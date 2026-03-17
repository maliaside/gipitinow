import {
  createSession,
  submitCode,
  cancelSession,
  runManualRegistration,
  ManualSession,
  sessions as manualSessions,
} from "./manualRegistrationBot.js";
import { generateRandomName, generateEmailPrefix } from "./nameGenerator.js";
import { CloudMailClient } from "./cloudMailClient.js";
import { db, settingsTable, accountsTable } from "@workspace/db";

export interface AutoSession extends ManualSession {
  mailTmToken: string;
  autoMode: true;
}

export const autoSessions = new Map<string, AutoSession>();

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getCloudMailSettings(): Promise<{
  baseUrl: string; adminEmail: string; adminPassword: string; emailPassword: string;
} | null> {
  try {
    const rows = await db.select().from(settingsTable);
    const s: Record<string, string> = {};
    for (const r of rows) s[r.key] = r.value;
    if (s.cloudmail_base_url && s.cloudmail_admin_email && s.cloudmail_admin_password) {
      return {
        baseUrl: s.cloudmail_base_url,
        adminEmail: s.cloudmail_admin_email,
        adminPassword: s.cloudmail_admin_password,
        emailPassword: s.cloudmail_email_password || "AutoReg@9944",
      };
    }
    return null;
  } catch { return null; }
}

// ── CloudMail approach: buat email dan poll OTP ──
async function createCloudMailEmail(
  cloudmail: { baseUrl: string; adminEmail: string; adminPassword: string; emailPassword: string },
  prefix: string
): Promise<{ email: string; emailPassword: string; client: CloudMailClient }> {
  const client = new CloudMailClient({
    baseUrl: cloudmail.baseUrl,
    adminEmail: cloudmail.adminEmail,
    adminPassword: cloudmail.adminPassword,
  });
  const domain = client.getDomain();
  const email = `${prefix}@${domain}`;
  await client.createMailbox(email, cloudmail.emailPassword);
  return { email, emailPassword: cloudmail.emailPassword, client };
}

// ── mail.tm approach (fallback) ──
export async function createMailTmEmail(prefix?: string): Promise<{ email: string; token: string }> {
  // Retry sampai 3x dengan email berbeda jika gagal
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("https://api.mail.tm/domains");
      if (!r.ok) throw new Error(`mail.tm domains API gagal: ${r.status}`);
      const j: any = await r.json();
      const domains: string[] = (j["hydra:member"] || []).map((d: any) => d.domain);
      if (!domains.length) throw new Error("Tidak dapat domain mail.tm");

      // Hindari sharebot jika ada domain lain
      const preferred = domains.find(d => !d.includes("sharebot")) ?? domains[0];
      // Gunakan prefix berbeda tiap retry agar tidak bentrok
      const rand = Math.floor(Math.random() * 90000 + 10000);
      const u = attempt === 0 ? (prefix ?? `user${rand}`) : `user${rand}${attempt}`;
      const email = `${u}@${preferred}`;
      const pw = "AutoReg@9944";

      const cr = await fetch("https://api.mail.tm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: email, password: pw }),
      });
      if (!cr.ok) {
        const errBody = await cr.text();
        throw new Error(`Gagal buat akun mail.tm: ${cr.status} — ${errBody}`);
      }

      // Tunggu sebentar sebelum ambil token (hindari race condition)
      await new Promise(r => setTimeout(r, 1500));

      const ar = await fetch("https://api.mail.tm/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: email, password: pw }),
      });
      if (!ar.ok) {
        // Coba sekali lagi dengan delay
        await new Promise(r => setTimeout(r, 3000));
        const ar2 = await fetch("https://api.mail.tm/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: email, password: pw }),
        });
        if (!ar2.ok) throw new Error(`Gagal ambil token mail.tm: ${ar2.status}`);
        const td2: any = await ar2.json();
        if (!td2.token) throw new Error("Token mail.tm kosong");
        return { email, token: td2.token };
      }

      const td: any = await ar.json();
      if (!td.token) throw new Error("Token mail.tm kosong");
      return { email, token: td.token };
    } catch (e: any) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Gagal buat email mail.tm setelah 3 percobaan");
}

