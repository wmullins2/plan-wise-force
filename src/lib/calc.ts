// SAMP — FM labour loading calculations
// Pure functions, no React. Drives the entire labour-loading output.

export type Discipline = "HVAC" | "Electrical" | "Plumbing" | "BMS" | "Fabric" | "Supervisor" | "General";
export type WOType = "PM" | "Inspection" | "Statutory" | "Recurring";
export type ShiftModel = "Day work" | "Continental 4on4off 12h" | "3-shift rotating 8h" | "2-shift early/late 8h" | "Custom";
export type OperatingPattern = "Mon-Fri 08-17" | "Mon-Sat 08-17" | "Extended 07-19 Mon-Fri" | "24/7 continuous" | "24/5 Mon-Fri" | "Custom";

export const DISCIPLINES: Discipline[] = ["HVAC","Electrical","Plumbing","BMS","Fabric","Supervisor","General"];
export const WO_TYPES: WOType[] = ["PM","Inspection","Statutory","Recurring"];

export const TRADE_GROUPS = {
  Mechanical: ["HVAC","Plumbing","BMS","General"] as Discipline[],
  Electrical: ["Electrical"] as Discipline[],
  Fabric: ["Fabric"] as Discipline[],
  Supervisor: ["Supervisor"] as Discipline[],
};

export const TRADE_DESCRIPTIONS: Record<keyof typeof TRADE_GROUPS, string> = {
  Mechanical: "HVAC, plumbing, BMS and general mechanical PPM. Typically the largest trade workload on FM contracts.",
  Electrical: "LV distribution, lighting, emergency lighting, fire alarm support and electrical statutory inspections.",
  Fabric: "Building fabric repairs, joinery, decoration, doors, finishes and minor builder works.",
  Supervisor: "Site supervision, CAFM management, vendor coordination, quality and compliance oversight.",
};

export const FREQUENCIES: Record<string, number> = {
  Daily: 365, Weekly: 52, Fortnightly: 26, Monthly: 12,
  Quarterly: 4, "6-Monthly": 2, Annual: 1, "2-Yearly": 0.5, "5-Yearly": 0.2,
};

export const SFG20_BENCHMARKS: Record<string, number> = {
  "87-19": 30, "37-01": 45, "04-02": 20, "04-01": 15, "88-35": 60,
  "14-18": 10, "63-05": 90, "39-10": 30, "30-20": 45, "11-01": 60,
  "04-05": 25, "17-10": 120, "34-01": 60, "37-05": 30, "39-05": 45,
};

export const OPERATING_PATTERN_DEFAULTS: Record<OperatingPattern, { hoursPerShift: number; concurrentShifts: number; workDays: number }> = {
  "Mon-Fri 08-17":            { hoursPerShift: 9,  concurrentShifts: 1, workDays: 260 },
  "Mon-Sat 08-17":            { hoursPerShift: 9,  concurrentShifts: 1, workDays: 312 },
  "Extended 07-19 Mon-Fri":   { hoursPerShift: 12, concurrentShifts: 1, workDays: 252 },
  "24/7 continuous":          { hoursPerShift: 12, concurrentShifts: 2, workDays: 365 },
  "24/5 Mon-Fri":             { hoursPerShift: 8,  concurrentShifts: 3, workDays: 260 },
  "Custom":                   { hoursPerShift: 8,  concurrentShifts: 1, workDays: 252 },
};

export type Site = {
  id: string;
  name: string;
  client: string;
  location: string;
  contract_type: string;
  reactive_hours_per_year: number;
  operating_pattern: OperatingPattern;
  shift_model: ShiftModel;
  hours_per_shift: number;
  concurrent_shifts: number;
  work_days_per_year: number;
  min_on_site: number;
  annual_leave_days: number;
  sickness_days: number;
  training_days: number;
  wt_travel: number; wt_idle: number; wt_permits: number; wt_parts: number;
  wt_coordination: number; wt_meetings: number; wt_setup: number; wt_cleanup: number;
  wt_breakin: number; wt_training: number; wt_escorting: number; wt_admin: number;
};

export type PMTask = {
  id: string;
  site_id: string;
  task_name: string;
  in_house: boolean;
  wo_type: WOType;
  discipline: Discipline;
  statutory: boolean;
  num_assets: number;
  mins_per_asset: number;
  frequency: string;
  periodicity_multiplier: number;
  hours_per_year: number;
  sfg20_code: string | null;
  notes: string | null;
};

