import { chromium, Browser, Page, BrowserContext } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync } from "child_process";

import { CloudMailClient } from "./cloudMailClient.js";

import { generateRandomName, generateRandomBirthday, generateEmailPrefix, generatePassword, generateKoreanAddress, generateCreditCardInfo } from "./nameGenerator.js";

function getSystemChromiumPath(): string | undefined {
  try {
    return execSync("which chromium || which chromium-browser", { timeout: 3000 })
      .toString().trim().split("\n")[0];
  } catch { return undefined; }
}

export interface RegistrationConfig {
  cloudMail: {
    baseUrl: string;
    adminEmail: string;
    adminPassword: string;
    emailPassword: string;
    emailPrefix?: string;
  };
  chatgptPassword?: string;
  ccNumber?: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  headless?: boolean;
  count?: number;
}

export interface RegistrationResult {
  success: boolean;
  email: string;
  emailPassword: string;
  chatgptPassword: string;
  firstName: string;
  lastName: string;
  birthday: string;
  proxyUsed: string;
  errorMessage: string;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function humanType(page: Page, selector: string, text: string) {
  await page.click(selector);
  await sleep(300);
  for (const char of text) {
    await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
  }
  await sleep(500 + Math.random() * 500);
}

async function randomDelay(min = 1000, max = 3000) {
  await sleep(min + Math.random() * (max - min));
}

export class RegistrationBot {
  private cancelled = false;
  private logCallback: ((msg: string) => void) | null = null;

  setLogCallback(fn: (msg: string) => void) { this.logCallback = fn; }
  cancel() { this.cancelled = true; }
  reset() { this.cancelled = false; }

  private log(msg: string) {
    console.log(msg);
    if (this.logCallback) this.logCallback(msg);
  }

  async register(config: RegistrationConfig): Promise<RegistrationResult> {
    this.cancelled = false;
    const { firstName, lastName } = generateRandomName();
    const birthday = generateRandomBirthday();
    const emailPassword = config.cloudMail.emailPassword;
    const chatgptPassword = config.chatgptPassword || generatePassword();
    const proxyUsed = config.proxy?.server || "none";

    const cloudMailClient = new CloudMailClient({
      baseUrl: config.cloudMail.baseUrl,
      adminEmail: config.cloudMail.adminEmail,
      adminPassword: config.cloudMail.adminPassword,
    });

    const prefix = config.cloudMail.emailPrefix
      ? `${config.cloudMail.emailPrefix}${Math.floor(Math.random() * 9000 + 1000)}`
      : generateEmailPrefix(firstName, lastName);
    const email = `${prefix}@${cloudMailClient.getDomain()}`;

    const result: RegistrationResult = {
      success: false,
      email,
      emailPassword,
      chatgptPassword,
      firstName,
      lastName,
      birthday,
      proxyUsed,
      errorMessage: "",
    };

    this.log(`[Mulai] Mendaftar ${email} | Proxy: ${proxyUsed}`);

    // Step 1: Create mailbox
    this.log(`[Email] Membuat mailbox ${email}...`);
    try {
      await cloudMailClient.createMailbox(email, emailPassword);
      this.log(`[Email] ✅ Mailbox berhasil dibuat`);
    } catch (err: any) {
      result.errorMessage = `Gagal membuat mailbox: ${err.message}`;
      this.log(`[Gagal] ${result.errorMessage}`);
      return result;
    }

    if (this.cancelled) {
      result.errorMessage = "Tugas dibatalkan";
      return result;
    }

    // Step 2: Launch browser with stealth
    const playwrightExtra = addExtra(chromium as any);
    playwrightExtra.use(StealthPlugin());

    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      const systemChromium = getSystemChromiumPath();
      const launchOptions: any = {
        headless: config.headless !== false,
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
          "--disable-infobars",
          "--window-size=1280,800",
        ],
      };
      // Proxy TIDAK dipakai saat launch — hanya diaktifkan di context payment
      browser = await (playwrightExtra as any).launch(launchOptions) as Browser;
      const context = await browser.newContext({
        locale: "en-US",
        timezoneId: "America/New_York",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
      });
      page = await context.newPage();

