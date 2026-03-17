import { useState, useEffect, useRef, useCallback } from "react";
import { Layout } from "@/components/layout";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Play,
  StopCircle,
  Mail,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Trash2,
  AlertTriangle,
  BadgeCheck,
  Monitor,
  ExternalLink,
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
  | "waiting_human_submit"
  | "success"
  | "failed"
  | "cancelled";

interface AutoSession {
  id: string;
  email: string;
  password: string;
  status: SessionStatus;
  logs: string[];
  createdAt: string;
  autoMode: boolean;
  vncUrl?: string;
}

const statusConfig: Record<SessionStatus, { label: string; color: string; bg: string; icon: any; spin?: boolean }> = {
  idle:                 { label: "Antri",              color: "text-slate-400",   bg: "bg-slate-500/10",    icon: Loader2,    spin: true },
  starting:             { label: "Mulai",              color: "text-blue-400",    bg: "bg-blue-500/10",     icon: Loader2,    spin: true },
  filling_email:        { label: "Isi Email",          color: "text-indigo-400",  bg: "bg-indigo-500/10",   icon: Loader2,    spin: true },
  filling_password:     { label: "Isi Password",       color: "text-violet-400",  bg: "bg-violet-500/10",   icon: Loader2,    spin: true },
  waiting_code:         { label: "Ambil OTP",          color: "text-amber-400",   bg: "bg-amber-500/10",    icon: Zap,        spin: true },
  filling_code:         { label: "Isi OTP",            color: "text-orange-400",  bg: "bg-orange-500/10",   icon: Loader2,    spin: true },
  filling_profile:      { label: "Isi Profil",         color: "text-cyan-400",    bg: "bg-cyan-500/10",     icon: Loader2,    spin: true },
  waiting_human_submit: { label: "⏸ Klik Subscribe!", color: "text-yellow-300",  bg: "bg-yellow-400/10",   icon: Monitor,    spin: false },
  success:              { label: "Berhasil ✓",         color: "text-emerald-400", bg: "bg-emerald-500/10",  icon: CheckCircle2 },
  failed:               { label: "Gagal",              color: "text-rose-400",    bg: "bg-rose-500/10",     icon: XCircle },
  cancelled:            { label: "Dibatalkan",         color: "text-slate-500",   bg: "bg-slate-500/10",    icon: XCircle },
};

const isTerminal = (s: SessionStatus) => ["success", "failed", "cancelled"].includes(s);
const isRunning  = (s: SessionStatus) => !["idle", "success", "failed", "cancelled"].includes(s);

