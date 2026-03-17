import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
(chromium as any).use(StealthPlugin());

const PROXY    = "http://XwVJ7XC2nn60_custom_zone_KR_st__city_sid_75601476_time_0:2484611@change5.owlproxy.com:7778";
const CC       = "6258142686060787";
const CC_EXP_M = "10";
const CC_EXP_Y = "34";
const CC_CVV   = "565";
const CHROMIUM = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const PASSWORD = "Ppsmmgl@1919";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min) + min); }

const pUrl = new URL(PROXY);
const pServer = `${pUrl.protocol}//${pUrl.hostname}:${pUrl.port}`;
const pUser = decodeURIComponent(pUrl.username);
const pPass = decodeURIComponent(pUrl.password);

async function createEmail() {
  const r = await fetch("https://api.mail.tm/domains");
  const j: any = await r.json();
  const domain = j["hydra:member"][0].domain;
  const u = `fin${Date.now()}${rand(10, 99)}`;
  const email = `${u}@${domain}`;
  const pw = "TestPass@1234";
  await fetch("https://api.mail.tm/accounts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: pw }),
  });
  const ar = await fetch("https://api.mail.tm/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: pw }),
  });
  const td: any = await ar.json();
  log(`✅ Email: ${email}`);
  return { email, token: td.token };
}

async function waitOtp(token: string): Promise<string> {
  for (let i = 0; i < 25; i++) {
    await sleep(4000);
    const r = await fetch("https://api.mail.tm/messages?page=1", { headers: { Authorization: `Bearer ${token}` } });
    const d: any = await r.json();
    const msgs: any[] = d["hydra:member"] || [];
    if (msgs.length > 0) {
      const mr = await fetch(`https://api.mail.tm/messages/${msgs[0].id}`, { headers: { Authorization: `Bearer ${token}` } });
      const msg: any = await mr.json();
      const text = msg.text || msg.html || "";
      const m = text.match(/\b(\d{6})\b/);
      if (m) { log(`✅ OTP: ${m[1]}`); return m[1]; }
    }
    log(`⏳ OTP (${i + 1}/25)...`);
  }
  throw new Error("OTP timeout");
}

const bMM = String(rand(1, 12)).padStart(2, "0");
const bDD = String(rand(1, 28)).padStart(2, "0");
const bYY = String(rand(1985, 2003));
const NAMES = [["James", "Williams"], ["Olivia", "Davis"], ["Noah", "Garcia"], ["Sophia", "Martinez"]];
const [fn, ln] = NAMES[rand(0, NAMES.length)];

