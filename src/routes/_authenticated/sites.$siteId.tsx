import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Upload, Plus, Trash2, AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  WRENCH_FACTORS, DISCIPLINES, WO_TYPES, FREQUENCIES, OPERATING_PATTERN_DEFAULTS,
  totalLossPerShift, wrenchTimePct, annualHoursPerEmployee, productiveHoursPerEmployee,
  inHouseHoursPerYear, vendorHoursPerYear, totalFTE, headcountAt100, shiftSlots, isShiftTeam,
  availabilityRatio, disciplineBreakdown, tradeGroupRollup, sensitivityTable,
  statutorySplit, woTypeSplit, sfg20Comparison, taskHoursPerYear, coverAdjusted, fmt,
  type Site, type PMTask, type Discipline, type WOType,
} from "@/lib/calc";
import { PageHeader, Metric, SectionTitle, Pill } from "@/components/samp-ui";

const OPERATING_PATTERNS = ["Mon-Fri 08-17","Mon-Sat 08-17","Extended 07-19 Mon-Fri","24/7 continuous","24/5 Mon-Fri","Custom"] as const;
const SHIFT_MODELS = ["Day work","Continental 4on4off 12h","3-shift rotating 8h","2-shift early/late 8h","Custom"] as const;
const CONTRACT_TYPES = ["TFM","Hard FM","Soft FM","Self-delivered"] as const;

export const Route = createFileRoute("/_authenticated/sites/$siteId")({
  head: () => ({ meta: [{ title: "Site — SAMP" }] }),
  component: SiteDetailPage,
});