function SessionCard({ session, onCancel }: { session: AutoSession; onCancel: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const cfg = statusConfig[session.status];
  const Icon = cfg.icon;

  useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [session.logs, expanded]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`glass-panel rounded-xl border ${
        session.status === "success"              ? "border-emerald-500/20" :
        session.status === "failed"               ? "border-rose-500/20" :
        session.status === "waiting_code"         ? "border-amber-500/30" :
        session.status === "waiting_human_submit" ? "border-yellow-400/40" :
        "border-white/5"
      } overflow-hidden`}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}>
          <Icon className={`w-4 h-4 ${cfg.color} ${cfg.spin && isRunning(session.status) ? "animate-spin" : ""}`} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono text-white truncate">{session.email}</p>
          <p className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</p>
        </div>

        <div className="flex items-center gap-2">
          {isRunning(session.status) && (
            <button
              onClick={e => { e.stopPropagation(); onCancel(session.id); }}
              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
            >
              <StopCircle className="w-3.5 h-3.5" />
            </button>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {session.status === "waiting_human_submit" && session.vncUrl && (
        <div className="px-4 pb-3 pt-1">
          <div className="rounded-lg bg-yellow-400/10 border border-yellow-400/30 p-3 space-y-2">
            <p className="text-xs font-semibold text-yellow-300 flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5" />
              Form Payment Siap — Klik Subscribe Manual
            </p>
            <p className="text-[11px] text-yellow-200/70">
              Semua field sudah terisi (CC, alamat Korea, seats). Buka VNC browser di bawah,
              lalu klik tombol <strong>Subscribe</strong> dan selesaikan hCaptcha jika muncul.
            </p>
            <a
              href={session.vncUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-2 w-full justify-center rounded-md bg-yellow-400/20 hover:bg-yellow-400/30 border border-yellow-400/40 text-yellow-200 text-xs font-medium py-2 transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" />
              Buka VNC Browser
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          </div>
        </div>
      )}

      <AnimatePresence>
        {expanded && session.logs.length > 0 && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5">
              <div
                ref={logRef}
                className="p-3 max-h-48 overflow-y-auto font-mono text-[11px] space-y-0.5 bg-black/30 custom-scrollbar"
              >
                {session.logs.map((line, i) => (
                  <div key={i} className={`leading-relaxed ${
                    line.includes("❌") || line.includes("Gagal") || line.includes("gagal") ? "text-rose-400" :
                    line.includes("✅") || line.includes("Berhasil") || line.includes("🎉") ? "text-emerald-400" :
                    line.includes("⚠️") ? "text-amber-400" :
                    line.includes("⏳") || line.includes("Polling") ? "text-amber-300" :
                    line.includes("🔢") || line.includes("OTP") ? "text-orange-300" :
                    line.includes("🤖") ? "text-primary" :
                    "text-slate-300"
                  }`}>
                    {line}
                  </div>
                ))}
                {isRunning(session.status) && (
                  <span className="inline-block w-2 h-3 bg-primary animate-pulse rounded-sm" />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function Auto() {
  const { toast } = useToast();
  const [count, setCount]       = useState(1);
  const [sessions, setSessions] = useState<AutoSession[]>([]);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollAll = useCallback(async () => {
    if (sessions.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/auto/sessions`);
      if (res.ok) {
        const data: AutoSession[] = await res.json();
        setSessions(data);
        const allDone = data.every(s => isTerminal(s.status));
        if (allDone && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch { }
  }, [sessions.length]);

  useEffect(() => {
    const hasActive = sessions.some(s => isRunning(s.status));
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(pollAll, 2500);
    }
    return () => {
      if (pollRef.current && !hasActive) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [sessions, pollAll]);

  useEffect(() => {
    fetch(`${API_BASE}/auto/sessions`)
      .then(r => r.ok ? r.json() : [])
      .then(setSessions)
      .catch(() => {});
  }, []);

  const startBatch = async () => {
    if (count < 1) return;
    setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/auto/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      if (!res.ok) throw new Error("Gagal memulai");
      const newSessions: AutoSession[] = await res.json();
      setSessions(prev => {
        const ids = new Set(prev.map(s => s.id));
        const added = newSessions.filter((s: AutoSession) => !ids.has(s.id) && s.id);
        return [...added, ...prev];
      });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(pollAll, 2500);
      toast({ title: `✅ ${newSessions.filter((s: any) => s.id).length} sesi dimulai` });
    } catch {
      toast({ title: "Gagal memulai auto register", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const cancelSession = async (id: string) => {
    await fetch(`${API_BASE}/auto/sessions/${id}`, { method: "DELETE" });
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status: "cancelled" as SessionStatus } : s));
  };

  const cancelAll = async () => {
    await fetch(`${API_BASE}/auto/sessions`, { method: "DELETE" });
    setSessions(prev => prev.map(s => isRunning(s.status) ? { ...s, status: "cancelled" as SessionStatus } : s));
    toast({ title: "Semua sesi dibatalkan" });
  };

  const clearDone = () => {
    setSessions(prev => prev.filter(s => !isTerminal(s.status)));
  };

  const successCount  = sessions.filter(s => s.status === "success").length;
  const failedCount   = sessions.filter(s => s.status === "failed" || s.status === "cancelled").length;
  const runningCount  = sessions.filter(s => isRunning(s.status)).length;
  const hasActive     = runningCount > 0;

  return (
    <Layout>
      <div className="space-y-6 max-w-2xl mx-auto pb-24 md:pb-0">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center shadow-lg shadow-primary/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold text-white leading-tight">
                Auto Register
              </h1>
              <p className="text-sm text-muted-foreground">Email temporer mail.tm — OTP otomatis</p>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Mail className="w-4 h-4" /> Jumlah Akun
              </label>
              <Input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={e => setCount(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                className="bg-background border-white/10 focus-visible:ring-primary/50 text-white font-mono w-32"
                disabled={hasActive}
              />
            </div>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20 px-6"
              onClick={startBatch}
              disabled={starting || hasActive}
            >
              {starting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Memulai...</>
              ) : (
                <><Play className="w-4 h-4 mr-2" /> Mulai</>
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 border border-primary/10 rounded-xl px-3 py-2">
            <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>Email dibuat otomatis via mail.tm · OTP diambil otomatis · Proxy Korea aktif untuk promo</span>
          </div>
        </div>

        {/* Stats */}
        {sessions.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-panel rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-primary">{runningCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Berjalan</div>
            </div>
            <div className="glass-panel rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-emerald-400">{successCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Berhasil</div>
            </div>
            <div className="glass-panel rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-rose-400">{failedCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Gagal</div>
            </div>
          </div>
        )}

        {/* Action row */}
        {sessions.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={pollAll}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            {hasActive && (
              <button
                onClick={cancelAll}
                className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20"
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Hentikan Semua
              </button>
            )}
            {sessions.some(s => isTerminal(s.status)) && (
              <button
                onClick={clearDone}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Hapus Selesai
              </button>
            )}
            {successCount > 0 && (
              <div className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <BadgeCheck className="w-3.5 h-3.5" />
                {successCount} tersimpan ke Accounts
              </div>
            )}
          </div>
        )}

        {/* Session Cards */}
        <AnimatePresence mode="popLayout">
          {sessions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16 text-muted-foreground"
            >
              <Zap className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Belum ada sesi — atur jumlah akun dan klik Mulai</p>
            </motion.div>
          ) : (
            <div className="space-y-2">
              {sessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onCancel={cancelSession}
                />
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
}
