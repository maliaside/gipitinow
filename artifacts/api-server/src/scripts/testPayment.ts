import { chromium } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync } from "child_process";
import { generateKoreanAddress, generateCreditCardInfo } from "../lib/nameGenerator.js";

const EMAIL = "jugan.ke.mal@gmail.com";
const PASSWORD = "Ppsmmgl@1919";
const CC_NUMBER = "6258142686060787";
const CARDHOLDER = "Karen Clark";

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function getChromiumPath(): string | undefined {
  try {
    return execSync("which chromium || which chromium-browser || which google-chrome-stable", { timeout: 3000 })
      .toString().trim().split("\n")[0];
  } catch { return undefined; }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function dismissOnboarding(page: any) {
  // Cek dan skip onboarding "What brings you to ChatGPT?"
  for (let i = 0; i < 5; i++) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (text.includes("What brings you to ChatGPT") || text.includes("brings you")) {
      log(`🔄 Onboarding terdeteksi (attempt ${i + 1}) — klik Skip...`);
      for (const sel of ['button:has-text("Skip")', 'a:has-text("Skip")', 'button:has-text("Next")']) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 1500 })) {
            await btn.click({ force: true });
            log(`✅ Klik "${sel}"`);
            await sleep(2000);
            break;
          }
        } catch { }
      }
    } else {
      break;
    }
    await sleep(1000);
  }
}

