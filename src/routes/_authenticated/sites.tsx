import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Building2, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "./dashboard";
import type { Site } from "@/lib/calc";

export const Route = createFileRoute("/_authenticated/sites")({
  head: () => ({ meta: [{ title: "Sites — SAMP" }] }),
  component: SitesPage,
});

const CONTRACT_TYPES = ["TFM", "Hard FM", "Soft FM", "Self-delivered"] as const;

function SitesPage() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const canWrite = role === "admin" || role === "editor";
  const canDelete = role === "admin";

  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").order("name");
      if (error) throw error;
      return data as Site[];
    },
  });

  const addSite = useMutation({
    mutationFn: async (input: { name: string; client: string; location: string; contract_type: string }) => {
      const { error } = await supabase.from("sites").insert({ ...input, owner_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sites"] }); setOpen(false); toast.success("Site created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const delSite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sites"] }); toast.success("Site deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 space-y-6 max-w-[1600px]">
      <PageHeader title="Sites" subtitle="Manage your portfolio of FM sites" right={
        canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} /> New site</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create a new site</DialogTitle></DialogHeader>
              <SiteForm onSubmit={(v) => addSite.mutate(v)} loading={addSite.isPending} />
            </DialogContent>
          </Dialog>
        )
      } />

      {isLoading && <div className="text-sm text-muted-foreground">Loading sites…</div>}

      {sites && sites.length === 0 && (
        <Card className="p-12 text-center border-dashed">
          <Building2 className="mx-auto mb-3 text-muted-foreground" size={40} />
          <p className="text-sm text-muted-foreground">No sites yet. Add your first site to begin.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sites?.map((s) => (
          <Card key={s.id} className="p-5 hover:border-primary/50 transition group">
            <div className="flex items-start justify-between gap-2">
              <Link to="/sites/$siteId" params={{ siteId: s.id }} className="flex-1 min-w-0">
                <h3 className="font-semibold truncate group-hover:text-primary transition">{s.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.client || "—"}</p>
              </Link>
              {canDelete && (
                <button onClick={() => confirm(`Delete ${s.name}?`) && delSite.mutate(s.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition p-1">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="mt-4 space-y-1.5 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin size={12} /> <span className="truncate">{s.location || "No location"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-secondary text-secondary-foreground">{s.contract_type}</span>
                <span className="text-mono text-muted-foreground">{s.operating_pattern}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SiteForm({ onSubmit, loading }: { onSubmit: (v: any) => void; loading: boolean }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  const [contract, setContract] = useState("TFM");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, client, location, contract_type: contract }); }}
          className="space-y-4">
      <div><Label>Name</Label><Input value={name} onChange={e=>setName(e.target.value)} required /></div>
      <div><Label>Client / operator</Label><Input value={client} onChange={e=>setClient(e.target.value)} /></div>
      <div><Label>Location</Label><Input value={location} onChange={e=>setLocation(e.target.value)} /></div>
      <div>
        <Label>Contract type</Label>
        <Select value={contract} onValueChange={setContract}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={loading} className="w-full">{loading ? "Creating…" : "Create site"}</Button>
    </form>
  );
}