async function pollMailTmOtp(
  token: string,
  sessionId: string,
  appendLogFn: (msg: string) => void,
  maxAttempts = 25
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(4000);
    const s = autoSessions.get(sessionId);
    if (!s || s.status === "cancelled") return "__CANCEL__";
    try {
      const r = await fetch("https://api.mail.tm/messages?page=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { appendLogFn(`⚠️ mail.tm fetch gagal: ${r.status}`); continue; }
      const d: any = await r.json();
      const msgs: any[] = d["hydra:member"] || [];
      if (msgs.length > 0) {
        const mr = await fetch(`https://api.mail.tm/messages/${msgs[0].id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!mr.ok) continue;
        const msg: any = await mr.json();
        const text: string = (msg.text || "") + (msg.html || "");
        const m = text.match(/\b(\d{6})\b/);
        if (m) { appendLogFn(`✅ OTP diterima dari mail.tm: ${m[1]}`); return m[1]; }
      }
      appendLogFn(`⏳ Polling OTP mail.tm (${i + 1}/${maxAttempts})...`);
    } catch (e: any) {
      appendLogFn(`⚠️ Error polling mail.tm: ${e.message}`);
    }
  }
  throw new Error("OTP mail.tm timeout setelah 100 detik");
}

export async function startAutoRegistration(
  proxy?: { server: string; username?: string; password?: string },
  ccNumber?: string,
  saveToDb: boolean = true
): Promise<AutoSession> {
  // Generate nama dulu, buat email dari nama
  const { firstName, lastName } = generateRandomName();
  const fullName = `${firstName} ${lastName}`;
  const emailPrefix = generateEmailPrefix(firstName, lastName);

  // Coba CloudMail user dulu (domain custom, misal mygpt.xxx)
  // Fallback ke mail.tm jika tidak dikonfigurasi
  let email: string;
  let useMailTm = false;
  let mailTmToken = "";
  let cloudMailClient: CloudMailClient | null = null;
  let cloudMailEmailPassword = "";

  const cloudmailConfig = await getCloudMailSettings();
  if (cloudmailConfig) {
    try {
      const result = await createCloudMailEmail(cloudmailConfig, emailPrefix);
      email = result.email;
      cloudMailClient = result.client;
      cloudMailEmailPassword = result.emailPassword;
    } catch (e: any) {
      // Fallback ke mail.tm jika CloudMail gagal
      console.log(`[AutoReg] CloudMail gagal: ${e.message} — fallback ke mail.tm`);
      const r = await createMailTmEmail(emailPrefix);
      email = r.email;
      mailTmToken = r.token;
      useMailTm = true;
    }
  } else {
    const r = await createMailTmEmail(emailPrefix);
    email = r.email;
    mailTmToken = r.token;
    useMailTm = true;
  }

  const base = createSession(email, "");
  const session = base as AutoSession;
  session.mailTmToken = mailTmToken;
  session.autoMode = true;
  session.presetName = fullName;
  autoSessions.set(session.id, session);

  const appendLog = (msg: string) => {
    const line = `[${new Date().toLocaleTimeString("id-ID")}] ${msg}`;
    session.logs.push(line);
    console.log(`[AutoSesi ${session.id}] ${msg}`);
  };

  const emailSource = cloudMailClient ? "CloudMail" : "mail.tm";
  appendLog(`🤖 Mode OTOMATIS aktif — ${fullName} — ${email} [${emailSource}]`);

  // OTP polling (async)
  (async () => {
    for (let i = 0; i < 90; i++) {
      await sleep(2000);
      if (session.status === "waiting_code") break;
      if (["cancelled", "failed", "success"].includes(session.status)) return;
    }
    if (session.status !== "waiting_code") return;
    appendLog(`📬 Status waiting_code — mulai polling OTP [${emailSource}]...`);
    try {
      let otp: string;
      if (useMailTm) {
        otp = await pollMailTmOtp(mailTmToken, session.id, appendLog);
      } else {
        // Poll CloudMail
        const code = await cloudMailClient!.waitForVerificationCode(
          email, cloudMailEmailPassword, 180,
          (msg) => appendLog(msg.replace("[邮件]", "📬"))
        );
        otp = code ?? "__TIMEOUT__";
        if (!code) otp = "__TIMEOUT__";
      }
      if (otp === "__CANCEL__") return;
      if (otp === "__TIMEOUT__") throw new Error("OTP CloudMail timeout");
      const ok = submitCode(session.id, otp);
      if (!ok) appendLog(`⚠️ submitCode gagal (sesi sudah tidak waiting_code)`);
    } catch (e: any) {
      appendLog(`❌ OTP auto-retrieval gagal: ${e.message}`);
      session.status = "failed";
    }
  })();

  runManualRegistration(session, proxy, ccNumber).then(async () => {
    if (session.status === "success") {
      if (saveToDb) {
        try {
          await db.insert(accountsTable).values({
            email: session.email,
            password: session.password,
            status: "active",
            notes: `Auto Register (${emailSource})`,
          });
          appendLog(`💾 Akun tersimpan ke database`);
        } catch (e: any) {
          appendLog(`⚠️ Gagal simpan ke DB: ${e.message}`);
        }
      }
      appendLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      appendLog(`✅ AKUN BERHASIL DIBUAT`);
      appendLog(`📧 Email    : ${session.email}`);
      appendLog(`🔑 Password : ${session.password}`);
      appendLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
  }).catch((e: any) => {
    appendLog(`❌ runManualRegistration error: ${e.message}`);
    if (!["success", "cancelled"].includes(session.status)) {
      session.status = "failed";
    }
  });

  return session;
}

export function cancelAutoSession(id: string) {
  cancelSession(id);
  autoSessions.delete(id);
  manualSessions.delete(id);
}
