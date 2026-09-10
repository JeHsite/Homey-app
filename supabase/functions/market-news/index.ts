// Homey — חדשות כלכלה (Finnhub). המפתח נשמר כסוד FINNHUB_KEY ב-Supabase.
// "Verify JWT with legacy secret" כבוי (ההמלצה של Supabase; טוקנים חדשים לא נחתמים במפתח הישן).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const key = Deno.env.get("FINNHUB_KEY");
    if (!key) throw new Error("missing key");

    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`);
    const all = await res.json();

    const news = (all || []).slice(0, 6).map((n: any) => ({
      headline: n.headline,
      summary: (n.summary || "").slice(0, 200),
      source: n.source,
      url: n.url,
      datetime: n.datetime,
    }));

    return new Response(JSON.stringify({ news }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ news: [], error: "unavailable" }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