async function main() {
  log("🚀 TEST FINAL: doManualPayment — chatgpt.com first + waitForFunction");
  const { email, token } = await createEmail();

  const browser = await (chromium as any).launch({
    executablePath: CHROMIUM, headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  // Context 1: signup
  const ctx1 = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const pg1 = await ctx1.newPage();

  log("🔐 Signup...");
  await pg1.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(3000);

  for (const sel of ["button:has-text(\"Sign up\")", "a:has-text(\"Sign up\")"]) {
    try { const b = pg1.locator(sel).first(); if (await b.isVisible({ timeout: 2000 })) { await b.click({ force: true }); await sleep(4000); break; } } catch { }
  }

  for (const sel of ["input[type=\"email\"]", "input[name=\"email\"]"]) {
    try { await pg1.waitForSelector(sel, { timeout: 10000 }); await pg1.fill(sel, email); await sleep(300); await pg1.keyboard.press("Enter"); await sleep(5000); break; } catch { }
  }

  for (const sel of ["input[type=\"password\"]"]) {
    try { await pg1.waitForSelector(sel, { timeout: 8000 }); await pg1.fill(sel, PASSWORD); await sleep(300); await pg1.keyboard.press("Enter"); await sleep(5000); break; } catch { }
  }

  if (pg1.url().includes("email-verification")) {
    const otp = await waitOtp(token);
    const boxes = await pg1.locator("input[inputmode=\"numeric\"][maxlength=\"1\"]").all();
    if (boxes.length >= 6) {
      for (let i = 0; i < 6; i++) { await boxes[i].fill(otp[i]); await sleep(80); }
    } else {
      for (const sel of ["input[name=\"code\"]", "input[type=\"text\"]"]) {
        try { const el = pg1.locator(sel).first(); if (await el.isVisible({ timeout: 2000 })) { await el.fill(otp); break; } } catch { }
      }
    }
    for (const sel of ["button:has-text(\"Continue\")", "button[type=\"submit\"]"]) {
      try { const b = pg1.locator(sel).first(); if (await b.isVisible({ timeout: 2000 })) { await b.click({ force: true }); break; } } catch { }
    }
    await sleep(5000);
  }

  if (pg1.url().includes("about-you")) {
    const fullName = `${fn} ${ln}`;
    await pg1.evaluate(() => {
      const i = document.querySelector("input[name=\"name\"]") as HTMLInputElement;
      if (i) i.focus();
    });
    await sleep(100);
    await pg1.keyboard.press("Control+a");
    await pg1.keyboard.press("Delete");
    await sleep(100);
    await pg1.keyboard.type(fullName, { delay: 70 });
    await pg1.evaluate(() => {
      const i = document.querySelector("input[name=\"name\"]") as HTMLInputElement;
      if (i) i.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    const sbs = pg1.locator("[role=\"spinbutton\"]");
    if (await sbs.count() >= 3) {
      const vals: [number, string][] = [[0, String(parseInt(bMM))], [1, String(parseInt(bDD))], [2, bYY]];
      for (const [i, v] of vals) {
        await sbs.nth(i).evaluate(e => (e as HTMLElement).focus());
        await sleep(150);
        await pg1.keyboard.type(v, { delay: 60 });
        await sleep(150);
      }
    }
    const isoDate = `${bYY}-${bMM}-${bDD}`;
    await pg1.evaluate((iso: string) => {
      const h = document.querySelector("input[name=\"birthday\"]") as HTMLInputElement;
      if (h) {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        s?.call(h, iso);
        h.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, isoDate);
    await sleep(600);
    await Promise.all([
      pg1.waitForResponse(r => r.url().includes("create_account"), { timeout: 8000 }).catch(() => null),
      pg1.locator("button[type=\"submit\"]").first().click({ force: true }),
    ]);
    await sleep(6000);
  }

  if (pg1.url().includes("auth.openai.com")) { await browser.close(); throw new Error("Signup gagal"); }
  log(`✅ SIGNUP OK: ${pg1.url()}`);

  const cookies = await ctx1.cookies();
  log(`🍪 ${cookies.length} cookies tersimpan`);

  // Context 2: Korea proxy (BROWSER YANG SAMA)
  log(`🇰🇷 Korea proxy context...`);
  const ctx2 = await browser.newContext({
    proxy: { server: pServer, username: pUser, password: pPass },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1280, height: 800 },
  });
  await ctx2.addCookies(cookies);
  const pg2 = await ctx2.newPage();

  try {
    // FIX: chatgpt.com dulu untuk establish session
    log("🌐 [FIX] chatgpt.com dulu untuk establish session...");
    await pg2.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);
    const urlRoot = pg2.url();
    log(`🌐 URL chatgpt.com: ${urlRoot}`);
    const body0 = await pg2.evaluate(() => document.body.innerText.slice(0, 100)).catch(() => "");
    log(`📋 ${body0}`);

    if (urlRoot.includes("auth.openai.com")) {
      log("❌ Session tidak valid di proxy");
      await browser.close();
      return;
    }
    log("✅ Session valid di Korea proxy!");

    // Navigasi ke plans
    log("🔗 Buka plans (Korea proxy)...");
    await pg2.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);
    log(`🌐 URL plans: ${pg2.url()}`);

    // Dismiss onboarding
    for (let i = 0; i < 10; i++) {
      const body = await pg2.evaluate(() => document.body.innerText).catch(() => "");
      if (body.includes("What brings you") || (body.includes("School") && body.includes("Skip"))) {
        log(`  Onboarding dismiss (${i + 1})...`);
        for (const sel of ["button:has-text(\"Skip\")"]) {
          try { const b = pg2.locator(sel).first(); if (await b.isVisible({ timeout: 1500 })) { await b.click({ force: true }); log("  ✅ Skip"); await sleep(2000); break; } } catch { }
        }
      } else { log("✅ No onboarding"); break; }
      await sleep(500);
    }

    // FIX: waitForFunction plan cards
    log("⏳ [FIX] waitForFunction: tunggu plan cards...");
    try {
      await pg2.waitForFunction(() => {
        const txt = document.body.innerText;
        return txt.includes("Claim offer") || txt.includes("Free offer") ||
          txt.includes("Get Plus") || txt.includes("Plus") ||
          txt.includes("Subscribe") || txt.includes("Upgrade") ||
          txt.includes("무료");
      }, { timeout: 20000 });
      log("✅ Plan cards terdeteksi!");
    } catch {
      log("⚠️ waitForFunction timeout 20s");
    }
    await sleep(1000);

    const bodyFinal = await pg2.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
    log(`📋 Konten:\n${bodyFinal.slice(0, 1000)}`);
    const btnsFinal = await pg2.evaluate(() =>
      Array.from(document.querySelectorAll("button")).map(b => (b as HTMLButtonElement).innerText.trim()).filter(t => t.length > 0)
    ).catch(() => [] as string[]);
    log(`🖱️ Tombol: ${JSON.stringify(btnsFinal)}`);

    // Klik plan
    const planSels = [
      "button:has-text(\"Claim offer\")",
      "button:has-text(\"Free offer\")",
      "button:has-text(\"Try for free\")",
      "button:has-text(\"무료\")",
      "button:has-text(\"Get Plus\")",
      "a:has-text(\"Get Plus\")",
      "button:has-text(\"Upgrade\")",
      "button:has-text(\"Subscribe\")",
    ];
    let clicked = false;
    for (const sel of planSels) {
      try {
        const btn = pg2.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          log(`✅ Klik: "${sel}"`);
          await btn.click({ force: true });
          clicked = true;
          await sleep(6000);
          break;
        }
      } catch { }
    }
    if (!clicked) log("⚠️ Tidak ada tombol plan");

    log(`🌐 URL setelah klik: ${pg2.url()}`);

    // Tunggu Stripe
    log("⏳ Tunggu Stripe iframe (maks 60 detik)...");
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      const frames = pg2.frames();
      const stripes = frames.filter(f => f.url().includes("stripe.com") || f.url().includes("js.stripe"));
      log(`  [${i + 1}] ${frames.length} frames, ${stripes.length} Stripe`);
      for (const f of frames) {
        if (f.url() && f.url() !== "about:blank" && !f.url().includes("chrome-error")) {
          log(`    → ${f.url().slice(0, 100)}`);
        }
      }

      if (i === 2 && stripes.length === 0) {
        log("  🔄 Re-klik plan...");
        for (const sel of planSels) {
          try {
            const b = pg2.locator(sel).first();
            if (await b.isVisible({ timeout: 1500 })) { await b.click({ force: true }); log(`  Re-klik: "${sel}"`); await sleep(4000); break; }
          } catch { }
        }
      }

      if (stripes.length > 0) {
        log(`🎉🎉 STRIPE DITEMUKAN! (${stripes.length})`);
        for (const frame of stripes) {
          log(`  💳 Frame: ${frame.url().slice(0, 80)}`);
          for (const sel of ["input[name=\"cardnumber\"]", "input[autocomplete=\"cc-number\"]"]) {
            try { const el = frame.locator(sel).first(); if (await el.isVisible({ timeout: 2500 })) { await el.click(); await sleep(300); await el.pressSequentially(CC, { delay: 60 }); log("  ✅ CC"); await sleep(500); break; } } catch { }
          }
          for (const sel of ["input[name=\"exp-date\"]", "input[autocomplete=\"cc-exp\"]"]) {
            try { const el = frame.locator(sel).first(); if (await el.isVisible({ timeout: 2500 })) { await el.click(); await sleep(300); await el.pressSequentially(`${CC_EXP_M}${CC_EXP_Y}`, { delay: 60 }); log("  ✅ Expiry"); await sleep(500); break; } } catch { }
          }
          for (const sel of ["input[name=\"cvc\"]", "input[autocomplete=\"cc-csc\"]"]) {
            try { const el = frame.locator(sel).first(); if (await el.isVisible({ timeout: 2500 })) { await el.click(); await sleep(300); await el.pressSequentially(CC_CVV, { delay: 60 }); log("  ✅ CVV"); await sleep(500); break; } } catch { }
          }
        }

        try { const c = pg2.locator("select[name*=\"country\"]").first(); if (await c.isVisible({ timeout: 2000 })) { await c.selectOption({ value: "KR" }); log("🌍 Country: KR"); } } catch { }

        await sleep(2000);
        const bsub = await pg2.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "");
        log(`📋 Sebelum submit: ${bsub.slice(0, 200)}`);

        for (const sel of ["button:has-text(\"Subscribe\")", "button:has-text(\"Start subscription\")", "button:has-text(\"Confirm\")", "button[type=\"submit\"]"]) {
          try { const b = pg2.locator(sel).first(); if (await b.isVisible({ timeout: 3000 })) { await b.click({ force: true }); log(`🚀 Submit: "${sel}"`); await sleep(8000); break; } } catch { }
        }

        const fu = pg2.url();
        const ft = await pg2.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "");
        log(`🌐 Final URL: ${fu}`);
        log(`📋 Final: ${ft.slice(0, 200)}`);
        if (ft.toLowerCase().includes("thank") || ft.toLowerCase().includes("success") || ft.toLowerCase().includes("subscribed")) {
          log("🎉🎉🎉 === PAYMENT BERHASIL! ===");
        } else {
          log("ℹ️ Submit dikirim — cek URL untuk konfirmasi");
        }
        break;
      }

      const pc = await pg2.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
      log(`  Konten: ${pc.slice(0, 80)}`);
    }

    await ctx2.close();
  } finally {
    await browser.close();
    log("🔚 Done");
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