async function main() {
  const { expMonth, expYear, cvv } = generateCreditCardInfo();
  const addr = generateKoreanAddress();

  log(`🚀 Test payment dimulai`);
  log(`📧 Email: ${EMAIL}`);
  log(`💳 CC: ****${CC_NUMBER.slice(-4)} | Exp: ${expMonth}/${expYear.slice(-2)} | CVV: ${cvv}`);
  log(`📍 Alamat: ${addr.line1}, ${addr.city}, ${addr.province} ${addr.postal}`);

  const playwrightExtra = addExtra(chromium as any);
  playwrightExtra.use(StealthPlugin());

  const chromiumPath = getChromiumPath();
  const browser = await (playwrightExtra as any).launch({
    headless: true,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
      "--no-zygote", "--window-size=1280,800",
    ],
  });

  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    // ─── STEP 1: LOGIN ──────────────────────────────────────────────────
    log(`🔐 Login ke ChatGPT...`);
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);
    log(`📄 URL: ${page.url()} | Title: ${await page.title().catch(() => "?")}`);

    // Klik tombol "Log in"
    log(`🖱️ Klik tombol Log in...`);
    for (const sel of ['button:has-text("Log in")', 'a:has-text("Log in")', '[data-testid="login-button"]']) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 4000 })) {
          await btn.click({ force: true });
          log(`✅ Klik "${sel}"`);
          await sleep(4000);
          break;
        }
      } catch { }
    }

    log(`📄 URL setelah klik Log in: ${page.url()}`);

    // Isi email
    log(`✍️ Isi email...`);
    for (const sel of ['input[type="email"]', 'input[name="email"]', 'input[id*="email"]']) {
      try {
        await page.waitForSelector(sel, { timeout: 12000 });
        await page.fill(sel, EMAIL);
        log(`✅ Email diisi`);
        await sleep(400);
        await page.keyboard.press("Enter");
        await sleep(4000);
        break;
      } catch { }
    }

    log(`📄 URL setelah email: ${page.url()}`);

    // Isi password
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 12000 });
      await page.fill('input[type="password"]', PASSWORD);
      log(`✅ Password diisi`);
      await sleep(400);
      await page.keyboard.press("Enter");
      await sleep(6000);
    } catch { log(`⚠️ Password field tidak muncul`); }

    log(`📄 URL setelah login: ${page.url()}`);
    const loginContent = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
    log(`📄 Konten: ${loginContent.slice(0, 120)}`);
    if (page.url().includes("/log-in") || page.url().includes("auth.openai.com/log-in")) {
      throw new Error(`Login gagal. URL: ${page.url()}`);
    }
    log(`✅ Login berhasil!`);
    await sleep(2000);

    // ─── STEP 2: DISMISS ONBOARDING JIKA ADA ────────────────────────────
    await dismissOnboarding(page);

    // ─── STEP 3: NAVIGASI KE PLANS ──────────────────────────────────────
    log(`🔗 Navigasi ke plans...`);
    await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);
    log(`📄 URL: ${page.url()}`);

    // Dismiss onboarding lagi jika masih muncul di plans
    await dismissOnboarding(page);

    await sleep(2000);
    const plansContent = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
    log(`📄 Konten plans: ${plansContent.slice(0, 200)}`);
    await page.screenshot({ path: "/tmp/step_plans.png" }).catch(() => {});
    log(`📸 Screenshot plans: /tmp/step_plans.png`);

    // ─── STEP 4: KLIK GET PLUS ───────────────────────────────────────────
    log(`🖱️ Klik Get Plus / Upgrade...`);
    const upgradeSelectors = [
      'button:has-text("Get Plus")',
      'a:has-text("Get Plus")',
      'button:has-text("Upgrade to Plus")',
      'button:has-text("Subscribe")',
    ];
    let clicked = false;
    for (const sel of upgradeSelectors) {
      try {
        const btns = page.locator(sel);
        const count = await btns.count();
        log(`  Cek "${sel}": ${count} ditemukan`);
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            const btn = btns.nth(i);
            if (await btn.isVisible({ timeout: 2000 })) {
              const txt = await btn.textContent();
              log(`  ✅ Klik tombol: "${txt?.trim()}" (${sel})`);
              await btn.click({ force: true });
              clicked = true;
              await sleep(5000);
              break;
            }
          }
          if (clicked) break;
        }
      } catch { }
    }
    if (!clicked) log(`⚠️ Tombol upgrade tidak ditemukan`);

    log(`📄 URL setelah klik: ${page.url()}`);
    await page.screenshot({ path: "/tmp/step_after_upgrade.png" }).catch(() => {});
    log(`📸 Screenshot setelah upgrade: /tmp/step_after_upgrade.png`);

    // ─── STEP 5: TUNGGU STRIPE IFRAME ───────────────────────────────────
    log(`⏳ Menunggu Stripe iframe (maks 40 detik)...`);
    let stripeFound = false;
    for (let i = 0; i < 10; i++) {
      await sleep(4000);
      const frames = page.frames();
      const stripeFrames = frames.filter((f: any) =>
        f.url().includes("stripe.com") || f.url().includes("js.stripe")
      );
      log(`  Attempt ${i + 1}: ${frames.length} frames, ${stripeFrames.length} Stripe`);
      for (const f of frames) {
        const furl = f.url();
        if (furl && furl !== "about:blank") log(`    → ${furl.slice(0, 120)}`);
      }

      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
      if (pageText.includes("What brings you") || pageText.includes("brings you to ChatGPT")) {
        log(`  ⚠️ Onboarding masih muncul — dismiss...`);
        await dismissOnboarding(page);
        continue;
      }

      if (stripeFrames.length > 0) {
        stripeFound = true;
        log(`✅ ${stripeFrames.length} Stripe frame ditemukan!`);

        for (const frame of stripeFrames) {
          log(`  💳 Frame: ${frame.url().slice(0, 100)}`);

          // Card number
          for (const sel of ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', '[data-elements-stable-field-name="cardNumber"] input', 'input[placeholder*="1234"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2000 })) {
                await el.click(); await sleep(300);
                await el.pressSequentially(CC_NUMBER, { delay: 60 });
                log(`  ✅ Card number diisi`); await sleep(500); break;
              }
            } catch { }
          }

          // Expiry
          for (const sel of ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', '[data-elements-stable-field-name="cardExpiry"] input', 'input[placeholder*="MM"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2000 })) {
                await el.click(); await sleep(300);
                await el.pressSequentially(`${expMonth}${expYear.slice(-2)}`, { delay: 60 });
                log(`  ✅ Expiry: ${expMonth}/${expYear.slice(-2)}`); await sleep(500); break;
              }
            } catch { }
          }

          // CVC
          for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', '[data-elements-stable-field-name="cardCvc"] input', 'input[placeholder*="CVC"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2000 })) {
                await el.click(); await sleep(300);
                await el.pressSequentially(cvv, { delay: 60 });
                log(`  ✅ CVV diisi`); await sleep(500); break;
              }
            } catch { }
          }
        }
        break;
      }
    }

    if (!stripeFound) {
      const content = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "");
      log(`❌ Stripe tidak ditemukan setelah 10 attempt`);
      log(`📄 Konten halaman: ${content.slice(0, 300)}`);
      await page.screenshot({ path: "/tmp/stripe_not_found.png" }).catch(() => {});
      log(`📸 Screenshot: /tmp/stripe_not_found.png`);
    }

    // ─── STEP 6: BILLING ADDRESS ─────────────────────────────────────────
    await sleep(500);
    // Country → Korea
    try {
      const sel = page.locator('select[name*="country"], select[id*="country"]').first();
      if (await sel.isVisible({ timeout: 3000 })) {
        await sel.selectOption({ value: "KR" });
        log(`🌍 Country: Korea (KR)`); await sleep(500);
      }
    } catch { }

    // Cardholder name
    try {
      const sel = page.locator('input[autocomplete="cc-name"], input[name*="cardholderName"], input[name*="name"][type="text"]').first();
      if (await sel.isVisible({ timeout: 2000 })) {
        await sel.fill(CARDHOLDER);
        log(`✅ Cardholder: ${CARDHOLDER}`); await sleep(300);
      }
    } catch { }

    // Address line 1
    try {
      const sel = page.locator('input[autocomplete="address-line1"], input[name*="line1"]').first();
      if (await sel.isVisible({ timeout: 2000 })) {
        await sel.fill(addr.line1);
        log(`✅ Address: ${addr.line1}`); await sleep(300);
      }
    } catch { }

    // City
    try {
      const sel = page.locator('input[autocomplete="address-level2"], input[name*="city"]').first();
      if (await sel.isVisible({ timeout: 2000 })) {
        await sel.fill(addr.city);
        log(`✅ City: ${addr.city}`); await sleep(300);
      }
    } catch { }

    // Postal
    try {
      const sel = page.locator('input[autocomplete="postal-code"], input[name*="postal"]').first();
      if (await sel.isVisible({ timeout: 2000 })) {
        await sel.fill(addr.postal);
        log(`✅ Postal: ${addr.postal}`); await sleep(300);
      }
    } catch { }

    await sleep(1000);
    await page.screenshot({ path: "/tmp/payment_before_submit.png" }).catch(() => {});
    log(`📸 Form sebelum submit: /tmp/payment_before_submit.png`);

    // ─── STEP 7: SUBMIT ──────────────────────────────────────────────────
    log(`🚀 Submit payment...`);
    const submitSelectors = [
      'button:has-text("Subscribe")',
      'button:has-text("Start subscription")',
      'button:has-text("Confirm")',
      'button:has-text("Pay")',
      'button[type="submit"]:not([disabled])',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          const txt = await btn.textContent();
          log(`🚀 SUBMIT: "${txt?.trim()}" (${sel})`);
          await btn.click({ force: true });
          submitted = true;
          await sleep(8000);
          break;
        }
      } catch { }
    }
    if (!submitted) log(`⚠️ Tombol submit tidak ditemukan`);

    // ─── STEP 8: HASIL ───────────────────────────────────────────────────
    const finalUrl = page.url();
    const finalText = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "");
    log(`🌐 URL final: ${finalUrl}`);
    log(`📄 Hasil: ${finalText.slice(0, 250)}`);
    await page.screenshot({ path: "/tmp/payment_result.png" }).catch(() => {});
    log(`📸 Hasil screenshot: /tmp/payment_result.png`);

    if (finalText.toLowerCase().includes("thank") || finalText.toLowerCase().includes("success") ||
        finalText.toLowerCase().includes("subscribed") || finalUrl.includes("success")) {
      log(`🎉 PAYMENT BERHASIL!`);
    } else {
      log(`ℹ️ Cek screenshot untuk detail`);
    }

  } catch (err: any) {
    log(`❌ Error: ${err.message}`);
    await page.screenshot({ path: "/tmp/payment_error.png" }).catch(() => {});
  } finally {
    await browser.close();
    log(`✅ Selesai`);
  }
}

main().catch(console.error);
