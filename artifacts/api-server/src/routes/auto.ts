import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  autoSessions,
  startAutoRegistration,
  cancelAutoSession,
  createMailTmEmail,
} from "../lib/autoRegisterBot.js";
import { sessions as manualSessions, fillCheckoutPayment } from "../lib/manualRegistrationBot.js";
import { fetchRandomProxy, fetchRandomProxyRaw } from "../lib/proxyUtils.js";
import { sendDiscordDM } from "../lib/discordBot.js";

const router: IRouter = Router();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

function sessionToJson(s: ReturnType<typeof autoSessions.get>): object | null {
  if (!s) return null;
  return {
    id: s.id,
    email: s.email,
    password: s.password,
    status: s.status,
    logs: s.logs,
    createdAt: s.createdAt.toISOString(),
    autoMode: true,
    vncUrl: s.vncUrl,
  };
}

// ─── HTML helpers ──────────────────────────────────────────────────────────
function escHtml(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

interface AutopayJob {
  sessionId: string;
  checkoutUrl: string;
  email: string;
  status: "running" | "done" | "error";
  logs: string[];
  result?: string;
  startedAt: Date;
  discordUserId?: string;
}
const autopayJobs = new Map<string, AutopayJob>();

function buildJobHtml(jobId: string, job: AutopayJob): string {
  const isDone = job.status !== "running";
  const statusIcon = job.status === "done" ? "✅" : job.status === "error" ? "❌" : "⏳";
  const statusColor = job.status === "done" ? "#22c55e" : job.status === "error" ? "#ef4444" : "#3b82f6";
  const logsHtml = job.logs.map(l => `<div class="log">${escHtml(l)}</div>`).join("");

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AutoPay — ${escHtml(job.email)}</title>
  ${!isDone ? `<meta http-equiv="refresh" content="3">` : ""}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #0f172a; color: #e2e8f0; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 600px;
            width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,.5); }
    .title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .email { font-size: 14px; color: #94a3b8; margin-bottom: 24px; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px;
             border-radius: 999px; font-weight: 600; font-size: 14px; margin-bottom: 24px;
             background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor}44; }
    .result { background: #0f172a; border: 1px solid #334155; border-radius: 10px;
              padding: 12px 16px; font-size: 13px; color: #94a3b8; margin-bottom: 20px; }
    .result-success { background: #052e16; border: 1px solid #16a34a; border-radius: 12px;
              padding: 16px 20px; font-size: 15px; font-weight: 600; color: #4ade80;
              text-align: center; margin-bottom: 20px; }
    .result-error { background: #1a0a0a; border: 1px solid #dc2626; border-radius: 12px;
              padding: 16px 20px; font-size: 13px; color: #f87171; margin-bottom: 20px; }
    .logs-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase;
                  letter-spacing: .05em; margin-bottom: 10px; }
    .logs { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px;
            padding: 14px; max-height: 340px; overflow-y: auto; font-size: 12px;
            font-family: "JetBrains Mono", "Fira Code", monospace; line-height: 1.7; }
    .log { color: #94a3b8; border-bottom: 1px solid #1e293b; padding: 2px 0; }
    .log:last-child { border-bottom: none; color: #e2e8f0; }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid ${statusColor}44;
               border-top-color: ${statusColor}; border-radius: 50%;
               animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .footer { font-size: 11px; color: #475569; margin-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">⚡ AutoPay ChatGPT Business</div>
    <div class="email">📧 ${escHtml(job.email)}</div>
    <div class="badge">
      ${!isDone ? `<span class="spinner"></span>` : statusIcon}
      ${job.status === "running" ? "Sedang memproses pembayaran..." :
        job.status === "done" ? "Payment berhasil!" : "Payment gagal"}
    </div>
    ${job.result
      ? job.status === "done"
        ? `<div class="result-success">${escHtml(job.result)}</div>`
        : `<div class="result-error">💬 ${escHtml(job.result)}</div>`
      : ""
    }
    <div class="logs-title">Log Proses</div>
    <div class="logs" id="logs">${logsHtml || '<div class="log">Memulai...</div>'}</div>
    <div class="footer">
      ${isDone ? "Selesai" : "Halaman ini otomatis refresh setiap 3 detik..."} •
      Job: <code>${jobId}</code>
    </div>
  </div>
  <script>const el=document.getElementById("logs");if(el)el.scrollTop=el.scrollHeight;</script>
</body>
</html>`;
}

// ─── Autopay routes (HARUS sebelum /:sessionId agar tidak tershadow) ────────

// GET /api/autopay/job/:jobId/status — JSON status
router.get("/autopay/job/:jobId/status", (req, res): void => {
  const job = autopayJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job tidak ditemukan" }); return; }
  res.json({ status: job.status, logs: job.logs, result: job.result });
});

// GET /api/autopay/job/:jobId — halaman status autopay (auto-refresh setiap 3s)
router.get("/autopay/job/:jobId", (req, res): void => {
  const job = autopayJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>❌ Job tidak ditemukan</h2><p>Job <code>${req.params.jobId}</code> tidak ada.</p>
    </body></html>`);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildJobHtml(req.params.jobId, job));
});

