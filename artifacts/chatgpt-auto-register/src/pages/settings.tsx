import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Save, CheckCircle, XCircle, Loader2, Mail, Globe, Key, Shield, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SettingsData {
  cloudmail_base_url: string;
  cloudmail_admin_email: string;
  cloudmail_admin_password: string;
  cloudmail_email_password: string;
  cloudmail_email_prefix: string;
  chatgpt_default_password: string;
  local_proxy_url: string;
  cc_number: string;
}

const defaultSettings: SettingsData = {
  cloudmail_base_url: "",
  cloudmail_admin_email: "",
  cloudmail_admin_password: "",
  cloudmail_email_password: "",
  cloudmail_email_prefix: "",
  chatgpt_default_password: "",
  local_proxy_url: "",
  cc_number: "",
};

export function Settings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingsData>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/settings`)
      .then(r => r.json())
      .then(data => { setSettings(prev => ({ ...prev, ...data })); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const update = (key: keyof SettingsData, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!resp.ok) throw new Error("Gagal menyimpan pengaturan");
      toast({ title: "✓ Pengaturan tersimpan", description: "Semua konfigurasi berhasil diperbarui." });
    } catch (err: any) {
      toast({ title: "Gagal menyimpan", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch(`${BASE}/api/settings/test-cloudmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: settings.cloudmail_base_url,
          adminEmail: settings.cloudmail_admin_email,
          adminPassword: settings.cloudmail_admin_password,
        }),
      });
      const data = await resp.json() as any;
      setTestResult({ ok: data.success, msg: data.message });
    } catch {
      setTestResult({ ok: false, msg: "Gagal terhubung ke jaringan" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  const SaveButton = () => (
    <Button
      onClick={handleSave}
      disabled={saving}
      className="bg-primary text-primary-foreground hover:opacity-90 w-full md:w-auto px-8"
    >
      {saving ? (
        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Menyimpan...</>
      ) : (
        <><Save className="w-4 h-4 mr-2" /> Simpan Pengaturan</>
      )}
    </Button>
  );

  return (
    <Layout>
      <div className="space-y-8 max-w-3xl pb-24">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Pengaturan</h1>
            <p className="text-muted-foreground text-lg">Konfigurasi Cloud Mail, proxy, dan parameter registrasi.</p>
          </div>
          <div>
            <SaveButton />
          </div>
        </div>

        {/* Cloud Mail Config */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-white/10">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Mail className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">📧 Cloud Mail — Server Email</h2>
              <p className="text-sm text-muted-foreground">Untuk membuat akun email otomatis dan menerima kode verifikasi</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/80">Alamat Server</label>
              <Input
                value={settings.cloudmail_base_url}
                onChange={e => update("cloudmail_base_url", e.target.value)}
                placeholder="https://your-domain.example.com"
                className="bg-black/30 border-white/10 text-white placeholder:text-white/30"
              />
              <p className="text-xs text-muted-foreground">URL API Cloud Mail kamu (harus dimulai dengan https://)</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-white/80">Email Admin</label>
                <Input
                  value={settings.cloudmail_admin_email}
                  onChange={e => update("cloudmail_admin_email", e.target.value)}
                  placeholder="admin@your-domain.com"
                  className="bg-black/30 border-white/10 text-white placeholder:text-white/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-white/80">Password Admin</label>
                <Input
                  type="password"
                  value={settings.cloudmail_admin_password}
                  onChange={e => update("cloudmail_admin_password", e.target.value)}
                  placeholder="Password admin Cloud Mail"
                  className="bg-black/30 border-white/10 text-white placeholder:text-white/30"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-white/80">Password Default Email Baru</label>
                <Input
                  type="password"
                  value={settings.cloudmail_email_password}
                  onChange={e => update("cloudmail_email_password", e.target.value)}
                  placeholder="Password untuk email yang dibuat otomatis"
                  className="bg-black/30 border-white/10 text-white placeholder:text-white/30"
                />
                <p className="text-xs text-muted-foreground">Semua akun email yang dibuat otomatis akan memakai password ini</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-white/80">Prefix Email (opsional)</label>
                <Input
                  value={settings.cloudmail_email_prefix}
                  onChange={e => update("cloudmail_email_prefix", e.target.value)}
                  placeholder="gpt (kosongkan untuk acak)"
                  className="bg-black/30 border-white/10 text-white placeholder:text-white/30"
                />
                <p className="text-xs text-muted-foreground">Contoh: prefix "gpt" → gpt1234@domain.com</p>
              </div>
            </div>

            {/* Test Connection */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Button
                onClick={handleTest}
                disabled={testing || !settings.cloudmail_base_url}
                variant="outline"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
              >
                {testing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Mengetes...</>
                ) : (
                  <><Globe className="w-4 h-4 mr-2" /> Test Koneksi</>
                )}
              </Button>
              {testResult && (
                <div className={`flex items-center gap-2 text-sm ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
                  {testResult.ok
                    ? <CheckCircle className="w-4 h-4" />
                    : <XCircle className="w-4 h-4" />}
                  {testResult.msg}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ChatGPT Config */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-white/10">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Key className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">🤖 Konfigurasi ChatGPT</h2>
              <p className="text-sm text-muted-foreground">Password untuk semua akun ChatGPT yang didaftarkan</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/80">Password Default Akun ChatGPT</label>
              <Input
                type="password"
                value={settings.chatgpt_default_password}
                onChange={e => update("chatgpt_default_password", e.target.value)}
                placeholder="Kosongkan untuk generate password kuat otomatis"
                className="bg-black/30 border-white/10 text-white placeholder:text-white/30"
              />
              <p className="text-xs text-muted-foreground">Semua akun ChatGPT yang didaftar akan memakai password ini (kosongkan = generate acak)</p>
            </div>
          </div>
        </div>

        {/* CC Payment Config */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-white/10">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <CreditCard className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">💳 Kartu Kredit Payment</h2>
              <p className="text-sm text-muted-foreground">Nomor CC manual — expiry &amp; CVV digenerate otomatis, alamat Korea Selatan acak</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/80">Nomor Kartu Kredit</label>
              <Input
                value={settings.cc_number}
                onChange={e => update("cc_number", e.target.value.replace(/\s/g, ""))}
                placeholder="4111111111111111"
                maxLength={19}
                className="bg-black/30 border-white/10 text-white placeholder:text-white/30 font-mono tracking-widest"
              />
              <p className="text-xs text-muted-foreground">
                Masukkan nomor CC tanpa spasi. Expiry (2034–2041) &amp; CVV (3 digit) digenerate acak otomatis.
                Alamat billing: Korea Selatan (data nyata, dipilih acak).
              </p>
            </div>
            <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3 text-xs text-purple-200/70 space-y-1">
              <p>🔐 <strong>Auto-generate saat payment:</strong></p>
              <p>• Expiry bulan/tahun: acak (2034–2041)</p>
              <p>• CVV: 3 digit acak</p>
              <p>• Billing address: alamat lengkap Korea Selatan (line1, district, city, province, postal)</p>
              <p>• Cardholder name: nama akun yang sama</p>
            </div>
          </div>
        </div>

        {/* Proxy Config */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-white/10">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <Shield className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">🪜 Konfigurasi Proxy Lokal</h2>
              <p className="text-sm text-muted-foreground">Proxy VPN lokal untuk mengakses ChatGPT</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/80">Alamat Proxy Lokal (opsional)</label>
              <Input
                value={settings.local_proxy_url}
                onChange={e => update("local_proxy_url", e.target.value)}
                placeholder="socks5://127.0.0.1:10808"
                className="bg-black/30 border-white/10 text-white placeholder:text-white/30"
              />
              <p className="text-xs text-muted-foreground">
                Isi jika server tidak bisa akses chatgpt.com langsung. Format: socks5://host:port atau http://host:port.
                Proxy residensial diatur di halaman Proxy.
              </p>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-6">
          <h3 className="text-base font-bold text-blue-300 mb-3">📖 Alur Proses Registrasi</h3>
          <ol className="space-y-1.5 text-sm text-blue-200/70 list-decimal list-inside">
            <li>Buat akun email otomatis via Cloud Mail API</li>
            <li>Jalankan browser Playwright Chromium (mode Headless)</li>
            <li>Inject plugin Stealth untuk bypass deteksi Cloudflare</li>
            <li>Isi email → password → tunggu kode verifikasi</li>
            <li>Polling Cloud Mail untuk ambil kode 6 digit dan isi otomatis</li>
            <li>Isi nama dan tanggal lahir yang digenerate acak</li>
            <li>Simpan akun ke database setelah berhasil registrasi</li>
          </ol>
        </div>

      </div>
    </Layout>
  );
}