export const WRENCH_FACTORS = [
  { key: "wt_travel",       label: "Travel time" },
  { key: "wt_idle",         label: "Idle (cross team comms)" },
  { key: "wt_permits",      label: "Permits" },
  { key: "wt_parts",        label: "Parts" },
  { key: "wt_coordination", label: "Coordination" },
  { key: "wt_meetings",     label: "Meetings" },
  { key: "wt_setup",        label: "Set up (LOTO, SSOW, tools)" },
  { key: "wt_cleanup",      label: "Clean up" },
  { key: "wt_breakin",      label: "Break-in work" },
  { key: "wt_training",     label: "Training" },
  { key: "wt_escorting",    label: "Escorting vendors" },
  { key: "wt_admin",        label: "Admin (WO input, BMS checks)" },
] as const;

export function totalLossPerShift(site: Site): number {
  return WRENCH_FACTORS.reduce((s, f) => s + (site[f.key as keyof Site] as number || 0), 0);
}

export function wrenchTimePct(site: Site): number {
  const loss = totalLossPerShift(site);
  const productive = site.hours_per_shift - loss;
  return site.hours_per_shift > 0 ? Math.max(0, productive / site.hours_per_shift) : 0;
}

export function annualHoursPerEmployee(site: Site): number {
  return site.hours_per_shift * site.work_days_per_year;
}

export function productiveHoursPerEmployee(site: Site): number {
  return annualHoursPerEmployee(site) * wrenchTimePct(site);
}

export function taskHoursPerYear(t: PMTask): number {
  if (t.hours_per_year && t.hours_per_year > 0) return t.hours_per_year;
  const periodicity = t.periodicity_multiplier || FREQUENCIES[t.frequency] || 0;
  return (t.num_assets * t.mins_per_asset * periodicity) / 60;
}

export function inHouseHoursPerYear(tasks: PMTask[]): number {
  return tasks.filter(t => t.in_house).reduce((s, t) => s + taskHoursPerYear(t), 0);
}
export function vendorHoursPerYear(tasks: PMTask[]): number {
  return tasks.filter(t => !t.in_house).reduce((s, t) => s + taskHoursPerYear(t), 0);
}

export function totalFTE(site: Site, tasks: PMTask[]): number {
  const productive = productiveHoursPerEmployee(site);
  const inHouse = inHouseHoursPerYear(tasks);
  const reactive = site.reactive_hours_per_year || 0;
  if (productive <= 0) return 0;
  return (inHouse + reactive) / productive;
}

export function headcountAt100(site: Site, tasks: PMTask[]): number {
  const annual = annualHoursPerEmployee(site);
  if (annual <= 0) return 0;
  return (inHouseHoursPerYear(tasks) + (site.reactive_hours_per_year || 0)) / annual;
}

export function shiftSlots(model: ShiftModel): number {
  if (model === "Continental 4on4off 12h") return 2;
  if (model === "3-shift rotating 8h") return 3;
  if (model === "2-shift early/late 8h") return 2;
  return 1;
}

export function isShiftTeam(model: ShiftModel): boolean {
  return shiftSlots(model) > 1;
}

export function availabilityRatio(site: Site): number {
  const absence = site.annual_leave_days + site.sickness_days + site.training_days;
  const available = Math.max(1, site.work_days_per_year - absence);
  return available / site.work_days_per_year;
}

export type CoverResult = {
  rawFTE: number;
  absenceAdjusted: number;
  minOnSiteRule: number;
  recommended: number;
  coverPremium: number;
  flag: boolean;
};

export function coverAdjusted(site: Site, rawFTE: number): CoverResult {
  const ratio = availabilityRatio(site);
  const absenceAdjusted = ratio > 0 ? rawFTE / ratio : rawFTE;
  let minOnSiteRule: number;
  if (isShiftTeam(site.shift_model)) {
    const slots = shiftSlots(site.shift_model);
    minOnSiteRule = (site.min_on_site * slots) / Math.max(ratio, 0.0001);
  } else {
    minOnSiteRule = site.min_on_site / Math.max(ratio, 0.0001);
  }
  const recommended = Math.max(absenceAdjusted, minOnSiteRule);
  const coverPremium = Math.max(0, recommended - rawFTE);
  const flag = rawFTE > 0 ? (recommended / rawFTE) > 1.5 : recommended > 0;
  return { rawFTE, absenceAdjusted, minOnSiteRule, recommended, coverPremium, flag };
}

