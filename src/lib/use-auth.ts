import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "editor" | "viewer";

export type AuthState = {
  loading: boolean;
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profile: { name: string; email: string } | null;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true, user: null, session: null, role: null, profile: null,
  });

  useEffect(() => {
    let cancelled = false;
    const loadRole = async (user: User | null) => {
      if (!user) return { role: null as AppRole | null, profile: null };
      const [{ data: roles }, { data: profile }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("profiles").select("name,email").eq("id", user.id).maybeSingle(),
      ]);
      const priority: AppRole[] = ["admin", "editor", "viewer"];
      const role = priority.find((r) => roles?.some((x) => x.role === r)) ?? null;
      return { role, profile: profile ?? { name: "", email: user.email ?? "" } };
    };

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const extra = await loadRole(data.session?.user ?? null);
      if (cancelled) return;
      setState({ loading: false, user: data.session?.user ?? null, session: data.session, ...extra });
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const extra = await loadRole(session?.user ?? null);
      if (cancelled) return;
      setState({ loading: false, user: session?.user ?? null, session, ...extra });
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return state;
}
