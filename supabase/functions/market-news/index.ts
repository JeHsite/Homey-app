// Homey — חדשות כלכלה: Finnhub (עולמי, אנגלית) + גלובס RSS (ישראל, עברית), ממוזגים לפי זמן פרסום.
// FINNHUB_KEY נשמר כסוד ב-Supabase. גלובס לא דורש מפתח — RSS ציבורי.
// "Verify JWT with legacy secret" כבוי (ההמלצה של Supabase; טוקנים חדשים לא נחתמים במפתח הישן).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NewsItem = { headline: string; summary: string; source: string; url: string; datetime: number };

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  "#8226": "•", "#8206": "", "#8203": "",
};
function decodeEntities(s: string): string {
  // עד 3 מעברים: לפעמים & מגיע כפול-מקודד (&amp;#8226; -> &#8226; -> •) בפיד של גלובס
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
      if (ENTITIES[code] !== undefined) return ENTITIES[code];
      if (code[0] === "#") {
        const num = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(num) ? String.fromCodePoint(num) : m;
      }
      return m;
    });
    if (next === s) break;
    s = next;
  }
  return s;
}
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchFinnhub(): Promise<NewsItem[]> {
  const key = Deno.env.get("FINNHUB_KEY")?.trim(); // רווח מיותר בהדבקה שובר את המפתח
  if (!key) throw new Error("missing key");
  const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`);
  const all = await res.json();
  return (Array.isArray(all) ? all : []).slice(0, 30).map((n: any) => ({
    headline: String(n.headline || ""),
    summary: String(n.summary || "").slice(0, 200),
    source: String(n.source || "Finnhub"),
    url: String(n.url || ""),
    datetime: Number(n.datetime) || Math.floor(Date.now() / 1000),
  }));
}

// גלובס — RSS ציבורי, בלי מפתח. iID=2 הוא עמוד הבית (כלכלה, בורסה, הייטק, צרכנות וכו').
async function fetchGlobes(): Promise<NewsItem[]> {
  const res = await fetch("https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2");
  const xml = await res.text();
  const items: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && items.length < 30) {
    const block = m[1];
    const get = (tag: string) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
      if (!r) return "";
      const inner = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(r[1]);
      return decodeEntities(stripTags(inner ? inner[1] : r[1]));
    };
    const headline = get("title");
    const url = get("link").split("#")[0];
    const pubDate = get("pubDate");
    if (!headline || !url) continue;
    const dt = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : NaN;
    items.push({
      headline,
      summary: get("description").slice(0, 200),
      source: "גלובס",
      url,
      datetime: Number.isFinite(dt) ? dt : Math.floor(Date.now() / 1000),
    });
  }
  return items;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const [finnhub, globes] = await Promise.allSettled([fetchFinnhub(), fetchGlobes()]);
  const combined = [
    ...(finnhub.status === "fulfilled" ? finnhub.value : []),
    ...(globes.status === "fulfilled" ? globes.value : []),
  ];

  const seen = new Set<string>();
  const news = combined
    .filter((n) => {
      if (!n.headline || seen.has(n.headline)) return false;
      seen.add(n.headline);
      return true;
    })
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 24);

  return new Response(JSON.stringify({ news }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
