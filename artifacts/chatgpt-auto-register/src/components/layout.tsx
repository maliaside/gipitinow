import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Globe,
  PlayCircle,
  Settings,
  TerminalSquare,
  UserPlus,
  Zap,
  Menu,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { name: "Dashboard",       href: "/",        icon: LayoutDashboard },
  { name: "Auto Register",   href: "/auto",    icon: Zap },
  { name: "Manual Register", href: "/manual",  icon: UserPlus },
  { name: "Accounts",        href: "/accounts",icon: Users },
  { name: "Proxies",         href: "/proxies", icon: Globe },
  { name: "Tasks",           href: "/tasks",   icon: PlayCircle },
  { name: "Settings",        href: "/settings",icon: Settings },
];

// Bottom nav only shows most important 5 items
const bottomNavItems: NavItem[] = [
  { name: "Home",    href: "/",        icon: LayoutDashboard },
  { name: "Auto",   href: "/auto",    icon: Zap },
  { name: "Manual", href: "/manual",  icon: UserPlus },
  { name: "Akun",   href: "/accounts",icon: Users },
  { name: "Seting", href: "/settings",icon: Settings },
];

function SidebarContent({ location, onClose }: { location: string; onClose?: () => void }) {
  return (
    <>
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
          <TerminalSquare className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-lg leading-tight text-gradient">AutoReg</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">ChatGPT Edition</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-4 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href} onClick={onClose}>
              <div className={`
                flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-300 group relative
                ${isActive ? "text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}
              `}>
                {isActive && (
                  <motion.div
                    layoutId="active-nav-sidebar"
                    className="absolute inset-0 bg-gradient-to-r from-primary/20 to-transparent border-l-2 border-primary rounded-xl"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon className={`w-5 h-5 relative z-10 transition-colors shrink-0 ${isActive ? "text-primary" : "group-hover:text-primary/70"}`} />
                <span className="font-medium relative z-10 truncate">{item.name}</span>
                {item.href === "/auto" && !isActive && (
                  <span className="ml-auto relative z-10 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-semibold uppercase tracking-wide">
                    New
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 m-4 rounded-xl bg-white/5 border border-white/5 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">System Status</span>
        </div>
        <p className="text-sm font-medium text-white">All systems operational</p>
      </div>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentItem = navItems.find(n => n.href === location);

  return (
    <div className="min-h-screen w-full flex bg-background relative overflow-hidden text-foreground">
      {/* Dynamic Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={`${import.meta.env.BASE_URL}images/dark-mesh-bg.png`}
          alt="Background"
          className="w-full h-full object-cover opacity-20 mix-blend-screen"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
      </div>

      {/* Desktop Sidebar */}
      <aside className="w-64 glass-panel border-r border-white/5 relative z-10 hidden md:flex flex-col shrink-0">
        <SidebarContent location={location} />
      </aside>

      {/* Mobile Overlay Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed left-0 top-0 bottom-0 z-50 w-72 glass-panel border-r border-white/5 flex flex-col md:hidden"
            >
              <SidebarContent location={location} onClose={() => setMobileMenuOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative z-10 h-screen overflow-hidden min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden h-14 glass-panel border-b border-white/5 flex items-center px-4 gap-3 shrink-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 rounded-lg glass-button hover:bg-white/10 transition-colors"
            aria-label="Buka menu"
          >
            <Menu className="w-5 h-5 text-white" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <TerminalSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="font-display font-bold truncate">
              {currentItem?.name ?? "AutoReg"}
            </span>
          </div>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-white/5 backdrop-blur-xl bg-background/90">
        <div className="flex items-stretch">
          {bottomNavItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href} className="flex-1">
                <div className={`
                  flex flex-col items-center justify-center gap-1 py-2.5 px-1 relative transition-colors
                  ${isActive ? "text-primary" : "text-muted-foreground"}
                `}>
                  {isActive && (
                    <motion.div
                      layoutId="active-bottom-nav"
                      className="absolute inset-x-1 top-0 h-0.5 bg-primary rounded-full"
                      initial={false}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                  {item.href === "/auto" ? (
                    <div className={`relative ${isActive ? "" : ""}`}>
                      <item.icon className="w-5 h-5" />
                      {!isActive && (
                        <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                  ) : (
                    <item.icon className="w-5 h-5" />
                  )}
                  <span className="text-[10px] font-medium leading-none">{item.name}</span>
                </div>
              </Link>
            );
          })}
        </div>
        {/* iOS safe area padding */}
        <div className="h-safe-area-inset-bottom" style={{ height: "env(safe-area-inset-bottom)" }} />
      </nav>
    </div>
  );
}
