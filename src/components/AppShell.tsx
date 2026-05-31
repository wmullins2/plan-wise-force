import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, Sparkles, Users, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sites", label: "Sites", icon: Building2 },
  { to: "/ai", label: "AI Analysis", icon: Sparkles },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, profile, user } = useAuth();
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/login", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="p-5 border-b border-sidebar-border">
          <Link to="/dashboard" className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-primary">SAMP</span>
            <span className="text-[10px] text-mono uppercase tracking-widest text-muted-foreground">v1.0</span>
          </Link>
          <p className="mt-1 text-[11px] text-muted-foreground">Strategic Asset Management Plan</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => {
            const active = path === n.to || path.startsWith(n.to + "/");
            return (
              <Link key={n.to} to={n.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                }`}>
                <n.icon size={16} />
                <span>{n.label}</span>
              </Link>
            );
          })}
          {role === "admin" && (
            <Link to="/users"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                path.startsWith("/users")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              }`}>
              <Users size={16} /> <span>Users</span>
            </Link>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="px-2 py-2 mb-2">
            <p className="text-xs font-medium truncate">{profile?.name || user?.email}</p>
            <p className="text-[10px] text-mono uppercase tracking-wider text-primary mt-0.5">{role ?? "—"}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full justify-start gap-2 text-muted-foreground">
            <LogOut size={14} /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}
