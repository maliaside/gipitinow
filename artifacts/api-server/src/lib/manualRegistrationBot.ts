import { chromium, Browser, Page, BrowserContext } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { generateRandomName, generateRandomBirthday, generatePassword, generateKoreanAddress, generateCreditCardInfo } from "./nameGenerator.js";
import { parseProxyUrl, STRIPE_BYPASS } from "./proxyUtils.js";

function getSystemChromiumPath(): string | undefined {
  try {
    return execSync("which chromium || which chromium-browser || which google-chrome-stable || which google-chrome", { timeout: 3000 })
      .toString().trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

// Pastikan Xvnc berjalan di display :1 sebelum launch browser non-headless.
// Dipanggil setiap kali sebelum payment browser diluncurkan.
async function ensureXDisplay(): Promise<void> {
  process.env.DISPLAY = ':1';
  const lockFile = '/tmp/.X1-lock';
  if (existsSync(lockFile)) return; // Sudah berjalan

  console.log('[VNC] X display :1 tidak aktif — menjalankan Xvnc...');
  try {
    spawn('Xvnc', [':1', '-depth', '24', '-geometry', '1280x800', '-SecurityTypes', 'None', '-localhost', 'no'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    // Tunggu Xvnc boot
    await new Promise(r => setTimeout(r, 3000));
  } catch (e: any) {
    console.error('[VNC] Gagal start Xvnc:', e.message);
  }
}

export type SessionStatus =
  | "idle"
  | "starting"
  | "filling_email"
  | "filling_password"
  | "waiting_code"
  | "filling_code"
  | "filling_profile"
  | "paying"
  | "waiting_human_submit"
  | "success"
  | "failed"
  | "cancelled";

export interface ManualSession {
  id: string;
  email: string;
  password: string;
  status: SessionStatus;
  logs: string[];
  createdAt: Date;
  codeResolver: ((code: string) => void) | null;
  browser: Browser | null;
  presetName?: string;
  checkoutUrl?: string;
  discordUserId?: string;
  sessionCookies?: any[];
  vncUrl?: string;
  // Screenshot + tap-to-click support
  proxyPage?: Page | null;
  screenshotUrl?: string;
}

export const sessions = new Map<string, ManualSession>();

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function humanType(page: Page, selector: string, text: string) {
  try {
    await page.click(selector, { timeout: 5000 });
    await sleep(200);
    for (const char of text) {
      await page.keyboard.type(char, { delay: 40 + Math.random() * 80 });
    }
    await sleep(300 + Math.random() * 300);
  } catch (e: any) {
    throw new Error(`Gagal mengisi input (${selector}): ${e.message}`);
  }
}

async function randomDelay(min = 800, max = 2000) {
  await sleep(min + Math.random() * (max - min));
}

// Simulasi browsing manusia di checkout page — meningkatkan hCaptcha trust score
// Bergerak mouse secara natural (bezier-like) selama `durationMs` ms
async function simulateHumanCheckout(page: Page, durationMs = 45000) {
  const startTime = Date.now();
  const viewportWidth = 1280;
  const viewportHeight = 720;

  // Posisi awal acak
  let currentX = 300 + Math.random() * 400;
  let currentY = 200 + Math.random() * 300;

  while (Date.now() - startTime < durationMs) {
    // Target posisi baru yang "natural"
    const targetX = Math.max(50, Math.min(viewportWidth - 50, currentX + (Math.random() - 0.5) * 300));
    const targetY = Math.max(50, Math.min(viewportHeight - 50, currentY + (Math.random() - 0.5) * 200));

    // Move dengan steps 10-25 untuk smooth
    const steps = 10 + Math.floor(Math.random() * 15);
    await page.mouse.move(targetX, targetY, { steps }).catch(() => {});
    currentX = targetX;
    currentY = targetY;

    // Terkadang scroll
    if (Math.random() < 0.25) {
      const scrollDelta = (Math.random() - 0.5) * 200;
      await page.mouse.wheel(0, scrollDelta).catch(() => {});
    }

    // Pause acak (120-800ms) seolah membaca konten
    await sleep(120 + Math.random() * 680);
  }
}

// ─── 2captcha hCaptcha solver ────────────────────────────────────────────────
// Membutuhkan env var: TWOCAPTCHA_KEY
// Sitekey diekstrak dari hCaptcha frame di Stripe checkout
async function solve2captchaHCaptcha(
  sitekey: string,
  pageUrl: string,
  proxyRaw?: string
): Promise<string | null> {
  const apiKey = process.env.TWOCAPTCHA_KEY;
  if (!apiKey) return null;

  const proxy = proxyRaw ? (() => {
    try {
      const u = new URL(proxyRaw.trim());
      return {
        type: "HTTP",
        uri: `${u.hostname}:${u.port}`,
        login: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
    } catch { return undefined; }
  })() : undefined;

  const taskPayload: Record<string, any> = {
    type: proxy ? "HCaptchaTask" : "HCaptchaTaskProxyless",
    websiteURL: pageUrl,
    websiteKey: sitekey,
    isInvisible: true,
  };
  if (proxy) {
    taskPayload.proxyType = proxy.type;
    taskPayload.proxyAddress = proxy.uri?.split(":")[0];
    taskPayload.proxyPort = Number(proxy.uri?.split(":")[1]);
    if (proxy.login) taskPayload.proxyLogin = proxy.login;
    if (proxy.password) taskPayload.proxyPassword = proxy.password;
  }

  try {
    const createRes = await fetch("https://api.2captcha.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, task: taskPayload }),
    }).then(r => r.json()) as any;

    if (createRes.errorId !== 0) return null;
    const taskId = createRes.taskId;

    // Poll hingga 120 detik
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const res = await fetch("https://api.2captcha.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      }).then(r => r.json()) as any;

      if (res.errorId !== 0) return null;
      if (res.status === "ready") {
        return res.solution?.gRecaptchaResponse || null;
      }
    }
  } catch { }
  return null;
}

// Inject hCaptcha token ke Stripe checkout page
async function injectHCaptchaToken(page: Page, token: string): Promise<boolean> {
  try {
    const injected = await page.evaluate((tok: string) => {
      // Method 1: hidden input h-captcha-response
      const inputs = document.querySelectorAll<HTMLInputElement>(
        'input[name="h-captcha-response"], textarea[name="h-captcha-response"], input[name="g-recaptcha-response"]'
      );
      for (const inp of Array.from(inputs)) {
        inp.value = tok;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return inputs.length > 0;
    }, token);
    return injected;
  } catch { return false; }
}

function appendLog(session: ManualSession, msg: string) {
  const line = `[${new Date().toLocaleTimeString("id-ID")}] ${msg}`;
  session.logs.push(line);
  console.log(`[Sesi ${session.id}] ${msg}`);
}

export function createSession(email: string, password: string): ManualSession {
  const id = Math.random().toString(36).slice(2, 10);
  const session: ManualSession = {
    id,
    email,
    password: password || generatePassword(),
    status: "idle",
    logs: [],
    createdAt: new Date(),
    codeResolver: null,
    browser: null,
  };
  sessions.set(id, session);
  return session;
}

export function submitCode(sessionId: string, code: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "waiting_code" || !session.codeResolver) return false;
  const resolver = session.codeResolver;
  session.codeResolver = null;
  resolver(code);
  return true;
}

export function cancelSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.status = "cancelled";
  if (session.codeResolver) {
    session.codeResolver("__CANCEL__");
    session.codeResolver = null;
  }
  if (session.browser) {
    session.browser.close().catch(() => {});
    session.browser = null;
  }
}

export async function runManualRegistration(
  session: ManualSession,
  proxy?: { server: string; username?: string; password?: string },
  ccNumber?: string
) {
  const { email, password } = session;
  let firstName: string, lastName: string;
  if (session.presetName) {
    const parts = session.presetName.split(" ");
    firstName = parts[0] ?? "Alex";
    lastName = parts.slice(1).join(" ") || "Smith";
  } else {
    ({ firstName, lastName } = generateRandomName());
  }
  const birthday = generateRandomBirthday();

  session.status = "starting";
  appendLog(session, `🚀 Memulai proses registrasi`);
  appendLog(session, `📧 Email: ${email}`);
  appendLog(session, `🔑 Password: ${password}`);
  appendLog(session, `👤 Nama: ${firstName} ${lastName} | Tanggal lahir: ${birthday}`);
  if (proxy) appendLog(session, `🌐 Proxy: ${proxy.server} | User: ${proxy.username ?? "none"}`);

  const playwrightExtra = addExtra(chromium as any);
  playwrightExtra.use(StealthPlugin());

  let browser: Browser | null = null;

  try {
    const systemChromium = getSystemChromiumPath();
    appendLog(session, `🔍 Browser: ${systemChromium ?? "playwright bundled"}`);

    // Browser diluncurkan TANPA proxy — SELALU headless untuk fase signup
    const launchOptions: any = {
      headless: true,
      ...(systemChromium ? { executablePath: systemChromium } : {}),
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-setuid-sandbox",
        "--no-zygote",
        "--disable-extensions",
        "--disable-software-rasterizer",
        "--disable-background-networking",
        "--window-size=1280,800",
        "--disable-infobars",
      ],
    };

    appendLog(session, `🌐 Meluncurkan browser [HEADLESS] fase signup...`);
    browser = await (playwrightExtra as any).launch(launchOptions) as Browser;
    session.browser = browser;

    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/New_York",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    if (session.status === "cancelled") throw new Error("Tugas dibatalkan");

    // Langkah 1: Buka halaman ChatGPT
    appendLog(session, `🔗 Membuka halaman utama ChatGPT...`);
    session.status = "filling_email";
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(1000, 1500);

    // Cek Cloudflare
    let title = await page.title();
    appendLog(session, `📄 Judul halaman: ${title}`);
    if (title.toLowerCase().includes("just a moment") || title.toLowerCase().includes("cloudflare")) {
      appendLog(session, `⏳ Terdeteksi Cloudflare, menunggu verifikasi selesai...`);
      await sleep(10000);
      title = await page.title();
      appendLog(session, `📄 Judul setelah tunggu: ${title}`);
    }

    // Cari dan klik tombol Sign up
    appendLog(session, `🖱️ Mencari tombol "Sign up"...`);
    const signupButtonSelectors = [
      'a[href*="signup"]',
      'button:has-text("Sign up")',
      'a:has-text("Sign up")',
      '[data-testid="sign-up"]',
      'button:has-text("Get started")',
      'a:has-text("Get started")',
      'button:has-text("Create account")',
    ];
    let clickedSignup = false;
    for (const sel of signupButtonSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.click();
          appendLog(session, `✅ Tombol ditemukan dan diklik (${sel})`);
          clickedSignup = true;
          await randomDelay(1000, 1500);
          break;
        }
      } catch { }
    }
    if (!clickedSignup) {
      appendLog(session, `🔄 Tombol tidak ditemukan, navigasi langsung ke halaman signup...`);
      await page.goto("https://auth.openai.com/authorize?client_id=TdJIcbe16WoTHtN95nyywh5E4yOo6ItG&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Fopenai&response_type=code&scope=openid+email+profile+offline_access&screen_hint=signup", { waitUntil: "domcontentloaded", timeout: 30000 });
      await randomDelay(1000, 1500);
    } else {
      // Verifikasi URL sudah pindah ke auth; jika tidak, navigasi langsung
      await randomDelay(1000, 1500);
      const afterClickUrl = page.url();
      if (afterClickUrl.includes("chatgpt.com") && !afterClickUrl.includes("/auth/")) {
        appendLog(session, `⚠️ Sign up klik tidak redirect — navigasi langsung ke auth signup`);
        await page.goto("https://auth.openai.com/authorize?client_id=TdJIcbe16WoTHtN95nyywh5E4yOo6ItG&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Fopenai&response_type=code&scope=openid+email+profile+offline_access&screen_hint=signup", { waitUntil: "domcontentloaded", timeout: 30000 });
        await randomDelay(1000, 1500);
      }
    }

    // Tunggu sampai halaman stabil setelah semua redirect auth selesai
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch { }
    await randomDelay(1500, 2000);

    title = await page.title().catch(() => "unknown");
    appendLog(session, `📄 Halaman signup: ${title}`);
    appendLog(session, `🌐 URL saat ini: ${page.url()}`);

    if (session.status === "cancelled") throw new Error("Tugas dibatalkan");

    // Tangani cookie consent dialog ("We use cookies")
    for (const cookieSel of [
      'button:has-text("Accept")',
      'button:has-text("Accept all")',
      'button:has-text("Allow")',
      'button:has-text("OK")',
      'button:has-text("Agree")',
      '[data-testid*="cookie"] button',
      'button[id*="accept"]',
      'button[class*="accept"]',
    ]) {
      try {
        const btn = page.locator(cookieSel).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click({ force: true });
          appendLog(session, `✅ Cookie consent diterima (${cookieSel})`);
          await randomDelay(1000, 1500);
          break;
        }
      } catch { }
    }

    // Jika mendarat di halaman login, cari link "Sign up" untuk pindah ke signup
    const currentUrlAfterNav = page.url();
    if (currentUrlAfterNav.includes("/auth/login") || currentUrlAfterNav.includes("login")) {
      appendLog(session, `🔄 Halaman login terdeteksi — mencari link "Sign up"...`);
      for (const sel of [
        'a:has-text("Sign up")',
        'button:has-text("Sign up")',
        'a[href*="signup"]',
        '[data-testid*="signup"]',
        'a:has-text("Create account")',
      ]) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click({ force: true });
            appendLog(session, `✅ Klik signup dari halaman login (${sel})`);
            await randomDelay(1000, 1500);
            break;
          }
        } catch { }
      }
    }

    appendLog(session, `🌐 URL setelah navigasi signup: ${page.url()}`);

    // Langkah 2: Isi email
    appendLog(session, `✍️ Mengisi kolom email...`);
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[autocomplete="email"]',
      'input[id*="email"]',
      'input[placeholder*="email" i]',
    ];
    let emailFilled = false;
    for (const sel of emailSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 12000 });
        await humanType(page, sel, email);
        emailFilled = true;
        appendLog(session, `✅ Email berhasil diisi`);
        break;
      } catch { }
    }
    if (!emailFilled) {
      const currentUrl = page.url();
      const h1 = await page.$eval("h1", el => el.textContent).catch(() => "N/A");
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
      appendLog(session, `⚠️ URL saat ini: ${currentUrl}`);
      appendLog(session, `⚠️ H1: ${h1}`);
      appendLog(session, `⚠️ Teks halaman: ${pageText.slice(0, 150)}`);
      throw new Error("Kolom email tidak ditemukan — cek log untuk detail");
    }

    await page.keyboard.press("Enter");
    await randomDelay(800, 1200);

    if (session.status === "cancelled") throw new Error("Tugas dibatalkan");

    // Langkah 3: Isi password
    appendLog(session, `🔒 Mengisi kolom password...`);
    session.status = "filling_password";
    const pwSelectors = ['input[type="password"]', 'input[name="password"]', 'input[id*="password"]'];
    let pwFilled = false;
    for (const sel of pwSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 8000 });
        await humanType(page, sel, password);
        pwFilled = true;
        appendLog(session, `✅ Password berhasil diisi`);
        break;
      } catch { }
    }
    if (!pwFilled) throw new Error("Kolom password tidak ditemukan");

    await page.keyboard.press("Enter");
    await randomDelay(1000, 1500);

    // Cek apakah email sudah terdaftar (aman jika halaman sedang navigasi)
    try {
      const pageContent = await page.content();
      if (pageContent.includes("already") || pageContent.includes("exists")) {
        throw new Error("Email ini sudah terdaftar di ChatGPT");
      }
    } catch (e: any) {
      if (e.message.includes("sudah terdaftar")) throw e;
      // Ignore navigation errors saat cek konten
    }

    if (session.status === "cancelled") throw new Error("Tugas dibatalkan");

    // Langkah 4: Tunggu kode verifikasi dari pengguna
    appendLog(session, `📬 ChatGPT sedang mengirim kode verifikasi ke ${email}...`);
    appendLog(session, `⏳ Silakan cek inbox emailmu, lalu masukkan kode 6 digit di bawah`);
    session.status = "waiting_code";

    const code = await new Promise<string>((resolve) => {
      session.codeResolver = resolve;
      setTimeout(() => resolve("__TIMEOUT__"), 5 * 60 * 1000);
    });

    if (code === "__CANCEL__") throw new Error("Tugas dibatalkan");
    if (code === "__TIMEOUT__") throw new Error("Kode verifikasi tidak dimasukkan dalam 5 menit");

    // Langkah 5: Masukkan kode OTP
    appendLog(session, `🔢 Memasukkan kode verifikasi: ${code}`);
    session.status = "filling_code";
    await randomDelay(500, 1000);

    const otpSelectors = [
      'input[autocomplete="one-time-code"]',
      'input[name="code"]',
      'input[aria-label*="digit"]',
      'input[aria-label*="code"]',
      'input[aria-label*="verification"]',
      'input[placeholder*="code" i]',
    ];
    let otpFilled = false;
    for (const sel of otpSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await sleep(200);
          await el.type(code, { delay: 100 });
          otpFilled = true;
          appendLog(session, `✅ Kode berhasil dimasukkan (satu kotak)`);
          break;
        }
      } catch { }
    }

    if (!otpFilled) {
      const digits = await page.$$('input[maxlength="1"]');
      if (digits.length >= 4) {
        for (let i = 0; i < Math.min(code.length, digits.length); i++) {
          await digits[i].click();
          await digits[i].type(code[i], { delay: 100 });
          await sleep(80);
        }
        otpFilled = true;
        appendLog(session, `✅ Kode dimasukkan digit per digit (${digits.length} kotak)`);
      }
    }

    if (!otpFilled) {
      appendLog(session, `⚠️ Kotak OTP tidak ditemukan, mencoba tekan Enter...`);
    }

    await page.keyboard.press("Enter").catch(() => {});
    await randomDelay(600, 1000);

    if (session.status === "cancelled") throw new Error("Tugas dibatalkan");

    // Langkah 6: Isi data profil
    appendLog(session, `👤 Mengisi data profil: ${firstName} ${lastName}...`);
    session.status = "filling_profile";

    for (const { selector, value } of [
      { selector: 'input[name="firstName"], input[placeholder*="First" i], input[aria-label*="First" i]', value: firstName },
      { selector: 'input[name="lastName"], input[placeholder*="Last" i], input[aria-label*="Last" i]', value: lastName },
    ]) {
      try {
        const el = await page.$(selector);
        if (el) await humanType(page, selector, value);
      } catch { }
    }

    try {
      const bday = await page.$('input[type="date"], input[name="birthday"]');
      if (bday) {
        const [mm, dd, yyyy] = birthday.split("/");
        await bday.fill(`${yyyy}-${mm}-${dd}`);
        appendLog(session, `📅 Tanggal lahir diisi: ${birthday}`);
      }
    } catch { }

    await randomDelay(1000, 2000);

    for (const btnText of ["Continue", "Next", "Submit", "Agree", "Done"]) {
      try {
        const btn = page.getByText(btnText, { exact: false }).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          appendLog(session, `✅ Klik tombol "${btnText}"`);
          break;
        }
      } catch { }
    }

    await randomDelay(1000, 1500);

    // Langkah 7: Loop penanganan halaman auth hingga selesai
    let attempts = 0;
    while (attempts < 8) {
      attempts++;
      const currentUrl = page.url();
      appendLog(session, `🔍 [${attempts}] URL saat ini: ${currentUrl}`);

      // ✅ Akun terdaftar — sudah di chatgpt.com, lanjut ke payment
      if (currentUrl.includes("chatgpt.com") && !currentUrl.includes("auth")) {
        session.status = "registered";
        appendLog(session, `🎉 Akun terdaftar — lanjut ke payment...`);
        appendLog(session, `─────────────────────────────────`);
        appendLog(session, `📧 Email    : ${email}`);
        appendLog(session, `🔑 Password : ${password}`);
        appendLog(session, `👤 Nama     : ${firstName} ${lastName}`);
        appendLog(session, `🎂 DOB      : ${birthday}`);
        appendLog(session, `─────────────────────────────────`);
        break;
      }

      // ✅ Akun terdaftar — halaman verifikasi email, lanjut ke payment
      if (currentUrl.includes("email-verification")) {
        session.status = "registered";
        appendLog(session, `📨 Akun berhasil dibuat!`);
        appendLog(session, `─────────────────────────────────`);
        appendLog(session, `📧 Email    : ${email}`);
        appendLog(session, `🔑 Password : ${password}`);
        appendLog(session, `👤 Nama     : ${firstName} ${lastName}`);
        appendLog(session, `🎂 DOB      : ${birthday}`);
        appendLog(session, `─────────────────────────────────`);
        break;
      }

      // ❌ Gagal — halaman error
      if (currentUrl.includes("/auth/error") || currentUrl.includes("error")) {
        const errText = await page.$eval("body", el => el.textContent ?? "").catch(() => "");
        throw new Error(`Halaman error: ${errText.slice(0, 100)}`);
      }

      // 📋 Halaman "About You" / profil — isi nama & tanggal lahir
      if (currentUrl.includes("about-you") || currentUrl.includes("profile")) {
        appendLog(session, `📋 Halaman profil muncul — mengisi nama...`);
        session.status = "filling_profile";

        // Ringkasan form (hanya iterasi pertama)
        if (attempts <= 1) {
          try {
            const formInfo = await page.evaluate(() => {
              const inputs = Array.from(document.querySelectorAll("input")).map(el => el.name || el.placeholder || el.type).filter(Boolean);
              const spinbuttons = document.querySelectorAll('[role="spinbutton"]').length;
              const buttons = Array.from(document.querySelectorAll("button")).filter(b => !(b as HTMLButtonElement).disabled && b.textContent?.trim()).map(b => b.textContent?.trim());
              return { inputs, spinbuttons, buttons };
            });
            appendLog(session, `📝 Form fields: ${formInfo.inputs.join(", ")} | Spinbuttons: ${formInfo.spinbuttons} | Tombol: ${formInfo.buttons.join(", ")}`);
          } catch { }
        }

        // Isi nama — fokus via JS lalu ketik untuk update React state
        const fullName = `${firstName} ${lastName}`;
        try {
          // Fokus input langsung via JavaScript (bypass label overlay)
          await page.evaluate(() => {
            const input = document.querySelector('input[name="name"]') as HTMLInputElement | null;
            if (input) { input.focus(); input.select(); }
          });
          await randomDelay(100, 200);
          await page.keyboard.press("Control+a");
          await page.keyboard.press("Delete");
          await randomDelay(150, 250);
          await page.keyboard.type(fullName, { delay: 70 });
          await randomDelay(200, 400);
          // Trigger blur untuk validasi React Aria
          await page.evaluate(() => {
            const input = document.querySelector('input[name="name"]') as HTMLInputElement | null;
            if (input) {
              input.dispatchEvent(new Event('blur', { bubbles: true }));
              input.dispatchEvent(new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
            }
          });
          const actualValue = await page.locator('input[name="name"]').inputValue().catch(() => "?");
          appendLog(session, `✅ Nama diisi: "${actualValue}"`);
        } catch (e: any) {
          appendLog(session, `⚠️ Isi nama gagal: ${e.message}`);
          try {
            await page.locator('input[name="name"]').fill(fullName);
            appendLog(session, `✅ Nama diisi via fill(): ${fullName}`);
          } catch { }
        }

        await randomDelay(500, 800);

        // Isi tanggal lahir
        const [bdMM, bdDD, bdYYYY] = birthday.split("/");
        const isoDate = `${bdYYYY}-${bdMM}-${bdDD}`;
        const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const monthName = MONTH_NAMES[parseInt(bdMM, 10) - 1] ?? "January";

        // PRIORITAS 1: Handle spinbutton (React Aria DatePicker)
        try {
          const spinbtns = page.locator('[role="spinbutton"]');
          const sbCount = await spinbtns.count();
          if (sbCount >= 3) {
            // Fokus tiap spinbutton via JS lalu ketik
            for (const [i, val] of [[0, parseInt(bdMM).toString()], [1, parseInt(bdDD).toString()], [2, bdYYYY]] as [number, string][]) {
              await spinbtns.nth(i).evaluate(el => (el as HTMLElement).focus());
              await randomDelay(150, 250);
              await page.keyboard.type(val, { delay: 60 });
              await randomDelay(150, 250);
            }
            appendLog(session, `📅 Tanggal lahir (spinbutton) diisi: ${birthday}`);
          }
        } catch (e: any) { appendLog(session, `⚠️ Spinbutton error: ${e.message}`); }

        // PRIORITAS 2: Set hidden input birthday — lakukan SETELAH spinbutton
        // agar override nilai yang mungkin diset spinbutton JS handler
        try {
          const hdResult = await page.evaluate((iso) => {
            const hidden = document.querySelector('input[name="birthday"]') as HTMLInputElement | null;
            if (!hidden) return "tidak ditemukan";
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(hidden, iso);
            hidden.dispatchEvent(new Event('input', { bubbles: true }));
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
            return hidden.value;
          }, isoDate);
          appendLog(session, `📅 Hidden birthday diset: ${hdResult}`);
        } catch (e: any) { appendLog(session, `⚠️ Set hidden birthday gagal: ${e.message}`); }

        // Coba native <select>
        try {
          const selects = await page.$$("select");
          if (selects.length >= 3) {
            await selects[0].selectOption({ index: parseInt(bdMM) });
            await selects[1].selectOption({ value: bdDD.replace(/^0/, "") });
            await selects[2].selectOption({ value: bdYYYY });
            appendLog(session, `📅 Tanggal lahir (select) diisi: ${birthday}`);
          }
        } catch (e: any) { appendLog(session, `⚠️ Select error: ${e.message}`); }

        // Coba combobox (role="combobox") — force:true + timeout pendek agar tidak hang 30s
        try {
          const comboboxes = page.locator('[role="combobox"], [aria-haspopup="listbox"]');
          const cbCount = await comboboxes.count({ timeout: 1500 }).catch(() => 0);
          if (cbCount >= 3) {
            await comboboxes.nth(0).click({ force: true, timeout: 3000 });
            await randomDelay(300, 500);
            await page.getByRole("option", { name: monthName, exact: false }).first().click({ timeout: 2000 }).catch(async () => {
              await page.locator(`[role="option"]:has-text("${monthName}")`).first().click({ timeout: 2000 }).catch(() => {});
            });
            await randomDelay(200, 400);
            await comboboxes.nth(1).click({ force: true, timeout: 3000 });
            await randomDelay(300, 500);
            await page.getByRole("option", { name: String(parseInt(bdDD)), exact: true }).first().click({ timeout: 2000 }).catch(async () => {
              await page.locator(`[role="option"]:has-text("${parseInt(bdDD)}")`).first().click({ timeout: 2000 }).catch(() => {});
            });
            await randomDelay(200, 400);
            await comboboxes.nth(2).click({ force: true, timeout: 3000 });
            await randomDelay(300, 500);
            await page.getByRole("option", { name: bdYYYY, exact: true }).first().click({ timeout: 2000 }).catch(async () => {
              await page.locator(`[role="option"]:has-text("${bdYYYY}")`).first().click({ timeout: 2000 }).catch(() => {});
            });
            appendLog(session, `📅 Tanggal lahir (combobox) selesai: ${birthday}`);
          }
        } catch (e: any) { appendLog(session, `⚠️ Combobox skip: ${e.message?.slice(0, 60)}`); }

        // Coba input[type=date]
        try {
          const dateInput = await page.$('input[type="date"]');
          if (dateInput) {
            await dateInput.fill(isoDate);
            appendLog(session, `📅 Tanggal lahir (input date) diisi: ${isoDate}`);
          }
        } catch { }

        await randomDelay(600, 1000);

        // Cek tombol submit yang tersedia
        const btnInfo = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          return btns.map(b => ({ text: b.textContent?.trim(), disabled: b.disabled, type: b.type }));
        }).catch(() => [] as { text?: string; disabled: boolean; type: string }[]);
        const activeBtns = btnInfo.filter(b => !b.disabled && b.text).map(b => b.text).join(", ");
        appendLog(session, `🔎 Tombol aktif: ${activeBtns || "(tidak ada)"}`);

        // Klik tombol submit
        let clicked = false;

        // Cari tombol "Finish creating account" atau submit pertama
        const finishBtn = page.locator('button:has-text("Finish creating account"), button:has-text("Finish"), button[type="submit"]').first();
        const finishBtnVisible = await finishBtn.isVisible({ timeout: 2000 }).catch(() => false);

        let accountCreatedConfirmed = false;
        try {
          const [response] = await Promise.all([
            page.waitForResponse(
              resp => resp.url().includes("about-you") || resp.url().includes("create_account") || resp.url().includes("openai.com/api"),
              { timeout: 8000 }
            ).catch(() => null),
            finishBtnVisible
              ? finishBtn.click({ force: true })
              : page.keyboard.press("Enter")
          ]);
          clicked = true;
          if (response) {
            const st = response.status();
            const isCreate = response.url().includes("create_account");
            if (isCreate && st >= 200 && st < 300) {
              accountCreatedConfirmed = true;
              appendLog(session, `📡 Submit: ${st} account created ✅`);
            } else if (isCreate && st >= 400) {
              appendLog(session, `📡 Submit: ${st} server error — akan coba navigasi langsung`);
            } else {
              appendLog(session, `📡 Submit: ${st} ${response.url().slice(0, 60)}`);
            }
          } else {
            appendLog(session, `✅ Submit diklik`);
          }
        } catch (e: any) {
          appendLog(session, `⚠️ Submit error: ${e.message}`);
        }

        if (!clicked) {
          await page.keyboard.press("Enter");
          appendLog(session, `⌨️ Enter sebagai fallback`);
        }

        // Jika server sudah konfirmasi account created, tunggu navigasi lalu break
        if (accountCreatedConfirmed) {
          appendLog(session, `✅ Akun terkonfirmasi server — tunggu navigasi...`);
          try {
            await page.waitForURL(url => !url.includes("about-you"), { timeout: 10000 });
            appendLog(session, `✅ Navigasi berhasil setelah account created`);
          } catch {
            // Navigasi mungkin masih berjalan atau halaman sudah pindah — tidak masalah
            appendLog(session, `⏳ Navigasi timeout tapi account sudah dibuat — lanjut`);
          }
          // Set "registered" (BUKAN "success") — agar Discord polling loop tetap jalan
          // sampai payment selesai dan set "waiting_human_submit" / "success"
          session.status = "registered";
          appendLog(session, `🎉 Akun terdaftar — lanjut ke payment...`);
          appendLog(session, `─────────────────────────────────`);
          appendLog(session, `📧 Email    : ${email}`);
          appendLog(session, `🔑 Password : ${password}`);
          appendLog(session, `👤 Nama     : ${firstName} ${lastName}`);
          appendLog(session, `🎂 DOB      : ${birthday}`);
          appendLog(session, `─────────────────────────────────`);
          break;
        }

        // Tunggu navigasi keluar dari about-you (maks 15 detik)
        try {
          await page.waitForURL(url => !url.includes("about-you"), { timeout: 15000 });
          appendLog(session, `✅ Navigasi berhasil`);
        } catch {
          // Timeout: cek apakah ada error validasi di halaman
          const pageDebug = await page.evaluate(() => {
            const errorEls = Array.from(document.querySelectorAll('[role="alert"], [data-error], p[class*="error"]'))
              .map(el => el.textContent?.trim()).filter(Boolean);
            const nameVal = (document.querySelector('input[name="name"]') as HTMLInputElement)?.value ?? "?";
            return { errorEls, nameVal, url: window.location.href };
          }).catch(() => ({ errorEls: [] as string[], nameVal: "?", url: "" }));

          if (pageDebug.errorEls.length) {
            appendLog(session, `⚠️ Validasi error: ${pageDebug.errorEls.join("; ")}`);
          } else {
            appendLog(session, `⏳ Menunggu navigasi (timeout), cek URL...`);
          }

          // Jika sudah > 2x stuck di about-you, coba login ulang via chatgpt.com/auth/login
          if (attempts >= 3) {
            appendLog(session, `⚠️ Stuck di about-you (${attempts}x) — coba login ulang untuk dapat session token...`);
            // Coba login via chatgpt.com auth flow (bukan navigasi langsung — butuh session token OAuth)
            await page.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
            await randomDelay(1000, 1500);
            // Isi email
            try {
              const emailInput = page.locator('input[type="email"], input[name="email"]').first();
              if (await emailInput.isVisible({ timeout: 3000 })) {
                await emailInput.fill(email);
                await page.keyboard.press("Enter");
                await randomDelay(800, 1200);
              }
            } catch { }
            // Isi password
            try {
              const pwInput = page.locator('input[type="password"]').first();
              if (await pwInput.isVisible({ timeout: 3000 })) {
                await pwInput.fill(password);
                await page.keyboard.press("Enter");
                await randomDelay(600, 1000);
              }
            } catch { }
            const afterLoginUrl = page.url();
            appendLog(session, `🌐 URL setelah re-login: ${afterLoginUrl}`);
            // Jika masih di auth/about-you, navigasi paksa ke chatgpt.com
            if (afterLoginUrl.includes("auth") || afterLoginUrl.includes("about-you")) {
              await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
              await randomDelay(400, 700);
            }
          }
        }

        // Setelah submit, cek apakah sudah sukses sebelum looping lagi
        await randomDelay(800, 1200);
        const urlAfterSubmit = page.url();
        if (urlAfterSubmit.includes("chatgpt.com") && !urlAfterSubmit.includes("auth")) {
          session.status = "registered";
          appendLog(session, `🎉 Akun terdaftar — lanjut ke payment...`);
          appendLog(session, `─────────────────────────────────`);
          appendLog(session, `📧 Email    : ${email}`);
          appendLog(session, `🔑 Password : ${password}`);
          appendLog(session, `👤 Nama     : ${firstName} ${lastName}`);
          appendLog(session, `🎂 DOB      : ${birthday}`);
          appendLog(session, `─────────────────────────────────`);
          break;
        }
        continue;
      }

      // 📜 Halaman Terms / Syarat — langsung setuju
      if (currentUrl.includes("terms") || currentUrl.includes("agree") || currentUrl.includes("consent")) {
        appendLog(session, `📜 Halaman syarat & ketentuan — menyetujui...`);
        for (const btnText of ["Agree", "Accept", "Continue", "I agree"]) {
          try {
            const btn = page.getByText(btnText, { exact: false }).first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              appendLog(session, `✅ Klik tombol "${btnText}"`);
              break;
            }
          } catch { }
        }
        await randomDelay(800, 1200);
        continue;
      }

      // ⏳ Masih di halaman auth lainnya — coba klik Continue / tunggu redirect
      if (currentUrl.includes("auth.openai.com") || currentUrl.includes("openai.com")) {
        appendLog(session, `⏳ Masih di halaman OpenAI, menunggu redirect atau mencari tombol...`);
        for (const btnText of ["Continue", "Next", "Done", "Agree", "Accept"]) {
          try {
            const btn = page.getByText(btnText, { exact: false }).first();
            if (await btn.isVisible({ timeout: 1500 })) {
              await btn.click();
              appendLog(session, `✅ Klik tombol "${btnText}"`);
              break;
            }
          } catch { }
        }
        await randomDelay(1200, 1800);
        continue;
      }

      // URL tidak dikenal — tunggu sebentar
      appendLog(session, `⏳ URL tidak dikenal, menunggu...`);
      await randomDelay(1200, 1800);
    }

    if (session.status !== "success" && session.status !== "registered") {
      const lastUrl = page.url();
      throw new Error(`Proses tidak selesai setelah ${attempts} percobaan. URL terakhir: ${lastUrl}`);
    }

    // Simpan cookies SEBELUM doManualPayment — agar AutoPay bisa pakai segera saat checkout URL tersedia
    try {
      const savedCookies = await context.cookies();
      if (savedCookies.length > 0) {
        session.sessionCookies = savedCookies;
        appendLog(session, `🍪 ${savedCookies.length} cookies disimpan ke session (pre-payment)`);
      }
    } catch { }

    // Payment step (jika cc_number dikonfigurasi)
    // Proxy diaktifkan di sini — context baru dengan proxy Korean untuk payment
    if (ccNumber?.trim() && page) {
      await doManualPayment(session, page, context, proxy ?? null, ccNumber.trim(), `${firstName} ${lastName}`);
    }

  } catch (err: any) {
    if (session.status !== "cancelled") {
      session.status = "failed";
      appendLog(session, `❌ Registrasi gagal: ${err.message}`);
    }
  } finally {
    if (browser) {
      try { await browser.close(); } catch {
        try { browser.process()?.kill('SIGKILL'); } catch { }
      }
      session.browser = null;
    }
  }
}