// GET /api/autopay/:sessionId — klik link dari Discord → jalankan autopay
router.get("/autopay/:sessionId", async (req, res): Promise<void> => {
  const { sessionId } = req.params;

  // Cari session
  const autoSess = autoSessions.get(sessionId);
  const manSess = manualSessions.get(sessionId);
  const sess = autoSess ?? manSess;

  // Jika sudah ada job aktif untuk sesi ini, redirect ke sana
  const existingEntry = [...autopayJobs.entries()].find(([, j]) => j.sessionId === sessionId);
  if (existingEntry) {
    res.redirect(`/api/autopay/job/${existingEntry[0]}`);
    return;
  }

  let checkoutUrl = sess?.checkoutUrl ?? (req.query.url ? String(req.query.url) : undefined);
  const email = sess?.email ?? (req.query.email ? String(req.query.email) : "unknown");
  const queryPassword = req.query.password ? String(req.query.password) : null;

  if (!checkoutUrl) {
    // Jika session ada tapi checkout URL belum ready → tampilkan halaman tunggu
    if (sess) {
      const isFailed = sess.status === "failed" || sess.status === "cancelled";
      const statusText: Record<string, string> = {
        idle: "Memulai...",
        starting: "Membuka browser...",
        filling_email: "Mengisi email...",
        filling_password: "Mengisi password...",
        waiting_code: "Menunggu kode OTP...",
        filling_code: "Verifikasi kode OTP...",
        filling_profile: "Mengisi data profil...",
        success: "Registrasi selesai",
        failed: "Registrasi gagal",
        cancelled: "Dibatalkan",
      };
      const currentStatusText = statusText[sess.status] ?? sess.status;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AutoPay — Menunggu Registrasi</title>
  ${!isFailed ? `<meta http-equiv="refresh" content="4">` : ""}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #0f172a; color: #e2e8f0; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px 28px;
            max-width: 440px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,.5);
            text-align: center; }
    .icon { font-size: 40px; margin-bottom: 16px; }
    h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .sub { font-size: 14px; color: #94a3b8; margin-bottom: 24px; }
    .status-row { display: flex; align-items: center; justify-content: center;
                  gap: 10px; background: #0f172a; border: 1px solid #334155;
                  border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
    .spinner { display: inline-block; width: 16px; height: 16px;
               border: 2px solid #3b82f644; border-top-color: #3b82f6;
               border-radius: 50%; animation: spin .8s linear infinite; flex-shrink: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status-text { font-size: 13px; font-weight: 600; color: #93c5fd; }
    .email { font-size: 12px; color: #64748b; margin-top: 4px; }
    .note { font-size: 11px; color: #475569; }
    .err { color: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isFailed ? "❌" : "⏳"}</div>
    <h2>${isFailed ? "Registrasi Gagal" : "Menunggu Registrasi..."}</h2>
    <p class="sub">AutoPay akan otomatis dimulai setelah registrasi mencapai halaman pembayaran.</p>
    <div class="status-row">
      ${!isFailed ? `<span class="spinner"></span>` : ""}
      <span class="status-text ${isFailed ? "err" : ""}">
        ${isFailed ? "❌ " : ""}${escHtml(currentStatusText)}
      </span>
    </div>
    <p class="email">📧 ${escHtml(sess.email || sessionId)}</p>
    ${!isFailed ? `<p class="note" style="margin-top:12px">Halaman ini otomatis refresh setiap 4 detik...</p>` : ""}
  </div>
</body>
</html>`);
    } else {
      // Session tidak ditemukan sama sekali (mungkin server restart)
      res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AutoPay — Sesi Kedaluwarsa</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #0f172a; color: #e2e8f0; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px 28px;
            max-width: 440px; width: 100%; text-align: center; }
    .icon { font-size: 40px; margin-bottom: 16px; }
    h2 { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px;
           font-size: 12px; color: #64748b; }
    .tip { margin-top: 20px; background: #172033; border: 1px solid #1e3a5f;
           border-radius: 10px; padding: 14px; font-size: 13px; color: #60a5fa; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⏰</div>
    <h2>Sesi Kedaluwarsa</h2>
    <p>Link AutoPay ini sudah tidak valid karena sesi registrasi <code>${escHtml(sessionId)}</code> tidak ditemukan — kemungkinan server sempat restart.</p>
    <div class="tip">💡 Mulai registrasi baru di Discord dengan perintah <strong>/createGPT</strong> untuk mendapat link AutoPay yang fresh.</div>
  </div>
</body>
</html>`);
    }
    return;
  }

  const ccNumber = (await getSetting("cc_number"))?.trim() ?? "";
  if (!ccNumber) {
    res.status(400).send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>❌ CC Number belum dikonfigurasi</h2>
      <p>Isi <strong>CC Number</strong> di halaman Settings terlebih dahulu.</p>
    </body></html>`);
    return;
  }

  // Buat autopay job baru
  const jobId = Math.random().toString(36).slice(2, 10);
  const names = ["James","John","Michael","David","Robert","Sarah","Emily","Jessica","Ashley","Amanda"];
  const surnames = ["Kim","Park","Lee","Choi","Jung","Han","Yoon","Cho","Shin","Jang"];
  const cardholderName = sess?.presetName ??
    `${names[Math.floor(Math.random()*names.length)]} ${surnames[Math.floor(Math.random()*surnames.length)]}`;

  // Ambil proxy Korea dari GitHub (random) dan password session
  const [proxyUrl, sessionPassword] = await Promise.all([
    fetchRandomProxyRaw().catch(() => null),
    Promise.resolve(sess?.password ?? queryPassword),
  ]);

  const job: AutopayJob = {
    sessionId,
    checkoutUrl,
    email,
    status: "running",
    logs: [],
    startedAt: new Date(),
    discordUserId: sess?.discordUserId,
  };
  autopayJobs.set(jobId, job);

  // Jalankan payment di background
  (async () => {
    try {
      const result = await fillCheckoutPayment(
        checkoutUrl!,
        ccNumber,
        cardholderName,
        (msg) => {
          job.logs.push(`[${new Date().toLocaleTimeString("id-ID")}] ${msg}`);
          console.log(`[Autopay ${jobId}] ${msg}`);
        },
        {
          email: email !== "unknown" ? email : undefined,
          password: sessionPassword ?? undefined,
          proxyUrl: proxyUrl ?? undefined,
          sessionCookies: sess?.sessionCookies,
        }
      );
      job.status = result.ok ? "done" : "error";
      job.result = result.message;

      // Kirim DM Discord jika ada userId
      if (job.discordUserId) {
        const statusLine = result.ok
          ? `✅ **AutoPay Berhasil!**\n📧 \`${email}\`\n\n🎉 Pembayaran ChatGPT Business berhasil diproses. Akun sudah aktif!`
          : `❌ **AutoPay Gagal**\n📧 \`${email}\`\n\n💬 ${result.message}`;
        await sendDiscordDM(job.discordUserId, statusLine);
      }
    } catch (e: any) {
      job.status = "error";
      job.result = e.message;
      job.logs.push(`[error] ❌ ${e.message}`);
      if (job.discordUserId) {
        await sendDiscordDM(
          job.discordUserId,
          `❌ **AutoPay Error**\n📧 \`${email}\`\n\n\`\`\`${e.message.slice(0, 300)}\`\`\``
        );
      }
    }
  })();

  // Redirect langsung ke halaman status job
  res.redirect(`/api/autopay/job/${jobId}`);
});

