import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { aiAnalyse } from "@/lib/ai.functions";
import {
  totalFTE, inHouseHoursPerYear, vendorHoursPerYear, wrenchTimePct,
  disciplineBreakdown, tradeGroupRollup, statutorySplit, woTypeSplit,
  type Site, type PMTask, fmt,
} from "@/lib/calc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/samp-ui";
import { Sparkles, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ai")({
  head: () => ({ meta: [{ title: "AI Analysis — SAMP" }] }),
  component: AIPage,
});

const QUICK_PROMPTS = [
  { label: "Wrench-time review", text: "Review my wrench-time factors against FM industry norms. Flag any that look off and recommend tightening targets." },
  { label: "Engineer headcount", text: "Is my recommended headcount realistic given the workload, shift pattern and statutory load? Where would you push back?" },
  { label: "Discipline analysis", text: "Analyse the discipline mix. Which trade is over- or under-loaded versus what you'd expect for this contract type?" },
  { label: "Industry benchmarks", text: "How does this site compare against BIFM / SFG20 benchmarks for total maintenance hours per m² (estimate) and FTE intensity?" },
  { label: "SFG20 anomalies", text: "List any tasks where the duration deviates more than 20% from SFG20 benchmarks and explain likely causes." },
];

function AIPage() {
  const { data: sites } = useQuery({
    queryKey: ["sites-min"],
    queryFn: async () => {
      const { data } = await supabase.from("sites").select("*").order("name");
      return (data ?? []) as Site[];
    },
  });
  const [siteId, setSiteId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [draft, setDraft] = useState("");
  const askFn = useServerFn(aiAnalyse);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteId && sites?.length) setSiteId(sites[0].id);
  }, [sites, siteId]);

  const { data: tasks } = useQuery({
    queryKey: ["tasks", siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const { data } = await supabase.from("pm_tasks").select("*").eq("site_id", siteId!);
      return (data ?? []) as PMTask[];
    },
  });

  const site = sites?.find(s => s.id === siteId);
  const context = useMemo(() => {
    if (!site || !tasks) return "No site selected.";
    const disc = disciplineBreakdown(site, tasks);
    const trades = tradeGroupRollup(site, tasks);
    const stat = statutorySplit(tasks, site);
    const wo = woTypeSplit(tasks.filter(t=>t.in_house));
    return `SITE: ${site.name} (${site.client}, ${site.location})
Contract: ${site.contract_type}
Operating pattern: ${site.operating_pattern} | Shift model: ${site.shift_model}
Hours/shift: ${site.hours_per_shift} | Concurrent shifts: ${site.concurrent_shifts} | Work days: ${site.work_days_per_year} | Min on site: ${site.min_on_site}
Annual leave: ${site.annual_leave_days}, Sickness: ${site.sickness_days}, Training: ${site.training_days}

WRENCH TIME FACTORS (hrs/shift):
travel=${site.wt_travel}, idle=${site.wt_idle}, permits=${site.wt_permits}, parts=${site.wt_parts},
coord=${site.wt_coordination}, meetings=${site.wt_meetings}, setup=${site.wt_setup}, cleanup=${site.wt_cleanup},
breakin=${site.wt_breakin}, training=${site.wt_training}, escorting=${site.wt_escorting}, admin=${site.wt_admin}
=> Wrench time: ${fmt.pct(wrenchTimePct(site))}

WORKLOAD:
In-house: ${fmt.n(inHouseHoursPerYear(tasks))} hrs/yr | Vendor: ${fmt.n(vendorHoursPerYear(tasks))} hrs/yr | Reactive: ${site.reactive_hours_per_year} hrs/yr
Total FTE required (in-house): ${fmt.fte(totalFTE(site, tasks))}

DISCIPLINE BREAKDOWN:
${disc.filter(d=>d.hours>0).map(d => `- ${d.discipline} (${d.tradeGroup}): ${fmt.n(d.hours)} hrs, ${fmt.fte(d.fte)} FTE, ${d.taskCount} tasks, statutory ${fmt.n(d.statutoryHours)} hrs`).join("\n")}

TRADE GROUPS WITH SHIFT-COVER:
${trades.map(t => `- ${t.group}: raw ${fmt.fte(t.fte)} FTE → recommended ${t.recommendedHeadcount} (cover premium +${fmt.fte(t.cover.coverPremium)}${t.cover.flag ? " ⚠ flagged" : ""})`).join("\n")}

STATUTORY: ${fmt.n(stat.statutoryHours)} hrs (${fmt.fte(stat.statutoryFTE)} FTE) vs Non-stat ${fmt.n(stat.nonStatutoryHours)} hrs
WO TYPE: ${wo.map(w => `${w.wo_type} ${fmt.pct(w.pct, 0)}`).join(" | ")}

TOP 8 TASKS BY HOURS:
${[...tasks].sort((a,b) => (b.hours_per_year||0)-(a.hours_per_year||0)).slice(0, 8).map(t => `- ${t.task_name} (${t.discipline}, ${t.wo_type}${t.statutory?", STAT":""}, SFG20:${t.sfg20_code||"—"})`).join("\n")}`;
  }, [site, tasks]);

  const ask = useMutation({
    mutationFn: async (message: string) => askFn({ data: { context, history, message } }),
    onSuccess: (res, message) => {
      setHistory(h => [...h, { role: "user", content: message }, { role: "assistant", content: res.reply }]);
      setDraft("");
      setTimeout(() => scrollerRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-[1200px] space-y-6 h-screen flex flex-col">
      <PageHeader
        title="AI Analysis"
        subtitle="Senior FM consultant with knowledge of ISO 55000, SFG20, CIBSE and BIFM."
        right={
          <div className="flex items-center gap-2 min-w-[260px]">
            <Select value={siteId ?? ""} onValueChange={setSiteId}>
              <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
              <SelectContent>
                {sites?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map(q => (
          <button key={q.label} disabled={!site || ask.isPending}
                  onClick={() => ask.mutate(q.text)}
                  className="text-xs px-3 py-1.5 rounded-full bg-secondary hover:bg-accent border border-border text-secondary-foreground disabled:opacity-50">
            {q.label}
          </button>
        ))}
      </div>

      <Card ref={scrollerRef as any} className="flex-1 overflow-y-auto p-6 space-y-4 min-h-[300px]">
        {history.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-12">
            <Sparkles className="mx-auto mb-3 text-primary" size={32}/>
            <p>Ask anything about <strong className="text-foreground">{site?.name ?? "this site"}</strong>.</p>
            <p className="text-xs mt-1">Full site context — operating pattern, wrench-time, tasks, FTE — is included automatically.</p>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-primary/15 text-foreground border border-primary/30"
                : "bg-card border border-border"
            }`}>{m.content}</div>
          </div>
        ))}
        {ask.isPending && <div className="text-xs text-muted-foreground text-mono">Analysing…</div>}
      </Card>

      <form onSubmit={e=>{ e.preventDefault(); if (draft.trim()) ask.mutate(draft.trim()); }} className="flex gap-2">
        <Textarea value={draft} onChange={e=>setDraft(e.target.value)}
          placeholder="Ask about wrench time, headcount, statutory exposure…"
          className="resize-none" rows={2}
          onKeyDown={e=>{ if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (draft.trim()) ask.mutate(draft.trim()); } }} />
        <Button type="submit" disabled={!draft.trim() || ask.isPending} className="self-end gap-2"><Send size={14}/> Send</Button>
      </form>
    </div>
  );
}