function SiteDetailPage() {
  const { siteId } = Route.useParams();
  const { role } = useAuth();
  const canWrite = role === "admin" || role === "editor";

  const { data, isLoading } = useQuery({
    queryKey: ["site", siteId],
    queryFn: async () => {
      const [{ data: site }, { data: tasks }] = await Promise.all([
        supabase.from("sites").select("*").eq("id", siteId).maybeSingle(),
        supabase.from("pm_tasks").select("*").eq("site_id", siteId).order("created_at"),
      ]);
      if (!site) throw new Error("Site not found");
      return { site: site as Site, tasks: (tasks ?? []) as PMTask[] };
    },
  });

  if (isLoading || !data) {
    return <div className="p-8 text-mono text-sm text-muted-foreground">Loading site…</div>;
  }

  return (
    <div className="p-8 max-w-[1600px] space-y-6">
      <Link to="/sites" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> All sites
      </Link>
      <PageHeader
        title={data.site.name}
        subtitle={`${data.site.client || "—"} · ${data.site.location || "—"} · ${data.site.contract_type}`}
        right={<Link to="/ai"><Button variant="outline" size="sm">Ask AI about this site</Button></Link>}
      />

      <Tabs defaultValue="loading" className="w-full">
        <TabsList className="grid grid-cols-4 max-w-2xl">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="wrench">Wrench time</TabsTrigger>
          <TabsTrigger value="pm">PM schedule</TabsTrigger>
          <TabsTrigger value="loading">Labour loading</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-6">
          <SetupTab site={data.site} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="wrench" className="mt-6">
          <WrenchTab site={data.site} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="pm" className="mt-6">
          <PMTab site={data.site} tasks={data.tasks} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="loading" className="mt-6">
          <LoadingTab site={data.site} tasks={data.tasks} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- SETUP TAB ---------------- */
function SetupTab({ site, canWrite }: { site: Site; canWrite: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = useState<Site>(site);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sites").update({
        name: s.name, client: s.client, location: s.location, contract_type: s.contract_type as any,
        reactive_hours_per_year: s.reactive_hours_per_year,
        operating_pattern: s.operating_pattern as any, shift_model: s.shift_model as any,
        hours_per_shift: s.hours_per_shift, concurrent_shifts: s.concurrent_shifts,
        work_days_per_year: s.work_days_per_year, min_on_site: s.min_on_site,
        annual_leave_days: s.annual_leave_days, sickness_days: s.sickness_days, training_days: s.training_days,
        updated_at: new Date().toISOString(),
      }).eq("id", site.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["site", site.id] }); toast.success("Site saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const setPattern = (p: string) => {
    const defaults = OPERATING_PATTERN_DEFAULTS[p as keyof typeof OPERATING_PATTERN_DEFAULTS];
    setS(prev => ({
      ...prev,
      operating_pattern: p as Site["operating_pattern"],
      hours_per_shift: defaults?.hoursPerShift ?? prev.hours_per_shift,
      concurrent_shifts: defaults?.concurrentShifts ?? prev.concurrent_shifts,
      work_days_per_year: defaults?.workDays ?? prev.work_days_per_year,
    }));
  };

  const setShiftModel = (m: string) => {
    setS(prev => ({
      ...prev,
      shift_model: m as Site["shift_model"],
      min_on_site: m === "Continental 4on4off 12h" ? Math.max(2, prev.min_on_site) : prev.min_on_site,
    }));
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-5">
        <SectionTitle sub="Basic site information">Site details</SectionTitle>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Name"><Input value={s.name} onChange={e=>setS({...s, name: e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Client / operator"><Input value={s.client} onChange={e=>setS({...s, client: e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Location"><Input value={s.location} onChange={e=>setS({...s, location: e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Contract type">
            <Select value={s.contract_type} onValueChange={v=>setS({...s, contract_type: v as any})} disabled={!canWrite}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Reactive hrs / year"><Input type="number" className="font-mono" value={s.reactive_hours_per_year}
            onChange={e=>setS({...s, reactive_hours_per_year: +e.target.value})} disabled={!canWrite}/></Field>
        </div>
      </Card>

      <Card className="p-6 space-y-5">
        <SectionTitle sub="Selecting a pattern auto-fills hours/shift, concurrent shifts and work days.">Operating pattern & shifts</SectionTitle>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Operating pattern">
            <Select value={s.operating_pattern} onValueChange={setPattern} disabled={!canWrite}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{OPERATING_PATTERNS.map(p=><SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Shift model">
            <Select value={s.shift_model} onValueChange={setShiftModel} disabled={!canWrite}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{SHIFT_MODELS.map(m=><SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Hours / shift"><Input type="number" step="0.5" className="font-mono" value={s.hours_per_shift} onChange={e=>setS({...s, hours_per_shift:+e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Concurrent shifts / day"><Input type="number" className="font-mono" value={s.concurrent_shifts} onChange={e=>setS({...s, concurrent_shifts:+e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Work days / year"><Input type="number" className="font-mono" value={s.work_days_per_year} onChange={e=>setS({...s, work_days_per_year:+e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Min engineers on site"><Input type="number" className="font-mono" value={s.min_on_site} onChange={e=>setS({...s, min_on_site:+e.target.value})} disabled={!canWrite}/></Field>
        </div>
      </Card>

      <Card className="p-6 space-y-5">
        <SectionTitle sub="Per person per year.">Leave, sickness, training</SectionTitle>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Annual leave days"><Input type="number" className="font-mono" value={s.annual_leave_days} onChange={e=>setS({...s, annual_leave_days:+e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Sickness allowance"><Input type="number" className="font-mono" value={s.sickness_days} onChange={e=>setS({...s, sickness_days:+e.target.value})} disabled={!canWrite}/></Field>
          <Field label="Training days"><Input type="number" className="font-mono" value={s.training_days} onChange={e=>setS({...s, training_days:+e.target.value})} disabled={!canWrite}/></Field>
        </div>
      </Card>

      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={()=>save.mutate()} disabled={save.isPending} className="gap-2"><Save size={16}/> Save site</Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>{children}</div>;
}

/* ---------------- WRENCH TIME TAB ---------------- */
function WrenchTab({ site, canWrite }: { site: Site; canWrite: boolean }) {
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, number>>(() =>
    Object.fromEntries(WRENCH_FACTORS.map(f => [f.key, (site as any)[f.key]])),
  );
  const draft = { ...site, ...vals } as Site;
  const loss = totalLossPerShift(draft);
  const wt = wrenchTimePct(draft);
  const annual = annualHoursPerEmployee(draft);
  const productive = productiveHoursPerEmployee(draft);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sites").update({ ...vals, updated_at: new Date().toISOString() }).eq("id", site.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["site", site.id] }); toast.success("Wrench time saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Loss per shift" value={fmt.n(loss, 2) + " h"} />
        <Metric label="Wrench time" value={fmt.pct(wt)} accent />
        <Metric label="Annual hrs / employee" value={fmt.n(annual)} />
        <Metric label="Productive hrs / employee" value={fmt.n(productive)} accent />
      </div>

      <Card className="p-6">
        <SectionTitle sub="12 productivity loss factors (hours per shift). Defaults match standard FM industry benchmarks.">Productivity loss factors</SectionTitle>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-3">
          {WRENCH_FACTORS.map(f => (
            <div key={f.key} className="grid grid-cols-[1fr_120px] items-center gap-3">
              <Label className="text-sm">{f.label}</Label>
              <Input type="number" step="0.05" className="font-mono text-right"
                value={vals[f.key]}
                onChange={e=>setVals(v=>({ ...v, [f.key]: +e.target.value }))}
                disabled={!canWrite}
              />
            </div>
          ))}
        </div>
        {canWrite && (
          <div className="flex justify-end mt-6">
            <Button onClick={()=>save.mutate()} disabled={save.isPending} className="gap-2"><Save size={16}/> Save</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- PM SCHEDULE TAB ---------------- */
function PMTab({ site, tasks, canWrite }: { site: Site; tasks: PMTask[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  const addTask = useMutation({
    mutationFn: async (rows: Partial<PMTask>[]) => {
      const payload = rows.map(r => ({ ...r, site_id: site.id }));
      const { error } = await supabase.from("pm_tasks").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["site", site.id] });
      toast.success(`${vars.length} task(s) added`);
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pm_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["site", site.id] }),
  });

  const onUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const norm = (s: string) => s.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
      const pick = (row: any, keys: string[]) => {
        for (const k of Object.keys(row)) if (keys.includes(norm(k))) return row[k];
        return undefined;
      };

      const detectDiscipline = (val: any): Discipline => {
        const v = (val ?? "").toString().toLowerCase();
        if (v.includes("hvac") || v.includes("mech") || v.includes("air")) return "HVAC";
        if (v.includes("elec")) return "Electrical";
        if (v.includes("plumb") || v.includes("water")) return "Plumbing";
        if (v.includes("bms") || v.includes("control")) return "BMS";
        if (v.includes("fabric") || v.includes("build")) return "Fabric";
        if (v.includes("super")) return "Supervisor";
        return "General";
      };
      const detectWO = (val: any): WOType => {
        const v = (val ?? "").toString().toLowerCase();
        if (v.includes("stat")) return "Statutory";
        if (v.includes("insp")) return "Inspection";
        if (v.includes("rec")) return "Recurring";
        return "PM";
      };

      const parsed: Partial<PMTask>[] = rows.map(r => {
        const name = pick(r, ["taskname","task","name","description","wodescription"]);
        const inhouse = pick(r, ["inhouse","inhousevendor","resource","provider"]);
        const wo = pick(r, ["wotype","worktype","wo","type"]);
        const disc = pick(r, ["discipline","trade","craft"]);
        const numA = +(pick(r, ["assets","numberofassets","numassets","quantity","qty"]) ?? 1);
        const minsA = +(pick(r, ["minutesperasset","minsperasset","durationmins","minutes","mins"]) ?? 0);
        const period = +(pick(r, ["periodicity","periodicitymultiplier","frequencyperyear","occurrencesperyear"]) ?? 1);
        const minsYear = +(pick(r, ["minutesperyear","minsperyear"]) ?? 0);
        const hoursYear = +(pick(r, ["hoursperyear","hrsperyear","annualhours"]) ?? 0);
        const sfg = pick(r, ["sfg20","sfg20code","sfgcode"]);
        const notes = pick(r, ["comments","notes","remarks"]);

        const hrs = hoursYear > 0 ? hoursYear
          : minsYear > 0 ? minsYear / 60
          : (numA * minsA * period) / 60;

        return {
          task_name: (name ?? "Unnamed task").toString().slice(0, 200),
          in_house: typeof inhouse === "string" ? !/vendor|sub|contract/i.test(inhouse) : true,
          wo_type: detectWO(wo),
          discipline: detectDiscipline(disc),
          statutory: detectWO(wo) === "Statutory",
          num_assets: numA || 1,
          mins_per_asset: minsA || 0,
          frequency: "Annual",
          periodicity_multiplier: period || 1,
          hours_per_year: hrs || 0,
          sfg20_code: sfg ? sfg.toString().slice(0, 20) : null,
          notes: notes ? notes.toString().slice(0, 500) : null,
        };
      }).filter(t => t.task_name);

      if (!parsed.length) { toast.error("No rows detected in file"); return; }
      addTask.mutate(parsed);
    } catch (e: any) {
      toast.error("Could not parse file: " + e.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold">PM schedule</h3>
          <p className="text-xs text-muted-foreground">{tasks.length} task(s) · {fmt.n(inHouseHoursPerYear(tasks))} in-house hrs/yr · {fmt.n(vendorHoursPerYear(tasks))} vendor hrs/yr</p>
        </div>
        {canWrite && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                   onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onUpload(f); }} />
            <Button variant="outline" className="gap-2" onClick={()=>fileRef.current?.click()}>
              <Upload size={16}/> Upload .xlsx
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus size={16}/> Add task</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Add PM task</DialogTitle></DialogHeader>
                <TaskForm onSubmit={(t) => addTask.mutate([t])} loading={addTask.isPending} />
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b border-border">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="p-3">Task</th>
              <th className="p-3">Discipline</th>
              <th className="p-3">WO type</th>
              <th className="p-3">Source</th>
              <th className="p-3 text-right">Assets</th>
              <th className="p-3 text-right">Min/asset</th>
              <th className="p-3 text-right">Freq×/yr</th>
              <th className="p-3 text-right">Hrs/yr</th>
              <th className="p-3">SFG20</th>
              {canWrite && <th className="p-3"></th>}
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground text-sm">No tasks yet — add manually or upload a CAFM .xlsx.</td></tr>
            )}
            {tasks.map(t => (
              <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="p-3">
                  {t.task_name}
                  {t.statutory && <Pill tone="warning"><span className="ml-1.5">STAT</span></Pill>}
                </td>
                <td className="p-3"><Pill>{t.discipline}</Pill></td>
                <td className="p-3 text-xs">{t.wo_type}</td>
                <td className="p-3 text-xs">{t.in_house ? "In-house" : "Vendor"}</td>
                <td className="p-3 text-right text-mono">{fmt.n(t.num_assets)}</td>
                <td className="p-3 text-right text-mono">{fmt.n(t.mins_per_asset)}</td>
                <td className="p-3 text-right text-mono">{fmt.n(t.periodicity_multiplier || FREQUENCIES[t.frequency] || 0, 1)}</td>
                <td className="p-3 text-right text-mono font-semibold">{fmt.n(taskHoursPerYear(t), 1)}</td>
                <td className="p-3 text-mono text-xs text-muted-foreground">{t.sfg20_code || "—"}</td>
                {canWrite && (
                  <td className="p-3">
                    <button onClick={()=>delTask.mutate(t.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={14}/>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function TaskForm({ onSubmit, loading }: { onSubmit: (t: Partial<PMTask>) => void; loading: boolean }) {
  const [t, setT] = useState<Partial<PMTask>>({
    task_name: "", discipline: "General", wo_type: "PM", in_house: true, statutory: false,
    num_assets: 1, mins_per_asset: 30, frequency: "Annual", periodicity_multiplier: 1, hours_per_year: 0,
    sfg20_code: null, notes: null,
  });
  return (
    <form onSubmit={e=>{ e.preventDefault(); const periodicity = FREQUENCIES[t.frequency!] ?? 1; onSubmit({ ...t, periodicity_multiplier: periodicity }); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><Label>Task name</Label><Input value={t.task_name} onChange={e=>setT({...t, task_name: e.target.value})} required/></div>
        <div>
          <Label>Discipline</Label>
          <Select value={t.discipline!} onValueChange={v=>setT({...t, discipline: v as Discipline})}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>{DISCIPLINES.map(d=><SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>WO type</Label>
          <Select value={t.wo_type!} onValueChange={v=>setT({...t, wo_type: v as WOType, statutory: v==="Statutory"})}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>{WO_TYPES.map(w=><SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Source</Label>
          <Select value={t.in_house ? "in" : "out"} onValueChange={v=>setT({...t, in_house: v==="in"})}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value="in">In-house</SelectItem><SelectItem value="out">Vendor</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label>Frequency</Label>
          <Select value={t.frequency!} onValueChange={v=>setT({...t, frequency: v})}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>{Object.keys(FREQUENCIES).map(f=><SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Number of assets</Label><Input type="number" className="font-mono" value={t.num_assets} onChange={e=>setT({...t, num_assets:+e.target.value})}/></div>
        <div><Label>Minutes / asset</Label><Input type="number" className="font-mono" value={t.mins_per_asset} onChange={e=>setT({...t, mins_per_asset:+e.target.value})}/></div>
        <div><Label>Total hrs/yr (optional)</Label><Input type="number" className="font-mono" value={t.hours_per_year} onChange={e=>setT({...t, hours_per_year:+e.target.value})}/></div>
        <div><Label>SFG20 code</Label><Input value={t.sfg20_code ?? ""} onChange={e=>setT({...t, sfg20_code: e.target.value || null})}/></div>
        <div className="col-span-2"><Label>Notes</Label><Input value={t.notes ?? ""} onChange={e=>setT({...t, notes: e.target.value || null})}/></div>
      </div>
      <Button type="submit" disabled={loading} className="w-full">{loading ? "Adding…" : "Add task"}</Button>
    </form>
  );
}

/* ---------------- LABOUR LOADING TAB ---------------- */
function LoadingTab({ site, tasks }: { site: Site; tasks: PMTask[] }) {
  const calc = useMemo(() => {
    const inHouse = inHouseHoursPerYear(tasks);
    const vendor = vendorHoursPerYear(tasks);
    const reactive = site.reactive_hours_per_year || 0;
    const wt = wrenchTimePct(site);
    const annual = annualHoursPerEmployee(site);
    const productive = productiveHoursPerEmployee(site);
    const fte = totalFTE(site, tasks);
    const head100 = headcountAt100(site, tasks);
    const fps = site.concurrent_shifts > 0 ? fte / site.concurrent_shifts : 0;
    const cost = fte * 45000;
    return {
      inHouse, vendor, reactive, wt, annual, productive, fte, head100, fps, cost,
      disc: disciplineBreakdown(site, tasks),
      trades: tradeGroupRollup(site, tasks),
      sens: sensitivityTable(site, tasks),
      stat: statutorySplit(tasks, site),
      wo: woTypeSplit(tasks.filter(t=>t.in_house)),
      sfg: sfg20Comparison(tasks),
    };
  }, [site, tasks]);

  if (tasks.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <p className="text-muted-foreground">Add PM tasks on the previous tab to see labour loading.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metric label="In-house hrs/yr" value={fmt.n(calc.inHouse)} />
        <Metric label="Vendor hrs/yr" value={fmt.n(calc.vendor)} />
        <Metric label="Reactive hrs/yr" value={fmt.n(calc.reactive)} />
        <Metric label="Wrench time" value={fmt.pct(calc.wt)} accent />
        <Metric label="Productive hrs / person" value={fmt.n(calc.productive)} />
        <Metric label="Total FTE (in-house)" value={fmt.fte(calc.fte)} accent />
      </div>

      {/* FTE summary */}
      <Card className="p-6">
        <SectionTitle sub="Indicative labour cost at £45k per FTE all-in.">FTE summary</SectionTitle>
        <table className="w-full text-sm">
          <tbody>
            <SummaryRow label="Annual hrs / employee" v={fmt.n(calc.annual)} />
            <SummaryRow label="Productive hrs / employee" v={fmt.n(calc.productive)} />
            <SummaryRow label="Total in-house maintenance hrs" v={fmt.n(calc.inHouse + calc.reactive)} />
            <SummaryRow label="Headcount @ 100% productivity" v={fmt.fte(calc.head100)} />
            <SummaryRow label="Effective FTE (wrench-adjusted)" v={fmt.fte(calc.fte)} accent />
            <SummaryRow label="FTE per shift" v={fmt.fte(calc.fps)} />
            <SummaryRow label="Indicative labour cost" v={fmt.gbp(calc.cost)} accent />
          </tbody>
        </table>
      </Card>

      {/* Sensitivity */}
      <Card className="p-6">
        <SectionTitle sub="FTE required at different wrench-time levels. Current value highlighted.">Wrench-time sensitivity</SectionTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              {calc.sens.map(s => <th key={s.level} className="p-2 text-right">{fmt.pct(s.level, 0)}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              {calc.sens.map(s => (
                <td key={s.level} className={`p-3 text-right text-mono ${s.current ? "bg-primary/15 text-primary font-semibold" : ""}`}>
                  {fmt.fte(s.fte)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Discipline breakdown */}
      <Card className="p-6">
        <SectionTitle>Discipline breakdown</SectionTitle>
        <div className="space-y-2">
          {calc.disc.filter(d=>d.hours>0).map(d => (
            <div key={d.discipline} className="grid grid-cols-12 items-center gap-3 py-2 border-b border-border/50 last:border-0">
              <div className="col-span-3 flex items-center gap-2">
                <Pill primary>{d.discipline}</Pill>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{d.tradeGroup}</span>
              </div>
              <div className="col-span-4">
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${d.shareOfLoad * 100}%` }} />
                </div>
                <div className="text-[10px] text-mono text-muted-foreground mt-1">{fmt.pct(d.shareOfLoad)}</div>
              </div>
              <div className="col-span-1 text-right text-mono text-sm">{fmt.n(d.hours)} h</div>
              <div className="col-span-1 text-right text-mono text-sm">{fmt.fte(d.fte)} FTE</div>
              <div className="col-span-1 text-right text-mono text-xs text-muted-foreground">{d.taskCount} tk</div>
              <div className="col-span-2 text-[10px] text-muted-foreground text-right">
                PM {fmt.n(d.pmHours)} · Insp {fmt.n(d.inspectionHours)} · Stat {fmt.n(d.statutoryHours)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Trade group rollup */}
      <div>
        <SectionTitle sub="HVAC + Plumbing + BMS + General → Mechanical. Electrical / Fabric / Supervisor stand alone.">Trade-group rollup</SectionTitle>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {calc.trades.map(g => (
            <Card key={g.group} className="p-5">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">{g.group}</h4>
                <Pill primary>{fmt.pct(g.share, 0)}</Pill>
              </div>
              <div className="mt-3 font-mono text-3xl text-primary">{g.recommendedHeadcount}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recommended headcount</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Hrs/yr</span><div className="text-mono">{fmt.n(g.hours)}</div></div>
                <div><span className="text-muted-foreground">Raw FTE</span><div className="text-mono">{fmt.fte(g.fte)}</div></div>
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Feeds: {g.feedDisciplines.join(", ")}
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{g.description}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Shift cover + resilience */}
      <Card className="p-6">
        <SectionTitle sub={`Availability ratio: ${fmt.pct(availabilityRatio(site))} · ${isShiftTeam(site.shift_model) ? `${shiftSlots(site.shift_model)} shift slots` : "Day work"}`}>Shift cover & resilience</SectionTitle>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="p-2">Trade</th>
              <th className="p-2 text-right">Raw FTE</th>
              <th className="p-2 text-right">Absence-adjusted</th>
              <th className="p-2 text-right">Min-on-site rule</th>
              <th className="p-2 text-right">Final headcount</th>
              <th className="p-2 text-right">Cover premium</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {calc.trades.map(g => (
              <tr key={g.group} className="border-b border-border/50">
                <td className="p-3">{g.group}</td>
                <td className="p-3 text-right text-mono">{fmt.fte(g.cover.rawFTE)}</td>
                <td className="p-3 text-right text-mono">{fmt.fte(g.cover.absenceAdjusted)}</td>
                <td className="p-3 text-right text-mono">{fmt.fte(g.cover.minOnSiteRule)}</td>
                <td className="p-3 text-right text-mono font-semibold text-primary">{g.recommendedHeadcount}</td>
                <td className="p-3 text-right text-mono">+{fmt.fte(g.cover.coverPremium)}</td>
                <td className="p-3">{g.cover.flag && <Pill tone="warning"><AlertTriangle size={10} className="mr-1"/>50%+</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isShiftTeam(site.shift_model) && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning-foreground">
            <strong className="text-warning">Why raw FTE of 1 isn't viable for a shift team:</strong>{" "}
            A {site.shift_model} pattern needs {shiftSlots(site.shift_model)} engineers on shift at all times to maintain the min-on-site of {site.min_on_site}.
            Once you add ~{fmt.pct(1 - availabilityRatio(site), 0)} absence cover (leave + sickness + training), the practical headcount sits at
            roughly <strong className="text-mono">{Math.ceil(site.min_on_site * shiftSlots(site.shift_model) / availabilityRatio(site))}</strong> per trade — independent of workload.
          </div>
        )}
      </Card>

      {/* Statutory + WO type */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6">
          <SectionTitle>Statutory vs non-statutory</SectionTitle>
          <table className="w-full text-sm">
            <tbody>
              <SummaryRow label="Statutory hrs/yr" v={fmt.n(calc.stat.statutoryHours)} />
              <SummaryRow label="Statutory FTE" v={fmt.fte(calc.stat.statutoryFTE)} accent />
              <SummaryRow label="Non-statutory hrs/yr" v={fmt.n(calc.stat.nonStatutoryHours)} />
              <SummaryRow label="Non-statutory FTE" v={fmt.fte(calc.stat.nonStatutoryFTE)} />
            </tbody>
          </table>
        </Card>
        <Card className="p-6">
          <SectionTitle>WO type split</SectionTitle>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="p-2 text-left">Type</th><th className="p-2 text-right">Hours</th><th className="p-2 text-right">%</th>
            </tr></thead>
            <tbody>
              {calc.wo.map(w => (
                <tr key={w.wo_type} className="border-b border-border/50">
                  <td className="p-3">{w.wo_type}</td>
                  <td className="p-3 text-right text-mono">{fmt.n(w.hours)}</td>
                  <td className="p-3 text-right text-mono">{fmt.pct(w.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* SFG20 benchmark */}
      <Card className="p-6">
        <SectionTitle sub="Flags variance greater than ±20% against SFG20 benchmark minutes.">SFG20 benchmark comparison</SectionTitle>
        {calc.sfg.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks with recognised SFG20 codes yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="p-2">Task</th>
                <th className="p-2">Code</th>
                <th className="p-2 text-right">Your mins</th>
                <th className="p-2 text-right">Benchmark</th>
                <th className="p-2 text-right">Variance</th>
                <th className="p-2">Flag</th>
              </tr>
            </thead>
            <tbody>
              {calc.sfg.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="p-3">{r.task}</td>
                  <td className="p-3 text-mono text-xs">{r.code}</td>
                  <td className="p-3 text-right text-mono">{fmt.n(r.yours)}</td>
                  <td className="p-3 text-right text-mono text-muted-foreground">{fmt.n(r.benchmark)}</td>
                  <td className="p-3 text-right text-mono">{r.variance > 0 ? "+" : ""}{fmt.pct(r.variance, 0)}</td>
                  <td className="p-3">
                    {r.flag === "OK" ? <Pill tone="success">OK</Pill>
                      : r.flag === "Over" ? <Pill tone="destructive">Over</Pill>
                      : <Pill tone="warning">Under</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function SummaryRow({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <tr className="border-b border-border/50">
      <td className="p-2.5 text-muted-foreground">{label}</td>
      <td className={`p-2.5 text-right text-mono ${accent ? "text-primary font-semibold" : ""}`}>{v}</td>
    </tr>
  );
}
