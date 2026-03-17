import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Play,
  StopCircle,
  Send,
  Mail,
  Lock,
  KeyRound,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  UserCheck,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

type SessionStatus =
  | "idle"
  | "starting"
  | "filling_email"
  | "filling_password"
  | "waiting_code"
  | "filling_code"
  | "filling_profile"
  | "success"
  | "failed"
  | "cancelled";

interface Session {
  id: string;
  email: string;
  password: string;
  status: SessionStatus;
  logs: string[];
  createdAt: string;
  waitingForCode: boolean;
}

const statusConfig: Record<SessionStatus, { label: string; color: string; icon: any }> = {
  idle:            { label: "准备中",     color: "text-slate-400",   icon: Loader2 },
  starting:        { label: "启动浏览器", color: "text-blue-400",    icon: Loader2 },
  filling_email:   { label: "填写邮箱",   color: "text-indigo-400",  icon: Loader2 },
  filling_password:{ label: "填写密码",   color: "text-violet-400",  icon: Loader2 },
  waiting_code:    { label: "等待验证码", color: "text-amber-400",   icon: AlertCircle },
  filling_code:    { label: "填写验证码", color: "text-orange-400",  icon: Loader2 },
  filling_profile: { label: "填写资料",   color: "text-cyan-400",    icon: Loader2 },
  success:         { label: "注册成功",   color: "text-emerald-400", icon: CheckCircle2 },
  failed:          { label: "注册失败",   color: "text-rose-400",    icon: XCircle },
  cancelled:       { label: "已取消",     color: "text-slate-500",   icon: XCircle },
};

const isTerminal = (s: SessionStatus) => ["success", "failed", "cancelled"].includes(s);
const isRunning  = (s: SessionStatus) => !["idle", "success", "failed", "cancelled"].includes(s);

