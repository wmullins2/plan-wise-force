import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  totalFTE, inHouseHoursPerYear, vendorHoursPerYear, wrenchTimePct,
  disciplineBreakdown, woTypeSplit, fmt,
  type Site, type PMTask,
} from "@/lib/calc";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — SAMP" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn: async () => {
      const { data: sites, error } = await supabase.from("sites").select("*");
      if (error) throw error;
      const { data: tasks } = await supabase.from("pm_tasks").select("*");
      return { sites: (sites ?? []) as Site[], tasks: (tasks ?? []) as PMTask[] };
    },
  });

  if (isLoading) return <PageHeader title="Dashboard" subtitle="Loading portfolio…" />;

  const sites = data?.sites ?? [];
  const tasks = data?.tasks ?? [];

  if (sites.length === 0) {
    return (
      <div className="p-8">
        <PageHeader title="Dashboard" subtitle="Portfolio overview across all sites" />
        <Card className="mt-8 p-12 text-center border-dashed">
          <Building2 className="mx-auto mb-4 text-muted-foreground" size={48} />
          <h3 className="text-lg font-semibold">No sites yet</h3>
          <p className="text-sm text-muted-foreground mt-2">Create your first site to start labour loading.</p>
          <Link to="/sites">
            <Button className="mt-4 gap-2"><Plus size={16} /> Add site</Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Aggregate
  const totalPM = tasks.length;
  const totalInHouse = sites.reduce((s, site) => s + inHouseHoursPerYear(tasks.filter(t => t.site_id === site.id)), 0);
  const totalVendor = sites.reduce((s, site) => s + vendorHoursPerYear(tasks.filter(t => t.site_id === site.id)), 0);
  const avgWrench = sites.reduce((s, site) => s + wrenchTimePct(site), 0) / sites.length;
  const totalFTEs = sites.reduce((s, site) => s + totalFTE(site, tasks.filter(t => t.site_id === site.id)), 0);

  const perSite = sites.map(site => {
    const st = tasks.filter(t => t.site_id === site.id);
    return {
      name: site.name.length > 16 ? site.name.slice(0, 14) + "…" : site.name,
      inHouse: Math.round(inHouseHoursPerYear(st)),
      vendor: Math.round(vendorHoursPerYear(st)),
    };
  });

  // discipline aggregate
  const discAgg: Record<string, number> = {};
  sites.forEach(site => {
    disciplineBreakdown(site, tasks.filter(t => t.site_id === site.id)).forEach(d => {
      discAgg[d.discipline] = (discAgg[d.discipline] ?? 0) + d.hours;
    });
  });
  const discData = Object.entries(discAgg).map(([k, v]) => ({ discipline: k, hours: Math.round(v) }))
    .sort((a, b) => b.hours - a.hours);

  // WO type aggregate
  const woAgg = woTypeSplit(tasks.filter(t => t.in_house));
  const COLORS = ["#c8f04a", "#5fb8ff", "#f4b942", "#c084fc", "#ff7a7a"];

  return (
    <div className="p-8 space-y-8 max-w-[1600px]">
      <PageHeader title="Portfolio dashboard" subtitle={`${sites.length} site${sites.length>1?"s":""} · ${totalPM} PM tasks`} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metric label="Sites" value={fmt.n(sites.length)} />
        <Metric label="PM tasks" value={fmt.n(totalPM)} />
        <Metric label="In-house hrs/yr" value={fmt.n(totalInHouse)} />
        <Metric label="Vendor hrs/yr" value={fmt.n(totalVendor)} />
        <Metric label="Avg wrench time" value={fmt.pct(avgWrench)} accent />
        <Metric label="Total FTE" value={fmt.fte(totalFTEs)} accent />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">In-house vs vendor hours by site</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perSite}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.27 0.012 250)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.65 0.015 250)" }} />
                <YAxis tick={{ fontSize: 11, fill: "oklch(0.65 0.015 250)" }} />
                <Tooltip contentStyle={{ background: "oklch(0.19 0.012 250)", border: "1px solid oklch(0.27 0.012 250)", borderRadius: 6 }} />
                <Bar dataKey="inHouse" fill="#c8f04a" name="In-house" />
                <Bar dataKey="vendor" fill="#5fb8ff" name="Vendor" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">WO type split</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={woAgg} dataKey="hours" nameKey="wo_type" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {woAgg.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "oklch(0.19 0.012 250)", border: "1px solid oklch(0.27 0.012 250)", borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              {woAgg.map((w, i) => (
                <div key={w.wo_type} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                  <span>{w.wo_type}</span>
                  <span className="text-mono text-muted-foreground">{fmt.pct(w.pct, 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4">Discipline breakdown · all sites</h3>
        <div style={{ height: Math.max(220, discData.length * 36) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={discData} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.27 0.012 250)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "oklch(0.65 0.015 250)" }} />
              <YAxis type="category" dataKey="discipline" tick={{ fontSize: 12, fill: "oklch(0.85 0.005 250)" }} width={80} />
              <Tooltip contentStyle={{ background: "oklch(0.19 0.012 250)", border: "1px solid oklch(0.27 0.012 250)", borderRadius: 6 }} />
              <Bar dataKey="hours" fill="#c8f04a" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`mt-2 text-2xl font-mono font-semibold ${accent ? "text-primary" : ""}`}>{value}</div>
    </Card>
  );
}
