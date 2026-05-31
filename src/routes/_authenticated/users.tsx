import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listUsers, createUser, updateUserRole, resetUserPassword, deleteUser, setUserActive } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader, Pill } from "@/components/samp-ui";
import { Plus, Trash2, KeyRound, Power, Shield } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users — SAMP" }] }),
  component: UsersPage,
});

function UsersPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const list = useServerFn(listUsers);
  const create = useServerFn(createUser);
  const updateRole = useServerFn(updateUserRole);
  const resetPw = useServerFn(resetUserPassword);
  const del = useServerFn(deleteUser);
  const setActive = useServerFn(setUserActive);

  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["users-admin"],
    queryFn: () => list(),
    enabled: role === "admin",
  });

  const m = (fn: any, success: string) => useMutation({
    mutationFn: fn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users-admin"] }); toast.success(success); },
    onError: (e: any) => toast.error(e.message),
  });

  const createM = m((v: any) => create({ data: v }), "User created");
  const roleM = m((v: any) => updateRole({ data: v }), "Role updated");
  const pwM = m((v: any) => resetPw({ data: v }), "Password reset");
  const delM = m((v: any) => del({ data: v }), "User deleted");
  const activeM = m((v: any) => setActive({ data: v }), "Updated");

  if (role !== "admin") {
    return <div className="p-8"><Card className="p-12 text-center"><Shield className="mx-auto mb-3 text-muted-foreground" /><p>Admin only.</p></Card></div>;
  }

  return (
    <div className="p-8 space-y-6 max-w-[1400px]">
      <PageHeader title="User management" subtitle="Manage roles, access and password resets." right={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus size={16}/> New user</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create user</DialogTitle></DialogHeader>
            <CreateUserForm onSubmit={(v) => createM.mutate(v, { onSuccess: () => setOpen(false) })} loading={createM.isPending}/>
          </DialogContent>
        </Dialog>
      } />

      {isLoading && <div className="text-sm text-muted-foreground">Loading users…</div>}
      {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b border-border">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Role</th>
              <th className="p-3">Status</th><th className="p-3">Last login</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map(u => (
              <tr key={u.id} className="border-b border-border/50">
                <td className="p-3">{u.name || <span className="text-muted-foreground">—</span>}</td>
                <td className="p-3 text-mono text-xs">{u.email}</td>
                <td className="p-3">
                  <Select value={u.roles[0] ?? "viewer"} onValueChange={(r) => roleM.mutate({ userId: u.id, role: r as any })}>
                    <SelectTrigger className="h-8 w-28"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-3">
                  {u.active ? <Pill tone="success">Active</Pill> : <Pill tone="destructive">Inactive</Pill>}
                </td>
                <td className="p-3 text-mono text-xs text-muted-foreground">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                </td>
                <td className="p-3 flex gap-1 justify-end">
                  <button onClick={() => {
                    const pw = prompt("New password (min 8 chars):");
                    if (pw && pw.length >= 8) pwM.mutate({ userId: u.id, password: pw });
                  }} className="p-2 text-muted-foreground hover:text-foreground" title="Reset password">
                    <KeyRound size={14}/>
                  </button>
                  <button onClick={() => activeM.mutate({ userId: u.id, active: !u.active })}
                          className="p-2 text-muted-foreground hover:text-warning" title="Toggle active">
                    <Power size={14}/>
                  </button>
                  <button onClick={() => { if (confirm(`Delete ${u.email}?`)) delM.mutate({ userId: u.id }); }}
                          className="p-2 text-muted-foreground hover:text-destructive" title="Delete">
                    <Trash2 size={14}/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Role permissions</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="p-2">Feature</th><th className="p-2">Admin</th><th className="p-2">Editor</th><th className="p-2">Viewer</th>
            </tr>
          </thead>
          <tbody className="text-xs">
            {[
              ["View all sites","✓","Own sites only","Own sites only"],
              ["Add / edit sites","✓","✓","—"],
              ["Upload PM schedule","✓","✓","—"],
              ["Edit wrench time","✓","✓","—"],
              ["View labour loading","✓","✓","✓"],
              ["AI analysis","✓","✓","✓"],
              ["User management","✓","—","—"],
              ["Delete sites","✓","—","—"],
            ].map((row, i) => (
              <tr key={i} className="border-b border-border/30">
                <td className="p-2">{row[0]}</td>
                {row.slice(1).map((c, j) => (
                  <td key={j} className={`p-2 text-mono ${c==="✓"?"text-primary":c==="—"?"text-destructive":""}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function CreateUserForm({ onSubmit, loading }: { onSubmit: (v: any) => void; loading: boolean }) {
  const [v, setV] = useState({ name: "", email: "", password: "", role: "viewer" as "admin"|"editor"|"viewer" });
  return (
    <form onSubmit={e=>{e.preventDefault(); onSubmit(v);}} className="space-y-4">
      <div><Label>Name</Label><Input value={v.name} onChange={e=>setV({...v, name: e.target.value})} required/></div>
      <div><Label>Email</Label><Input type="email" value={v.email} onChange={e=>setV({...v, email: e.target.value})} required/></div>
      <div><Label>Password (min 8)</Label><Input type="password" value={v.password} onChange={e=>setV({...v, password: e.target.value})} minLength={8} required/></div>
      <div>
        <Label>Role</Label>
        <Select value={v.role} onValueChange={r=>setV({...v, role: r as any})}>
          <SelectTrigger><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={loading} className="w-full">{loading ? "Creating…" : "Create user"}</Button>
    </form>
  );
}
