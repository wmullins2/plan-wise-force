import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const messageSchema = z.object({
  context: z.string().min(1).max(40000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8000),
  })).max(40),
  message: z.string().min(1).max(4000),
});

const SYSTEM = `You are a senior Facilities Management consultant with 20+ years of experience. You are an expert in:
- ISO 55000 (asset management)
- SFG20 maintenance standards (the UK benchmark for PPM task durations)
- CIBSE technical guidance (HVAC, mechanical and electrical engineering)
- BIFM / IWFM workforce planning standards
- Wrench-time studies and labour productivity benchmarks (typical FM band: 35–55%)
- Shift planning, statutory compliance, and CAFM operations (Corrigo, Maximo, Planon)

You will be given the full site context: operating pattern, wrench-time factors, task summary by discipline, FTE calculations and shift-cover analysis.

Be specific, numerical, and actionable. Cite SFG20 codes and industry benchmarks. Flag risks clearly. Keep responses tight — bullet points and short paragraphs. Never invent data not provided in the context.`;

export const aiAnalyse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => messageSchema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI service not configured");

    const messages = [
      { role: "system", content: SYSTEM },
      { role: "system", content: "SITE CONTEXT:\n" + data.context },
      ...data.history,
      { role: "user", content: data.message },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("AI rate limit hit — try again shortly.");
      if (res.status === 402) throw new Error("AI usage credits exhausted. Top up Lovable AI to continue.");
      throw new Error(`AI request failed: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const reply = json?.choices?.[0]?.message?.content ?? "";
    return { reply };
  });