export type DisciplineRow = {
  discipline: Discipline;
  tradeGroup: keyof typeof TRADE_GROUPS;
  hours: number;
  fte: number;
  taskCount: number;
  pmHours: number;
  inspectionHours: number;
  otherHours: number;
  statutoryHours: number;
  shareOfLoad: number;
};

export function disciplineBreakdown(site: Site, tasks: PMTask[]): DisciplineRow[] {
  const productive = productiveHoursPerEmployee(site);
  const totalHours = inHouseHoursPerYear(tasks);
  const groupOf = (d: Discipline): keyof typeof TRADE_GROUPS => {
    for (const [g, ds] of Object.entries(TRADE_GROUPS)) {
      if ((ds as Discipline[]).includes(d)) return g as keyof typeof TRADE_GROUPS;
    }
    return "Mechanical";
  };
  return DISCIPLINES.map(d => {
    const dt = tasks.filter(t => t.in_house && t.discipline === d);
    const hours = dt.reduce((s,t) => s + taskHoursPerYear(t), 0);
    const pmHours = dt.filter(t => t.wo_type === "PM").reduce((s,t) => s+taskHoursPerYear(t), 0);
    const inspectionHours = dt.filter(t => t.wo_type === "Inspection").reduce((s,t) => s+taskHoursPerYear(t), 0);
    const statHours = dt.filter(t => t.statutory).reduce((s,t) => s+taskHoursPerYear(t), 0);
    return {
      discipline: d,
      tradeGroup: groupOf(d),
      hours,
      fte: productive > 0 ? hours / productive : 0,
      taskCount: dt.length,
      pmHours,
      inspectionHours,
      otherHours: hours - pmHours - inspectionHours,
      statutoryHours: statHours,
      shareOfLoad: totalHours > 0 ? hours / totalHours : 0,
    };
  });
}

export type TradeGroupRow = {
  group: keyof typeof TRADE_GROUPS;
  description: string;
  feedDisciplines: Discipline[];
  hours: number;
  fte: number;
  share: number;
  recommendedHeadcount: number;
  cover: CoverResult;
};

export function tradeGroupRollup(site: Site, tasks: PMTask[]): TradeGroupRow[] {
  const disc = disciplineBreakdown(site, tasks);
  const totalH = disc.reduce((s,r) => s+r.hours, 0);
  return (Object.keys(TRADE_GROUPS) as Array<keyof typeof TRADE_GROUPS>).map(g => {
    const rows = disc.filter(r => r.tradeGroup === g);
    const hours = rows.reduce((s,r) => s+r.hours, 0);
    const fte = rows.reduce((s,r) => s+r.fte, 0);
    const cover = coverAdjusted(site, fte);
    return {
      group: g,
      description: TRADE_DESCRIPTIONS[g],
      feedDisciplines: TRADE_GROUPS[g],
      hours,
      fte,
      share: totalH > 0 ? hours / totalH : 0,
      recommendedHeadcount: Math.ceil(cover.recommended),
      cover,
    };
  });
}

export const SENSITIVITY_LEVELS = [0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65];

export function sensitivityTable(site: Site, tasks: PMTask[]) {
  const annual = annualHoursPerEmployee(site);
  const inHouse = inHouseHoursPerYear(tasks) + (site.reactive_hours_per_year || 0);
  const current = wrenchTimePct(site);
  return SENSITIVITY_LEVELS.map(level => {
    const productive = annual * level;
    return {
      level,
      fte: productive > 0 ? inHouse / productive : 0,
      current: Math.abs(level - Math.round(current * 20) / 20) < 0.025,
    };
  });
}

export function statutorySplit(tasks: PMTask[], site: Site) {
  const productive = productiveHoursPerEmployee(site);
  const stat = tasks.filter(t => t.in_house && t.statutory).reduce((s,t) => s+taskHoursPerYear(t), 0);
  const nonStat = tasks.filter(t => t.in_house && !t.statutory).reduce((s,t) => s+taskHoursPerYear(t), 0);
  return {
    statutoryHours: stat,
    nonStatutoryHours: nonStat,
    statutoryFTE: productive > 0 ? stat / productive : 0,
    nonStatutoryFTE: productive > 0 ? nonStat / productive : 0,
  };
}