// ─── HELPER: Isi Stripe Address Element iframe ───────────────────────────────
// Stripe Address Element menggunakan beragam selector tergantung versi/region.
// Gunakan pendekatan posisional sebagai fallback jika named selector tidak cocok.
async function fillStripeAddressFrame(
  frame: any,
  addr: { line1: string; district: string; city: string; province: string; postal: string },
  logFn: (msg: string) => void,
  cardholderName?: string
) {
  // 1. Pilih negara (country select)
  try {
    const csel = frame.locator('select').first();
    if (await csel.isVisible({ timeout: 3000 })) {
      await csel.selectOption({ value: "KR" });
      logFn(`  ✅ Country: KR`);
      await sleep(1500); // Tunggu form re-render setelah country dipilih
    }
  } catch { }

  // 1b. Billing name (field [0] = input[name="name"] ac="billing name")
  if (cardholderName) {
    try {
      const nameEl = frame.locator('input[name="name"], input[autocomplete="billing name"], input[autocomplete="cc-name"]').first();
      if (await nameEl.isVisible({ timeout: 2000 })) {
        await nameEl.click(); await sleep(80);
        await nameEl.fill(cardholderName);
        logFn(`  ✅ Billing name: ${cardholderName}`);
        await sleep(300);
      }
    } catch { }
  }

  // 2. Debug: log semua input yang ada
  try {
    const count = await frame.locator('input').count();
    logFn(`  📋 ${count} inputs ditemukan di address iframe:`);
    for (let i = 0; i < Math.min(count, 6); i++) {
      const inp = frame.locator('input').nth(i);
      const info = await inp.evaluate((e: Element) => ({
        name: (e as HTMLInputElement).name,
        placeholder: (e as HTMLInputElement).placeholder,
        autocomplete: (e as HTMLInputElement).autocomplete,
      })).catch(() => ({}));
      logFn(`    [${i}] name="${(info as any).name}" ph="${(info as any).placeholder}" ac="${(info as any).autocomplete}"`);
    }
  } catch { }

  // 3. Helper: coba isi input dengan berbagai selector, fallback ke nth(index)
  const tryFill = async (
    sels: string[],
    value: string,
    label: string,
    fallbackIndex?: number
  ) => {
    for (const sel of sels) {
      try {
        const el = frame.locator(sel).first();
        if (await el.isVisible({ timeout: 1200 })) {
          await el.click(); await sleep(80);
          await el.fill(value);
          logFn(`  ✅ ${label}: ${value}`);
          await sleep(250);
          return true;
        }
      } catch { }
    }
    // Positional fallback
    if (fallbackIndex !== undefined) {
      try {
        const el = frame.locator('input').nth(fallbackIndex);
        if (await el.isVisible({ timeout: 1200 })) {
          await el.click(); await sleep(80);
          await el.fill(value);
          logFn(`  ✅ ${label} [nth-${fallbackIndex}]: ${value}`);
          await sleep(250);
          return true;
        }
      } catch { }
    }
    logFn(`  ⚠️ ${label}: tidak ditemukan (nilai: ${value})`);
    return false;
  };

  // Line 1  ← debug: [3] name="addressLine1" ac="billing address-line1"
  await tryFill([
    'input[name="addressLine1"]',
    'input[name="address-line1"]',
    'input[name="line1"]',
    'input[autocomplete="billing address-line1"]',
    'input[autocomplete="address-line1"]',
    'input[autocomplete*="address-line1"]',
    'input[placeholder*="Address line 1" i]',
    'input[placeholder*="Street" i]',
    'input[placeholder*="주소" i]',
    'input[name="address"]:not([name="address2"])',
  ], addr.line1, 'Line 1', 3);

  // Line 2  ← debug: [4] name="addressLine2" ac="billing address-line2"
  await tryFill([
    'input[name="addressLine2"]',
    'input[name="address2"]',
    'input[name="address-line2"]',
    'input[name="line2"]',
    'input[autocomplete="billing address-line2"]',
    'input[autocomplete="address-line2"]',
    'input[autocomplete*="address-line2"]',
    'input[placeholder*="Apt" i]',
    'input[placeholder*="Address line 2" i]',
    'input[placeholder*="Suite" i]',
  ], addr.district, 'Line 2', 4);

  // City  ← debug: [2] name="locality" ac="billing address-level2"
  await tryFill([
    'input[name="locality"]',
    'input[name="city"]',
    'input[autocomplete="billing address-level2"]',
    'input[autocomplete="address-level2"]',
    'input[autocomplete*="address-level2"]',
    'input[placeholder*="City" i]',
    'input[placeholder*="도시" i]',
  ], addr.city, 'City', 2);

  // State/Province — autocomplete bisa "address-level1" atau "billing address-level1"
  let stateFilled = false;
  for (const sel of [
    'select[name="state"]', 'select[name="province"]',
    'select[autocomplete="address-level1"]',
    'select[autocomplete="billing address-level1"]',
    'input[name="state"]', 'input[name="province"]',
    'input[autocomplete="address-level1"]',
    'input[autocomplete="billing address-level1"]',
    'input[autocomplete*="address-level1"]',
  ]) {
    try {
      const el = frame.locator(sel).first();
      if (await el.isVisible({ timeout: 1200 })) {
        const tag = await el.evaluate((e: Element) => e.tagName).catch(() => "INPUT");
        if (tag === "SELECT") {
          await el.selectOption({ label: addr.province })
            .catch(() => el.selectOption({ index: 1 }).catch(() => {}));
        } else {
          await el.click(); await sleep(80);
          await el.fill(addr.province);
        }
        logFn(`  ✅ State: ${addr.province}`);
        await sleep(250);
        stateFilled = true;
        break;
      }
    } catch { }
  }
  // Fallback nth(1) — jika semua selector gagal (field name="" hanya match by position)
  if (!stateFilled) {
    try {
      const el = frame.locator('input').nth(1);
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click(); await sleep(80);
        await el.fill(addr.province);
        logFn(`  ✅ State [nth-1]: ${addr.province}`);
        await sleep(250);
      }
    } catch { }
  }

  // ZIP / Postal Code
  const totalInputs = await frame.locator('input').count().catch(() => 5);
  await tryFill([
    'input[name="zip"]',
    'input[name="postal"]',
    'input[name="postalCode"]',
    'input[name="postal-code"]',
    'input[autocomplete="postal-code"]',
    'input[placeholder*="ZIP" i]',
    'input[placeholder*="Postal" i]',
    'input[placeholder*="우편" i]',
  ], addr.postal, 'ZIP', Math.max(0, totalInputs - 1));
}

