// Shared small UI primitives used across SAMP pages
import { Card } from "@/components/ui/card";

export function Metric({ label, value, accent, sub }: { label: string; value: string; accent?: boolean; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`mt-2 text-2xl font-mono font-semibold ${accent ? "text-primary" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground text-mono">{sub}</div>}
    </Card>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "primary" | "warning" | "destructive" | "success" }) {
  const map: Record<string, string> = {
    default: "bg-secondary text-secondary-foreground",
    primary: "bg-primary/15 text-primary border border-primary/30",
    warning: "bg-warning/15 text-warning border border-warning/30",
    destructive: "bg-destructive/15 text-destructive border border-destructive/30",
    success: "bg-success/15 text-success border border-success/30",
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${map[tone]}`}>{children}</span>;
}
