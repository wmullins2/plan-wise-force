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
import { ArrowLeft, Upload, Trash2, AlertTriangle, Save, Download, X, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  WRENCH_FACTORS, DISCIPLINES, WO_TYPES, FREQUENCIES,
  totalLossPerShift, wrenchTimePct, annualHoursPerEmployee, productiveHoursPerEmployee,
  inHouseHoursPerYear, vendorHoursPerYear, totalFTE, headcountAt100, shiftSlots, isShiftTeam,
  availabilityRatio, disciplineBreakdown, tradeGroupRollup, sensitivityTable,
  statutorySplit, woTypeSplit, sfg20Comparison, taskHoursPerYear, coverAdjusted, fmt,
  recommendShiftPattern, coverageHoursPerDay, COVERAGE_DAYS,
  type Site, type PMTask, type Discipline, type WOType, type CoverageDays, type ShiftRecommendation,
} from "@/lib/calc";
import { PageHeader, Metric, SectionTitle, Pill } from "@/components/samp-ui";

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

  // --- Coverage-based shift recommendation ---
  // Coverage inputs are kept in local UI state; the resulting pattern is written
  // back to the existing site fields (operating_pattern, shift_model, hours_per_shift,
  // concurrent_shifts, work_days_per_year) so the rest of the calc engine works unchanged.
  const inferDefaults = () => {
    if (s.operating_pattern === "24/7 continuous") return { start: "00:00", end: "00:00", days: "Mon-Sun" as CoverageDays };
    if (s.operating_pattern === "24/5 Mon-Fri")    return { start: "00:00", end: "00:00", days: "Mon-Fri" as CoverageDays };
    if (s.operating_pattern === "Mon-Sat 08-17")   return { start: "08:00", end: "17:00", days: "Mon-Sat" as CoverageDays };
    if (s.operating_pattern === "Extended 07-19 Mon-Fri") return { start: "07:00", end: "19:00", days: "Mon-Fri" as CoverageDays };
    return { start: "08:00", end: "17:00", days: "Mon-Fri" as CoverageDays };
  };
  const init = inferDefaults();
  const [coverStart, setCoverStart] = useState(init.start);
  const [coverEnd, setCoverEnd]     = useState(init.end);
  const [coverDays, setCoverDays]   = useState<CoverageDays>(init.days);
  const [override, setOverride]     = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const coverageHours = coverageHoursPerDay(coverStart, coverEnd);
  const recommendation = useMemo(
    () => recommendShiftPattern(coverageHours, coverDays, s.min_on_site),
    [coverageHours, coverDays, s.min_on_site],
  );

  // Apply recommendation to site fields whenever it changes — unless user is overriding.
  const applyRec = (r: ShiftRecommendation) => {
    setS(prev => ({
      ...prev,
      operating_pattern: r.operatingPattern,
      shift_model: r.shiftModel,
      hours_per_shift: r.hoursPerShift,
      concurrent_shifts: r.simultaneousSlots,
      work_days_per_year: r.workDaysPerYear,
    }));
  };
  // Sync once whenever recommendation changes and not overriding
  const lastApplied = useRef<string>("");
  if (!override) {
    const key = `${recommendation.operatingPattern}|${recommendation.shiftModel}|${recommendation.hoursPerShift}|${recommendation.simultaneousSlots}|${recommendation.workDaysPerYear}`;
    if (lastApplied.current !== key) {
      lastApplied.current = key;
      // defer to avoid setState-in-render warning
      queueMicrotask(() => applyRec(recommendation));
    }
  }

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

      {/* STEP 1 — Coverage */}
      <Card className="p-6 space-y-5">
        <SectionTitle sub="Define when the site needs to be staffed. The system will recommend the most efficient shift pattern.">
          Step 1 · Required coverage
        </SectionTitle>
        <div className="grid md:grid-cols-4 gap-4">
          <Field label="Coverage start">
            <Input type="time" className="font-mono" value={coverStart} onChange={e=>setCoverStart(e.target.value)} disabled={!canWrite}/>
          </Field>
          <Field label="Coverage end">
            <Input type="time" className="font-mono" value={coverEnd} onChange={e=>setCoverEnd(e.target.value)} disabled={!canWrite}/>
          </Field>
          <Field label="Days of week">
            <Select value={coverDays} onValueChange={v=>setCoverDays(v as CoverageDays)} disabled={!canWrite}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{COVERAGE_DAYS.map(d=><SelectItem key={d} value={d}>{d === "24h" ? "24 hours (any day)" : d}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Min engineers on site">
            <Input type="number" className="font-mono" value={s.min_on_site} onChange={e=>setS({...s, min_on_site:+e.target.value})} disabled={!canWrite}/>
          </Field>
        </div>
        <div className="text-xs text-muted-foreground">
          Coverage window: <span className="font-mono text-foreground">{coverageHours.toFixed(1)}h/day</span>
          {" · "}Tip: set start = end (e.g. 00:00 → 00:00) for 24-hour coverage.
        </div>
      </Card>

      {/* STEP 2 — Recommendation */}
      <Card className="p-6 space-y-4">
        <SectionTitle sub="Calculated automatically from the coverage window above.">
          Step 2 · Recommended shift pattern
        </SectionTitle>
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-primary font-medium">Recommended</div>
              <div className="text-xl font-semibold mt-1">{recommendation.patternName}</div>
              <p className="text-sm text-muted-foreground mt-2 max-w-xl">{recommendation.reason}</p>
            </div>
            <Pill tone="primary">{override ? "Overridden" : "Active"}</Pill>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            <Metric label="Shift length" value={`${recommendation.hoursPerShift}h`} />
            <Metric label="Shifts / day"  value={String(recommendation.shiftsPerDay)} />
            <Metric label="Work days / yr" value={String(recommendation.workDaysPerYear)} />
            <Metric label="Simultaneous slots" value={String(recommendation.simultaneousSlots)} accent />
          </div>
        </div>
      </Card>

      {/* STEP 3 — Override */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <SectionTitle sub="Use the recommended pattern, or override it manually.">Step 3 · Override</SectionTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Override recommended pattern</Label>
            <Switch checked={override} onCheckedChange={(v)=>setOverride(!!v)} disabled={!canWrite}/>
          </div>
        </div>
        {override && (
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Shift model">
                <Select value={s.shift_model} onValueChange={(m)=>setS({...s, shift_model: m as Site["shift_model"]})} disabled={!canWrite}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{SHIFT_MODELS.map(m=><SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Hours / shift">
                <Input type="number" step="0.5" className="font-mono" value={s.hours_per_shift}
                  onChange={e=>setS({...s, hours_per_shift:+e.target.value})} disabled={!canWrite}/>
              </Field>
              <Field label="Concurrent shifts / day">
                <Input type="number" className="font-mono" value={s.concurrent_shifts}
                  onChange={e=>setS({...s, concurrent_shifts:+e.target.value})} disabled={!canWrite}/>
              </Field>
              <Field label="Work days / year">
                <Input type="number" className="font-mono" value={s.work_days_per_year}
                  onChange={e=>setS({...s, work_days_per_year:+e.target.value})} disabled={!canWrite}/>
              </Field>
            </div>
            <Field label="Reason for override (optional)">
              <Textarea value={overrideReason} onChange={e=>setOverrideReason(e.target.value)} rows={2} disabled={!canWrite}/>
            </Field>
          </div>
        )}
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

/* ---------------- PM SCHEDULE TAB (upload-only) ---------------- */

// Canonical field keys we map to
type FieldKey =
  | "task_name" | "discipline" | "wo_type" | "in_house" | "statutory"
  | "num_assets" | "mins_per_asset" | "periodicity_multiplier"
  | "mins_per_year" | "hours_per_year" | "sfg20_code" | "notes" | "ignore";

const FIELD_LABELS: Record<FieldKey, string> = {
  task_name: "Task name", discipline: "Discipline", wo_type: "WO type",
  in_house: "In-house / Vendor", statutory: "Statutory flag",
  num_assets: "Number of assets", mins_per_asset: "Minutes per asset",
  periodicity_multiplier: "Periodicity (times/yr)", mins_per_year: "Minutes per year",
  hours_per_year: "Hours per year", sfg20_code: "SFG20 code", notes: "Notes / comments",
  ignore: "— Ignore —",
};

const norm = (s: any) => (s ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");

// Synonym → canonical field
const FIELD_SYNONYMS: Record<FieldKey, string[]> = {
  task_name: ["taskname","task","name","description","wodescription","schedule","schedulename","workorder","workordername","activity","ppmtask"],
  discipline: ["discipline","trade","craft","category","assettype","skill","tradegroup"],
  wo_type: ["wotype","worktype","type","tasktype","ordertype","jobtype","maintenancetype"],
  in_house: ["inhouse","inhousevendor","source","resource","provider","contractor","supplier","executedby","resourcetype"],
  statutory: ["statutory","stat","compliance","mandatory","legal","sfgcompliance"],
  num_assets: ["assets","numberofassets","numassets","quantity","qty","assetcount","count","units"],
  mins_per_asset: ["minutesperasset","minsperasset","durationmins","duration","minutes","mins","time","timeminutes","timeperasset","minutespertask"],
  periodicity_multiplier: ["periodicity","periodicitymultiplier","frequencyperyear","occurrencesperyear","timesperyear","frequency","recurrence","peryear","occurrences"],
  mins_per_year: ["minutesperyear","minsperyear","annualminutes","totalminutes"],
  hours_per_year: ["hoursperyear","hrsperyear","annualhours","totalhours","yearlyhours"],
  sfg20_code: ["sfg20","sfg20code","sfgcode","sfg","sfgreference","reference","ref","code","sfg20ref"],
  notes: ["comments","notes","remarks","memo","description2"],
  ignore: [],
};

function autoMapHeaders(headers: string[]): Record<string, FieldKey> {
  const map: Record<string, FieldKey> = {};
  const used = new Set<FieldKey>();
  for (const h of headers) {
    const n = norm(h);
    let best: FieldKey = "ignore";
    for (const [field, syns] of Object.entries(FIELD_SYNONYMS) as [FieldKey, string[]][]) {
      if (field === "ignore" || used.has(field)) continue;
      if (syns.some(s => n === s || (n.length > 3 && (n.includes(s) || s.includes(n))))) {
        best = field; break;
      }
    }
    map[h] = best;
    if (best !== "ignore") used.add(best);
  }
  return map;
}

const detectDiscipline = (val: any): Discipline => {
  const v = (val ?? "").toString().toLowerCase();
  if (v.includes("hvac") || v.includes("mech") || v.includes("air") || v.includes("chill")) return "HVAC";
  if (v.includes("elec")) return "Electrical";
  if (v.includes("plumb") || v.includes("water")) return "Plumbing";
  if (v.includes("bms") || v.includes("control")) return "BMS";
  if (v.includes("fabric") || v.includes("build") || v.includes("joiner")) return "Fabric";
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
const detectInHouse = (val: any): boolean => {
  if (val === undefined || val === null || val === "") return true;
  const v = val.toString().toLowerCase();
  if (/vendor|sub|contract|supplier|external|outsourc/.test(v)) return false;
  return true;
};
const detectBool = (val: any): boolean => {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  const v = (val ?? "").toString().toLowerCase().trim();
  return ["y","yes","true","1","stat","statutory","x","✓"].includes(v);
};

type ParsedRow = Partial<PMTask> & { _src?: string; _flags?: string[]; _skip?: boolean };

// Map free-text frequency labels to expected times/year for mismatch detection.
const FREQ_LABEL_TO_PERYEAR: Record<string, number> = {
  daily: 365, weekly: 52, fortnightly: 26, biweekly: 26, monthly: 12,
  quarterly: 4, "6monthly": 2, sixmonthly: 2, halfyearly: 2, biannual: 2,
  annual: 1, annually: 1, yearly: 1, "2yearly": 0.5, biennial: 0.5,
  "5yearly": 0.2, "5year": 0.2,
};

function rowsToTasks(rows: any[], headerMap: Record<string, FieldKey>, sheetName: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const row of rows) {
    const get = (field: FieldKey) => {
      for (const [h, f] of Object.entries(headerMap)) {
        if (f === field && row[h] !== undefined && row[h] !== "") return row[h];
      }
      return undefined;
    };
    const rawName = get("task_name");
    const flags: string[] = [];

    if (!rawName) {
      const hasAnyData = Object.values(row).some(v => v !== "" && v !== undefined && v !== null);
      if (hasAnyData) {
        out.push({ task_name: "(missing name)", _src: sheetName, _flags: ["Missing task name"], _skip: true });
      }
      continue;
    }

    const numA = +(get("num_assets") ?? 1) || 1;
    const minsA = +(get("mins_per_asset") ?? 0) || 0;
    const periodRaw = get("periodicity_multiplier");
    const period = +(periodRaw ?? 1) || 1;
    const minsYear = +(get("mins_per_year") ?? 0) || 0;
    const hoursYearRaw = +(get("hours_per_year") ?? 0) || 0;
    const hrs = minsYear > 0
      ? minsYear / 60
      : hoursYearRaw > 0
        ? hoursYearRaw
        : (numA * minsA * period) / 60;

    if (hrs <= 0) flags.push("Zero hrs/yr");
    if (hrs > 500) flags.push("Check: >500 hrs/yr");

    // Frequency label vs numeric mismatch
    if (periodRaw !== undefined) {
      const labelKey = periodRaw.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
      const expected = FREQ_LABEL_TO_PERYEAR[labelKey];
      if (expected && expected !== period) {
        flags.push(`Freq "${periodRaw}" ≠ ${period}/yr`);
      }
    }

    const woVal = get("wo_type");
    const statVal = get("statutory");
    out.push({
      task_name: rawName.toString().slice(0, 200),
      discipline: detectDiscipline(get("discipline")),
      wo_type: detectWO(woVal),
      in_house: detectInHouse(get("in_house")),
      statutory: statVal !== undefined ? detectBool(statVal) : detectWO(woVal) === "Statutory",
      num_assets: numA,
      mins_per_asset: minsA,
      frequency: "Annual",
      periodicity_multiplier: period,
      hours_per_year: Math.round(hrs * 100) / 100,
      sfg20_code: (() => { const s = get("sfg20_code"); return s ? s.toString().slice(0, 20) : null; })(),
      notes: (() => { const s = get("notes"); return s ? s.toString().slice(0, 500) : null; })(),
      _src: sheetName,
      _flags: flags.length ? flags : undefined,
    });
  }
  return out;
}

type ImportState = {
  fileName: string;
  sheets: { name: string; headers: string[]; rows: any[]; map: Record<string, FieldKey> }[];
};

function PMTab({ site, tasks, canWrite }: { site: Site; tasks: PMTask[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [filter, setFilter] = useState({ discipline: "all", wo: "all", source: "all", stat: "all" });

  const replaceTasks = useMutation({
    mutationFn: async (rows: Partial<PMTask>[]) => {
      const { error: delErr } = await supabase.from("pm_tasks").delete().eq("site_id", site.id);
      if (delErr) throw delErr;
      if (rows.length) {
        const payload = rows
          .filter((r: any) => !r._skip)
          .map(({ ...r }: any) => { delete r._src; delete r._flags; delete r._skip; return { ...r, site_id: site.id }; });
        const { error } = await supabase.from("pm_tasks").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["site", site.id] });
      toast.success(`Imported ${vars.length} task(s) — previous schedule replaced.`);
      setImportState(null);
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

  const clearAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pm_tasks").delete().eq("site_id", site.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["site", site.id] }); toast.success("All tasks cleared."); },
  });

  const onFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Only .xlsx files are accepted.");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheets = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        const headers = rows.length ? Object.keys(rows[0]) : [];
        return { name, headers, rows, map: autoMapHeaders(headers) };
      }).filter(s => s.headers.length > 0);
      if (!sheets.length) { toast.error("No data found in workbook."); return; }
      setImportState({ fileName: file.name, sheets });
    } catch (e: any) {
      toast.error("Could not parse file: " + e.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const parsedPreview = useMemo<ParsedRow[]>(() => {
    if (!importState) return [];
    return importState.sheets.flatMap(s => rowsToTasks(s.rows, s.map, s.name));
  }, [importState]);

  // unresolved required fields across all sheets
  const unmappedRequired = useMemo(() => {
    if (!importState) return [];
    const required: FieldKey[] = ["task_name"];
    const missing: { sheet: string; field: FieldKey }[] = [];
    for (const s of importState.sheets) {
      const present = new Set(Object.values(s.map));
      for (const f of required) if (!present.has(f)) missing.push({ sheet: s.name, field: f });
    }
    return missing;
  }, [importState]);

  const filtered = useMemo(() => tasks.filter(t =>
    (filter.discipline === "all" || t.discipline === filter.discipline) &&
    (filter.wo === "all" || t.wo_type === filter.wo) &&
    (filter.source === "all" || (filter.source === "in" ? t.in_house : !t.in_house)) &&
    (filter.stat === "all" || (filter.stat === "yes" ? t.statutory : !t.statutory))
  ), [tasks, filter]);

  const exportXlsx = () => {
    const rows = tasks.map(t => ({
      "Task name": t.task_name, "Discipline": t.discipline, "WO type": t.wo_type,
      "Source": t.in_house ? "In-house" : "Vendor", "Statutory": t.statutory ? "Yes" : "No",
      "Assets": t.num_assets, "Mins / asset": t.mins_per_asset,
      "Times / yr": t.periodicity_multiplier, "Hrs / yr": taskHoursPerYear(t),
      "SFG20": t.sfg20_code ?? "", "Notes": t.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PM Schedule");
    XLSX.writeFile(wb, `${site.name.replace(/[^a-z0-9]+/gi,"_")}_PM_schedule.xlsx`);
  };

  // Summary stats
  const summary = useMemo(() => {
    const valid = parsedPreview.filter(t => !t._skip);
    const inHouse = valid.filter(t => t.in_house).reduce((a,t) => a + (t.hours_per_year ?? 0), 0);
    const vendor = valid.filter(t => !t.in_house).reduce((a,t) => a + (t.hours_per_year ?? 0), 0);
    const byDisc: Record<string, number> = {};
    const byWo: Record<string, number> = {};
    for (const t of valid) {
      byDisc[t.discipline!] = (byDisc[t.discipline!] ?? 0) + (t.hours_per_year ?? 0);
      byWo[t.wo_type!] = (byWo[t.wo_type!] ?? 0) + (t.hours_per_year ?? 0);
    }
    const flagged = parsedPreview.filter(t => t._flags && t._flags.length).length;
    const skipped = parsedPreview.filter(t => t._skip).length;
    return { inHouse, vendor, byDisc, byWo, flagged, skipped, validCount: valid.length };
  }, [parsedPreview]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold">PM schedule</h3>
          <p className="text-xs text-muted-foreground">
            {tasks.length} task(s) · {fmt.n(inHouseHoursPerYear(tasks))} in-house hrs/yr · {fmt.n(vendorHoursPerYear(tasks))} vendor hrs/yr
          </p>
        </div>
        {tasks.length > 0 && (
          <Button variant="outline" size="sm" className="gap-2" onClick={exportXlsx}>
            <Download size={14}/> Export
          </Button>
        )}
        {canWrite && tasks.length > 0 && (
          <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive"
                  onClick={()=>{ if (confirm("Clear all tasks? This cannot be undone.")) clearAll.mutate(); }}>
            <Trash2 size={14}/> Clear all
          </Button>
        )}
      </div>

      {/* Upload zone */}
      {canWrite && (
        <Card
          className={`p-8 border-2 border-dashed transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
          onDragOver={(e)=>{ e.preventDefault(); setDragOver(true); }}
          onDragLeave={()=>setDragOver(false)}
          onDrop={(e)=>{ e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        >
          <div className="flex flex-col items-center text-center gap-3">
            <Upload size={28} className="text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Drop a CAFM PM schedule (.xlsx) here</p>
              <p className="text-xs text-muted-foreground mt-1">All sheets in the workbook will be parsed. Column headers are auto-detected — uploading replaces the existing schedule.</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
                   onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onFile(f); }} />
            <Button variant="outline" className="gap-2 mt-2" onClick={()=>fileRef.current?.click()}>
              <FileSpreadsheet size={16}/> Browse files
            </Button>
          </div>
        </Card>
      )}

      {/* Import preview / mapping dialog */}
      <Dialog open={!!importState} onOpenChange={(o)=>!o && setImportState(null)}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review import — {importState?.fileName}</DialogTitle>
          </DialogHeader>
          {importState && (
            <div className="space-y-5">
              {/* Mapping section */}
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Auto-detected mapping for each sheet. Adjust any column whose meaning was missed.
                </p>
                {importState.sheets.map((s, si) => (
                  <Card key={s.name} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold">{s.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.rows.length} rows · {s.headers.length} cols</div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-2">
                      {s.headers.map(h => (
                        <div key={h} className="grid grid-cols-[1fr_180px] items-center gap-2">
                          <span className="text-xs font-mono truncate" title={h}>{h}</span>
                          <Select value={s.map[h]} onValueChange={(v)=>{
                            setImportState(prev => {
                              if (!prev) return prev;
                              const sheets = [...prev.sheets];
                              sheets[si] = { ...sheets[si], map: { ...sheets[si].map, [h]: v as FieldKey } };
                              return { ...prev, sheets };
                            });
                          }}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(FIELD_LABELS) as FieldKey[]).map(k => (
                                <SelectItem key={k} value={k}>{FIELD_LABELS[k]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              {unmappedRequired.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded bg-warning/10 border border-warning/30 text-xs">
                  <AlertTriangle size={14} className="text-warning mt-0.5"/>
                  <div>
                    Some sheets are missing a <strong>Task name</strong> column:
                    {" "}{unmappedRequired.map(m => `${m.sheet}`).join(", ")}.
                    Map one before importing or those rows will be skipped.
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Metric label="Tasks to import" value={fmt.n(summary.validCount)} accent/>
                <Metric label="In-house hrs/yr" value={fmt.n(summary.inHouse)}/>
                <Metric label="Vendor hrs/yr" value={fmt.n(summary.vendor)}/>
                <Metric label="Total hrs/yr" value={fmt.n(summary.inHouse + summary.vendor)} accent/>
                <Metric label="Flagged rows" value={fmt.n(summary.flagged)} sub={summary.skipped ? `${summary.skipped} skipped` : undefined}/>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <Card className="p-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">By discipline</div>
                  {Object.entries(summary.byDisc).sort((a,b)=>b[1]-a[1]).map(([k,v]) => (
                    <div key={k} className="flex justify-between text-xs py-0.5"><span>{k}</span><span className="text-mono">{fmt.n(v)} h</span></div>
                  ))}
                </Card>
                <Card className="p-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">By WO type</div>
                  {Object.entries(summary.byWo).sort((a,b)=>b[1]-a[1]).map(([k,v]) => (
                    <div key={k} className="flex justify-between text-xs py-0.5"><span>{k}</span><span className="text-mono">{fmt.n(v)} h</span></div>
                  ))}
                </Card>
              </div>

              {/* Preview table */}
              <Card className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-border sticky top-0">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="p-2">Task</th><th className="p-2">Disc</th><th className="p-2">WO</th>
                      <th className="p-2">Src</th><th className="p-2">Stat</th>
                      <th className="p-2 text-right">Assets</th><th className="p-2 text-right">Min/a</th>
                      <th className="p-2 text-right">×/yr</th><th className="p-2 text-right">Hrs/yr</th>
                      <th className="p-2">SFG20</th>
                      <th className="p-2">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPreview.slice(0, 200).map((t, i) => (
                      <tr key={i} className={`border-b border-border/30 ${t._skip ? "opacity-50" : ""} ${t._flags?.length ? "bg-warning/5" : ""}`}>
                        <td className="p-2 max-w-[260px] truncate" title={t.task_name}>{t.task_name}</td>
                        <td className="p-2">{t.discipline}</td>
                        <td className="p-2">{t.wo_type}</td>
                        <td className="p-2">{t.in_house ? "In" : "Vendor"}</td>
                        <td className="p-2">{t.statutory ? "Y" : ""}</td>
                        <td className="p-2 text-right text-mono">{t.num_assets}</td>
                        <td className="p-2 text-right text-mono">{t.mins_per_asset}</td>
                        <td className="p-2 text-right text-mono">{t.periodicity_multiplier}</td>
                        <td className="p-2 text-right text-mono font-semibold">{fmt.n(t.hours_per_year ?? 0, 1)}</td>
                        <td className="p-2 text-mono text-muted-foreground">{t.sfg20_code ?? ""}</td>
                        <td className="p-2">
                          {t._flags?.length ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-warning"><AlertTriangle size={10}/>{t._flags.join(" · ")}</span>
                          ) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedPreview.length > 200 && (
                  <div className="p-2 text-center text-[10px] text-muted-foreground">+ {parsedPreview.length - 200} more rows (will be imported)</div>
                )}
              </Card>

              <div className="flex justify-between items-center gap-3 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Confirming will <strong>replace</strong> all {tasks.length} existing task(s) for this site.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={()=>setImportState(null)} className="gap-2"><X size={14}/> Cancel</Button>
                  <Button onClick={()=>replaceTasks.mutate(parsedPreview)} disabled={replaceTasks.isPending || parsedPreview.length === 0} className="gap-2">
                    <Save size={14}/> {replaceTasks.isPending ? "Importing…" : `Confirm & import ${parsedPreview.length}`}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Filters */}
      {tasks.length > 0 && (
        <Card className="p-3 flex flex-wrap gap-2">
          <FilterSelect label="Discipline" value={filter.discipline} onChange={v=>setFilter(f=>({...f, discipline: v}))}
                        options={[["all","All"], ...DISCIPLINES.map(d=>[d,d] as [string,string])]}/>
          <FilterSelect label="WO type" value={filter.wo} onChange={v=>setFilter(f=>({...f, wo: v}))}
                        options={[["all","All"], ...WO_TYPES.map(d=>[d,d] as [string,string])]}/>
          <FilterSelect label="Source" value={filter.source} onChange={v=>setFilter(f=>({...f, source: v}))}
                        options={[["all","All"],["in","In-house"],["out","Vendor"]]}/>
          <FilterSelect label="Statutory" value={filter.stat} onChange={v=>setFilter(f=>({...f, stat: v}))}
                        options={[["all","All"],["yes","Yes"],["no","No"]]}/>
          <div className="ml-auto text-[11px] text-muted-foreground self-center text-mono">{filtered.length} / {tasks.length}</div>
        </Card>
      )}

      {/* Read-only task table */}
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
              <th className="p-3 text-right">×/yr</th>
              <th className="p-3 text-right">Hrs/yr</th>
              <th className="p-3">SFG20</th>
              {canWrite && <th className="p-3"></th>}
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground text-sm">
                No tasks yet — upload a CAFM .xlsx export to populate the schedule.
              </td></tr>
            )}
            {filtered.map(t => (
              <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="p-3">
                  {t.task_name}
                  {t.statutory && <span className="ml-2"><Pill tone="warning">STAT</Pill></span>}
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

function FilterSelect({ label, value, onChange, options }:{
  label: string; value: string; onChange: (v: string) => void; options: [string,string][];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-36 text-xs"><SelectValue/></SelectTrigger>
        <SelectContent>{options.map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
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
                <Pill tone="primary">{d.discipline}</Pill>
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
                <Pill tone="primary">{fmt.pct(g.share, 0)}</Pill>
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
        {(() => {
          const slots = Math.max(1, site.concurrent_shifts);
          const avail = availabilityRatio(site);
          const perSlot = Math.ceil(Math.max(1, site.min_on_site) / Math.max(0.0001, avail));
          const totalCrew = slots * perSlot;
          const pmFTE = calc.fte;
          const underStaffed = pmFTE < totalCrew - 0.05;
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="People per shift slot" value={String(perSlot)} sub="incl. absence cover" />
                <Metric label="Concurrent slots" value={String(slots)} />
                <Metric label="Min crew to operate" value={String(totalCrew)} accent sub="per trade, before workload" />
                <Metric label="PM workload FTE" value={fmt.fte(pmFTE)} />
              </div>
              {underStaffed && (
                <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning-foreground">
                  <strong className="text-warning flex items-center gap-1"><AlertTriangle size={12}/> Workload below minimum viable crew:</strong>{" "}
                  PM workload requires <strong className="text-mono">{fmt.fte(pmFTE)}</strong> FTE but a {site.shift_model} pattern
                  requires a minimum of <strong className="text-mono">{totalCrew}</strong> people to operate safely with absence cover.
                  Consider a lighter shift pattern, sharing crew across trades, or absorbing reactive scope to justify the headcount.
                </div>
              )}
              {isShiftTeam(site.shift_model) && !underStaffed && (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  A {site.shift_model} pattern needs {slots} engineers on shift at all times to maintain min-on-site of {site.min_on_site}.
                  After ~{fmt.pct(1 - avail, 0)} absence uplift, the practical crew is{" "}
                  <strong className="text-mono text-foreground">{totalCrew}</strong> per trade — independent of workload.
                </div>
              )}
            </div>
          );
        })()}
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
