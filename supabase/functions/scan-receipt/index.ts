// Homey — קריאת קבלה מצילום עם Claude. מקבל תמונה (base64) ומחזיר: בית עסק, סכום, תאריך וקטגוריה משוערת.
// דורש התחברות (JWT של המשתמש, "Verify JWT" כבוי כי הבדיקה נעשית כאן), משפחה בפרימיום, ומכסה חודשית
// (טבלת receipt_scans) כדי שעלות ה-AI תישאר חסומה. בלי הסוד ANTHROPIC_API_KEY מחזיר no_api_key.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";
const MONTHLY_LIMIT = 40;
const MAX_IMAGE_CHARS = 2_500_000; // ~1.8MB אחרי base64; הלקוח מקטין את התמונה לפני שליחה
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey) return json({ error: "no_api_key" }, 503);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await sb.from("profiles").select("family_id").eq("id", userData.user.id).maybeSingle();
  if (!profile?.family_id) return json({ error: "no_family" }, 403);
  const familyId = profile.family_id as string;

  // פרימיום בלבד (עולה כסף אמיתי) — fail-closed: בלי שורת פרימיום מפורשת לא ממשיכים
  const { data: plan } = await sb.from("family_plan").select("plan").eq("family_id", familyId).maybeSingle();
  if (plan?.plan !== "premium") return json({ error: "premium_required" }, 403);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await sb.from("receipt_scans").select("id", { count: "exact", head: true })
    .eq("family_id", familyId).gte("created_at", monthStart);
  if ((count ?? 0) >= MONTHLY_LIMIT) return json({ error: "monthly_limit", limit: MONTHLY_LIMIT }, 429);

  const input = await req.json().catch(() => ({} as Record<string, unknown>));
  const image = typeof input.image === "string" ? input.image : "";
  const mediaType = String(input.media_type || "image/jpeg");
  if (!image || image.length > MAX_IMAGE_CHARS || !MEDIA_TYPES.includes(mediaType)) return json({ error: "bad_image" }, 400);

  // קטגוריות מהלקוח (כולל מותאמות אישית): { "מזון": ["סופר", ...] } — מנוקות ומוגבלות בגודל
  const categories: Record<string, string[]> = {};
  const rawCats = (input.categories && typeof input.categories === "object") ? input.categories as Record<string, unknown> : {};
  for (const [name, subs] of Object.entries(rawCats).slice(0, 60)) {
    const c = clean(name, 40);
    if (c) categories[c] = (Array.isArray(subs) ? subs : []).slice(0, 20).map((s) => clean(s, 40)).filter(Boolean);
  }
  if (!Object.keys(categories).length) return json({ error: "no_categories" }, 400);

  // נספר את הניסיון לפני הקריאה, כדי שגם כשלונות לא יעקפו את המכסה
  await sb.from("receipt_scans").insert({ family_id: familyId });

  const system = `אתם קוראים קבלות ישראליות מצילום. החזירו JSON בלבד, בלי טקסט לפניו או אחריו:
{"merchant": "שם בית העסק", "total": 123.45, "date": "YYYY-MM-DD", "category": "...", "sub": "..."}
- total: הסכום הסופי לתשלום בשקלים (לא מע"מ ולא סכום ביניים). אם לא ברור, החזירו null.
- date: תאריך הקנייה. אם לא מופיע, null.
- category ו-sub: בחרו אך ורק מהרשימה הבאה (שם קטגוריה ← תתי-קטגוריות), הקרובה ביותר לסוג העסק. אם אין התאמה, null.
${JSON.stringify(categories)}
- אל תמציאו נתונים שלא מופיעים בקבלה.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: "קראו את הקבלה והחזירו JSON." },
        ],
      }],
    }),
  });
  if (!r.ok) {
    console.error("anthropic", r.status, (await r.text()).slice(0, 300));
    return json({ error: "ai_failed" }, 502);
  }
  const body = await r.json();
  const text = (body.content ?? []).filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text).join("");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return json({ error: "unreadable" }, 422);
  }

  const total = Number(raw.total);
  if (!Number.isFinite(total) || total <= 0 || total > 1_000_000) return json({ error: "no_total" }, 422);
  const category = typeof raw.category === "string" && categories[raw.category] ? raw.category : "";
  const sub = category && categories[category].includes(String(raw.sub)) ? String(raw.sub) : category ? categories[category][0] ?? "" : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? "")) ? String(raw.date) : "";

  return json({ merchant: clean(raw.merchant, 60), amount: Math.round(total * 100) / 100, date, category, sub });
});