export function woTypeSplit(tasks: PMTask[]) {
  const total = inHouseHoursPerYear(tasks);
  return WO_TYPES.map(t => {
    const hours = tasks.filter(x => x.in_house && x.wo_type === t).reduce((s,x) => s+taskHoursPerYear(x), 0);
    return { wo_type: t, hours, pct: total > 0 ? hours/total : 0 };
  });
}

export function sfg20Comparison(tasks: PMTask[]) {
  return tasks
    .filter(t => t.sfg20_code && SFG20_BENCHMARKS[t.sfg20_code])
    .map(t => {
      const benchmark = SFG20_BENCHMARKS[t.sfg20_code!];
      const yours = t.mins_per_asset;
      const variance = benchmark > 0 ? (yours - benchmark) / benchmark : 0;
      let flag: "OK" | "Over" | "Under" = "OK";
      if (Math.abs(variance) > 0.2) flag = variance > 0 ? "Over" : "Under";
      return { task: t.task_name, code: t.sfg20_code!, yours, benchmark, variance, flag };
    });
}

export const fmt = {
  n: (v: number, d = 0) => Number.isFinite(v) ? v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—",
  pct: (v: number, d = 1) => Number.isFinite(v) ? (v * 100).toFixed(d) + "%" : "—",
  hrs: (v: number) => fmt.n(v, 0) + " h",
  fte: (v: number) => fmt.n(v, 2),
  gbp: (v: number) => "£" + fmt.n(v, 0),
};

/* ============= Coverage-based shift pattern recommendation ============= */
export type CoverageDays = "Mon-Fri" | "Mon-Sat" | "Mon-Sun" | "24h";

export const COVERAGE_DAYS: CoverageDays[] = ["Mon-Fri", "Mon-Sat", "Mon-Sun", "24h"];

export const COVERAGE_DAY_DEFAULTS: Record<CoverageDays, { daysPerWeek: number; workDaysPerYear: number }> = {
  "Mon-Fri": { daysPerWeek: 5, workDaysPerYear: 260 },
  "Mon-Sat": { daysPerWeek: 6, workDaysPerYear: 312 },
  "Mon-Sun": { daysPerWeek: 7, workDaysPerYear: 365 },
  "24h":     { daysPerWeek: 7, workDaysPerYear: 365 },
};

export function coverageHoursPerDay(start: string, end: string): number {
  // "HH:MM" → hours per day. start==end (or 00:00→00:00) means 24h.
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const a = toMin(start), b = toMin(end);
  if (a === b) return 24;
  const diff = b > a ? b - a : (24 * 60 - a) + b;
  return diff / 60;
}

export type ShiftRecommendation = {
  patternName: string;
  shiftModel: ShiftModel;
  operatingPattern: OperatingPattern;
  hoursPerShift: number;
  shiftsPerDay: number;          // concurrent / sequential slots covering the day
  workDaysPerYear: number;
  reason: string;
  simultaneousSlots: number;     // how many slots must be staffed in parallel at any moment
  minCrewToOperate: number;      // min people to run the pattern (per role) before absence
  coverageHoursPerDay: number;
  coverageDays: CoverageDays;
};