      // Step 3: Navigate to signup
      this.log(`[Browser] Membuka halaman pendaftaran ChatGPT...`);
      await page.goto("https://chatgpt.com/auth/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
      await randomDelay(2000, 4000);

      if (this.cancelled) throw new Error("Tugas dibatalkan");

      // Handle cookie consent jika muncul
      for (const cookieSel of [
        'button:has-text("Accept")', 'button:has-text("Accept all")',
        'button:has-text("Allow")', 'button:has-text("OK")',
        'button:has-text("Agree")', 'button[id*="accept"]',
      ]) {
        try {
          const btn = page.locator(cookieSel).first();
          if (await btn.isVisible({ timeout: 1500 })) {
            await btn.click({ force: true });
            this.log(`✅ Cookie consent diterima`);
            await randomDelay(800, 1200);
            break;
          }
        } catch { }
      }

      // Jika mendarat di halaman login, cari link "Sign up"
      const urlAfterNav = page.url();
      if (urlAfterNav.includes("/auth/login") || urlAfterNav.includes("login")) {
        this.log(`🔄 Halaman login terdeteksi — cari link Sign up...`);
        for (const sel of ['a:has-text("Sign up")', 'a[href*="signup"]', 'button:has-text("Sign up")']) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              await el.click({ force: true });
              this.log(`✅ Klik signup dari login`);
              await randomDelay(2000, 3000);
              break;
            }
          } catch { }
        }
      }

      // Step 4: Enter email
      this.log(`[Langkah 1/5] Mengisi kolom email...`);
      const emailInput = await page.waitForSelector('input[type="email"], input[name="email"], input[autocomplete="email"]', { timeout: 20000 });
      if (!emailInput) throw new Error("Kolom email tidak ditemukan");
      await humanType(page, 'input[type="email"], input[name="email"], input[autocomplete="email"]', email);
      await randomDelay(500, 1000);
      await page.keyboard.press("Enter");
      await randomDelay(2000, 4000);

      if (this.cancelled) throw new Error("Tugas dibatalkan");

      // Step 5: Enter password
      this.log(`[Langkah 2/5] Mengisi kolom password...`);
      const pwInput = await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      if (!pwInput) throw new Error("Kolom password tidak ditemukan");
      await humanType(page, 'input[type="password"]', chatgptPassword);
      await randomDelay(500, 1000);
      await page.keyboard.press("Enter");
      await randomDelay(2000, 4000);

      if (this.cancelled) throw new Error("Tugas dibatalkan");

      // Step 6: Wait for verification email
      this.log(`[Langkah 3/5] Menunggu kode verifikasi dari email...`);
      const code = await cloudMailClient.waitForVerificationCode(
        email, emailPassword, 180, this.log.bind(this)
      );
      if (!code) throw new Error("Kode verifikasi tidak diterima (timeout 3 menit)");

      // Step 7: Enter verification code
      this.log(`[Langkah 3/5] Memasukkan kode verifikasi: ${code}...`);
      await randomDelay(1000, 2000);
      const otpSelectors = [
        'input[autocomplete="one-time-code"]',
        'input[name="code"]',
        'input[aria-label*="digit"]',
        'input[aria-label*="code"]',
        '[data-testid="otp-input"]',
      ];
      let otpFilled = false;
      for (const sel of otpSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            await sleep(300);
            await el.type(code, { delay: 80 });
            otpFilled = true;
            this.log(`[Langkah 3/5] ✅ Kode verifikasi berhasil diisi`);
            break;
          }
        } catch { }
      }
      if (!otpFilled) {
        // Coba kotak digit individual
        const digits = await page.$$('input[maxlength="1"], input[data-index]');
        if (digits.length >= 6) {
          for (let i = 0; i < Math.min(code.length, digits.length); i++) {
            await digits[i].click();
            await digits[i].type(code[i], { delay: 80 });
            await sleep(100);
          }
          otpFilled = true;
          this.log(`[Langkah 3/5] ✅ Kode verifikasi diisi per digit`);
        }
      }
      if (!otpFilled) throw new Error("Kolom kode verifikasi tidak ditemukan");

      await randomDelay(2000, 4000);
      try {
        await page.keyboard.press("Enter");
      } catch { }

      if (this.cancelled) throw new Error("Tugas dibatalkan");

      // Step 8: Isi profil (nama + tanggal lahir)
      this.log(`[Langkah 4/5] Mengisi data profil: ${firstName} ${lastName}...`);
      await randomDelay(2000, 4000);

      // Isi nama — fokus via JS lalu ketik untuk update React state
      const fullName = `${firstName} ${lastName}`;
      try {
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
        await page.evaluate(() => {
          const input = document.querySelector('input[name="name"]') as HTMLInputElement | null;
          if (input) {
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            input.dispatchEvent(new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
          }
        });
        const actualValue = await page.locator('input[name="name"]').inputValue().catch(() => "?");
        this.log(`✅ Nama diisi: "${actualValue}"`);
      } catch (e: any) {
        this.log(`⚠️ Isi nama gagal: ${e.message}`);
        try {
          await page.locator('input[name="name"]').fill(fullName);
          this.log(`✅ Nama diisi via fill(): ${fullName}`);
        } catch { }
      }

      await randomDelay(600, 1000);

      // Isi tanggal lahir
      const [bdMM, bdDD, bdYYYY] = birthday.split("/");
      const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      const monthName = monthNames[parseInt(bdMM) - 1];
      const isoDate = `${bdYYYY}-${bdMM}-${bdDD}`;

      // Prioritas 1: Spinbutton (React Aria DatePicker) — fokus via JS
      try {
        const spinbtns = page.locator('[role="spinbutton"]');
        const sbCount = await spinbtns.count();
        if (sbCount >= 3) {
          for (const [i, val] of [[0, parseInt(bdMM).toString()], [1, parseInt(bdDD).toString()], [2, bdYYYY]] as [number, string][]) {
            await spinbtns.nth(i).evaluate(el => (el as HTMLElement).focus());
            await randomDelay(150, 250);
            await page.keyboard.type(val, { delay: 60 });
            await randomDelay(150, 250);
          }
          this.log(`📅 Tanggal lahir (spinbutton) diisi: ${birthday}`);
        }
      } catch { }

      // Prioritas 2: Set hidden input SETELAH spinbutton agar override
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
        this.log(`📅 Hidden birthday diset: ${hdResult}`);
      } catch { }

      // Native select
      try {
        const selects = await page.$$("select");
        if (selects.length >= 3) {
          await selects[0].selectOption({ index: parseInt(bdMM) });
          await selects[1].selectOption({ value: bdDD.replace(/^0/, "") });
          await selects[2].selectOption({ value: bdYYYY });
          this.log(`📅 Tanggal lahir (select) diisi: ${birthday}`);
        }
      } catch { }

      // Combobox custom
      try {
        const comboboxes = page.locator('[role="combobox"], [aria-haspopup="listbox"]');
        const cbCount = await comboboxes.count();
        if (cbCount >= 3) {
          await comboboxes.nth(0).click();
          await randomDelay(300, 500);
          await page.getByRole("option", { name: monthName, exact: false }).first().click().catch(async () => {
            await page!.locator(`[role="option"]:has-text("${monthName}")`).first().click().catch(() => {});
          });
          await randomDelay(300, 500);
          await comboboxes.nth(1).click();
          await randomDelay(300, 500);
          await page.getByRole("option", { name: String(parseInt(bdDD)), exact: true }).first().click().catch(async () => {
            await page!.locator(`[role="option"]:has-text("${parseInt(bdDD)}")`).first().click().catch(() => {});
          });
          await randomDelay(300, 500);
          await comboboxes.nth(2).click();
          await randomDelay(300, 500);
          await page.getByRole("option", { name: bdYYYY, exact: true }).first().click().catch(async () => {
            await page!.locator(`[role="option"]:has-text("${bdYYYY}")`).first().click().catch(() => {});
          });
          this.log(`📅 Tanggal lahir (combobox) diisi: ${birthday}`);
        }
      } catch { }

      // Input date
      try {
        const dateInput = await page.$('input[type="date"]');
        if (dateInput) {
          await dateInput.fill(isoDate);
          this.log(`📅 Tanggal lahir (input date) diisi: ${isoDate}`);
        }
      } catch { }

      await randomDelay(1000, 2000);

      // Klik tombol submit
      for (const btnText of ["Continue", "Finish", "Next", "Submit", "Done"]) {
        try {
          const btn = page.getByText(btnText, { exact: false }).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click({ force: true });
            this.log(`✅ Klik tombol: "${btnText}"`);
            break;
          }
        } catch { }
      }
      await randomDelay(2000, 4000);

      // Step 9: Cek hasil registrasi
      this.log(`[Langkah 5/5] Memeriksa hasil registrasi...`);
      await randomDelay(3000, 5000);
      const finalUrl = page.url();
      if (
        finalUrl.includes("chatgpt.com") &&
        !finalUrl.includes("/auth/error") &&
        !finalUrl.includes("/auth/signup")
      ) {
        result.success = true;
        this.log(`✅ Registrasi berhasil! ${email} — URL: ${finalUrl}`);
      } else if (finalUrl.includes("/auth/error")) {
        throw new Error(`Halaman error saat registrasi: ${finalUrl}`);
      } else {
        await randomDelay(4000, 6000);
        const url2 = page.url();
        if (url2.includes("chatgpt.com") && !url2.includes("/auth/")) {
          result.success = true;
          this.log(`✅ Registrasi berhasil! ${email}`);
        } else {
          throw new Error(`Alur registrasi belum selesai. URL saat ini: ${url2}`);
        }
      }

      // Step 10: Payment — proxy Korean diaktifkan di sini via context baru
      if (result.success && config.ccNumber?.trim()) {
        await this.doPayment(page, context, config.ccNumber.trim(), `${firstName} ${lastName}`, config.proxy);
      }
    } catch (err: any) {
      result.errorMessage = err.message;
      this.log(`[Gagal] ${email}: ${err.message}`);
      if (page) {
        try {
          await page.screenshot({ path: `/tmp/error_${Date.now()}.png` }).catch(() => {});
        } catch { }
      }
    } finally {
      if (browser) {
        try { await browser.close(); } catch { }
      }
    }

    return result;
  }

  async doPayment(originalPage: Page, originalContext: BrowserContext, ccNumber: string, cardholderName: string, proxyConfig?: RegistrationConfig["proxy"]): Promise<void> {
    const { expMonth, expYear, cvv } = generateCreditCardInfo();
    const addr = generateKoreanAddress();
    this.log(`[Payment] 💳 Mulai proses payment CC: ****${ccNumber.slice(-4)}`);
    this.log(`[Payment] 📅 Expiry: ${expMonth}/${expYear} | CVV: ${cvv}`);
    this.log(`[Payment] 📍 Alamat: ${addr.line1}, ${addr.city}, ${addr.province} ${addr.postal}, Korea Selatan`);
    let paymentContext: BrowserContext | null = null;
    let page: Page = originalPage;

    try {
      // Buat context baru dengan proxy Korean untuk payment
      const cookies = await originalContext.cookies();
      if (proxyConfig?.server) {
        this.log(`[Payment] 🌐 Proxy Korea aktif: ${proxyConfig.server} | User: ${proxyConfig.username ?? "none"}`);
        const pConfig: any = { server: proxyConfig.server };
        if (proxyConfig.username) {
          pConfig.username = proxyConfig.username;
          pConfig.password = proxyConfig.password ?? "";
        }
        paymentContext = await originalContext.browser()!.newContext({
          locale: "en-US",
          timezoneId: "America/New_York",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          viewport: { width: 1280, height: 800 },
          proxy: pConfig,
        });
        await paymentContext.addCookies(cookies);
        page = await paymentContext.newPage();
        this.log(`[Payment] ✅ Context proxy siap`);
      } else {
        this.log(`[Payment] ⚠️ Tidak ada proxy — payment langsung`);
        page = originalPage;
      }

      // Navigasi ke halaman upgrade/billing ChatGPT
      await page.goto("https://chatgpt.com/plans", { waitUntil: "domcontentloaded", timeout: 20000 });
      await randomDelay(2000, 3000);

      const url = page.url();
      this.log(`[Payment] 🌐 URL billing: ${url}`);

      // Dismiss onboarding "What brings you to ChatGPT?" jika ada
      for (let i = 0; i < 5; i++) {
        const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
        if (bodyText.includes("What brings you to ChatGPT") || bodyText.includes("brings you")) {
          this.log(`[Payment] 🔄 Onboarding terdeteksi — Skip`);
          for (const sel of ['button:has-text("Skip")', 'a:has-text("Skip")', 'button:has-text("Next")']) {
            try {
              const btn = page.locator(sel).first();
              if (await btn.isVisible({ timeout: 1500 })) {
                await btn.click({ force: true });
                this.log(`[Payment] ✅ Onboarding di-skip`);
                await randomDelay(1500, 2000);
                break;
              }
            } catch { }
          }
        } else break;
        await randomDelay(500, 800);
      }

      await this.fillPaymentForm(page, ccNumber, cardholderName, expMonth, expYear, cvv, addr);
    } catch (e: any) {
      this.log(`[Payment] ⚠️ Gagal proses payment: ${e.message}`);
    } finally {
      if (paymentContext) {
        try { await paymentContext.close(); } catch { }
      }
    }
  }

  private async fillPaymentForm(
    page: Page,
    ccNumber: string,
    cardholderName: string,
    expMonth: string,
    expYear: string,
    cvv: string,
    addr: ReturnType<typeof generateKoreanAddress>
  ): Promise<void> {
    // Cari dan klik tombol "Upgrade" jika ada
    for (const text of ["Upgrade to Plus", "Get Plus", "Subscribe", "Upgrade", "Add payment"]) {
      try {
        const btn = page.getByText(text, { exact: false }).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click({ force: true });
          this.log(`[Payment] ✅ Klik tombol: "${text}"`);
          await randomDelay(2000, 3000);
          break;
        }
      } catch { }
    }

    await randomDelay(2000, 3000);

    // === ISI FIELD BILLING LUAR STRIPE IFRAME ===
    // Country/Region dropdown
    try {
      const countrySelect = page.locator('select[name*="country"], select[id*="country"]').first();
      if (await countrySelect.isVisible({ timeout: 3000 })) {
        await countrySelect.selectOption({ value: "KR" });
        this.log(`[Payment] 🌍 Country diset: Korea Selatan (KR)`);
        await randomDelay(500, 800);
      }
    } catch { }

    // === ISI STRIPE IFRAME ===
    // Stripe menggunakan iframe terpisah untuk field CC
    await randomDelay(1000, 2000);

    const stripeSelectors = [
      'iframe[name*="stripe"]',
      'iframe[src*="stripe"]',
      'iframe[src*="js.stripe.com"]',
      'iframe[title*="Secure"]',
      'iframe[title*="card"]',
    ];

    let stripeFrame = null;
    for (const sel of stripeSelectors) {
      try {
        const frames = page.frames();
        const frame = frames.find(f => f.url().includes("stripe.com") || f.url().includes("js.stripe.com"));
        if (frame) { stripeFrame = frame; break; }
        const frameEl = page.frameLocator(sel);
        // Test apakah frame bisa diakses
        await frameEl.locator('input').first().waitFor({ timeout: 2000 });
        stripeFrame = frameEl;
        break;
      } catch { }
    }

    // Tunggu Stripe iframe dengan polling loop (maks 40 detik)
    this.log(`[Payment] ⏳ Menunggu Stripe iframe...`);
    let stripeFound = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      await randomDelay(3000, 4000);
      const allFrames = page.frames();
      const stripeFrames = allFrames.filter(f =>
        f.url().includes("stripe.com") || f.url().includes("js.stripe")
      );
      this.log(`[Payment] 🔍 Attempt ${attempt + 1}: ${allFrames.length} frames, ${stripeFrames.length} Stripe`);
      for (const f of allFrames) {
        if (f.url() && f.url() !== "about:blank") {
          this.log(`[Payment]   frame: ${f.url().slice(0, 90)}`);
        }
      }

      if (stripeFrames.length > 0) {
        stripeFound = true;
        this.log(`[Payment] ✅ Stripe frame ditemukan (${stripeFrames.length})`);

        for (const frame of stripeFrames) {
          // Card number
          for (const sel of ['input[name="cardnumber"]', 'input[autocomplete="cc-number"]', '[data-elements-stable-field-name="cardNumber"] input', 'input[placeholder*="1234"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2000 })) {
                await el.click(); await randomDelay(200, 300);
                await el.pressSequentially(ccNumber, { delay: 60 });
                this.log(`[Payment] ✅ Card number diisi`);
                await randomDelay(400, 600); break;
              }
            } catch { }
          }

          // Expiry
          for (const sel of ['input[name="exp-date"]', 'input[autocomplete="cc-exp"]', '[data-elements-stable-field-name="cardExpiry"] input', 'input[placeholder*="MM"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2000 })) {
                await el.click(); await randomDelay(200, 300);
                await el.pressSequentially(`${expMonth}${expYear.slice(-2)}`, { delay: 60 });
                this.log(`[Payment] ✅ Expiry: ${expMonth}/${expYear.slice(-2)}`);
                await randomDelay(400, 600); break;
              }
            } catch { }
          }

          // CVV
          for (const sel of ['input[name="cvc"]', 'input[autocomplete="cc-csc"]', '[data-elements-stable-field-name="cardCvc"] input', 'input[placeholder*="CVC"]']) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 2000 })) {
                await el.click(); await randomDelay(200, 300);
                await el.pressSequentially(cvv, { delay: 60 });
                this.log(`[Payment] ✅ CVV diisi`);
                await randomDelay(400, 600); break;
              }
            } catch { }
          }
        }
        break;
      }
    }

    if (!stripeFound) {
      const content = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
      this.log(`[Payment] ⚠️ Stripe tidak ditemukan. Konten: ${content.slice(0, 150)}`);
    }

    // Isi billing address di luar iframe
    await randomDelay(500, 800);

    // Cardholder name
    try {
      const nameInput = page.locator('input[name*="name"], input[placeholder*="name"], input[autocomplete*="cc-name"]').first();
      if (await nameInput.isVisible({ timeout: 2000 })) {
        await nameInput.fill(cardholderName);
        this.log(`[Payment] ✅ Cardholder name: ${cardholderName}`);
      }
    } catch { }

    // Address line 1
    try {
      const addr1Input = page.locator('input[name*="address"], input[name*="line1"], input[placeholder*="address"], input[autocomplete*="address-line1"]').first();
      if (await addr1Input.isVisible({ timeout: 2000 })) {
        await addr1Input.fill(addr.line1);
        this.log(`[Payment] ✅ Address: ${addr.line1}`);
        await randomDelay(300, 500);
      }
    } catch { }

    // City
    try {
      const cityInput = page.locator('input[name*="city"], input[placeholder*="city"], input[autocomplete*="address-level2"]').first();
      if (await cityInput.isVisible({ timeout: 2000 })) {
        await cityInput.fill(addr.city);
        this.log(`[Payment] ✅ City: ${addr.city}`);
        await randomDelay(300, 500);
      }
    } catch { }

    // State/Province
    try {
      const stateInput = page.locator('input[name*="state"], input[name*="province"], input[autocomplete*="address-level1"]').first();
      if (await stateInput.isVisible({ timeout: 2000 })) {
        await stateInput.fill(addr.province);
        await randomDelay(300, 500);
      }
    } catch { }

    // Postal code
    try {
      const postalInput = page.locator('input[name*="postal"], input[name*="zip"], input[placeholder*="postal"], input[autocomplete*="postal-code"]').first();
      if (await postalInput.isVisible({ timeout: 2000 })) {
        await postalInput.fill(addr.postal);
        this.log(`[Payment] ✅ Postal: ${addr.postal}`);
        await randomDelay(300, 500);
      }
    } catch { }

    // Dump info halaman payment untuk debug
    const paymentPageText = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "");
    this.log(`[Payment] 📄 Halaman payment: ${paymentPageText.slice(0, 200)}`);

    // Klik tombol submit/subscribe
    this.log(`[Payment] 🖱️ Mencari tombol submit/subscribe...`);
    await randomDelay(1000, 2000);
    const submitSelectors = [
      'button:has-text("Subscribe")',
      'button:has-text("Submit")',
      'button:has-text("Confirm")',
      'button[type="submit"]',
      'button:has-text("Pay")',
      'button:has-text("Start subscription")',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click({ force: true });
          this.log(`[Payment] ✅ Submit diklik: "${sel}"`);
          submitted = true;
          await randomDelay(5000, 7000);
          break;
        }
      } catch { }
    }
    if (!submitted) {
      this.log(`[Payment] ⚠️ Tombol submit tidak ditemukan`);
    }

    const finalURL = page.url();
    const finalText = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
    this.log(`[Payment] 🌐 URL akhir: ${finalURL}`);
    this.log(`[Payment] 📄 Konten akhir: ${finalText.slice(0, 150)}`);
    this.log(`[Payment] ✅ Proses payment selesai`);
  }
}
