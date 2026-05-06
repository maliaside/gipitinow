import { useState } from "react";
import { 
  useListTasks,
  useCreateTask,
  useStartTask,
  useStopTask,
  useDeleteTask,
  getListTasksQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  Play, 
  Square, 
  Trash2, 
  Plus, 
  PlayCircle,
  Activity,
  CheckCircle,
  XCircle,
  Clock
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const createTaskSchema = z.object({
  name: z.string().min(1, "Name is required"),
  totalAccounts: z.coerce.number().min(1, "Must be at least 1"),
  useProxy: z.boolean().default(true),
  emailDomain: z.string().optional(),
});

type CreateTaskForm = z.infer<typeof createTaskSchema>;

const taskStatusConfig: Record<string, { icon: typeof Clock; color: string; border: string; animate?: string }> = {
  idle: { icon: Clock, color: "text-slate-400", border: "border-slate-400/20" },
  running: { icon: Activity, color: "text-primary", border: "border-primary/20", animate: "animate-pulse" },
  paused: { icon: Square, color: "text-amber-400", border: "border-amber-400/20" },
  completed: { icon: CheckCircle, color: "text-emerald-400", border: "border-emerald-400/20" },
  failed: { icon: XCircle, color: "text-rose-400", border: "border-rose-400/20" },
};

export function Tasks() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Polling every 5 seconds to show progress updates
  const { data: tasks = [], isLoading } = useListTasks({
    query: { queryKey: getListTasksQueryKey(), refetchInterval: 5000 }
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });

  const createMutation = useCreateTask({
    mutation: {
      onSuccess: () => { invalidate(); setIsDialogOpen(false); reset(); toast({ title: "Task created" }); },
      onError: () => toast({ title: "Creation failed", variant: "destructive" })
    }
  });

  const startMutation = useStartTask({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Task started" }); }
    }
  });

  const stopMutation = useStopTask({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Task stopped" }); }
    }
  });

  const deleteMutation = useDeleteTask({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Task deleted" }); }
    }
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<CreateTaskForm>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { useProxy: true }
  });

  const useProxyWatch = watch("useProxy");

  const onSubmit = (data: CreateTaskForm) => {
    createMutation.mutate({ data });
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">Automations</h1>
            <p className="text-muted-foreground text-lg">Configure and run bulk registration pipelines.</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" />
                New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-white/10 text-foreground">
              <DialogHeader>
                <DialogTitle className="text-xl font-display">Create Registration Task</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Task Name</label>
                  <Input 
                    {...register("name")} 
                    placeholder="Batch Run #001"
                    className="bg-background border-white/10 focus-visible:ring-primary/50 text-white"
                  />
                  {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Amount to Register</label>
                  <Input 
                    type="number"
                    {...register("totalAccounts")} 
                    placeholder="100"
                    className="bg-background border-white/10 focus-visible:ring-primary/50 text-white"
                  />
                  {errors.totalAccounts && <p className="text-xs text-destructive">{errors.totalAccounts.message}</p>}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Email Domain (Optional)</label>
                  <Input 
                    {...register("emailDomain")} 
                    placeholder="customdomain.com"
                    className="bg-background border-white/10 focus-visible:ring-primary/50 text-white"
                  />
                  <p className="text-[10px] text-muted-foreground">Leave blank to use temporary random emails.</p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-white">Use Proxies</label>
                    <p className="text-[11px] text-muted-foreground">Route requests through proxy pool</p>
                  </div>
                  <Switch 
                    checked={useProxyWatch} 
                    onCheckedChange={(c) => setValue("useProxy", c)} 
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating..." : "Create Task"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-4">
          {isLoading ? (
             Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-32 glass-panel rounded-2xl animate-pulse bg-white/5" />
            ))
          ) : tasks.length === 0 ? (
            <div className="p-16 text-center glass-panel rounded-3xl border border-dashed border-white/10">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-6 border border-primary/20 shadow-xl shadow-primary/10">
                <PlayCircle className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-2xl font-display font-bold text-white mb-2">No Active Tasks</h3>
              <p className="text-muted-foreground max-w-md mx-auto">Create a new task to start registering accounts automatically in the background.</p>
            </div>
          ) : (
            tasks.map((task, i) => {
              const status = taskStatusConfig[task.status];
              const StatusIcon = status.icon;
              const totalProcessed = task.successCount + task.failedCount;
              const progressPercentage = task.totalAccounts > 0 ? (totalProcessed / task.totalAccounts) * 100 : 0;
              
              const isRunning = task.status === 'running';

              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row gap-6 relative overflow-hidden group"
                >
                  {isRunning && (
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary animate-pulse" />
                  )}

                  <div className="flex-1 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-white flex items-center gap-3">
                          {task.name}
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold border ${status.border} ${status.color} bg-white/5`}>
                            <StatusIcon className={`w-3 h-3 ${status.animate || ''}`} />
                            {task.status}
                          </span>
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Created {format(new Date(task.createdAt), 'MMM dd, yyyy HH:mm')}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground font-medium">Progress</span>
                        <span className="text-white font-mono">{totalProcessed} / {task.totalAccounts}</span>
                      </div>
                      <div className="h-3 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                        <div 
                          className="h-full bg-gradient-to-r from-primary to-indigo-400 transition-all duration-1000 ease-out"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-emerald-400">{task.successCount} Successful</span>
                        <span className="text-rose-400">{task.failedCount} Failed</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-row md:flex-col gap-2 justify-end min-w-[120px] md:border-l border-white/10 md:pl-6">
                    {isRunning ? (
                      <Button 
                        variant="outline" 
                        className="w-full bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                        onClick={() => stopMutation.mutate({ id: task.id })}
                        disabled={stopMutation.isPending}
                      >
                        <Square className="w-4 h-4 mr-2" /> Stop
                      </Button>
                    ) : (
                      <Button 
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
                        onClick={() => startMutation.mutate({ id: task.id })}
                        disabled={startMutation.isPending || task.status === 'completed'}
                      >
                        <Play className="w-4 h-4 mr-2" /> Start
                      </Button>
                    )}
                    
                    <Button 
                      variant="ghost" 
                      className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if(confirm('Delete this task?')) deleteMutation.mutate({ id: task.id });
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Delete
                    </Button>
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
