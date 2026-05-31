import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (!data?.some((r: any) => r.role === "admin")) throw new Error("Admin only");
}

export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles").select("*").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("*");
    const { data: access } = await supabaseAdmin.from("site_access").select("*");
    return {
      users: (profiles || []).map((p) => ({
        ...p,
        roles: (roles || []).filter((r) => r.user_id === p.id).map((r) => r.role),
        siteIds: (access || []).filter((a) => a.user_id === p.id).map((a) => a.site_id),
      })),
    };
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().max(255),
    password: z.string().min(8).max(72),
    role: z.enum(["admin", "editor", "viewer"]),
    siteIds: z.array(z.string().uuid()).max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name, role: data.role },
    });
    if (error) throw new Error(error.message);
    // Trigger sets default role; if specified, ensure correct
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user!.id);
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user!.id, role: data.role });
    if (data.siteIds?.length) {
      await supabaseAdmin.from("site_access").insert(
        data.siteIds.map((sid) => ({ user_id: created.user!.id, site_id: sid })),
      );
    }
    return { ok: true };
  });

export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    userId: z.string().uuid(),
    role: z.enum(["admin", "editor", "viewer"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    userId: z.string().uuid(),
    password: z.string().min(8).max(72),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    userId: z.string().uuid(),
    active: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    await supabaseAdmin.from("profiles").update({ active: data.active }).eq("id", data.userId);
    // ban_duration is auth-admin trick; if deactivating, sign-out by updating user
    if (!data.active) {
      await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "876000h" } as any);
    } else {
      await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "none" } as any);
    }
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSiteAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    userId: z.string().uuid(),
    siteIds: z.array(z.string().uuid()).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    await supabaseAdmin.from("site_access").delete().eq("user_id", data.userId);
    if (data.siteIds.length) {
      const rows = data.siteIds.map((sid) => ({ user_id: data.userId, site_id: sid }));
      const { error } = await supabaseAdmin.from("site_access").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
