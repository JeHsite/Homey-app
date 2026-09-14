// Homey — שערי המרה (Frankfurter, ללא מפתח). קאש יומי משותף בטבלת exchange_rates.
// "Verify JWT" כבוי (עקבי עם market-news) — read-mostly, קאש דה-פקטו של יום אחד, בלי מידע רגיש.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function toRatesMap(rows: { currency: string; rate_to_ils: number; date: string }[]) {
  const rates: Record<string, { rate_to_ils: number; date: string }> = {};
  for (const r of rows) rates[r.currency] = { rate_to_ils: Number(r.rate_to_ils), date: r.date };
  return rates;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date().toISOString().slice(0, 10);

  try {
    // מקרה 1: יש כבר קאש להיום
    const { data: cached } = await supabase
      .from("exchange_rates").select("currency, rate_to_ils, date").eq("date", today);
    if (cached && cached.length > 0) return json({ rates: toRatesMap(cached), stale: false });

    // מקרה 2: אין קאש להיום — שולפים מ-Frankfurter פעם אחת
    const res = await fetch("https://api.frankfurter.app/latest?base=ILS", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const data = await res.json(); // { amount, base:"ILS", date:"YYYY-MM-DD", rates: { USD: 0.328, ... } }

    const rateDate: string = data.date;
    const rows = [{ date: rateDate, currency: "ILS", rate_to_ils: 1 }];
    for (const [code, ilsPerUnit] of Object.entries(data.rates as Record<string, number>)) {
      // Frankfurter: 1 ILS = X <code> → 1 <code> = 1/X ILS
      if (ilsPerUnit > 0) rows.push({ date: rateDate, currency: code, rate_to_ils: 1 / ilsPerUnit });
    }

    const { error: upsertError } = await supabase
      .from("exchange_rates").upsert(rows, { onConflict: "date,currency" });
    if (upsertError) throw upsertError;

    const { data: fresh } = await supabase
      .from("exchange_rates").select("currency, rate_to_ils, date").eq("date", rateDate);
    return json({ rates: toRatesMap(fresh ?? rows), stale: false });
  } catch (_e) {
    // מקרה 3: Frankfurter למטה/timeout — נופלים לשער האחרון הידוע לכל מטבע, מכל תאריך
    const { data: latest } = await supabase
      .from("exchange_rates")
      .select("currency, rate_to_ils, date")
      .order("date", { ascending: false });
    if (!latest || latest.length === 0) return json({ rates: {}, stale: true });

    const seen = new Set<string>();
    const rows: typeof latest = [];
    for (const r of latest) {
      if (seen.has(r.currency)) continue;
      seen.add(r.currency);
      rows.push(r);
    }
    return json({ rates: toRatesMap(rows), stale: true });
  }
});
