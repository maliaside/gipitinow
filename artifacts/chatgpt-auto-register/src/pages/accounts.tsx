import { useState } from "react";
import { 
  useListAccounts, 
  useDeleteAccount, 
  useCreateAccount,
  getListAccountsQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  Trash2, 
  Plus, 
  Download, 
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
  Users
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const createAccountSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  notes: z.string().optional(),
});

type CreateAccountForm = z.infer<typeof createAccountSchema>;

const statusConfig = {
  active: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" },
  failed: { icon: XCircle, color: "text-rose-400", bg: "bg-rose-400/10", border: "border-rose-400/20" },
  pending: { icon: Clock, color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
  unverified: { icon: HelpCircle, color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20" },
};

export function Accounts() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: accounts = [], isLoading } = useListAccounts();
  
  const deleteMutation = useDeleteAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        toast({ title: "Account deleted successfully" });
      },
      onError: () => toast({ title: "Failed to delete account", variant: "destructive" })
    }
  });

  const createMutation = useCreateAccount({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        setIsDialogOpen(false);
        reset();
        toast({ title: "Account added manually" });
      },
      onError: () => toast({ title: "Failed to add account", variant: "destructive" })
    }
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateAccountForm>({
    resolver: zodResolver(createAccountSchema)
  });

  const onSubmit = (data: CreateAccountForm) => {
    createMutation.mutate({ data });
  };

  const handleExport = async () => {
    try {
      const res = await fetch('/api/accounts/export');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accounts_export_${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const filteredAccounts = accounts.filter(acc => 
    acc.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">Accounts</h1>
            <p className="text-muted-foreground text-lg">Manage your registered ChatGPT profiles.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <Button 
              variant="outline" 
              onClick={handleExport}
              className="glass-button text-white"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Account
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-card border-white/10 text-foreground">
                <DialogHeader>
                  <DialogTitle className="text-xl font-display">Add Manual Account</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Email Address</label>
                    <Input 
                      {...register("email")} 
                      placeholder="account@example.com"
                      className="bg-background border-white/10 focus-visible:ring-primary/50 text-white"
                    />
                    {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Password</label>
                    <Input 
                      {...register("password")} 
                      type="password"
                      placeholder="••••••••"
                      className="bg-background border-white/10 focus-visible:ring-primary/50 text-white"
                    />
                    {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Notes (Optional)</label>
                    <Input 
                      {...register("notes")} 
                      placeholder="e.g. Created manually"
                      className="bg-background border-white/10 focus-visible:ring-primary/50 text-white"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full bg-primary hover:bg-primary/90"
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? "Adding..." : "Add Account"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="glass-panel rounded-3xl overflow-hidden flex flex-col border border-white/5 shadow-2xl">
          <div className="p-4 border-b border-white/5 bg-white/[0.02]">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-black/20 border-white/5 text-white focus-visible:ring-primary/30 rounded-xl"
              />
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.01] text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  <th className="p-4 pl-6">Email</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Proxy Used</th>
                  <th className="p-4">Created Date</th>
                  <th className="p-4 text-right pr-6">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      Loading accounts...
                    </td>
                  </tr>
                ) : filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/5 mb-4">
                        <Users className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <h3 className="text-lg font-medium text-white">No accounts found</h3>
                      <p className="text-muted-foreground">Start a task or add one manually.</p>
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((acc, i) => {
                    const StatusIcon = statusConfig[acc.status].icon;
                    return (
                      <motion.tr 
                        key={acc.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="p-4 pl-6 font-medium text-white">{acc.email}</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusConfig[acc.status].bg} ${statusConfig[acc.status].color} ${statusConfig[acc.status].border}`}>
                            <StatusIcon className="w-3.5 h-3.5" />
                            <span className="capitalize">{acc.status}</span>
                          </span>
                        </td>
                        <td className="p-4 text-muted-foreground text-sm">
                          {acc.proxyUsed ? <span className="font-mono">{acc.proxyUsed}</span> : "None"}
                        </td>
                        <td className="p-4 text-muted-foreground text-sm">
                          {format(new Date(acc.createdAt), 'MMM dd, yyyy HH:mm')}
                        </td>
                        <td className="p-4 pr-6 text-right">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            onClick={() => {
                              if(confirm('Delete this account permanently?')) {
                                deleteMutation.mutate({ id: acc.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
