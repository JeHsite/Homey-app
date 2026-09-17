// Homey — webhook מ-Cardcom על תוצאת עסקת LowProfile (שדרוג לפרימיום).
// "Verify JWT" כבוי — Cardcom לא שולח JWT של Supabase, זו כתובת ציבורית לגמרי.
// אבטחה: לפי ההנחיה הרשמית של Cardcom, לא סומכים על תוכן ה-webhook עצמו — פונים חזרה
// לשרת שלהם (GetLpResult) עם TerminalNumber/ApiName שלנו, וסומכים רק על מה שחוזר משם.
// טרם נבדק חי מול webhook אמיתי (ממתין לפרטי גישה מ-Cardcom) — צורת גוף הבקשה הנכנסת
// עדיין לא מאומתת סופית, לכן הקריאה למטה מנסה כמה מקורות (JSON / form / query) לשדה LowProfileId.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function extractLowProfileId(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("LowProfileId") ?? url.searchParams.get("lowprofileid");
  if (fromQuery) return fromQuery;
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const b = await req.json();
      return b.LowProfileId ?? b.lowprofileid ?? null;
    }
    if (ct.includes("form")) {
      const f = await req.formData();
      return (f.get("LowProfileId") as string) ?? (f.get("lowprofileid") as string) ?? null;
    }
  } catch (_e) { /* ignore */ }
  return null;
}

Deno.serve(async (req) => {
  // Cardcom מנסה שוב עד 7 פעמים אם לא מקבל HTTP 200 — לכן תמיד עונים 200 גם כשמדלגים,
  // ומחזירים 200 בסוף העיבוד גם אם משהו נכשל בפנים (רק לוגים), אחרת ניצור ריטריי אינסופי.
  const lowProfileId = await extractLowProfileId(req);
  if (!lowProfileId) return json({ ok: false, reason: "no_lowprofileid" });

  const terminal = Number(Deno.env.get("CARDCOM_TERMINAL_NUMBER"));
  const apiName = Deno.env.get("CARDCOM_API_NAME")!;

  const res = await fetch("https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ TerminalNumber: terminal, ApiName: apiName, LowProfileId: lowProfileId }),
  });
  const data = await res.json();

  if (data.ResponseCode !== 0) {
    console.error("billing-webhook: GetLpResult failed", data);
    return json({ ok: false });
  }

  const [familyId, interval] = String(data.ReturnValue || "").split("|");
  if (!familyId || (interval !== "monthly" && interval !== "annual")) {
    console.error("billing-webhook: bad ReturnValue", data.ReturnValue);
    return json({ ok: false });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // וידוא סכום/מטבע לפי מחיר התוכנית בפועל — לא רק ResponseCode==0 (מונע עדכון פרימיום על עסקה בסכום שגוי)
  const { data: cfg } = await sb.from("app_config").select("key, value")
    .in("key", ["price_monthly_ils", "price_annual_ils"]);
  const expected = Number(cfg?.find((c) => c.key === `price_${interval}_ils`)?.value ?? (interval === "monthly" ? 19.9 : 199));
  const amount = Number(data.TranzactionInfo?.Amount ?? data.Amount ?? 0);
  const coinId = Number(data.TranzactionInfo?.CoinId ?? 1);
  if (coinId !== 1 || Math.abs(amount - expected) > 0.5) {
    console.error("billing-webhook: amount mismatch", { amount, coinId, expected, lowProfileId });
    return json({ ok: false, reason: "amount_mismatch" });
  }

  const token = data.TokenInfo?.Token ?? null;
  const now = new Date();
  const periodEnd = new Date(now);
  if (interval === "monthly") periodEnd.setMonth(periodEnd.getMonth() + 1);
  else periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  // אידמפוטנטיות: אם כבר עיבדנו את ה-LowProfileId הזה (webhook כפול), לא כותבים שוב
  const { data: existing } = await sb.from("family_subscriptions")
    .select("low_profile_id").eq("family_id", familyId).maybeSingle();
  if (existing?.low_profile_id === lowProfileId) return json({ ok: true, dedup: true });

  await sb.from("family_subscriptions").upsert({
    family_id: familyId,
    processor: "cardcom",
    processor_token: token,
    token_card_month: data.TokenInfo?.CardMonth ?? null,
    token_card_year: data.TokenInfo?.CardYear ?? null,
    low_profile_id: lowProfileId,
    interval,
    status: "active",
    current_period_end: periodEnd.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: "family_id" });

  await sb.from("family_plan").upsert({
    family_id: familyId,
    plan: "premium",
    premium_source: "paid",
    premium_until: null,
    updated_at: now.toISOString(),
  }, { onConflict: "family_id" });

  return json({ ok: true });
});