export function Manual() {
  const { toast } = useToast();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession]   = useState<Session | null>(null);
  const [code, setCode]         = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef  = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [session?.logs]);

  // Poll session status
  useEffect(() => {
    if (!session?.id) return;
    if (isTerminal(session.status)) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/manual/register/${session.id}`);
        if (res.ok) {
          const data: Session = await res.json();
          setSession(data);
          if (isTerminal(data.status)) {
            clearInterval(pollRef.current!);
          }
        }
      } catch { }
    }, 2000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [session?.id]);

  const startRegistration = async () => {
    if (!email.trim()) {
      toast({ title: "Masukkan email dulu", variant: "destructive" });
      return;
    }
    setStarting(true);
    setSession(null);
    try {
      const res = await fetch(`${API_BASE}/manual/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      if (!res.ok) throw new Error("Failed to start");
      const data: Session = await res.json();
      setSession(data);
      setCode("");
    } catch {
      toast({ title: "Gagal memulai registrasi", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const handleSubmitCode = async () => {
    if (!session || !code.trim()) return;
    setSubmittingCode(true);
    try {
      const res = await fetch(`${API_BASE}/manual/register/${session.id}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Kode berhasil dikirim" });
      setCode("");
    } catch {
      toast({ title: "Gagal mengirim kode", variant: "destructive" });
    } finally {
      setSubmittingCode(false);
    }
  };

  const handleCancel = async () => {
    if (!session) return;
    await fetch(`${API_BASE}/manual/register/${session.id}/cancel`, { method: "POST" });
    setSession(s => s ? { ...s, status: "cancelled" } : s);
  };

  const cfg = session ? statusConfig[session.status] : null;
  const StatusIcon = cfg?.icon;

  return (
    <Layout>
      <div className="space-y-8 max-w-2xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">
            Manual Register
          </h1>
          <p className="text-muted-foreground text-lg">
            Masukkan emailmu sendiri dan lihat bot bekerja secara real-time.
          </p>
        </div>

        {/* Input Form */}
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Mail className="w-4 h-4" /> Alamat Email
              </label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="kamu@example.com"
                className="bg-background border-white/10 focus-visible:ring-primary/50 text-white"
                disabled={!!session && !isTerminal(session.status)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Lock className="w-4 h-4" /> Password ChatGPT
                <span className="text-xs text-muted-foreground">(opsional, akan digenerate otomatis)</span>
              </label>
              <Input
                type="text"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Biarkan kosong untuk auto-generate"
                className="bg-background border-white/10 focus-visible:ring-primary/50 text-white font-mono"
                disabled={!!session && !isTerminal(session.status)}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20"
              onClick={startRegistration}
              disabled={starting || (!!session && !isTerminal(session.status))}
            >
              {starting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Memulai...</>
              ) : (
                <><Play className="w-4 h-4 mr-2" /> Mulai Registrasi</>
              )}
            </Button>
            {session && !isTerminal(session.status) && (
              <Button
                variant="outline"
                className="bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
                onClick={handleCancel}
              >
                <StopCircle className="w-4 h-4 mr-2" /> Batalkan
              </Button>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <AnimatePresence>
          {session && cfg && StatusIcon && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass-panel rounded-2xl p-4 flex items-center gap-4 border ${
                session.status === "success"    ? "border-emerald-500/20" :
                session.status === "failed"     ? "border-rose-500/20" :
                session.status === "waiting_code"? "border-amber-500/30" :
                "border-primary/20"
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                session.status === "success"    ? "bg-emerald-500/10" :
                session.status === "failed"     ? "bg-rose-500/10" :
                session.status === "waiting_code"? "bg-amber-500/10" :
                "bg-primary/10"
              }`}>
                <StatusIcon className={`w-5 h-5 ${cfg.color} ${isRunning(session.status) && session.status !== "waiting_code" ? "animate-spin" : ""}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${cfg.color}`}>{cfg.label}</span>
                  {session.status === "success" && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Akun tersimpan</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {session.email} {session.password ? `• Password: ${session.password}` : ""}
                </p>
              </div>
              {session.status === "success" && (
                <UserCheck className="w-6 h-6 text-emerald-400" />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Verification Code Input */}
        <AnimatePresence>
          {session?.waitingForCode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-panel rounded-2xl p-6 border border-amber-500/30 bg-amber-500/5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-amber-400 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-semibold text-amber-400">Bot menunggu kode verifikasi</h3>
                  <p className="text-sm text-muted-foreground">
                    Cek inbox <span className="text-white font-medium">{session.email}</span>, copy kode 6 digit yang dikirim OpenAI
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  maxLength={6}
                  className="bg-background border-amber-500/30 focus-visible:ring-amber-500/50 text-white font-mono text-xl tracking-widest text-center"
                  onKeyDown={e => { if (e.key === "Enter" && code.length === 6) handleSubmitCode(); }}
                />
                <Button
                  className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-6"
                  onClick={handleSubmitCode}
                  disabled={code.length < 4 || submittingCode}
                >
                  {submittingCode ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live Log Terminal */}
        <AnimatePresence>
          {session && session.logs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel rounded-2xl overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <Terminal className="w-4 h-4 text-primary" />
                <span className="text-sm font-mono font-medium text-muted-foreground">Bot Log</span>
                <div className="ml-auto flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
                </div>
              </div>
              <div
                ref={logRef}
                className="p-4 h-80 overflow-y-auto font-mono text-xs space-y-1 custom-scrollbar bg-black/30"
              >
                {session.logs.map((line, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`leading-relaxed ${
                      line.includes("❌") || line.includes("失败") ? "text-rose-400" :
                      line.includes("✅") || line.includes("成功") || line.includes("🎉") ? "text-emerald-400" :
                      line.includes("⚠️") ? "text-amber-400" :
                      line.includes("⏳") || line.includes("等待") ? "text-amber-300" :
                      line.includes("🔢") || line.includes("验证码") ? "text-orange-300" :
                      "text-slate-300"
                    }`}
                  >
                    {line}
                  </motion.div>
                ))}
                {isRunning(session.status) && (
                  <div className="flex items-center gap-2 text-primary">
                    <span className="inline-block w-2 h-3 bg-primary animate-pulse rounded-sm" />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
}
