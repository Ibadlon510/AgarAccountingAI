import { Link, useLocation } from "wouter";
import { LayoutDashboard, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/rates", label: "Exchange Rates", icon: Coins },
  ];

  return (
    <div className="flex min-h-screen w-full bg-background font-sans text-foreground">
      <aside className="w-64 border-r bg-sidebar shrink-0 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <div className="font-bold text-lg tracking-tight text-sidebar-foreground">
            AgarAccounting AI<span className="text-primary ml-1">Admin</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                location === item.href
                  ? "bg-sidebar-border text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-border/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-sidebar-border text-xs text-muted-foreground font-mono">
          System Admin Console v1.0
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-h-screen overflow-auto bg-muted/30">
        {children}
      </main>
    </div>
  );
}
