import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — SAMP" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await supabase.rpc("update_last_login");
        toast.success("Signed in");
        navigate({ to: "/dashboard", replace: true });
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name }, emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        toast.success("Account created — signing you in");
        const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
        if (e2) {
          toast.message("Check your email to confirm your account");
        } else {
          await supabase.rpc("update_last_login");
          navigate({ to: "/dashboard", replace: true });
        }
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background bg-grid px-4 text-slate-50">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-baseline gap-2">
            <span className="text-3xl font-mono font-bold tracking-tight text-primary">SAMP</span>
            <span className="text-xs text-mono uppercase tracking-widest text-muted-foreground">v1.0</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Strategic Asset Management Plan · FM workforce planning</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-xl">
          <div className="flex gap-1 mb-6 rounded-md bg-muted p-1">
            <button type="button" onClick={() => setMode("signin")}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${mode==="signin"?"bg-background text-foreground shadow-sm":"text-muted-foreground hover:text-foreground"}`}>
              Sign in
            </button>
            <button type="button" onClick={() => setMode("signup")}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${mode==="signup"?"bg-background text-foreground shadow-sm":"text-muted-foreground hover:text-foreground"}`}>
              Create account
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={e=>setName(e.target.value)} required autoComplete="name" />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={8} autoComplete={mode==="signin"?"current-password":"new-password"} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            {mode === "signup" && (
              <p className="text-xs text-muted-foreground text-center">
                The first account created becomes the Super Admin.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
