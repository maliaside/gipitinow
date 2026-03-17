export interface CloudMailConfig {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
  domain?: string;
}

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  date: string;
}

export class CloudMailClient {
  private config: CloudMailConfig;
  private token: string | null = null;
  private domain: string;

  private static CODE_PATTERNS = [
    /verification code[:\s]*(\d{6})/i,
    /verify[:\s]*(\d{6})/i,
    /code[:\s]+(\d{6})/i,
    /\b(\d{6})\b/,
  ];

  constructor(config: CloudMailConfig) {
    this.config = { ...config, baseUrl: config.baseUrl.replace(/\/$/, "") };
    this.domain = config.domain || config.adminEmail.split("@")[1];
  }

  async getToken(): Promise<string> {
    const resp = await fetch(`${this.config.baseUrl}/api/public/genToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: this.config.adminEmail,
        password: this.config.adminPassword,
      }),
    });
    if (!resp.ok) throw new Error(`Cloud Mail genToken HTTP error: ${resp.status}`);
    const data = await resp.json() as any;
    if (data.code !== 200) throw new Error(`Cloud Mail genToken failed: ${JSON.stringify(data)}`);
    this.token = data.data.token;
    return this.token!;
  }

  async ensureToken(): Promise<string> {
    if (!this.token) await this.getToken();
    return this.token!;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  async createMailbox(email: string, password: string): Promise<boolean> {
    const token = await this.ensureToken();
    const resp = await fetch(`${this.config.baseUrl}/api/public/addUser`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ list: [{ email, password }] }),
    });
    if (!resp.ok) throw new Error(`Cloud Mail addUser HTTP error: ${resp.status}`);
    const data = await resp.json() as any;
    if (data.code !== 200) throw new Error(`Cloud Mail addUser failed: ${JSON.stringify(data)}`);
    return true;
  }

  async deleteMailbox(email: string): Promise<boolean> {
    try {
      const token = await this.ensureToken();
      await fetch(`${this.config.baseUrl}/api/public/delUser`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ list: [email] }),
      });
      return true;
    } catch {
      return false;
    }
  }

  async waitForVerificationCode(
    email: string,
    emailPassword: string,
    maxWaitSeconds = 180,
    logFn?: (msg: string) => void
  ): Promise<string | null> {
    const log = logFn ?? console.log;
    const start = Date.now();
    let attempts = 0;

    while ((Date.now() - start) / 1000 < maxWaitSeconds) {
      attempts++;
      await sleep(8000);
      try {
        const messages = await this.fetchInbox(email, emailPassword);
        for (const msg of messages) {
          const text = `${msg.subject} ${msg.body}`;
          for (const pattern of CloudMailClient.CODE_PATTERNS) {
            const m = text.match(pattern);
            if (m) {
              log(`[邮件] ✓ 验证码: ${m[1]} (第${attempts}次轮询)`);
              return m[1];
            }
          }
        }
        log(`[邮件] 等待验证码... (${Math.round((Date.now() - start) / 1000)}s / ${maxWaitSeconds}s)`);
      } catch (err: any) {
        log(`[邮件] 轮询错误: ${err.message}`);
      }
    }
    return null;
  }

  private async fetchInbox(email: string, emailPassword: string): Promise<MailMessage[]> {
    const resp = await fetch(`${this.config.baseUrl}/api/public/getMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: emailPassword }),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    if (data.code !== 200) return [];
    return (data.data || []).map((m: any) => ({
      id: m.id || "",
      from: m.from || "",
      subject: m.subject || "",
      body: m.body || m.text || m.html || "",
      date: m.date || "",
    }));
  }

  async listUsers(page = 1, size = 50): Promise<any[]> {
    const token = await this.ensureToken();
    const resp = await fetch(
      `${this.config.baseUrl}/api/public/userList?page=${page}&size=${size}`,
      { headers: { Authorization: token } }
    );
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return data.data?.list || [];
  }

  getDomain(): string { return this.domain; }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
