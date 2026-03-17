/**
 * Simulasi end-to-end:
 * 1. Login ke ChatGPT (tanpa proxy)
 * 2. Buat proxy context Korea, copy cookies
 * 3. Buka plans dengan IP Korea — dump semua teks & tombol
 * 4. Klik plan & tunggu Stripe
 * NOTE: Login via chatgpt.com/auth/login (email → password, tanpa OTP untuk akun lama)
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

(chromium as any).use(StealthPlugin());

const EMAIL    = "j.ugankemal@gmail.com";
const PASSWORD = "Ppsmmgl@1919";
const PROXY    = "http://XwVJ7XC2nn60_custom_zone_KR_st__city_sid_75601476_time_0:2484611@change5.owlproxy.com:7778";
const CC       = "6258142686060787";
const CC_EXP   = "1034";   // MMYY
const CC_CVV   = "565";
const CHROMIUM = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

const proxyUrl = new URL(PROXY);
const proxyServer = `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`;
const proxyUser   = decodeURIComponent(proxyUrl.username);
const proxyPass   = decodeURIComponent(proxyUrl.password);

async function main() {
  log("🚀 Test proxy payment dimulai");

  const browser = await (chromium as any).launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    // ─── LOGIN ──────────────────────────────────────────────────────────
    log("🔐 Login ke ChatGPT...");
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);

    // Klik Log in
    for (const sel of ['button:has-text("Log in")', 'a:has-text("Log in")']) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 4000 })) {
          await btn.click({ force: true });
          log(`✅ Klik Log in`);
          await sleep(4000);
          break;
        }
      } catch { }
    }

    log(`📄 URL setelah klik: ${page.url()}`);

    // Isi email
    for (const sel of ['input[type="email"]', 'input[name="email"]']) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        await page.fill(sel, EMAIL);
        log("✅ Email diisi");
        await sleep(400);
        await page.keyboard.press("Enter");
        await sleep(4000);
        break;
      } catch { }
    }

    log(`📄 URL setelah email: ${page.url()}`);
    const postEmailContent = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
    log(`📋 Konten: ${postEmailContent.slice(0, 100)}`);

    // Cek apakah minta password atau OTP
    if (page.url().includes("email-verification") || postEmailContent.includes("verification")) {
      log("⚠️ Email verification diminta — tidak bisa lanjut (butuh akses Gmail)");
      log("ℹ️ Akun baru ini membutuhkan email OTP saat login dari device baru");
      log("ℹ️ Untuk test payment, gunakan akun yang sudah ada session-nya ATAU daftarkan akun baru via bot");
      return;
    }

    // Isi password
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 12000 });
      await page.fill('input[type="password"]', PASSWORD);
      log("✅ Password diisi");
      await sleep(400);
      await page.keyboard.press("Enter");
      await sleep(6000);
    } catch { log("⚠️ Password field tidak muncul"); }

    log(`📄 URL setelah password: ${page.url()}`);
    if (page.url().includes("auth.openai.com")) {
      log("❌ Login gagal — masih di auth page");
      return;
    }
    log("✅ LOGIN BERHASIL!");

    // Ambil cookies setelah login
    const cookies = await context.cookies();
    log(`🍪 ${cookies.length} cookies tersimpan`);

    // ─── BUAT PROXY KOREA CONTEXT ─────────────────────────────────────
    log("🇰🇷 Membuat proxy Korea context...");
    const proxyContext = await browser.newContext({
      proxy: { server: proxyServer, username: proxyUser, password: proxyPass },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      viewport: { width: 1280, height: 800 },
    });

    // Copy cookies
    await proxyContext.addCookies(cookies);
    log(`🍪 ${cookies.length} cookies disalin ke proxy context`);

    const proxyPage = await proxyContext.newPage();

    // Cek IP Korea
    await proxyPage.goto("https://api.ipify.org?format=json", { timeout: 10000 });
    const ipText = await proxyPage.evaluate(() => document.body.innerText);
    log(`📍 IP Korea: ${ipText}`);

    // ─── BUKA PLANS DENGAN KOREA PROXY ───────────────────────────────
    log("🔗 Navigasi ke plans dengan IP Korea...");
    await proxyPage.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(5000);

    const plansUrl = proxyPage.url();
    log(`🌐 URL plans: ${plansUrl}`);

    if (plansUrl.includes("auth.openai.com")) {
      log("⚠️ Redirect ke login — session cookies tidak valid di proxy context");
      // Fallback: gunakan page asli
      await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(5000);
      log(`🌐 URL plans (tanpa proxy): ${page.url()}`);
      const txt = await page.evaluate(() => document.body.innerText.slice(0, 1000)).catch(() => "");
      log(`📋 Konten plans (tanpa proxy): ${txt.slice(0, 500)}`);
    } else {
      const plansText = await proxyPage.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => "");
      log(`📋 Konten plans (Korea IP):\n${plansText}`);

      // Cek semua tombol
      const btns = await proxyPage.evaluate(() => {
        const result: string[] = [];
        document.querySelectorAll("button, a").forEach(el => {
          const t = (el as HTMLElement).innerText?.trim();
          if (t && t.length > 1 && t.length < 80) result.push(t);
        });
        return [...new Set(result)].slice(0, 60);
      });
      log(`🖱️ Tombol/link: ${JSON.stringify(btns, null, 2)}`);

      // Screenshot
      await proxyPage.screenshot({ path: "/tmp/korea_plans_loggedin.png", fullPage: true });
      log("📸 Screenshot: /tmp/korea_plans_loggedin.png");

      // Cari dan klik plan
      const planSelectors = [
        'button:has-text("Try for free")',
        'button:has-text("Start free")',
        'button:has-text("Free trial")',
        'button:has-text("무료")',
        'button:has-text("Get Plus")',
        'button:has-text("Upgrade")',
        'button:has-text("Subscribe")',
      ];
      let clicked = false;
      for (const sel of planSelectors) {
        try {
          const btn = proxyPage.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            log(`✅ Klik plan: "${sel}"`);
            await btn.click({ force: true });
            clicked = true;
            await sleep(5000);
            break;
          }
        } catch { }
      }
      if (!clicked) log("⚠️ Tidak ada tombol plan yang ditemukan");

      const urlAfter = proxyPage.url();
      log(`🌐 URL setelah klik: ${urlAfter}`);

      // Cek Stripe
      log("⏳ Cek Stripe frames...");
      for (let i = 0; i < 8; i++) {
        await sleep(3500);
        const frames = proxyPage.frames();
        const stripes = frames.filter(f => f.url().includes("stripe.com"));
        log(`  Attempt ${i+1}: ${frames.length} frames, ${stripes.length} Stripe`);
        for (const f of frames) {
          if (f.url() && f.url() !== "about:blank") {
            log(`    → ${f.url().slice(0, 100)}`);
          }
        }
        if (stripes.length > 0) {
          log("✅ STRIPE DITEMUKAN! Payment form tersedia");
          
          // Isi CC
          for (const frame of stripes) {
            log(`  💳 Mengisi Stripe frame: ${frame.url().slice(0, 80)}`);
            for (const sel of ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', 'input[placeholder*="1234"]']) {
              try {
                const el = frame.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click(); await sleep(300);
                  await el.pressSequentially(CC, { delay: 60 });
                  log("  ✅ Card number diisi");
                  await sleep(500); break;
                }
              } catch { }
            }
            for (const sel of ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]']) {
              try {
                const el = frame.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click(); await sleep(300);
                  await el.pressSequentially("1034", { delay: 60 });
                  log("  ✅ Expiry diisi");
                  await sleep(500); break;
                }
              } catch { }
            }
            for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="CVC"]']) {
              try {
                const el = frame.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click(); await sleep(300);
                  await el.pressSequentially(CC_CVV, { delay: 60 });
                  log("  ✅ CVV diisi");
                  await sleep(500); break;
                }
              } catch { }
            }
          }

          await proxyPage.screenshot({ path: "/tmp/stripe_filled.png" });
          log("📸 Stripe screenshot: /tmp/stripe_filled.png");
          break;
        }
        const pg = await proxyPage.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
        log(`  Konten: ${pg.slice(0, 100)}`);
      }
    }

    await proxyContext.close();

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error("❌ ERROR:", e.message); process.exit(1); });
