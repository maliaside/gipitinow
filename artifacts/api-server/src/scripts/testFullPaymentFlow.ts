/**
 * Simulasi FULL end-to-end:
 * 1. Buat email mail.tm baru
 * 2. Signup ChatGPT (tanpa proxy)
 * 3. OTP auto-retrieve
 * 4. Isi profil → landing chatgpt.com
 * 5. Tampilkan IP sebelum proxy
 * 6. Aktifkan Korea proxy → tampilkan IP Korea
 * 7. /plans → dismiss semua modal
 * 8. Pricing modal → "Claim free offer"
 * 9. Isi Stripe CC
 * 10. Submit payment
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync } from "child_process";
(chromium as any).use(StealthPlugin());

// ── CONFIG ──────────────────────────────────────────────────────────────────
const PROXY_URL = "http://XwVJ7XC2nn60_custom_zone_KR_st__city_sid_75601476_time_0:2484611@change5.owlproxy.com:7778";
const CC_NUMBER = "6258142686060787";
const CC_EXP    = { month: "09", year: "2029" };
const CC_CVV    = "847";
const CC_NAME   = "Kimberly Perez";

// ── UTILS ────────────────────────────────────────────────────────────────────
function sleep(ms: number)  { return new Promise(r => setTimeout(r, ms)); }
function rnd(a: number, b: number) { return Math.floor(Math.random() * (b - a) + a); }

const TS = () => new Date().toISOString().slice(11, 19);
function log(msg: string)  { console.log(`[${TS()}] ${msg}`); }
function step(msg: string) { console.log(`\n[${TS()}] ${"═".repeat(60)}`); console.log(`[${TS()}] 👉 ${msg}`); }

function getChromium(): string {
  const candidates = [
    "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  ];
  for (const p of candidates) {
    try { execSync(`test -x ${p}`); return p; } catch {}
  }
  try { return execSync("which chromium").toString().trim(); } catch {}
  return "";
}

async function getIp(page: any): Promise<string> {
  const endpoints = [
    "https://api64.ipify.org?format=json",
    "https://httpbin.org/ip",
    "https://api.ipify.org?format=json",
  ];
  for (const ep of endpoints) {
    try {
      const r: any = await page.evaluate(async (url: string) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
          return res.json();
        } catch { return null; }
      }, ep);
      if (r) return r.ip || r.origin || "unknown";
    } catch {}
  }
  return "unknown";
}

// ── MAIL.TM ──────────────────────────────────────────────────────────────────
async function createMailTmEmail(): Promise<{ email: string; token: string }> {
  log("📬 Buat akun mail.tm...");
  const dr = await fetch("https://api.mail.tm/domains");
  const dj: any = await dr.json();
  const domain = dj["hydra:member"]?.[0]?.domain;
  if (!domain) throw new Error("Tidak bisa ambil domain mail.tm");
  const prefix  = `auto${Date.now()}${rnd(10, 99)}`;
  const email   = `${prefix}@${domain}`;
  const mailPw  = "AutoReg@9944";

  const cr = await fetch("https://api.mail.tm/accounts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPw }),
  });
  if (!cr.ok) throw new Error(`Gagal buat akun mail.tm: ${cr.status} ${await cr.text()}`);

  const tr = await fetch("https://api.mail.tm/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPw }),
  });
  if (!tr.ok) throw new Error(`Gagal ambil token mail.tm: ${tr.status}`);
  const tj: any = await tr.json();
  if (!tj.token) throw new Error("Token mail.tm kosong");

  log(`✅ Email: ${email}`);
  return { email, token: tj.token };
}

async function waitForOtp(token: string, maxWait = 120000): Promise<string> {
  log("⏳ Polling OTP dari mail.tm...");
  const deadline = Date.now() + maxWait;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    await sleep(4000);
    try {
      const r = await fetch("https://api.mail.tm/messages?page=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) continue;
      const d: any = await r.json();
      const msgs = (d["hydra:member"] || []) as any[];
      const fresh = msgs.filter((m: any) => Date.now() - new Date(m.createdAt).getTime() < 5 * 60 * 1000);
      if (fresh.length > 0) {
        const mr = await fetch(`https://api.mail.tm/messages/${fresh[0].id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const md: any = await mr.json();
        const body = (md.text || "") + (md.html || "");
        const m = body.match(/\b(\d{6})\b/);
        if (m) { log(`✅ OTP: ${m[1]} (attempt ${attempt})`); return m[1]; }
      }
      log(`  📭 OTP belum ada (attempt ${attempt})`);
    } catch (e: any) { log(`  ⚠️ Poll error: ${e.message}`); }
  }
  throw new Error("OTP timeout");
}

// ── CLOUDFLARE TURNSTILE WAIT ─────────────────────────────────────────────────
async function waitForCloudflareToPass(page: any, maxWaitSec = 40): Promise<boolean> {
  const start = Date.now();
  let wasPending = false;
  while (Date.now() - start < maxWaitSec * 1000) {
    const frames = page.frames();
    const cfFrame = frames.find((f: any) => f.url().includes("challenges.cloudflare.com"));
    if (cfFrame) {
      if (!wasPending) log("⚠️ Cloudflare Turnstile challenge terdeteksi — tunggu auto-resolve...");
      wasPending = true;
      await sleep(3000);
      // Check if challenge resolved (no more CF frame)
      const framesNow = page.frames();
      const cfStill = framesNow.find((f: any) => f.url().includes("challenges.cloudflare.com"));
      if (!cfStill) { log("✅ Cloudflare Turnstile selesai!"); return true; }
    } else {
      if (wasPending) { log("✅ CF frame hilang — challenge resolved!"); return true; }
      return true; // No CF challenge
    }
    await sleep(2000);
  }
  log("⚠️ Cloudflare Turnstile belum resolve setelah timeout");
  return false;
}

// ── MODAL DISMISS ─────────────────────────────────────────────────────────────
async function dismissAllModals(page: any, label: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try {
      const dismissed: string | null = await page.evaluate(() => {
        const closeTexts = [
          "Okay, let\u2019s go", "Okay, let's go",
          "Skip for now", "Skip", "Maybe later", "Not now",
          "Got it", "Done", "OK",
          "\u00d7", "\u2715",
        ];
        const btns = Array.from(document.querySelectorAll("button")) as HTMLElement[];
        for (const ct of closeTexts) {
          for (const btn of btns) {
            const t = btn.innerText.trim();
            if (t === ct || (ct.length > 3 && t.startsWith(ct.slice(0, 8)))) {
              (btn as HTMLButtonElement).click();
              return t;
            }
          }
        }
        return null;
      });
      if (dismissed) {
        log(`  [${label}] Dismissed modal: "${dismissed}"`);
        await sleep(2000);
      } else { break; }
    } catch { break; }
  }
}

// ── BROWSER LAUNCH ────────────────────────────────────────────────────────────
function getBrowserArgs(): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-setuid-sandbox", "--no-zygote",
    "--window-size=1280,900",
    "--disable-background-networking",
    "--disable-extensions",
  ];
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  step("START — Full End-to-End Simulation");

  const pUrl  = new URL(PROXY_URL);
  const pSrv  = `${pUrl.protocol}//${pUrl.hostname}:${pUrl.port}`;
  const pUser = decodeURIComponent(pUrl.username);
  const pPass = decodeURIComponent(pUrl.password);

  // ── 1. Buat email ─────────────────────────────────────────────────────────
  step("STEP 1: Buat email mail.tm");
  const { email, token: mailToken } = await createMailTmEmail();

  // ── 2. Launch browser (tanpa proxy) ──────────────────────────────────────
  step("STEP 2: Launch browser (fase signup — tanpa proxy)");
  const chromiumPath = getChromium();
  log(`🌐 Chromium: ${chromiumPath || "bundled"}`);
  const browser = await (chromium as any).launch({
    headless: true,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: getBrowserArgs(),
  });

  const ctx0 = await browser.newContext({
    locale: "en-US", timezoneId: "America/New_York",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx0.newPage();

  // Log navigasi
  page.on("framenavigated", (f: any) => {
    if (f === page.mainFrame()) log(`  nav → ${f.url().slice(0, 90)}`);
  });

  // Tampilkan IP tanpa proxy
  const ipNoProxy = await getIp(page);
  log(`🌐 IP (tanpa proxy): ${ipNoProxy}`);

  // ── 3. Buka chatgpt.com dan navigasi ke signup ─────────────────────────────
  step("STEP 3: Buka chatgpt.com → signup");
  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(3000);
  log(`URL: ${page.url()}`);

  // Klik "Sign up" / "Get started" dari halaman utama
  let clickedToSignup = false;
  for (const sel of [
    'a:has-text("Sign up")', 'button:has-text("Sign up")',
    'a:has-text("Get started")', 'button:has-text("Get started")',
    'a[href*="signup"]',
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click(); log(`✅ Klik signup: ${sel}`);
        clickedToSignup = true; await sleep(3000); break;
      }
    } catch {}
  }
  if (!clickedToSignup) {
    // Navigasi langsung ke auth signup URL
    await page.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2000);
  }
  log(`URL setelah klik signup: ${page.url()}`);

  // Klik "Sign up for free" / "Sign up" jika ada halaman splash auth
  for (const sel of [
    'button:has-text("Sign up for free")',
    'a:has-text("Sign up for free")',
    'button:has-text("Sign up")',
    '[data-testid="sign-up-link"]',
    'a:has-text("Don\'t have an account")',
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click(); log(`✅ Klik: ${sel}`);
        await sleep(3000); break;
      }
    } catch {}
  }
  log(`URL setelah sign-up-for-free: ${page.url()}`);

  // ── 4. Isi email ──────────────────────────────────────────────────────────
  step("STEP 4: Isi email");
  const bodyTxt0 = await page.evaluate(() => document.body.innerText).catch(() => "");
  log(`Konten auth (120): ${bodyTxt0.slice(0, 120).replace(/\n/g, " ")}`);
  log(`URL: ${page.url()}`);

  // Tunggu email input
  let emailFilled = false;
  for (const sel of [
    'input[name="email"]', 'input[type="email"]',
    'input[autocomplete="email"]', 'input[id*="email"]',
  ]) {
    try {
      const emailInput = page.locator(sel).first();
      await emailInput.waitFor({ state: "visible", timeout: 8000 });
      await emailInput.fill(email);
      log(`✅ Email: ${email} (${sel})`);
      emailFilled = true; break;
    } catch {}
  }
  if (!emailFilled) {
    log(`⚠️ Email input tidak ditemukan. URL: ${page.url()}`);
    const snap = await page.evaluate(() => document.body.innerText.slice(0, 200));
    log(`Body: ${snap.replace(/\n/g, " ")}`);
  }

  // Continue
  for (const sel of ['button:text-is("Continue")', 'button[type="submit"]', 'button:has-text("Continue")']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 5000 })) {
        await el.click(); log(`✅ Continue email`);
        await sleep(3000); break;
      }
    } catch {}
  }
  log(`URL setelah email: ${page.url()}`);

  // ── 5. Isi password ───────────────────────────────────────────────────────
  step("STEP 5: Isi password");
  const chatgptPw = `Ppsmmgl@${rnd(1000, 9999)}`;
  try {
    const pwInput = page.locator('input[type="password"], input[name="password"]').first();
    await pwInput.waitFor({ state: "visible", timeout: 10000 });
    for (const ch of chatgptPw) await page.keyboard.type(ch, { delay: rnd(40, 90) });
    log(`✅ Password: ${chatgptPw}`);
  } catch (e: any) { log(`⚠️ Password: ${e.message} | URL: ${page.url()}`); }

  for (const sel of ['button:text-is("Continue")', 'button[type="submit"]:not(:has-text("with"))']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click(); log(`✅ Submit signup`); await sleep(3000); break;
      }
    } catch {}
  }

  // ── 6. Terima OTP dari mail.tm ────────────────────────────────────────────
  step("STEP 6: OTP verification");
  await sleep(3000);
  log(`URL: ${page.url()}`);
  const otp = await waitForOtp(mailToken, 90000);

  // Isi OTP
  try {
    const otpInput = page.locator('input[autocomplete="one-time-code"], input[name="code"]').first();
    if (await otpInput.isVisible({ timeout: 5000 })) {
      await otpInput.fill(otp);
      log(`✅ OTP single input diisi`);
    } else {
      // Coba digit per digit
      const digits = page.locator('input[maxlength="1"]');
      const cnt = await digits.count();
      if (cnt >= 6) {
        for (let i = 0; i < 6; i++) {
          await digits.nth(i).fill(otp[i]); await sleep(80);
        }
        log(`✅ OTP diisi per digit (${cnt} kotak)`);
      }
    }
  } catch (e: any) { log(`⚠️ OTP input: ${e.message}`); }

  for (const sel of ['button:text-is("Continue")', 'button[type="submit"]:not(:has-text("with"))']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click(); log(`✅ Submit OTP`); await sleep(3000); break;
      }
    } catch {}
  }

  // ── 7. Isi profil dan tunggu chatgpt.com ──────────────────────────────────
  step("STEP 7: Isi profil + tunggu landing chatgpt.com");
  await sleep(2000);
  log(`URL: ${page.url()}`);

  // Handle about-you: isi nama + birthday + klik Continue
  for (let loop = 0; loop < 12; loop++) {
    await sleep(2000);
    const url = page.url();
    log(`  [loop ${loop+1}] URL: ${url.slice(0, 80)}`);

    // ✅ Sudah landing di chatgpt.com
    if (url.includes("chatgpt.com") && !url.includes("auth") && !url.includes("openai.com")) {
      log(`✅ Landing di chatgpt.com!`); break;
    }

    // Dismiss onboarding "What brings you to ChatGPT"
    const bodyNow = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (bodyNow.includes("What brings you") || (bodyNow.includes("School") && bodyNow.includes("Skip"))) {
      log(`🔄 Onboarding "What brings you" — Skip`);
      for (const sel of ['button:has-text("Skip")', 'a:has-text("Skip")']) {
        try {
          if (await page.locator(sel).first().isVisible({ timeout: 2000 })) {
            await page.locator(sel).first().click({ force: true });
            log(`✅ Skipped`); await sleep(2000); break;
          }
        } catch {}
      }
      continue;
    }

    // Profil about-you: isi nama + birthday
    if (url.includes("about-you") || url.includes("profile") || url.includes("openai.com")) {
      log(`📋 Halaman profil — isi nama & birthday`);

      // Isi nama via JS (React state compatible)
      try {
        await page.evaluate((name: string) => {
          const input = document.querySelector('input[name="name"]') as HTMLInputElement | null;
          if (!input) return;
          input.focus();
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          nativeInputValueSetter?.call(input, name);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, CC_NAME);
        await sleep(300);
        // Verify
        const val = await page.locator('input[name="name"]').inputValue().catch(() => "?");
        log(`  Nama: "${val}"`);
      } catch (e: any) {
        try {
          await page.locator('input[name="name"]').fill(CC_NAME);
          log(`  Nama (fallback fill)`);
        } catch {}
      }

      await sleep(300);

      // Isi birthday — try spinbuttons dulu (React Aria DatePicker)
      try {
        const spinbtns = page.locator('[role="spinbutton"]');
        const sbCount = await spinbtns.count();
        if (sbCount >= 3) {
          // month, day, year
          await spinbtns.nth(0).click(); await sleep(150); await page.keyboard.type("01"); await sleep(150);
          await spinbtns.nth(1).click(); await sleep(150); await page.keyboard.type("15"); await sleep(150);
          await spinbtns.nth(2).click(); await sleep(150); await page.keyboard.type("1995"); await sleep(150);
          log(`  Birthday via spinbutton: 01/15/1995`);
        } else if (sbCount === 2) {
          await spinbtns.nth(0).click(); await sleep(150); await page.keyboard.type("01"); await sleep(150);
          await spinbtns.nth(1).click(); await sleep(150); await page.keyboard.type("1995"); await sleep(150);
        }
      } catch {}

      // Try date input fallback
      try {
        const dateIn = page.locator('input[type="date"]').first();
        if (await dateIn.isVisible({ timeout: 1000 })) {
          await dateIn.fill("1995-01-15");
          log(`  Birthday via date input`);
        }
      } catch {}

      // Klik Continue/Next
      await sleep(500);
      let continueCLicked = false;
      for (const btnTxt of ["Continue", "Next", "Submit", "Agree", "Done"]) {
        try {
          const btn = page.locator(`button:has-text("${btnTxt}")`).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            const disabled = await btn.isDisabled().catch(() => false);
            if (!disabled) {
              await btn.click({ force: true });
              log(`  ✅ Klik "${btnTxt}"`);
              continueCLicked = true;
              await sleep(2000); break;
            } else {
              log(`  ⚠️ "${btnTxt}" disabled — coba Enter`);
              await page.keyboard.press("Enter");
              await sleep(2000); break;
            }
          }
        } catch {}
      }
      if (!continueCLicked) {
        await page.keyboard.press("Enter");
        await sleep(1000);
      }
    }
  }

  // ── 8. Verifikasi landing chatgpt.com & ambil cookies ─────────────────────
  step("STEP 8: Verifikasi landing + ambil cookies");
  const urlAtLanding = page.url();
  log(`URL: ${urlAtLanding}`);

  // Tunggu sampai benar-benar di chatgpt.com
  if (!urlAtLanding.includes("chatgpt.com") || urlAtLanding.includes("openai.com")) {
    log("⏳ Tunggu redirect ke chatgpt.com (max 40 detik)...");
    try {
      await page.waitForURL(
        (u: URL) => u.hostname.includes("chatgpt.com") && !u.href.includes("openai.com"),
        { timeout: 40000 }
      );
      log(`✅ Redirect ke: ${page.url()}`);
    } catch {
      log(`⚠️ waitForURL timeout — URL: ${page.url()}`);
      // Coba navigasi manual
      log("🔄 Navigasi manual ke chatgpt.com...");
      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(4000);
      // Dismiss onboarding
      const t = await page.evaluate(() => document.body.innerText).catch(() => "");
      if (t.includes("What brings you") || (t.includes("School") && t.includes("Skip"))) {
        try { await page.locator('button:has-text("Skip")').first().click({ force: true }); } catch {}
        await sleep(3000);
      }
    }
  }

  await sleep(3000);
  const landingTxt = await page.evaluate(() => document.body.innerText).catch(() => "");
  log(`Konten (80): ${landingTxt.slice(0, 80).replace(/\n/g, " ")}`);
  const isLoggedIn = landingTxt.includes("New chat") || landingTxt.includes("ChatGPT");
  log(`✅ Status login: ${isLoggedIn ? "MASUK" : "tidak pasti"}`);

  // Ambil semua cookies dari semua domain
  const cookies = await ctx0.cookies(["https://chatgpt.com", "https://auth.openai.com", "https://openai.com"]);
  log(`🍪 ${cookies.length} cookies tersimpan dari semua domain`);

  // Log cookie names penting
  const impCookies = cookies.filter((c: { name: string; domain: string }) => ["__cf_bm", "__Secure-next-auth.session-token", "oai-did", "oai-nav-state", "_puid"].some(n => c.name.includes(n)));
  log(`🔑 Cookies penting: ${impCookies.map((c: { name: string; domain: string }) => `${c.name.slice(0,30)}(${c.domain})`).join(", ")}`);

  // ── 9. Buat Korea proxy context ───────────────────────────────────────────
  step("STEP 9: Aktifkan Korea proxy — buat context baru");
  const ctxKR = await browser.newContext({
    proxy: { server: pSrv, username: pUser, password: pPass },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  await ctxKR.addCookies(cookies);
  const pKR = await ctxKR.newPage();

  pKR.on("framenavigated", (f: any) => {
    if (f === pKR.mainFrame()) log(`  KR nav → ${f.url().slice(0, 90)}`);
  });

  // Establish session + tampilkan IP Korea
  log("🌐 Buka chatgpt.com via Korea proxy...");
  let krConnected = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await pKR.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 40000 });
      krConnected = true; break;
    } catch (e: any) {
      log(`⚠️ KR attempt ${attempt}: ${e.message.slice(0, 70)}`);
      if (attempt < 6) await sleep(8000 + attempt * 2000);
    }
  }
  if (!krConnected) {
    // Coba navigasi yang lebih ringan (tanpa waitUntil)
    log("🔄 Coba navigasi ringan ke chatgpt.com...");
    try {
      await pKR.goto("https://chatgpt.com", { timeout: 50000 });
      krConnected = true;
    } catch (e: any) {
      log(`❌ Navigasi ringan juga gagal: ${e.message.slice(0, 70)}`);
    }
  }
  if (!krConnected) { log("❌ Korea proxy gagal konek"); await browser.close(); return; }

  await sleep(3000);
  const ipKorea = await getIp(pKR);
  log(`🌐 IP Korea proxy: ${ipKorea}`);

  if (pKR.url().includes("auth.openai.com") || pKR.url().includes("auth/login")) {
    log("❌ Session tidak valid di Korea proxy"); await browser.close(); return;
  }
  log(`✅ Session valid di Korea proxy! URL: ${pKR.url()}`);

  // ── 10. Cek IP Korea + dismiss onboarding ────────────────────────────────
  step("STEP 10: Cek IP Korea + dismiss onboarding");
  // Cek IP via navigasi ke ipify
  try {
    const ipPage = await ctxKR.newPage();
    await ipPage.goto("https://api64.ipify.org?format=json", { waitUntil: "domcontentloaded", timeout: 15000 });
    const ipBody = await ipPage.evaluate(() => document.body.innerText).catch(() => "{}");
    const ipKR2 = JSON.parse(ipBody).ip || "unknown";
    log(`🌐 IP Korea (via navigasi): ${ipKR2}`);
    await ipPage.close();
  } catch (e: any) { log(`⚠️ IP check gagal: ${e.message}`); }

  await dismissAllModals(pKR, "root");
  log("✅ Root onboarding handled");

  // ── 11. Buka /plans ───────────────────────────────────────────────────────
  step("STEP 11: Navigasi ke /plans");
  await pKR.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(5000);
  log(`URL plans: ${pKR.url()}`);

  // Cek IP saat plans
  try {
    const ipTmp = await pKR.evaluate(async () => {
      try {
        const r = await fetch("https://api64.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
        return (await r.json()).ip;
      } catch { return "fetch-blocked"; }
    });
    log(`🌐 IP saat /plans: ${ipTmp}`);
  } catch { log("🌐 IP saat /plans: fetch-blocked (normal karena CF)"); }

  // Tunggu plan content muncul (sambil CF resolve sendiri — jangan reload)
  log("⏳ Tunggu plan content muncul (max 90 detik)...");
  let planContentLoaded = false;
  for (let pw = 0; pw < 18; pw++) {
    await sleep(5000);
    const cfFrames = pKR.frames().filter((f: any) => f.url().includes("challenges.cloudflare.com"));
    const pt = await pKR.evaluate(() => document.body.innerText).catch(() => "");
    const hasPromo = pt.includes("Claim") || pt.includes("Free offer") || pt.includes("Plus") || pt.includes("Subscribe") || pt.includes("무료");
    log(`  ⏳ Wait ${pw+1}: CF=${cfFrames.length}, promo=${hasPromo}, text50: ${pt.slice(0, 50).replace(/\n/g, " ")}`);
    if (hasPromo && cfFrames.length === 0) {
      log(`✅ Plan content loaded! (no CF)`);
      planContentLoaded = true; break;
    }
    if (hasPromo && cfFrames.length > 0) {
      log(`  ℹ️ Content ada tapi CF masih aktif — tunggu CF resolve...`);
    }
  }

  // Dismiss "Tips for getting started" atau modal apapun di /plans
  await dismissAllModals(pKR, "plans");
  await sleep(2000);

  const plansTxt = await pKR.evaluate(() => document.body.innerText).catch(() => "");
  log(`📋 Plans text (400): ${plansTxt.slice(0, 400).replace(/\n/g, " ")}`);
  const allBtns = await pKR.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map((b: any) => b.innerText.trim()).filter((t: string) => t.length > 0)
  ).catch(() => [] as string[]);
  log(`🖱️ Semua tombol di /plans: ${JSON.stringify(allBtns)}`);

  // ── 12a. Klik "Continue" pada Korea consent modal (jika ada) ────────────
  step("STEP 12a: Dismiss Korea consent modal (Continue/Accept)");
  // Klik "Continue" Korea privacy consent dulu
  for (let ci = 0; ci < 5; ci++) {
    const bodyC = await pKR.evaluate(() => document.body.innerText).catch(() => "");
    const hasConsent = bodyC.includes("you agree to our Terms") || bodyC.includes("Korea addendum") || bodyC.includes("Privacy Policy and its Korea");
    if (!hasConsent) { log("✅ Tidak ada Korea consent modal"); break; }
    log(`  [${ci+1}] Korea consent terdeteksi — klik Continue...`);
    try {
      // Klik via JS — cari tombol "Continue" yang bukan disabled
      const clicked = await pKR.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
        const cont = btns.find(b => b.innerText.trim() === "Continue" && !b.disabled);
        if (cont) { cont.click(); return true; }
        return false;
      });
      if (clicked) { log(`  ✅ Continue clicked (JS)`); await sleep(2000); break; }
    } catch {}
    // Fallback Playwright
    try {
      const btn = pKR.locator('button:text-is("Continue")').first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click({ force: true }); log(`  ✅ Continue (Playwright)`); await sleep(2000); break;
      }
    } catch {}
    await sleep(1000);
  }

  // ── 12b. Klik "Free offer" navbar atau "Claim offer" sidebar ─────────────
  step("STEP 12b: Klik promo button (Free offer / Claim offer)");
  const allBtns2 = await pKR.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map((b: any) => b.innerText.trim()).filter((t: string) => t.length > 0)
  ).catch(() => [] as string[]);
  log(`🖱️ Tombol setelah consent: ${JSON.stringify(allBtns2)}`);

  let promoClicked = false;

  const promoSelectors = [
    'button:has-text("Free offer")',    // navbar utama
    'button:has-text("Claim offer")',   // sidebar
    'button:has-text("Claim free")',    // kalau langsung ke pricing modal
    'button:has-text("무료")',
  ];
  for (const sel of promoSelectors) {
    try {
      const btn = pKR.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click({ force: true });
        log(`✅ Klik promo: "${sel}"`);
        promoClicked = true;
        await sleep(4000);
        break;
      }
    } catch {}
  }
  if (!promoClicked) log("⚠️ Promo button tidak ditemukan");
  log(`URL setelah promo click: ${pKR.url()}`);

  // Dismiss modal yang muncul (Tips / Onboarding setelah promo klik)
  await dismissAllModals(pKR, "after-promo");
  await sleep(1000);

  // Dump tombol setelah klik promo
  const btnsAfterPromo = await pKR.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map((b: any) => b.innerText.trim()).filter((t: string) => t.length > 0)
  ).catch(() => [] as string[]);
  log(`🖱️ Tombol setelah klik promo: ${JSON.stringify(btnsAfterPromo)}`);

  // ── 13. Cek pricing modal → klik "Claim free offer" ──────────────────────
  step("STEP 13: Klik 'Claim free offer' di pricing modal");
  await sleep(2000);

  const pricingTxt = await pKR.evaluate(() => document.body.innerText).catch(() => "");
  log(`📋 Pricing text setelah promo klik (400): ${pricingTxt.slice(0, 400).replace(/\n/g, " ")}`);

  // Klik "Claim free offer" di pricing modal — coba via JS dulu (paling reliable)
  let claimFreeClicked = false;
  const claimSelectors = [
    'Claim free offer',
    'Claim free',
    'Try Business for free',
    'Start Business',
    'Try for free',
  ];
  // JS click dulu
  for (const txt of claimSelectors) {
    try {
      const clicked = await pKR.evaluate((t: string) => {
        const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
        const b = btns.find(btn => btn.innerText.includes(t));
        if (b) { b.click(); return b.innerText.trim(); }
        return null;
      }, txt);
      if (clicked) {
        log(`✅ Klik via JS: "${clicked}"`);
        claimFreeClicked = true;
        await sleep(5000); break;
      }
    } catch {}
  }
  // Playwright fallback
  if (!claimFreeClicked) {
    for (const sel of [
      'button:has-text("Claim free offer")',
      'button:has-text("Claim free")',
      'button:has-text("Try Business")',
      'button:has-text("Start free")',
    ]) {
      try {
        const btn = pKR.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click({ force: true });
          log(`✅ Klik Playwright: "${sel}"`);
          claimFreeClicked = true;
          await sleep(5000); break;
        }
      } catch {}
    }
  }
  if (!claimFreeClicked) {
    await pKR.screenshot({ path: "/tmp/before_stripe.png" });
    log("⚠️ 'Claim free offer' tidak ditemukan — cek /tmp/before_stripe.png");
  }

  // ── 14. Tunggu /checkout redirect ATAU Stripe modal iframe ───────────────
  step("STEP 14: Tunggu Stripe Checkout");
  let checkoutReached = false;
  let onCheckoutPage = false;

  for (let attempt = 0; attempt < 25; attempt++) {
    await sleep(4000);

    const curUrl = pKR.url();

    // Dismiss modal jika muncul
    try {
      const bodyNow = await pKR.evaluate(() => document.body.innerText).catch(() => "");
      if (bodyNow.includes("What brings you") || (bodyNow.includes("School") && bodyNow.includes("Skip"))) {
        log(`🔄 Onboarding muncul — dismiss`);
        try { await pKR.locator('button:has-text("Skip")').first().click({ force: true }); } catch {}
        await sleep(2000);
      }
      if (bodyNow.includes("Korea addendum") || bodyNow.includes("you agree to our Terms")) {
        log(`🔄 Korea consent — klik Continue`);
        await pKR.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find((btn: any) => btn.innerText.trim() === "Continue");
          if (b) (b as any).click();
        });
        await sleep(2000);
      }
      if (bodyNow.includes("Tips for getting") || bodyNow.includes("Okay, let")) {
        await dismissAllModals(pKR, `stripe-wait-${attempt}`);
      }
    } catch {}

    const frames = pKR.frames();
    const sFrames = frames.filter((f: any) => f.url().includes("stripe.com") || f.url().includes("js.stripe"));
    const inputFrames = frames.filter((f: any) =>
      f.url().includes("elements-inner") || f.url().includes("m.stripe.com") ||
      (f.url().includes("stripe.com") && (f.url().includes("cardNumber") || f.url().includes("card-") || f.url().includes("payment-")))
    );

    log(`  Attempt ${attempt+1}: url=${curUrl.slice(0, 60)} | frames=${frames.length} | stripe=${sFrames.length} | input=${inputFrames.length}`);
    for (const f of frames) {
      const u = f.url();
      if (u && u !== "about:blank" && !u.includes("chrome-error") && !u.includes("challenges.cloudflare")) {
        log(`    → ${u.slice(0, 100)}`);
      }
    }

    // ✅ CASE A: Sudah redirect ke /checkout URL (Stripe Hosted Checkout)
    if (curUrl.includes("/checkout/")) {
      log(`✅ CHECKOUT URL terdeteksi: ${curUrl.slice(0, 80)}`);
      checkoutReached = true;
      onCheckoutPage = true;
      break;
    }

    // ✅ CASE B: Stripe input iframe muncul dalam halaman modal
    if (inputFrames.length > 0) {
      log(`✅ Stripe INPUT frame ditemukan!`);
      checkoutReached = true;
      onCheckoutPage = false;
      break;
    }

    // Re-klik promo setelah 3 dan 8 attempt jika belum ada
    if (sFrames.length === 0 && (attempt === 2 || attempt === 7)) {
      log(`🔄 Re-klik promo (attempt ${attempt+1})...`);
      for (const sel of [
        'button:has-text("Claim free offer")',
        'button:has-text("Claim free")',
        'button:has-text("Claim offer")',
        'button:has-text("Free offer")',
      ]) {
        try {
          const btn = pKR.locator(sel).first();
          if (await btn.isVisible({ timeout: 1500 })) {
            await btn.click({ force: true });
            log(`  Re-klik: "${sel}"`);
            await sleep(3000); break;
          }
        } catch {}
      }
    }
  }

  if (!checkoutReached) {
    await pKR.screenshot({ path: "/tmp/no_stripe.png" });
    log("❌ Checkout tidak tercapai — cek /tmp/no_stripe.png");
    await browser.close(); return;
  }

  // ── 15. Isi form checkout ─────────────────────────────────────────────────
  step("STEP 15: Isi data di Checkout");
  log(`IP saat checkout: ${await getIp(pKR)}`);

  if (onCheckoutPage) {
    // Stripe hosted checkout di /checkout/openai_llc/cs_live_...
    log("📋 Mode: Stripe Hosted Checkout di /checkout URL");

    // ─── a) Tunggu networkidle + baca raw HTML ───────────────────────────
    log("⏳ Tunggu networkidle di /checkout...");
    try {
      await pKR.waitForLoadState("networkidle", { timeout: 30000 });
      log("✅ networkidle tercapai");
    } catch { log("⚠️ networkidle timeout — lanjut"); }

    await sleep(5000);
    await pKR.screenshot({ path: "/tmp/checkout_load.png" });
    log("📸 /tmp/checkout_load.png (state awal checkout)");

    // Debug: raw HTML body
    const rawHtml = await pKR.evaluate(() => document.body.innerHTML.slice(0, 800)).catch(() => "");
    log(`📄 Raw HTML body (800): ${rawHtml.replace(/\n/g, " ").slice(0, 600)}`);

    // Debug: cari semua iframe di DOM
    const iframesSrc = await pKR.evaluate(() =>
      Array.from(document.querySelectorAll("iframe")).map((f: any) => f.src || f.id || "(no src)")
    ).catch(() => [] as string[]);
    log(`🖼️ iframes di DOM: ${JSON.stringify(iframesSrc)}`);

    // Dump semua frames Playwright (termasuk cross-origin)
    const framesCheckout = pKR.frames();
    log(`Total Playwright frames: ${framesCheckout.length}`);
    for (const f of framesCheckout) {
      const u = f.url();
      if (u && u !== "about:blank" && !u.includes("chrome-error")) {
        log(`  frame → ${u.slice(0, 120)}`);
      }
    }

    // Tunggu body punya teks NYATA (React sudah render), maks 90s
    log("⏳ Tunggu React render di /checkout (maks 90s)...");
    let bodyRendered = false;
    for (let bw = 0; bw < 30; bw++) {
      await sleep(3000);
      const bt = await pKR.evaluate(() => document.body.innerText).catch(() => "");
      const fs = pKR.frames();
      log(`  body-wait ${bw+1}: chars=${bt.length} | frames=${fs.length}`);
      if (bt.length > 80) {
        log(`✅ React render: "${bt.slice(0, 120).replace(/\n/g, " ")}"`);
        bodyRendered = true;
        break;
      }
    }
    if (!bodyRendered) {
      log("⚠️ Body masih kosong setelah 90s — coba reload...");
      const checkoutUrlNow = pKR.url();
      await pKR.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await sleep(5000);
      // Tunggu lagi 60s
      for (let bw2 = 0; bw2 < 20; bw2++) {
        await sleep(3000);
        const bt2 = await pKR.evaluate(() => document.body.innerText).catch(() => "");
        log(`  body-wait-reload ${bw2+1}: chars=${bt2.length}`);
        if (bt2.length > 80) {
          log(`✅ React render setelah reload!`);
          bodyRendered = true;
          break;
        }
      }
      if (!bodyRendered) log("❌ Body masih kosong setelah reload — skip checkout");
    }

    const checkoutContent = await pKR.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "");
    log(`Konten final: ${checkoutContent.replace(/\n/g, " ").slice(0, 300)}`);

    // ─── b) Isi email + trigger payment section ──────────────────────────
    for (const sel of ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]', 'input[id*="email"]']) {
      try {
        const el = pKR.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          const cur = await el.inputValue().catch(() => "");
          if (!cur) {
            await el.fill(email);
            await el.press("Tab"); // Trigger onBlur
            log(`✅ Email diisi + Tab: ${email}`);
          } else {
            log(`✅ Email sudah ada: ${cur}`);
          }
          await sleep(800); break;
        }
      } catch {}
    }

    // Klik "Payment method" area untuk trigger Stripe Elements load
    for (const sel of [
      'text=Payment method', '[data-testid*="payment"]',
      'text=Card number', 'text=Credit card', 'section:has-text("Payment")',
      'div:has-text("Payment method") button', 'label:has-text("Card")',
    ]) {
      try {
        const el = pKR.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click({ force: true });
          log(`🖱️ Klik payment area: "${sel}"`);
          await sleep(2000); break;
        }
      } catch {}
    }

    // Log semua input yang ada di main page saat ini
    const mainInputs = await pKR.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map((i: any) => `${i.type}|${i.name}|${i.placeholder}|${i.autocomplete}`)
    ).catch(() => [] as string[]);
    log(`Main page inputs: ${JSON.stringify(mainInputs)}`);

    // ─── c) Tunggu Stripe EmbeddedCheckout frame ─────────────────────────
    // m.stripe.network/inner = entire checkout UI (plan, email, CC, submit)
    // elements-inner-* = individual CC field sub-frames
    log("⏳ Tunggu Stripe Embedded frame (maks 90s)...");
    let mInnerFrame: any = null;   // m.stripe.network/inner — full checkout UI
    let elemInnerFrames: any[] = []; // elements-inner-* — individual CC inputs

    for (let w = 0; w < 30; w++) {
      await sleep(3000);
      const allF = pKR.frames();
      const allStripeF = allF.filter((f: any) => {
        const u = f.url();
        return u.includes("stripe.com") || u.includes("js.stripe") || u.includes("stripe.network");
      });
      mInnerFrame = allF.find((f: any) => f.url().includes("stripe.network"));
      elemInnerFrames = allF.filter((f: any) => f.url().includes("elements-inner"));
      const bodyLen = (await pKR.evaluate(() => document.body.innerText.length).catch(() => 0));
      log(`  cc-wait ${w+1}: frames=${allF.length} stripe=${allStripeF.length} mInner=${!!mInnerFrame} elemInner=${elemInnerFrames.length} body=${bodyLen}`);
      for (const f of allF) {
        const u = f.url();
        if (u && u !== "about:blank" && !u.includes("chrome-error")) {
          log(`    → ${u.slice(0, 120)}`);
        }
      }
      if (mInnerFrame || elemInnerFrames.length > 0) {
        log("✅ Stripe frame ditemukan!");
        if (mInnerFrame) {
          const innerTxt = await mInnerFrame.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
          log(`  m.stripe.network content: "${innerTxt.replace(/\n/g, " ").slice(0, 150)}"`);
          const innerInputs = await mInnerFrame.evaluate(() =>
            Array.from(document.querySelectorAll("input")).map((i: any) => `${i.type}|${i.name}|${i.placeholder}`)
          ).catch(() => [] as string[]);
          log(`  m.stripe.network inputs: ${JSON.stringify(innerInputs)}`);
        }
        break;
      }
      if (w === 9) {
        const h2 = await pKR.evaluate(() => document.body.innerHTML.slice(0, 1000)).catch(() => "");
        log(`📄 HTML after 30s: ${h2.replace(/\n/g, " ").slice(0, 400)}`);
        await pKR.screenshot({ path: "/tmp/checkout_30s.png" });
        log("📸 /tmp/checkout_30s.png");
      }
    }

    // ─── d) Isi semua field secara spesifik per frame ───────────────────
    const paymentFrame = elemInnerFrames.find((f: any) => f.url().includes("elements-inner-payment"));
    const addressFrame = elemInnerFrames.find((f: any) => f.url().includes("elements-inner-address"));

    // 1) Email di main page + uncheck "I'm purchasing as business"
    log("\n📧 Isi email di main page...");
    for (const sel of ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]']) {
      try {
        const el = pKR.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          const cur = await el.inputValue().catch(() => "");
          if (!cur || cur !== email) {
            await el.click({ clickCount: 3 });
            await el.fill(email);
            await el.press("Tab");
            log(`  ✅ Email: ${email}`);
          } else {
            log(`  ✅ Email sudah ada: ${cur}`);
          }
          await sleep(600); break;
        }
      } catch {}
    }

    // 2) Billing address di elements-inner-address frame
    if (addressFrame) {
      log("\n🏠 Isi billing address...");
      // Dump semua inputs DAN selects di address frame
      const addrAll = await addressFrame.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input")).map((i: any) =>
          `input|${i.name}|${i.autocomplete}|${i.placeholder}`);
        const selects = Array.from(document.querySelectorAll("select")).map((s: any) =>
          `select|${s.name}|${s.autocomplete}|options:${s.options.length}`);
        return [...inputs, ...selects];
      }).catch(() => [] as string[]);
      log(`  Address elements: ${JSON.stringify(addrAll)}`);

      // Pilih Country = Korea (KR) — React-aware via JS evaluate
      try {
        const countrySet = await addressFrame.evaluate(() => {
          const sel = document.querySelector('select[autocomplete="billing country"], select[name="country"]') as HTMLSelectElement;
          if (!sel) return "not-found";
          // Set value + dispatch synthetic events for React
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
          if (nativeSetter) nativeSetter.call(sel, "KR");
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          sel.dispatchEvent(new Event("input", { bubbles: true }));
          return `set-KR (was: ${sel.value})`;
        });
        log(`  ✅ Country JS: ${countrySet}`);
        await sleep(2000); // wait for React re-render (state update may cause province to reload)
      } catch (e) { log(`  ⚠️ Country select: ${e}`); }

      // Billing name — scroll + force click agar meski di luar viewport
      for (const sel of ['input[name="name"]', 'input[autocomplete="billing name"]', 'input']) {
        try {
          const el = addressFrame.locator(sel).first();
          await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await el.click({ force: true, timeout: 2000 });
          await el.fill(CC_NAME);
          log(`  ✅ Billing name: ${CC_NAME} (sel: ${sel})`); await sleep(400); break;
        } catch {}
      }
      // Address line 1
      for (const sel of ['input[name="addressLine1"]', 'input[autocomplete="billing address-line1"]']) {
        try {
          const el = addressFrame.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click(); await el.fill("123 Gangnam-daero");
            log(`  ✅ Address: 123 Gangnam-daero`); await sleep(400); break;
          }
        } catch {}
      }
      // City / locality
      for (const sel of ['input[name="locality"]', 'input[autocomplete="billing address-level2"]']) {
        try {
          const el = addressFrame.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click(); await el.fill("Seoul");
            log(`  ✅ City: Seoul`); await sleep(400); break;
          }
        } catch {}
      }
      // Province/state (might be select or input for Korea)
      try {
        const stateEl = addressFrame.locator('select[autocomplete="billing address-level1"], select[name="administrativeArea"]').first();
        if (await stateEl.isVisible({ timeout: 2000 })) {
          // For Korea, try selecting Seoul province
          await stateEl.selectOption({ label: "Seoul" }).catch(() =>
            stateEl.selectOption({ index: 1 })
          );
          log("  ✅ Province select: Seoul");
          await sleep(400);
        }
      } catch {}
      for (const sel of ['input[autocomplete="billing address-level1"]', 'input[name="administrativeArea"]']) {
        try {
          const el = addressFrame.locator(sel).first();
          if (await el.isVisible({ timeout: 1500 })) {
            await el.click(); await el.fill("Seoul");
            log(`  ✅ Province input: Seoul`); await sleep(400); break;
          }
        } catch {}
      }
      // Postal code
      for (const sel of ['input[name="postalCode"]', 'input[autocomplete="billing postal-code"]']) {
        try {
          const el = addressFrame.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click(); await el.fill("06236");
            log(`  ✅ Postal: 06236`); await sleep(400); break;
          }
        } catch {}
      }
    }

    // 2b) Uncheck "I'm purchasing as business" SETELAH country KR dipilih (bisa auto-trigger)
    log("\n🔲 Cek & uncheck 'I'm purchasing as business'...");
    try {
      // Gunakan Playwright click() agar synthetic events ter-trigger dengan benar
      const bizChk = pKR.locator('input[type="checkbox"]').first();
      const isVisible = await bizChk.isVisible({ timeout: 2000 }).catch(() => false);
      const isChecked = isVisible ? await bizChk.isChecked().catch(() => false) : false;
      log(`  Checkbox visible=${isVisible} checked=${isChecked}`);
      if (isVisible && isChecked) {
        await bizChk.click({ force: true });
        await sleep(1200);
        const nowChecked = await bizChk.isChecked().catch(() => true);
        log(`  Setelah click: checked=${nowChecked}`);
        if (nowChecked) {
          // Fallback: JS click
          await pKR.evaluate(() => {
            const c = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (c) c.click();
          });
          await sleep(800);
          log("  JS fallback click done");
        }
      }
      // Cek apakah business name input sekarang muncul (untuk di-fill jika masih wajib)
      await sleep(500);
      const mainInputsNow = await pKR.evaluate(() =>
        Array.from(document.querySelectorAll("input")).map((i: any) => `${i.type}|${i.name}|${i.placeholder}`)
      ).catch(() => [] as string[]);
      log(`  Main inputs sekarang: ${JSON.stringify(mainInputsNow)}`);

      // Isi Seats = 1 jika ada
      const seatsIn = mainInputsNow.find((s: string) => s.includes("seats") || s.includes("number|seats"));
      if (seatsIn) {
        for (const sel of ['input[name="seats"]', 'input[type="number"]']) {
          try {
            const el = pKR.locator(sel).first();
            if (await el.isVisible({ timeout: 1500 })) {
              const cur = await el.inputValue().catch(() => "");
              if (cur !== "1") { await el.fill("1"); log("  ✅ Seats: 1"); }
              break;
            }
          } catch {}
        }
      }

      // Jika business name input muncul, isi
      if (mainInputsNow.some((s: string) => s.includes("businessName") || s.includes("Business name"))) {
        for (const sel of ['input[name="businessName"]', 'input[placeholder*="Business name"]']) {
          try {
            const el = pKR.locator(sel).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.fill("Kimberly Corp");
              log("  ✅ Business name: Kimberly Corp");
              await sleep(300); break;
            }
          } catch {}
        }
      }
    } catch (e) { log(`  ⚠️ business checkbox: ${e}`); }

    // 3) CC di elements-inner-payment frame
    if (paymentFrame) {
      log("\n💳 Isi CC di elements-inner-payment...");
      const fInputs = await paymentFrame.evaluate(() =>
        Array.from(document.querySelectorAll("input")).map((i: any) =>
          `${i.type}|${i.name}|${i.placeholder}|${i.autocomplete}`
        )
      ).catch(() => [] as string[]);
      log(`  Frame inputs: ${JSON.stringify(fInputs)}`);

      let cardFilled = false, expFilled = false, cvvFilled = false;

      // Card number
      for (const sel of ['input[name="number"]', 'input[autocomplete="cc-number"]', 'input[placeholder*="1234"]']) {
        try {
          const el = paymentFrame.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 })) {
            await el.click(); await sleep(400);
            await el.pressSequentially(CC_NUMBER, { delay: 100 });
            log(`  ✅ Card number: ${CC_NUMBER.slice(0,4)}xxxx`);
            await sleep(600); cardFilled = true; break;
          }
        } catch {}
      }
      // Expiry
      for (const sel of ['input[name="expiry"]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]']) {
        try {
          const el = paymentFrame.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 })) {
            await el.click(); await sleep(400);
            await el.pressSequentially(`${CC_EXP.month} / ${CC_EXP.year.slice(-2)}`, { delay: 100 });
            log(`  ✅ Expiry: ${CC_EXP.month}/${CC_EXP.year.slice(-2)}`);
            await sleep(600); expFilled = true; break;
          }
        } catch {}
      }
      // CVC
      for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="CVC"]']) {
        try {
          const el = paymentFrame.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 })) {
            await el.click(); await sleep(400);
            await el.pressSequentially(CC_CVV, { delay: 100 });
            log(`  ✅ CVV: ${CC_CVV}`);
            await sleep(600); cvvFilled = true; break;
          }
        } catch {}
      }
      log(`  Ringkasan CC: card=${cardFilled} exp=${expFilled} cvv=${cvvFilled}`);
    } else {
      // Fallback — coba semua elemInner frames
      for (const target of elemInnerFrames.length > 0 ? elemInnerFrames : [mInnerFrame ?? pKR]) {
        const tUrl = typeof target.url === "function" ? target.url().slice(0, 60) : "main";
        log(`\n💳 Fallback CC di: ${tUrl}`);
        const fIn = await target.evaluate(() =>
          Array.from(document.querySelectorAll("input")).map((i: any) => `${i.name}|${i.placeholder}`)
        ).catch(() => [] as string[]);
        log(`  Inputs: ${JSON.stringify(fIn)}`);
        for (const [sel, val, lbl] of [
          ['input[name="number"]', CC_NUMBER, "card"],
          ['input[autocomplete="cc-number"]', CC_NUMBER, "card"],
          ['input[name="expiry"]', `${CC_EXP.month} / ${CC_EXP.year.slice(-2)}`, "exp"],
          ['input[name="cvc"]', CC_CVV, "cvv"],
        ] as [string,string,string][]) {
          try {
            const el = target.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              await el.click(); await sleep(300);
              await el.pressSequentially(val, { delay: 100 });
              log(`  ✅ ${lbl}`); await sleep(500);
            }
          } catch {}
        }
      }
    }

    // Fallback: Jika "Business name is required" masih muncul, isi business fields
    await sleep(500);
    const checkTxt = await pKR.evaluate(() => document.body.innerText).catch(() => "");
    if (checkTxt.includes("business") || checkTxt.includes("KR BRN") || checkTxt.includes("Business name")) {
      log("🔧 Business fields masih muncul — coba isi sebagai fallback...");
      // Business name
      for (const sel of [
        'input[name="businessName"]', 'input[placeholder*="Business name"]',
        'input[aria-label*="Business name"]', 'input[aria-label*="business name"]',
      ]) {
        try {
          const el = pKR.locator(sel).first();
          if (await el.isVisible({ timeout: 1500 })) {
            await el.fill("Kimberly Corp");
            log(`  ✅ Business name: Kimberly Corp`); await sleep(300); break;
          }
        } catch {}
      }
      // KR BRN (Korean Business Registration Number - format: XXX-XX-XXXXX)
      for (const sel of [
        'input[name="taxId"]', 'input[placeholder*="BRN"]', 'input[placeholder*="Registration"]',
        'input[aria-label*="BRN"]', 'input[aria-label*="tax"]',
      ]) {
        try {
          const el = pKR.locator(sel).first();
          if (await el.isVisible({ timeout: 1500 })) {
            await el.fill("123-45-67890");
            log(`  ✅ KR BRN: 123-45-67890`); await sleep(300); break;
          }
        } catch {}
      }
    }

    // Screenshot setelah semua field diisi
    await pKR.screenshot({ path: "/tmp/after_fill.png" });
    log("📸 /tmp/after_fill.png (setelah isi semua field)");

  } else {
    // Modal Stripe iframes di /plans
    log("📋 Mode: Stripe Elements modal di /plans");
    const allStripeFrames = pKR.frames().filter((f: any) =>
      f.url().includes("stripe.com") || f.url().includes("js.stripe")
    );
    log(`Stripe frames: ${allStripeFrames.length}`);
    for (const sf of allStripeFrames) {
      log(`  💳 Frame: ${sf.url().slice(0, 80)}`);
      for (const sel of ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', '[data-elements-stable-field-name="cardNumber"] input', 'input[placeholder*="1234"]']) {
        try { const el = sf.locator(sel).first(); if (await el.isVisible({ timeout: 2000 })) { await el.click(); await sleep(200); await el.pressSequentially(CC_NUMBER, { delay: 80 }); log(`  ✅ CC`); await sleep(500); break; } } catch {}
      }
      for (const sel of ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', '[data-elements-stable-field-name="cardExpiry"] input', 'input[placeholder*="MM"]']) {
        try { const el = sf.locator(sel).first(); if (await el.isVisible({ timeout: 2000 })) { await el.click(); await sleep(200); await el.pressSequentially(`${CC_EXP.month}${CC_EXP.year.slice(-2)}`, { delay: 80 }); log(`  ✅ Exp`); await sleep(500); break; } } catch {}
      }
      for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', '[data-elements-stable-field-name="cardCvc"] input', 'input[placeholder*="CVC"]']) {
        try { const el = sf.locator(sel).first(); if (await el.isVisible({ timeout: 2000 })) { await el.click(); await sleep(200); await el.pressSequentially(CC_CVV, { delay: 80 }); log(`  ✅ CVV`); await sleep(500); break; } } catch {}
      }
    }
  }

  // ── 16. Screenshot sebelum submit ─────────────────────────────────────────
  step("STEP 16: Screenshot sebelum submit");
  await pKR.screenshot({ path: "/tmp/before_submit.png", fullPage: true });
  log("📸 /tmp/before_submit.png");

  // Log semua tombol yang ada
  const btnsBeforeSubmit = await pKR.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map((b: any) => b.innerText.trim()).filter((t: string) => t.length > 0)
  ).catch(() => [] as string[]);
  log(`Tombol sebelum submit: ${JSON.stringify(btnsBeforeSubmit)}`);

  // ── 17. Submit payment ────────────────────────────────────────────────────
  step("STEP 17: Submit payment");
  log(`IP saat submit: ${await getIp(pKR)}`);

  // Log semua tombol di semua frames (main + m-inner + elements-inner)
  const allFrms = pKR.frames();
  for (const frm of allFrms) {
    try {
      const fBtns = await frm.evaluate(() =>
        Array.from(document.querySelectorAll("button")).map((b: any) => b.innerText.trim()).filter((t: string) => t.length > 0)
      ).catch(() => [] as string[]);
      if (fBtns.length > 0) log(`Tombol di frame [${frm.url().slice(0, 60)}]: ${JSON.stringify(fBtns)}`);
    } catch {}
  }

  const submitTexts = ["Start free Business trial","Start free trial","Start your free","Subscribe","Claim","Pay","Confirm","Try for free"];
  let submitted = false;

  // Cari di SEMUA frame (main, m-inner, elements-inner)
  for (const frm of allFrms) {
    if (submitted) break;
    for (const txt of submitTexts) {
      try {
        const btn = frm.locator(`button:has-text("${txt}")`).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          log(`🚀 Submit dari frame [${frm.url().slice(0, 50)}]: "${txt}"`);
          await btn.click();
          submitted = true;
          await sleep(3000);
          break;
        }
      } catch {}
    }
  }

  // JS fallback di semua frames
  if (!submitted) {
    for (const frm of allFrms) {
      const jsClicked = await frm.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button")) as any[];
        const sub = btns.find((b: any) =>
          b.type === "submit" ||
          /start free|subscribe|claim free|pay now|confirm/i.test(b.innerText)
        );
        if (sub) { sub.click(); return sub.innerText.trim(); }
        return null;
      }).catch(() => null);
      if (jsClicked) {
        log(`🚀 JS submit di [${frm.url().slice(0, 50)}]: "${jsClicked}"`);
        submitted = true;
        await sleep(3000);
        break;
      }
    }
  }

  if (!submitted) log("⚠️ Submit button tidak ditemukan di semua frames");

  // ── 18. Tunggu & periksa konfirmasi ───────────────────────────────────────
  step("STEP 18: Tunggu konfirmasi");
  log(`IP post-submit: ${await getIp(pKR)}`);

  // Tunggu navigasi atau perubahan konten (hingga 90 detik)
  for (let w = 0; w < 18; w++) {
    await sleep(5000);
    const nowUrl = pKR.url();
    const nowTxt = await pKR.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => "");
    log(`  Wait ${w+1}: ${nowUrl.slice(0, 70)} | ${nowTxt.slice(0, 100).replace(/\n/g, " ")}`);

    // Cek error messages di payment frame
    const payF2 = pKR.frames().find((f: any) => f.url().includes("elements-inner-payment"));
    if (payF2) {
      const payErr = await payF2.evaluate(() => document.body.innerText).catch(() => "");
      if (payErr.length > 5) log(`  Payment frame: "${payErr.replace(/\n/g," ").slice(0,100)}"`);
    }
    // Cek error messages di address frame
    const addrF2 = pKR.frames().find((f: any) => f.url().includes("elements-inner-address"));
    if (addrF2) {
      const addrErr = await addrF2.evaluate(() => document.body.innerText).catch(() => "");
      if (addrErr.length > 5) log(`  Address frame: "${addrErr.replace(/\n/g," ").slice(0,100)}"`);
    }

    const isSuccessNow = nowTxt.toLowerCase().includes("success") ||
      nowTxt.toLowerCase().includes("thank") ||
      (nowTxt.includes("Business") && nowUrl.includes("chatgpt.com") && !nowUrl.includes("/checkout")) ||
      nowTxt.includes("Team") || nowTxt.includes("welcome") ||
      nowTxt.includes("확인") || nowTxt.includes("구독") ||
      nowUrl.includes("/gpts") || nowUrl.includes("/c/") || nowUrl === "https://chatgpt.com/";
    const isFailedNow = nowTxt.toLowerCase().includes("declined") ||
      nowTxt.toLowerCase().includes("card was declined") ||
      nowTxt.toLowerCase().includes("insufficient funds") ||
      nowTxt.toLowerCase().includes("invalid card") ||
      nowTxt.toLowerCase().includes("card number is invalid") ||
      nowTxt.toLowerCase().includes("error processing");

    if (isSuccessNow) { log(`✅ SUKSES terdeteksi!`); break; }
    if (isFailedNow) { log(`❌ GAGAL: ${nowTxt.slice(0, 200)}`); break; }

    // Jika masih di checkout, coba scroll ke bawah untuk lihat error
    if (nowUrl.includes("/checkout") && w === 3) {
      await pKR.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const fullTxt = await pKR.evaluate(() => document.body.innerText).catch(() => "");
      log(`  Full checkout text: "${fullTxt.replace(/\n/g," ").slice(0,300)}"`);
    }

    // Jika ada "Business name is required" error, coba isi + resubmit
    if (nowUrl.includes("/checkout") && w === 1 && (nowTxt.includes("Business name is required") || nowTxt.includes("Business name"))) {
      log("  🔧 Business name error — cari input & isi...");
      const allInputs = await pKR.evaluate(() =>
        Array.from(document.querySelectorAll("input")).map((i: any) =>
          `${i.type}|${i.name}|${i.id}|${i.placeholder}|${i.getAttribute("aria-label")}`
        )
      ).catch(() => [] as string[]);
      log(`  All inputs: ${JSON.stringify(allInputs)}`);

      // Try all possible selectors for business name
      for (const sel of [
        'input[name="businessName"]', 'input[name="business_name"]',
        'input[placeholder*="Business"]', 'input[placeholder*="business"]',
        'input[aria-label*="Business"]', 'input[aria-label*="business"]',
        'input[id*="business"]', 'input[id*="Business"]',
      ]) {
        try {
          const el = pKR.locator(sel).first();
          if (await el.isVisible({ timeout: 1000 })) {
            await el.fill("Kimberly Corp");
            log(`  ✅ Business name filled: ${sel}`);
            await sleep(500); break;
          }
        } catch {}
      }
      // Re-submit
      await sleep(500);
      try {
        const submitBtn = pKR.locator('button:has-text("Subscribe")').first();
        if (await submitBtn.isVisible({ timeout: 2000 })) {
          await submitBtn.click({ force: true });
          log("  🔄 Re-submit setelah business name diisi");
        }
      } catch {}
    }
  }

  const finalTxt = await pKR.evaluate(() => document.body.innerText).catch(() => "");
  const finalUrl = pKR.url();
  log(`URL final: ${finalUrl}`);
  log(`Teks (400): ${finalTxt.slice(0, 400).replace(/\n/g, " ")}`);

  await pKR.screenshot({ path: "/tmp/payment_result.png", fullPage: true });
  log("📸 Screenshot hasil: /tmp/payment_result.png");

  // Analisis hasil
  const isSuccess = finalTxt.toLowerCase().includes("success") ||
    finalTxt.toLowerCase().includes("thank") ||
    (finalTxt.includes("Business") && finalUrl.includes("chatgpt.com") && !finalUrl.includes("/checkout")) ||
    finalTxt.includes("Team") || finalTxt.toLowerCase().includes("welcome") ||
    finalTxt.includes("확인") || finalTxt.includes("구독");
  const isFailed = finalTxt.toLowerCase().includes("declined") ||
    finalTxt.toLowerCase().includes("card was declined") ||
    finalTxt.toLowerCase().includes("insufficient funds") ||
    finalTxt.toLowerCase().includes("invalid card");

  log("\n" + "═".repeat(70));
  log("🏁 HASIL AKHIR:");
  log("═".repeat(70));
  log(`Email   : ${email}`);
  log(`Password: ${chatgptPw}`);
  log(`IP Korea: ${ipKorea}`);
  log(`Status  : ${isSuccess ? "✅ BERHASIL BERLANGGANAN!" : isFailed ? "❌ CC DITOLAK" : "⚠️ CEK SCREENSHOT /tmp/payment_result.png"}`);
  log(`URL     : ${finalUrl}`);
  log("═".repeat(70));

  await browser.close();
  log("\n✅ Simulasi selesai!");
}

main().catch(e => {
  console.error(`\n❌ ERROR: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
