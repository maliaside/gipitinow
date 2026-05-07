import { useGetStats } from "@workspace/api-client-react";
import { motion, type Variants } from "framer-motion";
import { Layout } from "@/components/layout";
import { 
  Users, 
  Activity, 
  AlertCircle, 
  Globe, 
  PlayCircle, 
  CheckCircle2,
  TrendingUp
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";

// Mock data for the chart to make the dashboard look stunning
const mockChartData = [
  { name: 'Mon', success: 400, failed: 24 },
  { name: 'Tue', success: 300, failed: 13 },
  { name: 'Wed', success: 550, failed: 48 },
  { name: 'Thu', success: 200, failed: 8 },
  { name: 'Fri', success: 700, failed: 60 },
  { name: 'Sat', success: 850, failed: 35 },
  { name: 'Sun', success: 920, failed: 40 },
];

export function Dashboard() {
  const { data: stats, isLoading, isError } = useGetStats();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { type: "spring", stiffness: 300, damping: 24 }
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (isError || !stats) {
    return (
      <Layout>
        <div className="p-6 rounded-2xl glass-panel border-destructive/20 text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Failed to load statistics</h2>
          <p className="text-muted-foreground">Please check your backend connection.</p>
        </div>
      </Layout>
    );
  }

  const statCards = [
    {
      title: "Total Accounts",
      value: stats.totalAccounts,
      icon: Users,
      color: "from-blue-500 to-cyan-400",
      trend: "+12.5%"
    },
    {
      title: "Active Proxies",
      value: `${stats.activeProxies} / ${stats.totalProxies}`,
      icon: Globe,
      color: "from-emerald-500 to-teal-400",
      trend: "Stable"
    },
    {
      title: "Running Tasks",
      value: stats.runningTasks,
      icon: PlayCircle,
      color: "from-purple-500 to-indigo-400",
      trend: "Active"
    },
    {
      title: "Success Rate",
      value: `${(stats.successRate ?? 0).toFixed(1)}%`,
      icon: Activity,
      color: "from-orange-500 to-amber-400",
      trend: "+2.1%"
    }
  ];

  return (
    <Layout>
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-8"
      >
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2">Overview</h1>
          <p className="text-muted-foreground text-lg">Monitor your registration pipeline in real-time.</p>
        </div>

        {/* Top Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {statCards.map((stat, i) => (
            <motion.div key={i} variants={itemVariants} className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r opacity-0 group-hover:opacity-10 transition-opacity duration-500 rounded-3xl blur-xl" style={{ backgroundImage: `var(--tw-gradient-stops)` }} />
              <div className="relative p-6 rounded-3xl glass-panel overflow-hidden group-hover:border-white/10 transition-colors duration-300">
                <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${stat.color} opacity-10 rounded-bl-full`} />
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <div className={`p-3 rounded-2xl bg-gradient-to-br ${stat.color} bg-opacity-10 shadow-lg`}>
                    <stat.icon className="w-6 h-6 text-white" />
                  </div>
                  <span className="flex items-center text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    {stat.trend}
                  </span>
                </div>
                <div className="relative z-10">
                  <h3 className="text-muted-foreground font-medium mb-1">{stat.title}</h3>
                  <div className="text-3xl font-display font-bold text-white tracking-tight">{stat.value}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Main Chart Area */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-6 rounded-3xl glass-panel">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-display font-bold text-white">Registration Performance</h3>
                <p className="text-sm text-muted-foreground">Successful vs Failed attempts over the last 7 days</p>
              </div>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', backdropFilter: 'blur(10px)' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="success" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorSuccess)" />
                  <Area type="monotone" dataKey="failed" stroke="hsl(var(--destructive))" strokeWidth={3} fillOpacity={1} fill="url(#colorFailed)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Quick Info Sidebar */}
          <div className="p-6 rounded-3xl glass-panel flex flex-col justify-between">
            <div>
              <h3 className="text-xl font-display font-bold text-white mb-6">Status Overview</h3>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground font-medium">Account Health</span>
                    <span className="text-emerald-400 font-bold">{stats.activeAccounts} Active</span>
                  </div>
                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 rounded-full" 
                      style={{ width: `${(stats.activeAccounts / Math.max(1, stats.totalAccounts)) * 100}%` }}
                    />
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground font-medium">Failed Accounts</span>
                    <span className="text-destructive font-bold">{stats.failedAccounts} Needs action</span>
                  </div>
                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-red-500 to-rose-400 rounded-full" 
                      style={{ width: `${(stats.failedAccounts / Math.max(1, stats.totalAccounts)) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">System Readiness</p>
                      <p className="text-lg font-bold text-white">Optimal</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </Layout>
  );
}
