const PROXY_LIST_URL =
  "https://raw.githubusercontent.com/maliaside/xymalfilepxy/main/myprox.txt";

// Stripe + hCaptcha bypass proxy → pakai Replit IP
export const STRIPE_BYPASS =
  "js.stripe.com,m.stripe.network,b.stripecdn.com,api.stripe.com,hooks.stripe.com,newassets.hcaptcha.com,accounts.hcaptcha.com";

export function parseProxyUrl(
  raw: string
): { server: string; username?: string; password?: string } | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    return {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
    };
  } catch {
    return { server: raw.trim() };
  }
}

async function fetchProxyLines(): Promise<string[]> {
  const ts = Date.now();
  const resp = await fetch(`${PROXY_LIST_URL}?t=${ts}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

export async function fetchRandomProxy(): Promise<
  { server: string; username?: string; password?: string } | undefined
> {
  try {
    const lines = await fetchProxyLines();
    if (lines.length === 0) {
      console.warn("[Proxy] List kosong dari GitHub");
      return undefined;
    }
    const picked = lines[Math.floor(Math.random() * lines.length)];
    console.log(`[Proxy] Dipilih secara random (${lines.length} tersedia): ${picked}`);
    return parseProxyUrl(picked);
  } catch (e) {
    console.error(`[Proxy] Gagal fetch proxy list: ${e}`);
    return undefined;
  }
}

export async function fetchRandomProxyRaw(): Promise<string | null> {
  try {
    const lines = await fetchProxyLines();
    if (lines.length === 0) {
      console.warn("[Proxy] List kosong dari GitHub");
      return null;
    }
    const picked = lines[Math.floor(Math.random() * lines.length)];
    console.log(`[Proxy] Dipilih secara random (${lines.length} tersedia): ${picked}`);
    return picked;
  } catch (e) {
    console.error(`[Proxy] Gagal fetch proxy list: ${e}`);
    return null;
  }
}