// ─── Existing auto-registration routes ────────────────────────────────────

// POST /api/auto/start — mulai N sesi auto-register
router.post("/auto/start", async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body.count) || 1, 1), 20);
  const ccNumber = (await getSetting("cc_number")) ?? undefined;
  const sessions = [];
  for (let i = 0; i < count; i++) {
    try {
      const proxy = await fetchRandomProxy();
      const session = await startAutoRegistration(proxy, ccNumber);
      sessions.push(sessionToJson(session));
    } catch (e: any) {
      sessions.push({ error: e.message });
    }
  }
  res.json(sessions);
});

// GET /api/auto/sessions — daftar semua sesi aktif
router.get("/auto/sessions", (_req, res) => {
  const all = Array.from(autoSessions.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(sessionToJson)
    .filter(Boolean);
  res.json(all);
});

// GET /api/auto/sessions/:id — polling satu sesi
router.get("/auto/sessions/:id", (req, res): void => {
  const session = autoSessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "Sesi tidak ditemukan" }); return; }
  res.json(sessionToJson(session));
});

// DELETE /api/auto/sessions/:id — batalkan sesi
router.delete("/auto/sessions/:id", (req, res) => {
  cancelAutoSession(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/auto/sessions — batalkan semua sesi
router.delete("/auto/sessions", (_req, res) => {
  for (const id of autoSessions.keys()) {
    cancelAutoSession(id);
  }
  res.json({ ok: true });
});

// POST /api/auto/test-mailtm — tes koneksi mail.tm
router.post("/auto/test-mailtm", async (_req, res) => {
  try {
    const { email, token } = await createMailTmEmail();
    res.json({ ok: true, email, hasToken: !!token });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// GET /api/session/:id/screenshot — ambil screenshot live dari payment browser
router.get("/session/:id/screenshot", async (req, res) => {
  const session = manualSessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "Session tidak ditemukan" }); return; }
  if (!session.proxyPage) { res.status(409).json({ error: "Browser belum siap" }); return; }
  try {
    const buf = await session.proxyPage.screenshot({ type: "jpeg", quality: 75 });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-cache");
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/session/:id/click — forward tap ke payment browser
// Body: { x: number, y: number, imgW: number, imgH: number }
router.post("/session/:id/click", async (req, res) => {
  const session = manualSessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "Session tidak ditemukan" }); return; }
  if (!session.proxyPage) { res.status(409).json({ error: "Browser belum siap" }); return; }
  try {
    const { x, y, imgW, imgH } = req.body as { x: number; y: number; imgW: number; imgH: number };
    // Hitung viewport asli dari page
    const vp = session.proxyPage.viewportSize() ?? { width: 900, height: 700 };
    const clickX = Math.round((x / imgW) * vp.width);
    const clickY = Math.round((y / imgH) * vp.height);
    await session.proxyPage.mouse.click(clickX, clickY);
    res.json({ ok: true, clickX, clickY });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/session/:id/status-simple — status ringkas untuk checkout.html polling
router.get("/session/:id/status-simple", (req, res) => {
  const session = manualSessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: "not found" }); return; }
  res.json({ status: session.status, email: session.email });
});

export default router;
