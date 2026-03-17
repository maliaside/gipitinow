import { useState } from "react";
import { 
  useListProxies,
  useAddProxiesBatch,
  useDeleteProxy,
  getListProxiesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { motion } from "framer-motion";
import { Globe, Plus, Trash2, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const proxyStatusConfig = {
  active: { icon: ShieldCheck, color: "text-emerald-400" },
  failed: { icon: ShieldAlert, color: "text-rose-400" },
  untested: { icon: Shield, color: "text-blue-400" }
};

export function Proxies() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [proxyText, setProxyText] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: proxies = [], isLoading } = useListProxies();

  const deleteMutation = useDeleteProxy({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProxiesQueryKey() });
        toast({ title: "Proxy deleted" });
      }
    }
  });

  const batchAddMutation = useAddProxiesBatch({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListProxiesQueryKey() });
        setIsDialogOpen(false);
        setProxyText("");
        toast({ 
          title: "Proxies processed", 
          description: `Added: ${data.added}, Failed format: ${data.failed}` 
        });
      },
      onError: () => toast({ title: "Failed to add proxies", variant: "destructive" })
    }
  });

  const handleBatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = proxyText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    batchAddMutation.mutate({ data: { proxies: lines } });
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">Proxy Pool</h1>
            <p className="text-muted-foreground text-lg">Manage residential and datacenter proxies.</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" />
                Add Proxies
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] bg-card border-white/10 text-foreground">
              <DialogHeader>
                <DialogTitle className="text-xl font-display">Batch Add Proxies</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleBatchSubmit} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground flex justify-between">
                    <span>Format: <code className="text-primary/80">host:port:user:pass</code></span>
                    <span>or <code className="text-primary/80">host:port</code></span>
                  </label>
                  <Textarea 
                    value={proxyText}
                    onChange={(e) => setProxyText(e.target.value)}
                    placeholder="192.168.1.1:8080:user1:pass1&#10;10.0.0.1:3128"
                    className="min-h-[200px] font-mono text-sm bg-background border-white/10 focus-visible:ring-primary/50 text-white resize-none"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={batchAddMutation.isPending || !proxyText.trim()}
                >
                  {batchAddMutation.isPending ? "Processing..." : "Import Proxies"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="h-32 glass-panel rounded-2xl animate-pulse bg-white/5" />
            ))
          ) : proxies.length === 0 ? (
            <div className="col-span-full p-12 text-center glass-panel rounded-3xl">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                <Globe className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-display font-medium text-white mb-2">Proxy pool is empty</h3>
              <p className="text-muted-foreground max-w-md mx-auto">Add proxies to ensure your registration tasks don't get rate-limited.</p>
            </div>
          ) : (
            proxies.map((proxy, i) => {
              const { icon: StatusIcon, color: statusColor } = proxyStatusConfig[proxy.status];
              return (
                <motion.div
                  key={proxy.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="p-5 rounded-2xl glass-panel group hover:border-primary/30 transition-all duration-300 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if(confirm('Delete this proxy?')) deleteMutation.mutate({ id: proxy.id });
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`p-2 rounded-xl bg-white/5 ${statusColor}`}>
                      <StatusIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{proxy.protocol}</span>
                      <h4 className="text-sm font-mono font-medium text-white">{proxy.host}:{proxy.port}</h4>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-4 text-xs">
                    <span className={`capitalize font-medium ${statusColor}`}>{proxy.status}</span>
                    <span className="text-muted-foreground">
                      {proxy.username ? "Auth required" : "No Auth"}
                    </span>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </Layout>
  );
}