export function recommendShiftPattern(
  coverageHoursDay: number,
  days: CoverageDays,
  minOnSite: number = 1,
): ShiftRecommendation {
  const h = Math.max(0, Math.min(24, coverageHoursDay));
  const wd = COVERAGE_DAY_DEFAULTS[days].workDaysPerYear;

  // 24/7 (or near-24 across 7 days) → Continental
  if (h >= 23.5 && days === "Mon-Sun") {
    return {
      patternName: "Continental 4-on / 4-off",
      shiftModel: "Continental 4on4off 12h",
      operatingPattern: "24/7 continuous",
      hoursPerShift: 12, shiftsPerDay: 2, workDaysPerYear: 365,
      reason: "24/7 coverage needs two 12-hour shifts every day of the year.",
      simultaneousSlots: 2,
      minCrewToOperate: Math.max(4, 2 * Math.max(1, minOnSite) * 2),
      coverageHoursPerDay: h, coverageDays: days,
    };
  }
  // 24h Mon-Fri → 3-shift rotating
  if (h >= 23.5 && days === "Mon-Fri") {
    return {
      patternName: "3-shift rotating",
      shiftModel: "3-shift rotating 8h",
      operatingPattern: "24/5 Mon-Fri",
      hoursPerShift: 8, shiftsPerDay: 3, workDaysPerYear: 252,
      reason: "24 hours weekday-only fits three 8-hour rotating shifts.",
      simultaneousSlots: 3,
      minCrewToOperate: Math.max(3, 3 * Math.max(1, minOnSite)),
      coverageHoursPerDay: h, coverageDays: days,
    };
  }
  // 14-24h any days → Continental
  if (h >= 14) {
    return {
      patternName: "Continental 4-on / 4-off",
      shiftModel: "Continental 4on4off 12h",
      operatingPattern: "24/7 continuous",
      hoursPerShift: 12, shiftsPerDay: 2, workDaysPerYear: wd,
      reason: `${h.toFixed(1)}h/day across ${days} is most efficient on a 12-hour continental rota.`,
      simultaneousSlots: 2,
      minCrewToOperate: Math.max(4, 2 * Math.max(1, minOnSite) * 2),
      coverageHoursPerDay: h, coverageDays: days,
    };
  }
  // 12+ hours weekday → 2-shift 12h
  if (h >= 12 && days === "Mon-Fri") {
    return {
      patternName: "Extended day / 2-shift 12h",
      shiftModel: "2-shift early/late 8h",
      operatingPattern: "Extended 07-19 Mon-Fri",
      hoursPerShift: 12, shiftsPerDay: 1, workDaysPerYear: 252,
      reason: `${h.toFixed(1)}h weekday coverage suits an extended 12h day or paired 12h shifts.`,
      simultaneousSlots: 1,
      minCrewToOperate: Math.max(1, minOnSite),
      coverageHoursPerDay: h, coverageDays: days,
    };
  }
  // Up to 12h Mon-Sat → 2-shift Mon-Sat
  if (h <= 12 && days === "Mon-Sat") {
    return {
      patternName: "2-shift early/late · Mon–Sat",
      shiftModel: "2-shift early/late 8h",
      operatingPattern: "Mon-Sat 08-17",
      hoursPerShift: 8, shiftsPerDay: 2, workDaysPerYear: 300,
      reason: `${h.toFixed(1)}h × 6 days fits paired 8h early/late shifts.`,
      simultaneousSlots: 2,
      minCrewToOperate: Math.max(2, 2 * Math.max(1, minOnSite)),
      coverageHoursPerDay: h, coverageDays: days,
    };
  }
  // 10-14h Mon-Fri → 2-shift early/late
  if (h > 10 && h < 12 && days === "Mon-Fri") {
    return {
      patternName: "Early / Late 2-shift",
      shiftModel: "2-shift early/late 8h",
      operatingPattern: "Extended 07-19 Mon-Fri",
      hoursPerShift: 8, shiftsPerDay: 2, workDaysPerYear: 252,
      reason: `${h.toFixed(1)}h weekday coverage is best served by overlapping early and late 8h shifts.`,
      simultaneousSlots: 2,
      minCrewToOperate: Math.max(2, 2 * Math.max(1, minOnSite)),
      coverageHoursPerDay: h, coverageDays: days,
    };
  }
  // Default: up to 10h Mon-Fri → day work
  return {
    patternName: "Day work — single shift",
    shiftModel: "Day work",
    operatingPattern: days === "Mon-Sat" ? "Mon-Sat 08-17" : "Mon-Fri 08-17",
    hoursPerShift: Math.max(8, Math.min(10, Math.ceil(h))),
    shiftsPerDay: 1,
    workDaysPerYear: wd,
    reason: `${h.toFixed(1)}h/day × ${days} fits a standard single day-work shift.`,
    simultaneousSlots: 1,
    minCrewToOperate: Math.max(1, minOnSite),
    coverageHoursPerDay: h, coverageDays: days,
  };
}

export function minViableCrew(rec: ShiftRecommendation, availability: number): number {
  // people needed per role to staff every slot allowing for absence
  const base = rec.simultaneousSlots * Math.max(1, 1); // 1 person per slot baseline
  return Math.ceil(base / Math.max(0.0001, availability));
}