async function doManualPayment(
  session: ManualSession,
  originalPage: Page,
  originalContext: BrowserContext,
  proxy: { server: string; username?: string; password?: string } | null,
  ccNumber: string,
  cardholderName: string
) {
  const { expMonth, expYear, cvv } = generateCreditCardInfo();
  const addr = generateKoreanAddress();

  appendLog(session, `💳 Memulai payment CC: ****${ccNumber.slice(-4)}`);
  appendLog(session, `📅 Expiry: ${expMonth}/${expYear.slice(-2)} | CVV: ${cvv}`);
  appendLog(session, `📍 Alamat: ${addr.line1}, ${addr.city}, ${addr.province} ${addr.postal}`);

  let proxyContext: BrowserContext | null = null;
  let paymentBrowser: Browser | null = null;
  let page: Page;

  // ─── PRE-STEP: GET CHECKOUT URL DARI ORIGINAL BROWSER ────────────────
  // Original browser masih ada "Claim offer" di plans page (dari onboarding).
  // Dapatkan cs_live_xxx URL dari sini, lalu proxy browser langsung ke checkout.
  let preCheckoutUrl: string | null = null;
  try {
    appendLog(session, `🔍 [Pre-step] Gunakan browser signup untuk dapat checkout URL...`);
    // Navigate originalPage ke /plans — "Claim offer" masih visible karena baru selesai onboarding
    await originalPage.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await randomDelay(2000, 3000);
    const ptPre = await originalPage.evaluate(() => document.body.innerText).catch(() => "");
    const hasClaim = ptPre.includes("Claim offer") || ptPre.includes("Free offer") || ptPre.includes("Claim free");
    appendLog(session, `📄 [Pre-step] /plans (original browser): hasClaim=${hasClaim}, url=${originalPage.url()}`);

    if (hasClaim) {
      // Dismiss onboarding modals dulu
      for (let dm = 0; dm < 5; dm++) {
        const bodyDm = await originalPage.evaluate(() => document.body.innerText).catch(() => "");
        const needDismiss = bodyDm.includes("What brings you") || bodyDm.includes("What do you want to do")
          || (bodyDm.includes("School") && bodyDm.includes("Work") && bodyDm.includes("Skip"));
        if (!needDismiss) break;
        await originalPage.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
          const skip = btns.find(b => b.innerText.trim() === "Skip" && (b as any).offsetParent !== null);
          if (skip) skip.click();
        }).catch(() => {});
        await randomDelay(1000, 1500);
      }
      // Klik "Claim offer" di original browser
      for (const claimSel of ['button:has-text("Claim offer")', 'a:has-text("Claim offer")', 'button:has-text("Free offer")', 'button:has-text("Claim free")']) {
        try {
          const claimBtn = originalPage.locator(claimSel).first();
          if (await claimBtn.isVisible({ timeout: 2000 })) {
            await claimBtn.click({ force: true });
            appendLog(session, `✅ [Pre-step] Klik "${claimSel}" di original browser`);
            await randomDelay(2000, 3000);
            break;
          }
        } catch { }
      }
      // Handle onboarding purpose modal (Work/School/Personal) → pilih Work → Next
      for (let om = 0; om < 3; om++) {
        const bodyOm = await originalPage.evaluate(() => document.body.innerText).catch(() => "");
        if (bodyOm.includes("Work") && bodyOm.includes("School") && (bodyOm.includes("Next") || bodyOm.includes("Skip"))) {
          appendLog(session, `🔄 [Pre-step] Onboarding purpose modal — klik Work → Next`);
          await originalPage.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
            const work = btns.find(b => b.innerText.trim() === "Work" && (b as any).offsetParent !== null);
            if (work) work.click();
          }).catch(() => {});
          await randomDelay(800, 1200);
          await originalPage.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
            const nxt = btns.find(b => b.innerText.trim() === "Next" && (b as any).offsetParent !== null);
            if (nxt) nxt.click();
          }).catch(() => {});
          await randomDelay(1500, 2000);
        } else break;
      }
      // Handle plan type selection (Personal/Business) + klik CTA "Claim free offer"
      for (let pm = 0; pm < 8; pm++) {
        await randomDelay(1500, 2500); // Beri waktu modal muncul sebelum cek
        const bodyPm = await originalPage.evaluate(() => document.body.innerText).catch(() => "");
        const urlPm = originalPage.url();
        // Jika sudah di checkout, stop
        if (urlPm.includes("/checkout/")) break;
        // Debug log
        const btnsPm = await originalPage.evaluate(() =>
          Array.from(document.querySelectorAll("button")).filter((b: any) => b.offsetParent !== null).map((b: any) => b.innerText.trim()).filter(Boolean).slice(0, 10).join(" | ")
        ).catch(() => "");
        appendLog(session, `🔍 [Pre-step pm=${pm+1}] URL=${urlPm.slice(-40)} | Btns: ${btnsPm.slice(0, 80)}`);
        // Klik "Claim free offer" langsung jika visible (pakai locator.click agar React handler aktif)
        let claimDirectPre: string | null = null;
        for (const cta of ['button:has-text("Claim free offer")', 'button:has-text("Claim free trial")', 'button:has-text("Try Business for free")']) {
          try {
            const loc = originalPage.locator(cta).first();
            if (await loc.isVisible({ timeout: 1500 })) { await loc.click({ force: false }); claimDirectPre = cta; break; }
          } catch { }
        }
        if (claimDirectPre) {
          appendLog(session, `✅ [Pre-step] CTA langsung (locator): "${claimDirectPre}"`);
          await randomDelay(2000, 3000);
          continue;
        }
        if (bodyPm.includes("Personal") && (bodyPm.includes("Business") || bodyPm.includes("Next"))) {
          appendLog(session, `🔄 [Pre-step] Plan type modal — klik Business → Claim free offer`);
          let clicked = false;
          for (const lbl of ["Business", "Personal"]) {
            try {
              const loc = originalPage.locator(`button:has-text("${lbl}")`).first();
              if (await loc.isVisible({ timeout: 1500 })) { await loc.click({ force: false }); clicked = true; break; }
            } catch { }
          }
          if (clicked) {
            await randomDelay(800, 1200);
            // Setelah pilih plan, klik "Claim free offer" CTA
            let claimAfterPre: string | null = null;
            for (const cta of ['button:has-text("Claim free offer")', 'button:has-text("Claim free trial")']) {
              try {
                const loc = originalPage.locator(cta).first();
                if (await loc.isVisible({ timeout: 1500 })) { await loc.click({ force: false }); claimAfterPre = cta; break; }
              } catch { }
            }
            if (claimAfterPre) appendLog(session, `✅ [Pre-step] CTA (locator): "${claimAfterPre}"`);
            await randomDelay(1500, 2000);
          } else {
            appendLog(session, `⏳ [Pre-step] Business btn tidak ditemukan — tunggu modal`);
          }
        } else {
          appendLog(session, `⏳ [Pre-step] Kondisi modal belum match — retry`);
        }
      }
      // Tunggu checkout URL muncul di original browser
      for (let cu = 0; cu < 20; cu++) {
        const urlNow = originalPage.url();
        if (urlNow.includes("/checkout/") && urlNow.includes("cs_live")) {
          preCheckoutUrl = urlNow;
          appendLog(session, `✅ [Pre-step] Checkout URL didapat: ${urlNow.slice(0, 80)}...`);
          session.checkoutUrl = urlNow;
          break;
        }
        await randomDelay(1000, 1500);
      }
    }
    if (!preCheckoutUrl) {
      appendLog(session, `⚠️ [Pre-step] Checkout URL tidak didapat — lanjut ke /plans di proxy browser`);
    }
  } catch (preErr: any) {
    appendLog(session, `⚠️ [Pre-step] Error: ${preErr.message?.slice(0, 100)}`);
  }

  try {
    // ─── AKTIFKAN PROXY KOREA + BROWSER NON-HEADLESS UNTUK hCaptcha ─────
    // Launch browser NON-HEADLESS terpisah untuk payment agar hCaptcha tidak detect bot
    if (proxy) {
      appendLog(session, `🇰🇷 Launch browser NON-HEADLESS untuk payment (Korea proxy + hCaptcha bypass)...`);
      const systemChromium = getSystemChromiumPath();
      // Pastikan Xvnc berjalan di :1 — auto-start jika tidak ada
      await ensureXDisplay();
      const hasDisplay = true;
      appendLog(session, `🖥️ Display: ${process.env.DISPLAY} | Xvnc lock: ${existsSync('/tmp/.X1-lock')} | Mode: NON-HEADLESS`);

      const pw = addExtra(chromium as any);
      pw.use(StealthPlugin());
      paymentBrowser = await (pw as any).launch({
        headless: !hasDisplay,
        ...(systemChromium ? { executablePath: systemChromium } : {}),
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-setuid-sandbox",
          ...(hasDisplay ? [
            "--start-maximized",
          ] : [
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--no-zygote",
          ]),
          "--disable-extensions",
          "--disable-background-networking",
          "--window-size=900,700",
          "--disable-infobars",
        ],
      }) as Browser;

      proxyContext = await paymentBrowser.newContext({
        proxy: {
          server: proxy.server,
          ...(proxy.username ? { username: proxy.username } : {}),
          ...(proxy.password ? { password: proxy.password } : {}),
          bypass: STRIPE_BYPASS,
        },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        locale: "en-US",
        timezoneId: "Asia/Seoul",
        viewport: { width: 900, height: 700 },
        acceptDownloads: false,
      });

      // ─── Comprehensive fingerprint spoof — WebGL, navigator, canvas, audio ───
      await proxyContext.addInitScript(() => {
        try {
          // 1. WebGL renderer spoofing
          const patchWebGLCtx = (ctx: WebGLRenderingContext | WebGL2RenderingContext) => {
            const orig = ctx.getParameter.bind(ctx);
            (ctx as any).getParameter = function(param: number) {
              if (param === 37445) return "NVIDIA Corporation";
              if (param === 37446) return "NVIDIA GeForce RTX 3060/PCIe/SSE2";
              if (param === 7937)  return "NVIDIA Corporation";
              if (param === 7936)  return "NVIDIA GeForce RTX 3060";
              return orig(param);
            };
          };
          const patchProto = (proto: any) => {
            if (!proto) return;
            const orig = proto.getParameter;
            proto.getParameter = function(param: number) {
              if (param === 37445) return "NVIDIA Corporation";
              if (param === 37446) return "NVIDIA GeForce RTX 3060/PCIe/SSE2";
              if (param === 7937)  return "NVIDIA Corporation";
              if (param === 7936)  return "NVIDIA GeForce RTX 3060";
              return orig.call(this, param);
            };
          };
          patchProto(WebGLRenderingContext.prototype);
          if (typeof WebGL2RenderingContext !== "undefined") patchProto(WebGL2RenderingContext.prototype);
          const origGetCtx = HTMLCanvasElement.prototype.getContext;
          (HTMLCanvasElement.prototype as any).getContext = function(type: string, ...args: any[]) {
            const ctx = origGetCtx.apply(this, [type, ...args] as any);
            if (ctx && (type === "webgl" || type === "experimental-webgl" || type === "webgl2")) {
              patchWebGLCtx(ctx as any);
            }
            return ctx;
          };

          // 2. Navigator hardware spoofing
          try {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
          } catch {}
          try {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
          } catch {}
          try {
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true });
          } catch {}
          try {
            const origMimes = Object.getOwnPropertyDescriptor(navigator, 'mimeTypes');
            if (!origMimes || origMimes.get) {
              // Already patched by stealth, skip
            }
          } catch {}

          // 3. Screen resolution — konsisten dengan Playwright viewport 1280x800
          // Hanya spoof colorDepth (dari 32-bit ke 24-bit real monitor)
          try {
            Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
            Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });
          } catch {}

          // 4. Canvas 2D noise (unique but stable fingerprint)
          const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
          (HTMLCanvasElement.prototype as any).toDataURL = function(type: string, ...args: any[]) {
            const result = origToDataURL.apply(this, [type, ...args] as any);
            // Minimal perturbation — only add 1-char noise at a fixed offset to avoid tracking
            if (result && result.length > 200 && type !== "image/png" || !type) {
              return result;
            }
            return result;
          };

          // 5. Permissions spoofing
          if (navigator.permissions) {
            const origQuery = navigator.permissions.query.bind(navigator.permissions);
            (navigator.permissions as any).query = async (params: any) => {
              if (params.name === 'notifications') return { state: 'denied', onchange: null };
              if (params.name === 'geolocation') return { state: 'prompt', onchange: null };
              try { return await origQuery(params); } catch { return { state: 'denied', onchange: null }; }
            };
          }
        } catch(e) { /* ignore init script errors */ }
      });

      // Copy semua cookies dari original context
      const cookies = await originalContext.cookies();
      if (cookies.length > 0) {
        await proxyContext.addCookies(cookies);
        appendLog(session, `🍪 ${cookies.length} cookies disalin ke proxy context`);
      }

      page = await proxyContext.newPage();
      appendLog(session, `✅ Payment browser NON-HEADLESS + Korea proxy siap`);
    } else {
      appendLog(session, `⚠️ Tidak ada proxy — gunakan page asli`);
      page = originalPage;
    }

    // ─── LANGKAH 1: ESTABLISH SESSION DI chatgpt.com DULU ───────────────
    // Kritis: buka chatgpt.com dulu sebelum plans agar session cookies terbaca
    appendLog(session, `🌐 Buka chatgpt.com dulu untuk establish session...`);
    let urlRoot = "";
    for (let proxyTry = 0; proxyTry < 4; proxyTry++) {
      try {
        await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 60000 });
        urlRoot = page.url();
        break;
      } catch (e: any) {
        appendLog(session, `⚠️ Proxy connect error (try ${proxyTry + 1}): ${e.message?.slice(0, 80)}`);
        if (proxyTry < 3) {
          await randomDelay(800, 1200);
          appendLog(session, `🔄 Retry koneksi proxy...`);
        } else {
          throw new Error(`Proxy tidak dapat dihubungi setelah 4 percobaan: ${e.message?.slice(0, 80)}`);
        }
      }
    }
    await randomDelay(500, 800);
    appendLog(session, `🌐 URL chatgpt.com: ${urlRoot}`);

    // Cek validitas sesi — lihat apakah ada tombol "Log in" di halaman (berarti tidak auth)
    const rootBodyText = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a")).map(el => (el as HTMLElement).innerText?.trim()).filter(Boolean);
      return btns.join(" | ");
    }).catch(() => "");
    const sessionIsGuest = urlRoot.includes("auth.openai.com") || urlRoot.includes("log-in") ||
      (rootBodyText.includes("Log in") && rootBodyText.includes("Sign up"));
    if (sessionIsGuest) {
      appendLog(session, `⚠️ Session tidak valid di proxy context (URL: ${urlRoot.slice(0, 60)}, Btns: ${rootBodyText.slice(0, 80)}) — fallback ke original page`);
      if (proxyContext) { await proxyContext.close().catch(() => {}); proxyContext = null; }
      page = originalPage;
    } else {
      appendLog(session, `✅ Session valid di Korea proxy! (Btns: ${rootBodyText.slice(0, 80)})`);
    }

    // ─── LANGKAH 1b: NAVIGASI KE PLANS atau LANGSUNG KE CHECKOUT ────────
    if (preCheckoutUrl) {
      // Checkout URL sudah didapat dari original browser — langsung navigasi ke Stripe checkout
      appendLog(session, `🚀 Checkout URL dari pre-step tersedia — navigasi langsung ke Stripe checkout...`);
      await page.goto(preCheckoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e: any) => {
        appendLog(session, `⚠️ Goto checkout error: ${e.message?.slice(0, 80)}`);
      });
      await randomDelay(2000, 3000);
      const checkoutUrlNow = page.url();
      appendLog(session, `🌐 URL setelah goto checkout: ${checkoutUrlNow.slice(0, 80)}`);
      // Jika checkout URL valid, skip ke LANGKAH 4 (isi CC)
      if (checkoutUrlNow.includes("/checkout/") || checkoutUrlNow.includes("cs_live")) {
        session.checkoutUrl = checkoutUrlNow;
        // Langsung loncat ke pengisian CC (skip LANGKAH 2-3b)
        // Tandai planContentVisible=true agar kode LANGKAH 2 tidak jalan
        appendLog(session, `✅ Proxy browser sudah di Stripe checkout — skip ke pengisian CC`);
        // Jump ke CC fill section langsung
        // (kode di bawah ini: LANGKAH 2-3b tidak akan jalan karena preCheckoutUrl ada)
      } else {
        // Fallback: kembali ke /plans
        appendLog(session, `⚠️ Checkout URL tidak valid setelah goto — fallback ke /plans`);
        for (let plansTry = 0; plansTry < 3; plansTry++) {
          try {
            await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 60000 });
            break;
          } catch (e: any) {
            appendLog(session, `⚠️ Plans goto error (try ${plansTry + 1}): ${e.message?.slice(0, 80)}`);
            if (plansTry < 2) await randomDelay(800, 1200);
          }
        }
      }
    } else {
      appendLog(session, `🔗 Navigasi ke halaman plans dengan IP Korea...`);
      for (let plansTry = 0; plansTry < 3; plansTry++) {
        try {
          await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 60000 });
          break;
        } catch (e: any) {
          appendLog(session, `⚠️ Plans goto error (try ${plansTry + 1}): ${e.message?.slice(0, 80)}`);
          if (plansTry < 2) await randomDelay(800, 1200);
        }
      }
      await randomDelay(1500, 2500);
      const url2 = page.url();
      appendLog(session, `🌐 URL plans: ${url2}`);
    } // end if/else preCheckoutUrl

    // ─── LANGKAH 1c helper: DISMISS SEMUA MODAL DI /PLANS ───────────────
    // (didefinisikan di sini agar bisa dipakai baik di dalam maupun luar if/skipToCC)
    // a) "What brings you to ChatGPT" → Skip
    // b) Korea Privacy consent → Continue
    // c) "Tips for getting started" / "Okay, let's go" → klik
    const dismissPlansModals = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        // Cek apakah ada dialog/modal nyata di DOM (bukan sekadar teks di halaman)
        const modalInfo = await page.evaluate(() => {
          const body = document.body.innerText;
          // Cari dialog element yang benar-benar overlay
          const dialogs = Array.from(document.querySelectorAll(
            '[role="dialog"],[role="alertdialog"],dialog'
          )) as HTMLElement[];
          const hasDialog = dialogs.some(d => {
            const style = window.getComputedStyle(d);
            return style.display !== "none" && style.visibility !== "hidden";
          });
          return { body, hasDialog };
        }).catch(() => ({ body: "", hasDialog: false }));

        const bodyText = modalInfo.body;
        const hasDialog = modalInfo.hasDialog;

        // "What brings you" / onboarding — deteksi tanpa perlu [role="dialog"]
        // (onboarding di /plans render sebagai inline overlay, bukan dialog)
        // Heuristic: ada teks onboarding DAN tombol Skip/Next yang actionable
        const isOnboarding =
          bodyText.includes("What brings you")
          || bodyText.includes("What do you want to do")
          || bodyText.includes("Write or edit")
          || (
            bodyText.includes("School") && bodyText.includes("Work") &&
            (bodyText.includes("Skip") || bodyText.includes("Personal tasks"))
            && !bodyText.includes("Claim offer") // plan card masih visible → bukan pure onboarding
          );
        if (isOnboarding) {
          appendLog(session, `🔄 Onboarding modal — mencoba Skip/Next...`);
          // Coba Skip — langsung cari di seluruh halaman (inline onboarding tidak punya dialog wrapper)
          let handled = false;
          const skipClicked = await page.evaluate(() => {
            const allBtns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
            // Prioritas: Skip button
            const skipBtn = allBtns.find(b => b.innerText.trim() === "Skip" && (b as any).offsetParent !== null);
            if (skipBtn) { skipBtn.click(); return "skip"; }
            // Fallback: tombol Next (setelah pilih opsi)
            const nextBtn = allBtns.find(b => b.innerText.trim() === "Next" && (b as any).offsetParent !== null);
            if (nextBtn) { nextBtn.click(); return "next"; }
            return null;
          }).catch(() => null);
          if (skipClicked) {
            appendLog(session, `✅ Onboarding dismissed (${skipClicked})`);
            await randomDelay(800, 1200);
            handled = true;
          }
          if (!handled) {
            // Tidak ada Skip/Next — klik opsi pertama (School/Work/dll) lalu Next
            const clicked = await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
              const option = btns.find(b => {
                const t = b.innerText.trim();
                return t.length > 0
                  && !["Skip","Next","Continue","Back","Agree","Done"].includes(t)
                  && !b.disabled
                  && (b as any).offsetParent !== null;
              });
              if (option) { option.click(); return option.innerText.trim(); }
              return null;
            }).catch(() => null);
            if (clicked) {
              appendLog(session, `✅ Onboarding: opsi "${clicked}" dipilih`);
              await randomDelay(600, 1000);
              // Klik Next
              const nextClicked = await page.evaluate(() => {
                const nextBtn = Array.from(document.querySelectorAll("button")).find(
                  b => (b as HTMLButtonElement).innerText.trim() === "Next" && (b as any).offsetParent !== null
                ) as HTMLButtonElement | undefined;
                if (nextBtn) { nextBtn.click(); return true; }
                return false;
              }).catch(() => false);
              if (nextClicked) appendLog(session, `✅ Onboarding: Next diklik`);
              await randomDelay(800, 1200);
              handled = true;
            }
          }
          continue;
        }

        // Korea Privacy/Terms consent → Continue (hanya jika ada overlay/dialog, bukan sekedar teks footer)
        const hasKoreaModal = (bodyText.includes("Korea addendum") || bodyText.includes("Privacy Policy and its Korea")) && bodyText.includes("Continue");
        if (hasKoreaModal) {
          appendLog(session, `🔄 Korea consent modal — klik Continue`);
          const consentClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
            const cont = btns.find(b => b.innerText.trim() === "Continue" && !b.disabled);
            if (cont) { cont.click(); return true; }
            return false;
          });
          if (consentClicked) {
            appendLog(session, `✅ Korea consent accepted`);
            await randomDelay(800, 1200);
          } else {
            try {
              const btn = page.locator('button:text-is("Continue")').first();
              if (await btn.isVisible({ timeout: 2000 })) {
                await btn.click({ force: true });
                appendLog(session, `✅ Korea consent clicked (fallback)`);
                await randomDelay(800, 1200);
              }
            } catch { }
          }
          continue;
        }

        // "Tips for getting started" / "Okay, let's go"
        if (bodyText.includes("Tips for getting started") || bodyText.includes("Okay, let\u2019s go") || bodyText.includes("Okay, let's go")) {
          appendLog(session, `🔄 Tips modal — klik Okay`);
          const okayClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
            const ok = btns.find(b => b.innerText.includes("let") && b.innerText.includes("go"));
            if (ok) { ok.click(); return true; }
            return false;
          });
          if (okayClicked) await randomDelay(1500, 2000);
          continue;
        }

        // Semua modal sudah hilang
        appendLog(session, `✅ Semua modal dibersihkan`);
        break;
      }
    };

    // Flag: sudah di checkout URL dari pre-step → skip LANGKAH 1c, 2, 3, 3b
    const skipToCC = preCheckoutUrl != null && page.url().includes("/checkout/");

    // planSelectors didefinisikan di sini agar accessible di retry block luar if(!skipToCC)
    const planSelectors = [
      // ─ Promo Korea: "Claim offer" PRIORITAS PERTAMA (menuju payment) ─
      'button:has-text("Claim offer")',
      'a:has-text("Claim offer")',
      'button:has-text("Claim free offer")',
      'button:has-text("Claim free")',
      // ─ Standard Plus/Team ─
      'button:has-text("Get Plus")',
      'a:has-text("Get Plus")',
      'button:has-text("Upgrade to Plus")',
      'button:has-text("Subscribe to Plus")',
      'button:has-text("Subscribe")',
      'button:has-text("Upgrade")',
      'button:has-text("Start subscription")',
      'button:has-text("Try for free")',
      'button:has-text("Start free")',
      'button:has-text("Free trial")',
      'button:has-text("무료")',
      'button:has-text("무료로")',
      'button:has-text("무료 체험")',
      '[data-testid*="upgrade"]',
      '[data-testid*="subscribe"]',
      '[data-testid*="get-plus"]',
      // ─ Free offer sebagai last resort ─
      'button:has-text("Free offer")',
    ];

    if (!skipToCC) {

    await dismissPlansModals();

    // ─── LANGKAH 2: TUNGGU PLAN CARDS MUNCUL ─────────────────────────────
    appendLog(session, `⏳ Tunggu plan cards muncul (maks 45 detik — CF akan auto-resolve)...`);
    let planContentVisible = false;
    for (let pw = 0; pw < 18; pw++) {
      await randomDelay(600, 1000);
      const cfFrames = page.frames().filter(f => f.url().includes("challenges.cloudflare.com"));
      const pt = await page.evaluate(() => document.body.innerText).catch(() => "");
      const hasPromo = pt.includes("Claim") || pt.includes("Free offer") || pt.includes("Plus") || pt.includes("Subscribe") || pt.includes("무료");
      // Early exit: halaman logged-out — session tidak valid, tidak perlu tunggu lebih lama
      const isLoggedOut = (pt.includes("Log in") || pt.includes("Sign up for free")) && !hasPromo;
      appendLog(session, `  Wait ${pw+1}: CF=${cfFrames.length}, promo=${hasPromo}${isLoggedOut ? ", ⚠️ LOGGED OUT" : ""}`);
      if (hasPromo) {
        planContentVisible = true;
        await dismissPlansModals();
        break;
      }
      if (isLoggedOut && pw >= 1) {
        appendLog(session, `⚠️ Plans page logged-out setelah ${pw+1} wait — sesi tidak valid, hentikan payment`);
        throw new Error(`Session tidak valid di plans page (logged-out). Akun registrasi berhasil: ${session.email} | ${session.password}`);
      }
    }
    if (!planContentVisible) {
      appendLog(session, `⚠️ Plan content tidak muncul di /plans — coba /pricing sebagai fallback...`);
      // Fallback: coba halaman /pricing
      await page.goto("https://chatgpt.com/pricing", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await randomDelay(800, 1200);
      const pt2 = await page.evaluate(() => document.body.innerText).catch(() => "");
      const hasPromo2 = pt2.includes("Claim") || pt2.includes("Free offer") || pt2.includes("Plus") || pt2.includes("Subscribe") || pt2.includes("무료") || pt2.includes("Business");
      appendLog(session, `📄 /pricing: promo=${hasPromo2}, url=${page.url()}`);
      if (!hasPromo2) {
        // Fallback ke /plans dengan hard reload
        await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await randomDelay(600, 1000);
        const pt3 = await page.evaluate(() => document.body.innerText).catch(() => "");
        const hasPromo3 = pt3.includes("Claim") || pt3.includes("Free offer") || pt3.includes("Plus") || pt3.includes("Subscribe") || pt3.includes("Business");
        appendLog(session, `📄 /plans reload: promo=${hasPromo3}`);
        if (hasPromo3) await dismissPlansModals();
      } else {
        await dismissPlansModals();
      }
    }

    // ─── LANGKAH 3: LOG TOMBOL + KLIK PROMO ─────────────────────────────
    const allBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button")).map(b => (b as HTMLButtonElement).innerText.trim()).filter(t => t.length > 0)
    ).catch(() => [] as string[]);
    appendLog(session, `🖱️ Tombol di /plans: ${allBtns.slice(0, 8).join(" | ")}`);

    let planClicked = false;
    for (const sel of planSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          appendLog(session, `✅ Klik plan: "${sel}"`);
          await btn.click({ force: true });
          planClicked = true;
          await randomDelay(500, 800);
          break;
        }
      } catch { }
    }
    if (!planClicked) {
      appendLog(session, `⚠️ Tombol plan tidak ditemukan — coba tunggu dan lanjut`);
    }

    // Jika tersesat ke halaman chat, kembali ke /plans
    const urlAfterPlan = page.url();
    appendLog(session, `🌐 URL setelah klik plan: ${urlAfterPlan}`);
    if (urlAfterPlan.includes("/c/") || (!urlAfterPlan.includes("/plans") && !urlAfterPlan.includes("/checkout"))) {
      appendLog(session, `↩️ URL bukan /plans — kembali ke https://chatgpt.com/plans`);
      await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await randomDelay(500, 800);
      await dismissPlansModals();
    }

    // Tunggu modal render sebelum dismiss — modal plan selection muncul setelah klik Claim offer
    await randomDelay(800, 1200);

    // ─── LANGKAH 3b: HANDLE ONBOARDING → CHECKOUT ────────────────────────────
    // Setelah klik "Claim offer" (Business plan), muncul onboarding purpose modal.
    // Perlu klik purpose (Work) → Next → plan selection (Personal/Business) → Business → /checkout/
    let claimFreeClicked = false;
    for (let pb = 0; pb < 12; pb++) {
      // Jika sudah redirect ke /checkout, stop
      if (page.url().includes("/checkout/")) {
        appendLog(session, `✅ Sudah di checkout sebelum klik 3b`);
        claimFreeClicked = true;
        break;
      }

      const btnsNow = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button")).map(b => (b as HTMLButtonElement).innerText.trim()).filter(t => t.length > 0)
      ).catch(() => [] as string[]);
      appendLog(session, `🖱️ Tombol [3b-${pb+1}]: ${btnsNow.slice(0, 12).join(" | ")}`);
      const btnsStr = btnsNow.join("|").toLowerCase();

      // PRIORITAS 1: Onboarding purpose modal (School/Work/...) → klik Work
      const hasOnboarding = btnsStr.includes("school") && btnsStr.includes("work") && btnsStr.includes("skip");
      if (hasOnboarding) {
        // Gunakan Playwright locator.click() agar React event handler ter-trigger
        let onboardClicked: string | null = null;
        for (const lbl of ["Work", "Professional", "Business use", "Work and productivity"]) {
          try {
            const loc = page.locator(`button:has-text("${lbl}")`).first();
            if (await loc.isVisible({ timeout: 1000 })) {
              await loc.click({ force: false });
              onboardClicked = `work:${lbl}`;
              break;
            }
          } catch { }
        }
        if (!onboardClicked) {
          // Fallback: Next
          try {
            const loc = page.locator('button:has-text("Next")').first();
            if (await loc.isVisible({ timeout: 1000 })) { await loc.click(); onboardClicked = "next"; }
          } catch { }
        }
        if (!onboardClicked) {
          // Fallback: Skip
          try {
            const loc = page.locator('button:has-text("Skip")').first();
            if (await loc.isVisible({ timeout: 1000 })) { await loc.click(); onboardClicked = "skip"; }
          } catch { }
        }
        if (onboardClicked) {
          appendLog(session, `✅ Onboarding handled: "${onboardClicked}"`);
          await randomDelay(500, 800);
          continue;
        }
      }

      // PRIORITAS 2: Plan selection modal (Personal/Business) visible → klik Business LALU Claim free offer
      const hasPlanModal = btnsStr.includes("business") || btnsStr.includes("personal") || btnsStr.includes("claim free offer");
      if (hasPlanModal) {
        // Gunakan Playwright locator.click() agar React event handler ter-trigger (bukan DOM .click())
        // Coba CTA checkout langsung dulu (tanpa perlu pilih plan)
        const ctaSelectors = [
          'button:has-text("Claim free offer")',
          'button:has-text("Claim free trial")',
          'button:has-text("Try Business for free")',
          'button:has-text("Start Business")',
        ];
        let ctaClicked: string | null = null;
        for (const cta of ctaSelectors) {
          try {
            const loc = page.locator(cta).first();
            if (await loc.isVisible({ timeout: 1500 })) {
              const box = await loc.boundingBox().catch(() => null);
              if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                await randomDelay(200, 400);
              }
              await loc.click({ force: false });
              ctaClicked = cta;
              break;
            }
          } catch { }
        }
        if (ctaClicked) {
          appendLog(session, `✅ CTA langsung (locator): "${ctaClicked}" → tunggu checkout...`);
          claimFreeClicked = true;
          await randomDelay(600, 1000);
          if (page.url().includes("/checkout/")) break;
          continue;
        }
        // Klik "Business" plan selector dulu (locator.click), lalu CTA
        const planSelectorLabels = ["Business", "Personal"];
        let planSelectorClicked: string | null = null;
        for (const lbl of planSelectorLabels) {
          try {
            const loc = page.locator(`button:has-text("${lbl}")`).first();
            if (await loc.isVisible({ timeout: 1500 })) {
              await loc.click({ force: false });
              planSelectorClicked = lbl;
              break;
            }
          } catch { }
        }
        if (planSelectorClicked) {
          appendLog(session, `✅ Plan dipilih (locator): "${planSelectorClicked}" → cari CTA...`);
          await randomDelay(800, 1200);
          // Coba klik CTA setelah plan terpilih
          for (const cta of ctaSelectors) {
            try {
              const loc = page.locator(cta).first();
              if (await loc.isVisible({ timeout: 1500 })) {
                await loc.click({ force: false });
                appendLog(session, `✅ CTA setelah plan (locator): "${cta}"`);
                ctaClicked = cta;
                break;
              }
            } catch { }
          }
          if (!ctaClicked) {
            appendLog(session, `⚠️ CTA tidak ditemukan setelah pilih "${planSelectorClicked}"`);
          }
          claimFreeClicked = true;
          await randomDelay(600, 1000);
          if (page.url().includes("/checkout/")) break;
          continue;
        }
      }

      // PRIORITAS 3: Tombol checkout eksplisit (locator.click)
      const explicitCtaSelectors = [
        'button:has-text("Try Business for free")',
        'button:has-text("Start free trial")',
        'button:has-text("Claim free trial")',
        'button:has-text("Start Business")',
      ];
      let explicitClicked: string | null = null;
      for (const cta of explicitCtaSelectors) {
        try {
          const loc = page.locator(cta).first();
          if (await loc.isVisible({ timeout: 1500 })) {
            await loc.click({ force: false });
            explicitClicked = cta;
            break;
          }
        } catch { }
      }
      if (explicitClicked) {
        appendLog(session, `✅ Klik eksplisit [3b] (locator): "${explicitClicked}"`);
        claimFreeClicked = true;
        await randomDelay(500, 800);
        break;
      }

      // Jika tidak ada tombol yang dikenal → dismiss modal lain dan re-klik semua kandidat
      await dismissPlansModals();

      // Re-klik setiap iterasi (bukan hanya setiap 3)
      {
        let reclicked: string | null = null;
        // Coba semua varian tombol plan/checkout
        const reClickSelectors = [
          'button:has-text("Claim offer")',
          'button:has-text("Claim free offer")',
          'button:has-text("Free offer")',
          'button:has-text("Claim free trial")',
          'button:has-text("Try Business for free")',
        ];
        for (const claimSel of reClickSelectors) {
          try {
            const loc = page.locator(claimSel).first();
            if (await loc.isVisible({ timeout: 800 })) {
              await loc.click({ force: false });
              reclicked = claimSel;
              break;
            }
          } catch { }
        }
        if (reclicked) {
          appendLog(session, `  ✅ Re-klik (locator): ${reclicked}`);
          claimFreeClicked = true;
        } else if (pb % 3 === 2) {
          appendLog(session, `🔄 [3b] Tidak ada tombol plan — attempt ${pb+1}`);
        }
      }
      await randomDelay(500, 800);
    }
    appendLog(session, `🌐 URL setelah claim: ${page.url()}`);
    } // end if (!skipToCC)

    // ─── LANGKAH 4: TUNGGU STRIPE (iframe ATAU /checkout redirect) ──────
    appendLog(session, `⏳ Tunggu Stripe checkout form (maks ~90 detik)...`);
    let stripeFound = false;

    for (let attempt = 0; attempt < 18; attempt++) {
      await randomDelay(400, 700);

      // ── Dismiss inline onboarding (tanpa perlu dialog wrapper) ──────────
      // Setelah klik Claim offer, onboarding kadang muncul sebagai inline overlay
      const bodyText4 = await page.evaluate(() => document.body.innerText).catch(() => "");
      const hasInlineOnboarding = bodyText4.includes("What brings you") || (bodyText4.includes("School") && bodyText4.includes("Work") && bodyText4.includes("Skip"));
      if (hasInlineOnboarding) {
        let inlineSkipped: string | null = null;
        for (const lbl of ["Skip", "Next"]) {
          try {
            const loc = page.locator(`button:has-text("${lbl}")`).first();
            if (await loc.isVisible({ timeout: 1000 })) { await loc.click(); inlineSkipped = lbl.toLowerCase(); break; }
          } catch { }
        }
        if (inlineSkipped) {
          appendLog(session, `✅ Inline onboarding dismissed (${inlineSkipped}) — delay singkat...`);
          await randomDelay(800, 1200);
        }
      }

      // Dismiss modal jika muncul (onboarding, Korea consent, dll)
      await dismissPlansModals();

      // CASE 0: UI plan selection muncul (Personal / Business) → klik untuk trigger checkout
      let planChosen: string | null = null;
      for (const label of ["Personal", "Business"]) {
        try {
          // Exact text match agar tidak kena "Personal tasks" onboarding option
          const loc = page.locator(`button`).filter({ hasText: new RegExp(`^${label}$`) }).first();
          if (await loc.isVisible({ timeout: 1000 })) {
            await loc.click({ force: false });
            planChosen = label;
            break;
          }
        } catch { }
      }
      if (planChosen) {
        appendLog(session, `✅ Plan dipilih: "${planChosen}" → tunggu redirect checkout...`);
        await randomDelay(1000, 1500);
      }

      const currentUrl = page.url();
      const frames = page.frames();

      // CASE A: Sudah redirect ke /checkout — Stripe hosted checkout
      if (currentUrl.includes("/checkout/")) {
        appendLog(session, `✅ Redirect ke Stripe Checkout: ${currentUrl.slice(0, 80)}`);
        session.checkoutUrl = currentUrl;
        stripeFound = true;

        // 🔑 Tetap pakai proxyPage (Korea IP) untuk checkout — hCaptcha akan pakai Korea IP
        appendLog(session, `🔄 Tetap di proxyPage (Korea IP) — hCaptcha pakai Korea proxy...`);
        // proxyPage sudah ada di checkoutUrl, tidak perlu navigate ulang
        await randomDelay(2000, 3000);
        // page tetap = proxyPage (Korea proxy)

        // Log konten checkout
        const checkoutTxt = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
        appendLog(session, `📋 Checkout: ${checkoutTxt.replace(/\n/g, " ").slice(0, 200)}`);

        // 🧠 Simulasi aktivitas manusia (15 detik) sambil Stripe iframes loading
        // Ini memberi hCaptcha invisible waktu untuk mengumpulkan sinyal behavioral
        appendLog(session, `🧠 Simulasi human browsing (3 detik) untuk hCaptcha scoring...`);
        await simulateHumanCheckout(page, 3000);

        // Isi email jika ada (Contact information)
        try {
          const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
          if (await emailInput.isVisible({ timeout: 3000 })) {
            await emailInput.click();
            await randomDelay(300, 500);
            await emailInput.pressSequentially(session.email, { delay: 45 + Math.random() * 30 });
            appendLog(session, `  ✅ Email diisi di checkout`);
            await randomDelay(500, 800);
          }
        } catch { }

        // Tunggu Stripe card iframes muncul (bisa sampai 30 detik)
        appendLog(session, `  ⏳ Menunggu Stripe card iframe...`);
        let stripeCardFrames: any[] = [];
        for (let wi = 0; wi < 12; wi++) {
          await randomDelay(300, 500);
          const allF = page.frames();
          stripeCardFrames = allF.filter(f => {
            const u = f.url();
            return u.includes("stripe.com") && (
              u.includes("elements-inner") ||
              u.includes("hosted-fields") ||
              u.includes("payment-inner") ||
              u.includes("card-number") ||
              u.includes("card-expiry") ||
              u.includes("card-cvc") ||
              u.includes("card-input")
            );
          });
          // Hanya break jika payment iframe (bukan cuma address iframe) sudah muncul
          const paymentFrames = stripeCardFrames.filter((f: any) => !f.url().includes("elements-inner-address"));
          appendLog(session, `  🔍 Wait ${wi+1}: ${allF.length} frame total, ${stripeCardFrames.length} stripe (${paymentFrames.length} payment)`);
          for (const f of allF) {
            const u = f.url();
            if (u && !u.includes("about:blank") && !u.includes("chrome-error")) {
              appendLog(session, `      → ${u.slice(0, 80)}`);
            }
          }
          if (paymentFrames.length > 0) break;
        }

        // 🧠 Simulasi browsing manusia (30 detik) setelah Stripe iframes siap — hCaptcha scoring
        appendLog(session, `🧠 Simulasi human browsing (5 detik) setelah Stripe load — hCaptcha scoring...`);
        await simulateHumanCheckout(page, 5000);
        appendLog(session, `✅ Simulasi selesai — mulai isi form CC...`);

        // Isi CC fields — prioritas stripe card iframes, fallback ke semua frames
        const allFrames = stripeCardFrames.length > 0
          ? [page as any, ...stripeCardFrames]
          : [page as any, ...page.frames()];
        for (const frame of allFrames) {
          try {
            await randomDelay(500, 800);
            const fUrl = typeof frame.url === "function" ? frame.url() : "main";
            appendLog(session, `  🔍 Coba isi CC di frame: ${fUrl.slice(0, 60)}`);

            // Card number
            for (const sel of ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', '[data-elements-stable-field-name="cardNumber"] input', 'input[placeholder*="1234"]', 'input[placeholder*="Card number"]']) {
              try {
                const el = frame.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click(); await randomDelay(200, 400);
                  await el.pressSequentially(ccNumber, { delay: 60 });
                  appendLog(session, `  ✅ Card number diisi`);
                  await randomDelay(400, 700); break;
                }
              } catch { }
            }

            // Expiry
            for (const sel of ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', '[data-elements-stable-field-name="cardExpiry"] input', 'input[placeholder*="MM / YY"]', 'input[placeholder*="MM"]']) {
              try {
                const el = frame.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click(); await randomDelay(200, 400);
                  await el.pressSequentially(`${expMonth}${expYear.slice(-2)}`, { delay: 60 });
                  appendLog(session, `  ✅ Expiry: ${expMonth}/${expYear.slice(-2)}`);
                  await randomDelay(400, 700); break;
                }
              } catch { }
            }

            // CVV
            for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', '[data-elements-stable-field-name="cardCvc"] input', 'input[placeholder*="CVC"]', 'input[placeholder*="CVV"]']) {
              try {
                const el = frame.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click(); await randomDelay(200, 400);
                  await el.pressSequentially(cvv, { delay: 60 });
                  appendLog(session, `  ✅ CVV diisi`);
                  await randomDelay(400, 700); break;
                }
              } catch { }
            }

            // Nama di kartu
            for (const sel of ['input[name="name"]', 'input[placeholder*="Name on card"]', 'input[autocomplete="cc-name"]']) {
              try {
                const el = frame.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                  await el.click(); await randomDelay(200, 300);
                  await el.fill(cardholderName);
                  appendLog(session, `  ✅ Nama: ${cardholderName}`);
                  await randomDelay(300, 500); break;
                }
              } catch { }
            }
          } catch { }
        }
        break; // Keluar dari polling loop
      }

      // CASE B: Stripe iframe sudah muncul di /plans atau modal
      const stripeFrames = frames.filter(f =>
        f.url().includes("stripe.com/v3/elements-inner") ||
        f.url().includes("m.stripe.com") ||
        (f.url().includes("stripe.com") && (f.url().includes("cardNumber") || f.url().includes("payment")))
      );
      const stripeCtrl = frames.filter(f => f.url().includes("stripe.com") || f.url().includes("js.stripe"));
      appendLog(session, `🔍 Attempt ${attempt + 1}: ${frames.length} total, ${stripeCtrl.length} stripe-ctrl, ${stripeFrames.length} stripe-input`);
      for (const f of frames) {
        const u = f.url();
        if (u && u !== "about:blank" && !u.includes("chrome-error") && !u.includes("challenges.cloudflare")) {
          appendLog(session, `    → ${u.slice(0, 100)}`);
        }
      }

      // Re-klik plan jika belum ada Stripe setelah beberapa attempt
      if (stripeCtrl.length === 0 && (attempt === 3 || attempt === 8 || attempt === 13)) {
        appendLog(session, `🔄 Re-try klik plan (attempt ${attempt + 1})...`);
        // Pastikan kita di /plans dulu — kalau tersesat ke chat atau halaman lain, kembali ke /plans
        const curUrl = page.url();
        if (curUrl.includes("/c/") || (!curUrl.includes("/plans") && !curUrl.includes("/checkout"))) {
          appendLog(session, `  ↩️ URL salah (${curUrl.slice(0, 60)}) — navigasi ke /plans`);
          await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
          await randomDelay(1200, 2000);
        }
        await dismissPlansModals();
        for (const sel of planSelectors) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1500 })) {
              await btn.click({ force: true });
              appendLog(session, `  Re-klik: "${sel}"`);
              await randomDelay(1200, 1800);
              // Jika klik malah buka chat, balik ke /plans lagi
              const afterUrl = page.url();
              if (afterUrl.includes("/c/")) {
                appendLog(session, `  ↩️ Klik malah ke chat — kembali ke /plans`);
                await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
                await randomDelay(800, 1200);
                await dismissPlansModals();
              }
              break;
            }
          } catch { }
        }
        // Re-klik modal CTA — pakai locator.click() agar React event handler ter-trigger
        await randomDelay(800, 1200);
        let reClicked: string | null = null;
        for (const cta of [
          'button:has-text("Claim free offer")',
          'button:has-text("Claim free")',
          'button:has-text("Try Business for free")',
          'button:has-text("Start Business")',
          'button:has-text("Business")',
          'button:has-text("Personal")',
          'button:has-text("Free offer")',
        ]) {
          try {
            const loc = page.locator(cta).first();
            if (await loc.isVisible({ timeout: 800 })) {
              await loc.click({ force: false });
              reClicked = cta;
              break;
            }
          } catch { }
        }
        if (reClicked) {
          appendLog(session, `  Re-klik modal (locator): "${reClicked}"`);
          await randomDelay(1200, 2000);
        }
      }

      if (stripeFrames.length > 0) {
        stripeFound = true;
        appendLog(session, `✅ Stripe input frame ditemukan (${stripeFrames.length})`);
        for (const frame of stripeFrames) {
          appendLog(session, `  💳 Frame: ${frame.url().slice(0, 80)}`);
          for (const sel of ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', '[data-elements-stable-field-name="cardNumber"] input', 'input[placeholder*="1234"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2500 })) {
                await el.click(); await randomDelay(200, 400);
                await el.pressSequentially(ccNumber, { delay: 60 });
                appendLog(session, `  ✅ Card number`);
                await randomDelay(400, 700); break;
              }
            } catch { }
          }
          for (const sel of ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', '[data-elements-stable-field-name="cardExpiry"] input', 'input[placeholder*="MM"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2500 })) {
                await el.click(); await randomDelay(200, 400);
                await el.pressSequentially(`${expMonth}${expYear.slice(-2)}`, { delay: 60 });
                appendLog(session, `  ✅ Expiry`);
                await randomDelay(400, 700); break;
              }
            } catch { }
          }
          for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', '[data-elements-stable-field-name="cardCvc"] input', 'input[placeholder*="CVC"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2500 })) {
                await el.click(); await randomDelay(200, 400);
                await el.pressSequentially(cvv, { delay: 60 });
                appendLog(session, `  ✅ CVV`);
                await randomDelay(400, 700); break;
              }
            } catch { }
          }
        }
        break;
      }
    }

    if (!stripeFound) {
      const pageContent = await page.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => "");
      appendLog(session, `⚠️ Stripe form tidak muncul setelah 18 percobaan`);
      appendLog(session, `📄 Konten akhir: ${pageContent.slice(0, 250)}`);
    }

    // ─── LANGKAH 5: ISI EMAIL, SEATS, DAN BILLING ADDRESS ───────────────
    await randomDelay(800, 1200);

    // 5a: Email di Contact Information
    try {
      const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
      if (await emailInput.isVisible({ timeout: 5000 })) {
        await emailInput.fill(session.email);
        appendLog(session, `✅ Email diisi: ${session.email}`);
        await randomDelay(300, 500);
      }
    } catch { }

    // 5b: Seats (ChatGPT Business — set ke 5)
    try {
      for (const sel of [
        'input[type="number"]',
        'input[name*="seat"]',
        'input[name*="quantity"]',
        'input[name*="count"]',
        '[aria-label*="seat" i] input',
        '[aria-label*="quantity" i] input',
      ]) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 })) {
          await el.click({ clickCount: 3 });
          await el.fill("5");
          appendLog(session, `✅ Seats: 5`);
          await randomDelay(300, 500);
          break;
        }
      }
    } catch { }

    // 5c: Billing address — pakai fillStripeAddressFrame helper
    appendLog(session, `📍 Alamat: ${addr.line1}, ${addr.district}, ${addr.city}, ${addr.province} ${addr.postal}`);
    const addrFrame5c = page.frames().find((f: any) => f.url().includes("elements-inner-address"));
    if (addrFrame5c) {
      appendLog(session, `🗺️ Stripe address iframe ditemukan`);
      await fillStripeAddressFrame(addrFrame5c, addr, (msg) => appendLog(session, msg), session.name);
    } else {
      appendLog(session, `⚠️ Stripe address iframe tidak ditemukan`);
    }

    await randomDelay(500, 800);

    // 5d: "I'm purchasing as business" checkbox
    try {
      const bizChk = page.locator(
        'input[type="checkbox"][name*="business" i], label:has-text("purchasing as business") input, input[id*="business" i]'
      ).first();
      if (await bizChk.isVisible({ timeout: 2000 })) {
        const isChecked = await bizChk.isChecked().catch(() => false);
        if (!isChecked) { await bizChk.check(); }
        appendLog(session, `✅ "I'm purchasing as business" ${isChecked ? "sudah" : "dicentang"}`);
        await randomDelay(300, 500);
      }
    } catch { }

    // ─── LANGKAH 6: AUTO KLIK SUBSCRIBE ─────────────────────────────────────
    const vncDomain = process.env.REPLIT_DEV_DOMAIN || "localhost";
    const vncBrowserUrl = `https://${vncDomain}/browser.html`;
    session.proxyPage = page;

    const submitSelectors = [
      'button:has-text("Subscribe")',
      'button:has-text("Start subscription")',
      'button:has-text("Confirm")',
      'button:has-text("Pay")',
      'button:has-text("Complete")',
      'button:has-text("구독")',
      'button[type="submit"]',
    ];

    // Cari dan klik Subscribe secara otomatis
    let clickedSubscribe = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await sleep(300);
          await btn.click({ force: true }).catch(() => {});
          appendLog(session, `🖱️ Auto-klik tombol Subscribe: "${sel}"`);
          clickedSubscribe = true;
          break;
        }
      } catch { }
    }

    if (!clickedSubscribe) {
      appendLog(session, `⚠️ Tombol Subscribe tidak ditemukan — mencoba klik lewat JS...`);
      try {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button[type="submit"], button'));
          const sub = btns.find(b => /subscribe|confirm|pay|start|구독/i.test(b.textContent || ""));
          if (sub) (sub as HTMLElement).click();
        });
        clickedSubscribe = true;
        appendLog(session, `🖱️ Fallback JS click dijalankan`);
      } catch { }
    }

    // ─── LANGKAH 7: MONITOR CAPTCHA / SUCCESS ───────────────────────────────
    appendLog(session, `⏳ Memantau hasil klik Subscribe...`);
    session.status = "paying";

    const CAPTCHA_SELECTORS = [
      'iframe[src*="hcaptcha.com"]',
      'iframe[src*="recaptcha"]',
      'iframe[data-hcaptcha-widget-id]',
      '.h-captcha',
      '#hcaptcha',
      '[class*="captcha"]',
    ];

    // Deteksi apakah halaman masih di checkout (belum sukses)
    function isCheckoutUrl(url: string) {
      return url.includes("/checkout/") || url.includes("stripe.com");
    }
    function isSuccessUrl(url: string) {
      // URL yang dianggap sukses setelah checkout: bukan checkout, bukan plans, bukan auth
      return !url.includes("/checkout/") &&
             !url.includes("stripe.com") &&
             !url.includes("/plans") &&
             !url.includes("/auth/") &&
             url.includes("chatgpt.com");
    }

    let humanSubmitted = false;
    let captchaNotified = false;
    let reachedCheckout = false;        // Apakah pernah masuk ke checkout URL?
    const MAX_AUTO_WAIT_MS = 3 * 60 * 1000;   // 3 menit nunggu auto tanpa captcha
    const MAX_CAPTCHA_WAIT_MS = 10 * 60 * 1000; // 10 menit jika captcha muncul
    const autoStart = Date.now();
    let captchaStart = 0;

    // Cek URL saat ini — mungkin sudah di checkout sejak awal
    try {
      const initUrl = page.url();
      if (isCheckoutUrl(initUrl)) reachedCheckout = true;
    } catch { }

    while (true) {
      await sleep(1500);

      let currentUrl = "";
      try { currentUrl = page.url(); } catch { break; }

      // Track apakah kita pernah sampai ke checkout
      if (isCheckoutUrl(currentUrl)) reachedCheckout = true;

      // ── Sukses: pernah di checkout + sekarang URL berubah ke success page ──
      if (reachedCheckout && isSuccessUrl(currentUrl)) {
        appendLog(session, `✅ Payment selesai! URL: ${currentUrl.slice(0, 100)}`);
        humanSubmitted = true;
        break;
      }

      // ── Cek apakah captcha muncul ──
      let captchaFound = false;
      try {
        for (const sel of CAPTCHA_SELECTORS) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
            captchaFound = true;
            break;
          }
        }
        // Juga cek di frames
        if (!captchaFound) {
          for (const frame of page.frames()) {
            if (frame.url().includes("hcaptcha.com") || frame.url().includes("recaptcha")) {
              captchaFound = true;
              break;
            }
          }
        }
      } catch { }

      if (captchaFound && !captchaNotified) {
        // Pertama kali captcha terdeteksi
        // → set status waiting_human_submit agar Discord bot otomatis kirim embed VNC
        captchaNotified = true;
        captchaStart = Date.now();
        session.vncUrl = vncBrowserUrl;
        session.status = "waiting_human_submit";   // discordBot.ts polling akan deteksi ini dan kirim VNC embed

        appendLog(session, `🔐 hCaptcha terdeteksi! Link VNC dikirim ke Discord untuk solve manual.`);
        appendLog(session, `   VNC: ${vncBrowserUrl}`);
        appendLog(session, `⏳ Menunggu user selesaikan captcha (max 10 menit)...`);
      }

      // ── Timeout check ──
      if (captchaNotified) {
        // Sudah notif captcha — tunggu max 10 menit untuk user solve
        if (Date.now() - captchaStart > MAX_CAPTCHA_WAIT_MS) {
          appendLog(session, `⚠️ Timeout 10 menit menunggu captcha — lanjut verifikasi...`);
          break;
        }
      } else {
        // Belum ada captcha — tunggu max 3 menit
        if (Date.now() - autoStart > MAX_AUTO_WAIT_MS) {
          appendLog(session, `⚠️ Timeout 3 menit — Subscribe tidak memicu redirect, lanjut verifikasi...`);
          break;
        }
      }
    }

    if (!captchaNotified) {
      // Tidak ada captcha → flow otomatis penuh
      session.status = "paying";
    }

    const lastUrl = page.url();
    const lastText = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => "");

    const successKeywords = [
      "thank", "success", "subscribed", "payment successful",
      "pembayaran berhasil", "berhasil", "tim anda telah dibuat", "lanjutkan",
      "결제 완료", "구독 완료", "감사합니다",
    ];
    const isSuccess =
      successKeywords.some(kw => lastText.toLowerCase().includes(kw)) ||
      lastUrl.includes("success") ||
      lastUrl.includes("subscribed") ||
      (reachedCheckout && isSuccessUrl(lastUrl) && humanSubmitted);

    if (isSuccess) {
      appendLog(session, `🎉 PAYMENT BERHASIL! Akun tersubscribe Business Free Trial`);
    } else {
      appendLog(session, `ℹ️ Payment diproses — verifikasi status subscription...`);
    }

    // ─── LANGKAH 8: VERIFIKASI OTOMATIS STATUS SUBSCRIPTION ─────────────────
    const verifyPage = page; // page sudah punya session cookies
    const subResult = await verifySubscription(verifyPage, (msg) => appendLog(session, msg));
    if (subResult.subscribed) {
      appendLog(session, `✅ KONFIRMASI: Subscription aktif — ${subResult.plan}`);
    } else {
      appendLog(session, `⚠️ Subscription belum terdeteksi aktif — cek manual di dashboard`);
    }

  } catch (e: any) {
    appendLog(session, `⚠️ Payment gagal: ${e.message}`);
  } finally {
    if (proxyContext) {
      try { await proxyContext.close(); } catch { }
    }
    if (paymentBrowser) {
      try { await paymentBrowser.close(); } catch {
        try { paymentBrowser.process()?.kill('SIGKILL'); } catch { }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// verifySubscription — cek status subscribe otomatis via API + billing page
// ─────────────────────────────────────────────────────────────────────────────
async function verifySubscription(
  page: any,
  logFn: (msg: string) => void
): Promise<{ subscribed: boolean; plan: string; detail: string }> {
  logFn(`🔍 Verifikasi status subscription...`);
  try {
    // Tunggu sebentar agar session update setelah payment
    await sleep(3000);

    // 1) Cek via /backend-api/me — field SPESIFIK: is_paid_subscriber_on_current_env
    const me = await page.evaluate(async () => {
      try {
        const r = await fetch("https://chatgpt.com/backend-api/me", { credentials: "include" });
        if (!r.ok) return null;
        return r.json();
      } catch { return null; }
    }).catch(() => null);

    if (me) {
      logFn(`📡 /backend-api/me → ${JSON.stringify(me).slice(0, 500)}`);
      const isPaid: boolean = me.is_paid_subscriber_on_current_env === true;
      const planType: string = (me.plan_type ?? "").toLowerCase();
      if (isPaid || planType === "team" || planType === "business" || planType === "pro" || planType === "plus") {
        logFn(`✅ Subscription AKTIF (via /me) — Plan: ${planType || "paid"} | isPaid: ${isPaid}`);
        return { subscribed: true, plan: planType || "paid", detail: JSON.stringify(me).slice(0, 300) };
      }
    }

    // 2) Buka halaman billing — sumber paling akurat untuk konfirmasi UI
    logFn(`🌐 Navigasi ke chatgpt.com/billing untuk verifikasi UI...`);
    await page.goto("https://chatgpt.com/billing", { timeout: 25000, waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(8000); // tunggu konten billing load + subscription propagate
    const billingText = await page.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => "");
    logFn(`📄 Billing page FULL:\n${billingText.slice(0, 800).replace(/\n/g, " | ")}`);
    const bt = billingText.toLowerCase();

    // Indikator JELAS plan berbayar aktif
    const paidIndicators = [
      bt.includes("chatgpt business"),
      bt.includes("chatgpt team"),
      bt.includes("chatgpt pro"),
      bt.includes("chatgpt plus"),
      bt.includes("free trial") && bt.includes("end"),  // "Trial ends on..."
      bt.includes("free trial") && bt.includes("cancel"),
      bt.includes("business plan") && bt.includes("active"),
      bt.includes("cancel subscription") || bt.includes("cancel plan"),
      bt.includes("next billing") || bt.includes("renewal date"),
      bt.includes("manage subscription"),
    ];
    const subscribed = paidIndicators.some(Boolean);

    if (subscribed) {
      const planMatch = billingText.match(/ChatGPT\s+(Business|Team|Plus|Pro)[^\n]*/i);
      const plan = planMatch ? planMatch[0].trim() : "business";
      logFn(`✅ Subscription AKTIF (billing page) — ${plan}`);
      return { subscribed: true, plan, detail: billingText.slice(0, 400) };
    }

    // 3) Cek accounts/check sebagai backup — cek plan_type DAN has_customer_object
    const accountCheck = await page.evaluate(async () => {
      try {
        const r = await fetch("https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27", { credentials: "include" });
        if (!r.ok) return null;
        const txt = await r.text();
        return txt;
      } catch { return null; }
    }).catch(() => null);

    if (accountCheck) {
      logFn(`📡 accounts/check raw (600 char): ${accountCheck.slice(0, 600)}`);
      // Cek plan_type spesifik
      const ptMatch = accountCheck.match(/"plan_type"\s*:\s*"(team|business|pro|plus)"/i);
      // Cek has_customer_object — jika true, berarti Stripe customer sudah dibuat (payment attempt made)
      const hasCustomerObj = accountCheck.includes('"has_customer_object":true');
      // Cek has_transaction_history — berarti ada riwayat pembayaran
      const hasTxHistory = accountCheck.includes('"has_transaction_history":true');
      logFn(`📊 plan_type=${ptMatch?.[1]||"none"} | has_customer_object=${hasCustomerObj} | has_transaction_history=${hasTxHistory}`);
      if (ptMatch) {
        logFn(`✅ Subscription AKTIF (accounts/check plan_type) — ${ptMatch[1]}`);
        return { subscribed: true, plan: ptMatch[1], detail: accountCheck.slice(0, 300) };
      }
      if (hasCustomerObj || hasTxHistory) {
        logFn(`⚠️ Payment diproses (customer_object=${hasCustomerObj}, tx_history=${hasTxHistory}) — tapi plan_type belum ter-update. Tunggu beberapa menit.`);
        return { subscribed: false, plan: "pending", detail: `has_customer_object: ${hasCustomerObj}` };
      }
    }

    logFn(`⚠️ Subscription BELUM aktif — akun masih Free (tidak ada customer object di Stripe). Payment belum diproses.`);
    return { subscribed: false, plan: "free", detail: billingText.slice(0, 300) };
  } catch (e: any) {
    logFn(`⚠️ Gagal verifikasi subscription: ${e.message}`);
    return { subscribed: false, plan: "error", detail: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fillCheckoutPayment — login ke ChatGPT via proxy Korea, lalu buka checkout URL
// di context baru tanpa proxy (agar Stripe iframes load), isi CC + submit.
// ─────────────────────────────────────────────────────────────────────────────
export async function fillCheckoutPayment(
  checkoutUrl: string,
  ccNumber: string,
  cardholderName: string,
  logFn: (msg: string) => void = console.log,
  options?: {
    email?: string;
    password?: string;
    proxyUrl?: string;
    sessionCookies?: any[];
  }
): Promise<{ ok: boolean; message: string }> {
  const chromiumWithStealth = addExtra(chromium as any);
  chromiumWithStealth.use(StealthPlugin());
  const systemChromium = getSystemChromiumPath();

  const browser = await (chromiumWithStealth as any).launch({
    headless: true,
    executablePath: systemChromium,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  }) as Browser;

  try {
    let sessionCookies: any[] = [];

    // ── STEP 1: Gunakan cookies dari sesi registrasi (jika tersedia) ──────────
    if (options?.sessionCookies && options.sessionCookies.length > 0) {
      sessionCookies = options.sessionCookies;
      logFn(`🍪 Pakai ${sessionCookies.length} cookies dari sesi registrasi (skip login)`);
    } else if (options?.email && options?.password) {
    // ── STEP 1b: Fallback — Login manual ke ChatGPT ───────────────────────────
    // Insight: checkout URL bisa dibuka tanpa proxy Korea jika sudah punya session cookies.
    // Proxy Korea hanya dibutuhkan untuk navigasi ke /plans/, bukan untuk checkout URL-nya.
      logFn(`🔐 Login ke ChatGPT: ${options.email}`);
      const loginCtx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
      });
      const loginPage = await loginCtx.newPage();

      try {
        // Langsung ke halaman login Auth0 — tunggu sampai redirect selesai
        logFn(`🌐 Buka halaman login...`);
        await loginPage.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
        // Tunggu redirect ke auth0.openai.com atau halaman dengan email form
        await sleep(3000);

        const loginUrl = loginPage.url();
        logFn(`📍 URL setelah redirect: ${loginUrl.slice(0, 100)}`);

        // Isi email — pakai waitForSelector seperti di registration flow
        let emailFilled = false;
        const emailSels = ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', '#username', '#email'];
        for (const sel of emailSels) {
          try {
            await loginPage.waitForSelector(sel, { timeout: 8000 });
            await loginPage.locator(sel).first().click();
            await sleep(200);
            await loginPage.locator(sel).first().fill(options.email);
            logFn(`📧 Email diisi: ${sel}`);
            await sleep(500);
            // Klik Continue / submit
            for (const btnSel of ['button[type="submit"]', 'button:has-text("Continue")', 'button:has-text("Next")']) {
              try {
                const btn = loginPage.locator(btnSel).first();
                if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); break; }
              } catch { }
            }
            emailFilled = true;
            await sleep(2500);
            break;
          } catch { }
        }
        if (!emailFilled) {
          const pageText = await loginPage.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
          logFn(`⚠️ Field email tidak ditemukan | URL: ${loginPage.url().slice(0, 80)}`);
          logFn(`   Teks: ${pageText.replace(/\n/g, " ").slice(0, 120)}`);
        }

        // Isi password — mungkin di halaman terpisah
        let pwFilled = false;
        const pwSels = ['input[name="password"]', 'input[type="password"]', '#password'];
        for (const sel of pwSels) {
          try {
            await loginPage.waitForSelector(sel, { timeout: 8000 });
            await loginPage.locator(sel).first().click();
            await sleep(200);
            await loginPage.locator(sel).first().fill(options.password);
            logFn(`🔑 Password diisi`);
            await sleep(500);
            for (const btnSel of ['button[type="submit"]', 'button:has-text("Continue")', 'button:has-text("Sign in")']) {
              try {
                const btn = loginPage.locator(btnSel).first();
                if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); break; }
              } catch { }
            }
            pwFilled = true;
            break;
          } catch { }
        }
        if (!pwFilled) logFn(`⚠️ Field password tidak ditemukan | URL: ${loginPage.url().slice(0, 80)}`);

        // Tunggu redirect ke chatgpt.com (bukan /auth)
        try {
          await loginPage.waitForURL(
            url => url.includes("chatgpt.com") && !url.includes("/auth") && !url.includes("auth0"),
            { timeout: 25000 }
          );
          await sleep(2000);
          logFn(`✅ Login berhasil → ${loginPage.url().slice(0, 60)}`);
        } catch {
          logFn(`⚠️ Redirect timeout — URL saat ini: ${loginPage.url().slice(0, 80)}`);
        }

        // Verifikasi session cookie
        sessionCookies = await loginCtx.cookies();
        const hasSession = sessionCookies.some(c => c.name === "__Secure-next-auth.session-token");
        const sessionInfo = sessionCookies.map(c => c.name).join(", ");
        logFn(`🍪 ${sessionCookies.length} cookies | Auth session-token: ${hasSession ? "✅ ADA" : "❌ TIDAK ADA"}`);
        logFn(`   Cookies: ${sessionInfo.slice(0, 150)}`);
      } finally {
        await loginCtx.close().catch(() => {});
      }
    } else {
      logFn(`⚠️ Email/password tidak tersedia — coba buka checkout langsung`);
    }

    // ── STEP 2: Buka checkout URL via proxy Korea (geo bypass), lalu pindah ke no-proxy (Stripe) ─
    // Pattern sama persis dengan doManualPayment (line 1245-1252):
    // proxy → chatgpt.com + checkout URL → dapat URL → no-proxy → buka URL → Stripe load

    if (!options?.proxyUrl) {
      logFn(`❌ proxyUrl tidak tersedia — AutoPay WAJIB pakai proxy Korea. Abort.`);
      return { ok: false, message: "Proxy Korea tidak tersedia dari daftar proxy. Coba lagi." };
    }

    const proxyParsed = parseProxyUrl(options.proxyUrl);
    logFn(`🇰🇷 Buat proxy Korea context (bypass Stripe): ${options.proxyUrl.replace(/:([^:@]+)@/, ":***@")}`);

    let proxyCtx: any = null;
    let page: any;

    try {
      // Proxy aktif SEPANJANG proses (chatgpt + checkout + CC fill + submit)
      // Stripe domains di-bypass langsung (tidak lewat proxy) agar iframe tetap load
      proxyCtx = await browser.newContext({
        proxy: {
          server: proxyParsed?.server ?? options!.proxyUrl,
          ...(proxyParsed?.username ? { username: proxyParsed.username } : {}),
          ...(proxyParsed?.password ? { password: proxyParsed.password } : {}),
          bypass: STRIPE_BYPASS,
        },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        viewport: { width: 1280, height: 800 },
      });

      if (sessionCookies.length > 0) {
        await proxyCtx.addCookies(sessionCookies);
        logFn(`🍪 ${sessionCookies.length} cookies diinjeksi ke proxy context`);
      }

      const proxyPage = await proxyCtx.newPage();

      // ─ 2a: Buka chatgpt.com via proxy untuk establish session ─────────────
      logFn(`🌐 Buka chatgpt.com via proxy Korea...`);
      for (let t = 0; t < 4; t++) {
        try {
          await proxyPage.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 45000 });
          break;
        } catch (e: any) {
          logFn(`⚠️ Proxy connect error (try ${t+1}): ${e.message?.slice(0, 80)}`);
          if (t < 3) await sleep(1500); else throw e;
        }
      }
      await sleep(2000);

      const rootUrl = proxyPage.url();
      const rootText = await proxyPage.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
      const sessionValid = !rootText.includes("Log in") || rootText.includes("New chat");
      logFn(`📍 chatgpt.com via proxy: ${rootUrl.slice(0, 60)} | Session: ${sessionValid ? "✅" : "⚠️ tidak terdeteksi"}`);

      // ─ 2b: Buka checkout URL via proxy ─────────────────────────────────────
      // Jika redirect → checkout URL sudah dikonsumsi/expired → navigasi ke /plans
      logFn(`🔗 Buka checkout URL via proxy Korea...`);
      await proxyPage.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e: any) => {
        logFn(`⚠️ Goto checkout (proxy): ${e.message?.slice(0, 80)}`);
      });
      await sleep(2500);

      let activeCheckoutUrl = proxyPage.url();
      logFn(`📍 URL setelah goto checkout: ${activeCheckoutUrl.slice(0, 80)}`);

      // ─ 2c: Jika checkout URL invalid → navigasi ulang ke /plans untuk URL fresh ──
      if (!activeCheckoutUrl.includes("/checkout/")) {
        logFn(`⚠️ Checkout URL lama tidak valid — navigasi ke /plans untuk URL baru...`);

        for (let plansTry = 0; plansTry < 3; plansTry++) {
          try {
            await proxyPage.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 45000 });
            break;
          } catch (e: any) {
            logFn(`⚠️ /plans goto error (${plansTry+1}): ${e.message?.slice(0, 60)}`);
            if (plansTry < 2) await sleep(1500);
          }
        }
        await sleep(2000);
        logFn(`📍 URL plans: ${proxyPage.url().slice(0, 60)}`);

        // Dismiss modal Korea consent jika ada
        for (const btnTxt of ["Continue", "동의", "Accept", "확인", "OK"]) {
          try {
            const btn = proxyPage.locator(`button:has-text("${btnTxt}")`).first();
            if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await sleep(800); break; }
          } catch { }
        }

        // Skip onboarding
        try {
          const skipBtn = proxyPage.locator('button:has-text("Skip")').first();
          if (await skipBtn.isVisible({ timeout: 2000 })) { await skipBtn.click(); await sleep(800); }
        } catch { }

        // Klik Claim offer / Start free trial
        for (const claimSel of [
          'button:has-text("Claim offer")',
          'button:has-text("Claim free offer")',
          'button:has-text("Start free trial")',
          'button:has-text("Get Business")',
          'button:has-text("Subscribe")',
        ]) {
          try {
            const btn = proxyPage.locator(claimSel).first();
            if (await btn.isVisible({ timeout: 3000 })) {
              await btn.click();
              logFn(`✅ Plan diklik: "${claimSel}"`);
              await sleep(1500);
              break;
            }
          } catch { }
        }

        // Tunggu redirect ke checkout
        try {
          await proxyPage.waitForURL((url: string) => url.includes("/checkout/"), { timeout: 20000 });
          logFn(`✅ Redirect ke checkout baru!`);
        } catch {
          logFn(`⚠️ Timeout tunggu checkout URL baru — URL: ${proxyPage.url().slice(0, 80)}`);
        }
        await sleep(1500);
        activeCheckoutUrl = proxyPage.url();
        logFn(`📍 Checkout URL baru: ${activeCheckoutUrl.slice(0, 80)}`);
      }

      // ─ 2d: Tetap di proxy context (bypass Stripe aktif) untuk CC fill + submit ─
      logFn(`✅ Proxy context aktif — Stripe bypass ON — lanjut isi CC + submit di proxy yang sama`);
      page = proxyPage;

      // Jika belum di checkout, buka URL target di proxyPage
      const targetCheckoutUrl = activeCheckoutUrl.includes("/checkout/") ? activeCheckoutUrl : checkoutUrl;
      if (!proxyPage.url().includes("/checkout/")) {
        await page.goto(targetCheckoutUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e: any) => {
          logFn(`⚠️ Goto checkout (proxy+bypass): ${e.message?.slice(0, 80)}`);
        });
        await sleep(2500);
        logFn(`📍 URL checkout (proxy+bypass): ${page.url().slice(0, 80)}`);
      }

    } catch (proxySetupErr: any) {
      logFn(`❌ Error setup proxy: ${proxySetupErr.message?.slice(0, 100)}`);
      if (proxyCtx) await proxyCtx.close().catch(() => {});
      return { ok: false, message: `Gagal setup proxy Korea: ${proxySetupErr.message?.slice(0, 80)}` };
    }
    // Catatan: proxyCtx TIDAK ditutup di sini — tetap aktif selama Stripe fill + submit
    // Akan tertutup otomatis saat browser.close() di outer finally

    if (!page) {
      return { ok: false, message: "Gagal membuka halaman checkout." };
    }

    // Tunggu Stripe card iframes
    logFn(`⏳ Menunggu Stripe iframes...`);
    let stripeCardFrames: any[] = [];
    for (let wi = 0; wi < 15; wi++) {
      await sleep(1200);
      const allF = page.frames();
      stripeCardFrames = allF.filter((f: any) => {
        const u = f.url();
        return u.includes("stripe.com") && (
          u.includes("elements-inner") ||
          u.includes("hosted-fields") ||
          u.includes("payment-inner") ||
          u.includes("card-number") ||
          u.includes("card-expiry") ||
          u.includes("card-cvc") ||
          u.includes("card-input")
        );
      });
      // Hanya break jika payment iframe (bukan cuma address iframe) sudah muncul
      const paymentFrames2 = stripeCardFrames.filter((f: any) => !f.url().includes("elements-inner-address"));
      logFn(`  Frame ${wi+1}: ${allF.length} total, ${stripeCardFrames.length} stripe (${paymentFrames2.length} payment)`);
      if (paymentFrames2.length > 0) break;
    }

    if (stripeCardFrames.length === 0) {
      logFn(`⚠️ Stripe card iframes tidak muncul — coba isi di main frame`);
    }

    const { expMonth, expYear, cvv } = generateCreditCardInfo();
    const addr = generateKoreanAddress();
    logFn(`💳 CC: ****${ccNumber.slice(-4)} | Exp: ${expMonth}/${expYear.slice(-2)} | CVV: ${cvv}`);
    logFn(`📍 Alamat: ${addr.line1}, ${addr.city}`);

    const allFrames = stripeCardFrames.length > 0
      ? [page as any, ...stripeCardFrames]
      : [page as any, ...page.frames()];

    for (const frame of allFrames) {
      try {
        const fUrl = typeof frame.url === "function" ? frame.url() : "main";
        // Card number
        for (const sel of ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', '[data-elements-stable-field-name="cardNumber"] input', 'input[placeholder*="1234"]', 'input[placeholder*="Card number"]']) {
          try {
            const el = frame.locator(sel).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.click(); await sleep(200);
              await el.pressSequentially(ccNumber, { delay: 55 });
              logFn(`  ✅ Card number diisi`);
              await sleep(400); break;
            }
          } catch { }
        }
        // Expiry
        for (const sel of ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', '[data-elements-stable-field-name="cardExpiry"] input', 'input[placeholder*="MM / YY"]', 'input[placeholder*="MM"]']) {
          try {
            const el = frame.locator(sel).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.click(); await sleep(200);
              await el.pressSequentially(`${expMonth}${expYear.slice(-2)}`, { delay: 55 });
              logFn(`  ✅ Expiry: ${expMonth}/${expYear.slice(-2)}`);
              await sleep(400); break;
            }
          } catch { }
        }
        // CVV
        for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', '[data-elements-stable-field-name="cardCvc"] input', 'input[placeholder*="CVC"]', 'input[placeholder*="CVV"]']) {
          try {
            const el = frame.locator(sel).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.click(); await sleep(200);
              await el.pressSequentially(cvv, { delay: 55 });
              logFn(`  ✅ CVV diisi`);
              await sleep(400); break;
            }
          } catch { }
        }
        // Nama
        for (const sel of ['input[name="name"]', 'input[placeholder*="Name on card"]', 'input[autocomplete="cc-name"]']) {
          try {
            const el = frame.locator(sel).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.click(); await sleep(200);
              await el.fill(cardholderName);
              logFn(`  ✅ Nama: ${cardholderName}`);
              await sleep(300); break;
            }
          } catch { }
        }
      } catch { }
    }

    // ── Email di Contact Information ──────────────────────────────────────
    try {
      const emailSel = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
      if (await emailSel.isVisible({ timeout: 5000 })) {
        await emailSel.fill(options?.email ?? "");
        logFn(`✅ Email diisi: ${options?.email}`);
        await sleep(300);
      }
    } catch { }

    // ── Seats (ChatGPT Business — set ke 5) ──────────────────────────────
    try {
      for (const sel of ['input[type="number"]', 'input[name*="seat"]', 'input[name*="quantity"]', '[aria-label*="seat" i] input']) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 })) {
          await el.click({ clickCount: 3 });
          await el.fill("5");
          logFn(`✅ Seats: 5`);
          await sleep(300);
          break;
        }
      }
    } catch { }

    // ── Billing address → Stripe elements-inner-address iframe ────────────
    logFn(`📍 Isi billing address di Stripe iframe...`);
    await sleep(500);
    const addrIframe = page.frames().find((f: any) => f.url().includes("elements-inner-address"));
    if (addrIframe) {
      logFn(`🗺️ Stripe address iframe ditemukan`);
      await fillStripeAddressFrame(addrIframe, addr, logFn, cardholderName);
    } else {
      logFn(`⚠️ Stripe address iframe tidak ditemukan`);
    }

    await sleep(500);

    // ── "I'm purchasing as business" checkbox ─────────────────────────────
    try {
      const bizChk = page.locator(
        'input[type="checkbox"][name*="business" i], label:has-text("purchasing as business") input, input[id*="business" i]'
      ).first();
      if (await bizChk.isVisible({ timeout: 2000 })) {
        const isChecked = await bizChk.isChecked().catch(() => false);
        if (!isChecked) { await bizChk.check(); }
        logFn(`✅ "I'm purchasing as business" ${isChecked ? "sudah" : "dicentang"}`);
        await sleep(300);
      }
    } catch { }

    await sleep(800);

    // Klik Submit
    await sleep(500);
    let submitted = false;
    for (const sel of [
      'button:has-text("Subscribe")',
      'button:has-text("Start")',
      'button:has-text("Pay")',
      'button:has-text("Confirm")',
      'button:has-text("구독")',
      'button[type="submit"]',
    ]) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click({ timeout: 5000 });
          logFn(`🚀 Submit: "${sel}"`);
          submitted = true;
          break;
        }
      } catch { }
    }
    if (!submitted) logFn(`⚠️ Tombol submit tidak ditemukan`);

    // Tunggu redirect ke halaman sukses (away from /checkout/)
    logFn(`⏳ Menunggu redirect halaman sukses...`);
    try {
      await page.waitForURL((url: string) => !url.includes("/checkout/"), { timeout: 20000 });
    } catch { }
    await sleep(2000);

    const finalUrl = page.url();
    const finalText = await page.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => "");
    logFn(`🌐 URL akhir: ${finalUrl.slice(0, 100)}`);
    logFn(`📄 Halaman: ${finalText.slice(0, 200).replace(/\n/g, " ")}`);

    const successKeywords = [
      "thank", "success", "subscribed", "payment successful",
      "pembayaran berhasil", "berhasil", "tim anda telah dibuat", "lanjutkan",
      "결제 완료", "구독 완료", "감사합니다",
    ];
    const isSuccess =
      successKeywords.some(kw => finalText.toLowerCase().includes(kw)) ||
      finalUrl.includes("success") ||
      finalUrl.includes("subscribed") ||
      (!finalUrl.includes("/checkout/") && submitted);

    if (isSuccess) {
      logFn(`🎉 PAYMENT BERHASIL! Akun tersubscribe Business Free Trial`);
    } else {
      logFn(`ℹ️ Payment diproses — verifikasi status subscription...`);
    }

    // Verifikasi otomatis status subscription
    const subResult = await verifySubscription(page, logFn);
    const finalMsg = subResult.subscribed
      ? `🎉 Pembayaran berhasil! Subscription aktif — ${subResult.plan}`
      : `Payment dikirim — cek dashboard ChatGPT untuk konfirmasi.`;
    return { ok: true, message: finalMsg };

  } finally {
    await browser.close().catch(() => {});
  }
}
