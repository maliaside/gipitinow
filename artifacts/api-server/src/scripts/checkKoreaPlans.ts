import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
(chromium as any).use(StealthPlugin());

const PROXY    = "http://XwVJ7XC2nn60_custom_zone_KR_st__city_sid_75601476_time_0:2484611@change5.owlproxy.com:7778";
const EMAIL    = "auto177357323167123@sharebot.net";
const MAILTM_PASS = "AutoReg@9944";         // mail.tm password untuk akun ini
const CHROMIUM = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function log(msg: string)  { console.log(`[${new Date().toISOString()}] ${msg}`); }

const pUrl  = new URL(PROXY);
const pSrv  = `${pUrl.protocol}//${pUrl.hostname}:${pUrl.port}`;
const pUser = decodeURIComponent(pUrl.username);
const pPass = decodeURIComponent(pUrl.password);

// ── mail.tm OTP retrieval ───────────────────────────────────────────────────
async function getMailTmToken(): Promise<string> {
  const r = await fetch("https://api.mail.tm/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: EMAIL, password: MAILTM_PASS }),
  });
  if (!r.ok) throw new Error(`mail.tm token failed: ${r.status} ${await r.text()}`);
  const d: any = await r.json();
  return d.token;
}

async function waitForOtp(token: string, maxWaitMs = 60000): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch("https://api.mail.tm/messages?page=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { await sleep(3000); continue; }
      const d: any = await r.json();
      const msgs: any[] = d["hydra:member"] || [];
      // Cari email dari OpenAI dalam 5 menit terakhir
      const fresh = msgs.filter((m: any) => {
        const age = Date.now() - new Date(m.createdAt).getTime();
        return age < 5 * 60 * 1000 && (m.from?.address?.includes("openai") || m.subject?.toLowerCase().includes("verification") || m.subject?.toLowerCase().includes("code"));
      });
      if (fresh.length > 0) {
        const msg = fresh[0];
        // Ambil isi email
        const mr = await fetch(`https://api.mail.tm/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const md: any = await mr.json();
        const body = md.text || md.html || "";
        // Extract 6-digit OTP
        const match = body.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    } catch {}
    await sleep(4000);
  }
  return null;
}

// ── Login flow ──────────────────────────────────────────────────────────────
async function loginAndGetCookies(browser: any): Promise<any[]> {
  const ctx = await browser.newContext({
    locale: "en-US", timezoneId: "America/New_York",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const p = await ctx.newPage();

  p.on("framenavigated", (f: any) => {
    if (f === p.mainFrame()) log(`  nav → ${f.url().slice(0, 80)}`);
  });

  // Ambil mail.tm token dulu (buat polari nanti)
  log("📬 Login ke mail.tm...");
  let mailToken: string | null = null;
  try {
    mailToken = await getMailTmToken();
    log(`✅ mail.tm token OK`);
  } catch (e: any) { log(`⚠️ mail.tm: ${e.message}`); }

  // Navigasi auth
  log("🔑 Navigasi ke chatgpt.com/auth/login...");
  await p.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2000);

  // Klik Log in
  try {
    await p.locator('button:has-text("Log in"), a:has-text("Log in")').first().waitFor({ state: "visible", timeout: 8000 });
    await p.locator('button:has-text("Log in"), a:has-text("Log in")').first().click();
    log("✅ Log in diklik");
    await sleep(3000);
  } catch {}

  log(`URL auth: ${p.url()}`);

  // Isi email
  log("✍️ Isi email...");
  try {
    const emailInput = p.locator('input[name="username"], input[name="email"], input[type="email"]').first();
    await emailInput.waitFor({ state: "visible", timeout: 10000 });
    await emailInput.fill(EMAIL);
    log(`✅ Email: ${EMAIL}`);
  } catch (e: any) {
    log(`⚠️ Email input: ${e.message}`);
  }

  // Klik Continue (exact match!)
  for (const sel of ['button:text-is("Continue")', 'button[data-testid="submit-button"]']) {
    try {
      const el = p.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click(); log(`✅ Continue email (${sel})`); await sleep(3000); break;
      }
    } catch {}
  }
  // Tunggu navigasi selesai setelah Continue diklik
  await sleep(4000);
  // Tunggu URL berubah dari log-in-or-create-account
  try {
    await p.waitForFunction(() => !window.location.href.includes("log-in-or-create-account"), { timeout: 10000 });
  } catch {}
  await sleep(1000);
  log(`URL setelah email: ${p.url()}`);

  // ── Cek: password atau email verification? ─────────────────────────────────
  const urlAfterEmail = p.url();

  if (urlAfterEmail.includes("email-verification") || urlAfterEmail.includes("otp") || urlAfterEmail.includes("verify")) {
    // OTP Login flow
    log("📧 OTP verification required! Ambil kode dari mail.tm...");
    if (!mailToken) { log("❌ Tidak ada mail.tm token"); return []; }
    const otp = await waitForOtp(mailToken, 60000);
    if (!otp) { log("❌ OTP tidak ditemukan dalam 60 detik"); return []; }
    log(`✅ OTP: ${otp}`);

    // Isi OTP
    try {
      const otpInput = p.locator('input[name="code"], input[autocomplete="one-time-code"], input[type="text"], input[inputmode="numeric"]').first();
      await otpInput.waitFor({ state: "visible", timeout: 10000 });
      await otpInput.fill(otp);
      log("✅ OTP diisi");
    } catch (e: any) {
      log(`⚠️ OTP input: ${e.message}`);
      // Coba isi karakter per karakter
      const inputs = p.locator('input[type="text"], input[inputmode="numeric"]');
      const count  = await inputs.count().catch(() => 0);
      if (count >= 6) {
        for (let i = 0; i < 6; i++) {
          try { await inputs.nth(i).fill(otp[i]); } catch {}
        }
        log("✅ OTP diisi per karakter");
      }
    }

    // Submit
    for (const sel of ['button:text-is("Continue")', 'button[type="submit"]:not(:has-text("with"))', 'button[data-testid="submit-button"]']) {
      try {
        const el = p.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.click(); log(`✅ Submit OTP (${sel})`); await sleep(2000); break;
        }
      } catch {}
    }

  } else {
    // Password login flow
    log("🔒 Password login flow");
    try {
      const pwInput = p.locator('input[type="password"], input[name="password"]').first();
      await pwInput.waitFor({ state: "visible", timeout: 10000 });
      await pwInput.fill("Ppsmmgl@1919");
      log("✅ Password diisi");
    } catch (e: any) { log(`⚠️ Password: ${e.message}`); }

    for (const sel of ['button:text-is("Continue")', 'button:text-is("Log in")', 'button[type="submit"]:not(:has-text("with"))']) {
      try {
        const el = p.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.click(); log(`✅ Submit password`); await sleep(2000); break;
        }
      } catch {}
    }
  }

  // Tunggu redirect chatgpt.com
  log("⏳ Tunggu redirect chatgpt.com...");
  try { await p.waitForURL("*chatgpt.com*", { timeout: 30000 }); } catch {}
  await sleep(3000);
  log(`🌐 URL akhir: ${p.url()}`);

  const isOk = p.url().includes("chatgpt.com") && !p.url().includes("auth/login") && !p.url().includes("google.com");
  const cookies = await ctx.cookies();
  log(`Login: ${isOk} | Cookies: ${cookies.length}`);

  return isOk && cookies.length > 10 ? cookies : [];
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log("🚀 Simulasi Korea Plans — cek detail promo");

  const browser = await (chromium as any).launch({
    headless: true,
    executablePath: CHROMIUM,
    args: ["--disable-blink-features=AutomationControlled","--no-sandbox",
           "--disable-dev-shm-usage","--disable-gpu","--no-zygote","--window-size=1280,900"],
  });

  const cookies = await loginAndGetCookies(browser);
  if (cookies.length === 0) {
    log("❌ Login gagal — tidak bisa cek plans");
    await browser.close(); return;
  }
  log(`\n✅ Login berhasil! ${cookies.length} cookies`);

  // ── Korea proxy context ──────────────────────────────────────────────────
  log("\n🇰🇷 Buat Korea proxy context...");
  const ctxKR = await browser.newContext({
    proxy: { server: pSrv, username: pUser, password: pPass },
    locale: "ko-KR", timezoneId: "Asia/Seoul",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  await ctxKR.addCookies(cookies);
  const pKR = await ctxKR.newPage();

  // Retry Korea connection sampai 3x
  let koreaOk = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log(`🌐 Korea chatgpt.com (attempt ${attempt})...`);
      await pKR.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
      koreaOk = true;
      break;
    } catch (e: any) {
      log(`⚠️ Attempt ${attempt} gagal: ${e.message.slice(0, 60)}`);
      await sleep(5000);
    }
  }
  if (!koreaOk) { log("❌ Korea proxy tidak bisa terhubung ke chatgpt.com"); await browser.close(); return; }
  await sleep(4000);
  log(`🌐 Korea root: ${pKR.url()}`);

  try {
    const ip: any = await pKR.evaluate(async () => (await (await fetch("https://api.ipify.org?format=json")).json()));
    log(`🌐 IP: ${ip.ip}`);
  } catch {}

  if (pKR.url().includes("auth.openai.com") || pKR.url().includes("auth/login")) {
    log("❌ Session tidak valid di Korea proxy"); await browser.close(); return;
  }
  log("✅ Session valid di Korea!");

  // ── PENTING: Dismiss onboarding di root dulu sebelum ke /plans ──────────
  log("🔄 Dismiss semua onboarding di chatgpt.com root...");
  for (let i = 0; i < 10; i++) {
    try {
      await sleep(2000);
      const dismissed = await pKR.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        // Urutan prioritas dismiss
        const closeTexts = [
          "Okay, let\u2019s go", "Okay, let's go",
          "Skip for now", "Skip",
          "Maybe later", "Not now",
          "\u00d7", "\u2715", "Close",
          "I'm not interested",
        ];
        for (const ct of closeTexts) {
          for (const btn of btns) {
            const t = btn.innerText.trim();
            if (t === ct || (ct.length > 3 && t.includes(ct))) {
              (btn as HTMLElement).click();
              return t;
            }
          }
        }
        // Coba klik "next" di onboarding wizard
        const nextBtns = btns.filter(b => {
          const txt = b.innerText.trim().toLowerCase();
          return txt === "next" || txt === "done" || txt === "continue" || txt === "got it";
        });
        if (nextBtns.length > 0) {
          (nextBtns[0] as HTMLElement).click();
          return "next/done/continue";
        }
        return null;
      });
      if (dismissed) {
        log(`  ✅ Dismissed: "${dismissed}"`);
      } else {
        // Cek kalau sudah bersih
        const txt = await pKR.evaluate(() => document.body.innerText);
        const hasModal = txt.includes("What brings you") || txt.includes("Tips for getting started")
          || txt.includes("Okay, let") || txt.includes("Skip for now");
        if (!hasModal) { log(`  Halaman bersih dari onboarding`); break; }
      }
    } catch { break; }
  }
  await sleep(2000);

  // ── Buka /plans ──────────────────────────────────────────────────────────
  log("\n📄 Buka /plans...");
  await pKR.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(5000);

  // Dismiss onboarding
  for (let i = 0; i < 6; i++) {
    try {
      const txt = await pKR.evaluate(() => document.body.innerText);
      if (txt.includes("What brings you") || (txt.includes("School") && txt.includes("Skip"))) {
        log(`🔄 Onboarding (${i+1}) — Skip`);
        await pKR.locator('button:has-text("Skip")').first().click({ force: true });
        await sleep(4000);
      } else { break; }
    } catch { break; }
  }

  // Tunggu plan content
  try {
    await pKR.waitForFunction(() => {
      const t = document.body.innerText;
      return t.includes("Plus") || t.includes("Claim") || t.includes("offer") || t.includes("Subscribe") || t.includes("Free");
    }, { timeout: 20000 });
    log("✅ Plan content loaded!");
  } catch { log("⚠️ Plan content timeout"); }
  await sleep(3000);

  // Screenshot untuk debug visual
  try {
    await pKR.screenshot({ path: "/tmp/korea_plans_debug.png", fullPage: true });
    log("📸 Screenshot: /tmp/korea_plans_debug.png");
  } catch (e: any) { log(`⚠️ Screenshot: ${e.message}`); }

  // Raw HTML
  const rawHtml = await pKR.evaluate(() => document.documentElement.outerHTML).catch(() => "");
  log(`\n🔎 Raw HTML (500 char): ${rawHtml.slice(0, 500)}`);

  // Cek Cloudflare
  const isCF = rawHtml.includes("cf-") || rawHtml.includes("cloudflare") || rawHtml.includes("turnstile") || rawHtml.includes("challenge");
  log(`\n🛡️ Cloudflare challenge: ${isCF ? "YA — IP diblokir" : "TIDAK"}`);

  // ── CAPTURE FULL DETAIL ──────────────────────────────────────────────────
  const fullText = await pKR.evaluate(() => document.body.innerText).catch(() => "");

  log("\n" + "═".repeat(70));
  log("📋 FULL HALAMAN /plans:");
  log("═".repeat(70));
  console.log(fullText);

  log("\n" + "═".repeat(70));
  log("💰 ANALISIS HARGA:");
  log("═".repeat(70));

  const usd   = [...new Set([...(fullText.matchAll(/\$[\d,]+(?:\.\d+)?/g))].map(m => m[0]))];
  const krw   = [...new Set([...(fullText.matchAll(/₩[\d,]+/g))].map(m => m[0]))];
  const free0 = [...new Set([...(fullText.matchAll(/\$0(?:\.\d+)?|free\s+(?:for\s+\d+\s+months?)?|무료/gi))].map(m => m[0].trim()))];
  const plans = [...new Set([...(fullText.matchAll(/(?:Plus|Team|Pro|Enterprise|Free)\s*[^\n]{0,50}/gi))].map(m => m[0].trim()))];

  log(`USD    : ${JSON.stringify(usd)}`);
  log(`KRW    : ${JSON.stringify(krw)}`);
  log(`Free/0 : ${JSON.stringify(free0)}`);
  log(`Plans  : ${JSON.stringify(plans)}`);

  const btns = await pKR.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map(b => ({
      text: (b as HTMLElement).innerText.trim(),
      disabled: (b as HTMLButtonElement).disabled,
    })).filter(b => b.text.length > 0)
  ).catch(() => [] as any[]);
  log(`\n🖱️ Tombol: ${JSON.stringify(btns)}`);

  const frames = pKR.frames();
  log(`\n🔍 Frames (${frames.length}):`);
  for (const f of frames) {
    if (f.url() && f.url() !== "about:blank") log(`  → ${f.url()}`);
  }

  // ── STEP 5: Dismiss SEMUA modal yang mungkin ada ─────────────────────────
  log("\n🔄 Dismiss semua modal...");
  for (let i = 0; i < 8; i++) {
    try {
      const dismissed = await pKR.evaluate(() => {
        // Cari semua tombol yang bisa menutup modal
        const btns = Array.from(document.querySelectorAll("button"));
        const closeTexts = ["Okay, let's go", "Okay, let\u2019s go", "Skip", "Close", "Dismiss", "×", "\u00d7"];
        for (const btn of btns) {
          const t = btn.innerText.trim();
          if (closeTexts.some(ct => t === ct || t.includes(ct))) {
            (btn as HTMLElement).click();
            return t;
          }
        }
        return null;
      });
      if (dismissed) {
        log(`  Dismissed: "${dismissed}"`);
        await sleep(2000);
      } else { break; }
    } catch { break; }
  }
  await sleep(2000);
  log(`  Setelah dismiss: ${(await pKR.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 100)}`);


  // Klik "Free offer" di navbar atas (paling mudah diklik, tidak dihalangi modal)
  log("\n🖱️ Klik 'Free offer' di navbar...");
  try {
    const freeOfferNav = pKR.locator('button:has-text("Free offer")').first();
    await freeOfferNav.waitFor({ state: "visible", timeout: 5000 });
    await freeOfferNav.click();
    log("✅ 'Free offer' (navbar) diklik!");
    await sleep(8000);
  } catch (e: any) {
    log(`⚠️ Free offer navbar: ${e.message} — coba Claim offer`);
    try {
      await pKR.locator('button:text-is("Claim offer")').first().click({ force: true });
      log("✅ 'Claim offer' diklik!");
      await sleep(8000);
    } catch (e2: any) { log(`⚠️ Claim offer: ${e2.message}`); }
  }

  log(`🌐 URL setelah klik offer: ${pKR.url()}`);

  // Capture halaman setelah Claim
  const textAfterClaim = await pKR.evaluate(() => document.body.innerText).catch(() => "");
  log("\n" + "═".repeat(70));
  log("📋 HALAMAN SETELAH KLIK 'Claim offer':");
  log("═".repeat(70));
  console.log(textAfterClaim);

  const usdAfter   = [...new Set([...(textAfterClaim.matchAll(/\$[\d,]+(?:\.\d+)?/g))].map(m => m[0]))];
  const krwAfter   = [...new Set([...(textAfterClaim.matchAll(/₩[\d,]+/g))].map(m => m[0]))];
  const freeAfter  = [...new Set([...(textAfterClaim.matchAll(/\$0(?:\.\d+)?|free\s+(?:for\s+\d+\s+months?)?|무료/gi))].map(m => m[0].trim()))];

  log(`\n💰 USD: ${JSON.stringify(usdAfter)}`);
  log(`💰 KRW: ${JSON.stringify(krwAfter)}`);
  log(`💰 Free/$0: ${JSON.stringify(freeAfter)}`);

  const btnsAfter = await pKR.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map(b => ({
      text: (b as HTMLElement).innerText.trim(), disabled: (b as HTMLButtonElement).disabled,
    })).filter(b => b.text.length > 0)
  ).catch(() => [] as any[]);
  log(`\n🖱️ Tombol setelah Claim: ${JSON.stringify(btnsAfter)}`);

  const framesAfter = pKR.frames();
  log(`\n🔍 Frames setelah Claim (${framesAfter.length}):`);
  for (const f of framesAfter) {
    if (f.url() && f.url() !== "about:blank") log(`  → ${f.url()}`);
  }

  // Screenshot halaman setelah Claim
  try {
    await pKR.screenshot({ path: "/tmp/korea_after_claim.png", fullPage: true });
    log("📸 Screenshot after claim: /tmp/korea_after_claim.png");
  } catch {}

  // Coba juga "Free offer"
  log("\n🖱️ Juga cek 'Free offer'...");
  const textFreeOffer = textAfterClaim.includes("Free offer") ? "Ada 'Free offer' di halaman setelah Claim" : "Tidak ada";
  log(textFreeOffer);

  await browser.close();
  log("\n✅ Selesai!");
}

main().catch(e => { console.error("❌ Error:", e.message); process.exit(1); });
