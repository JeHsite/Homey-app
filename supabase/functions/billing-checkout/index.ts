// Homey — יצירת דף תשלום (Cardcom LowProfile) לשדרוג לפרימיום.
// "Verify JWT" דולק (ברירת מחדל) — הפונקציה עצמה מזהה את המשתמש מה-JWT שלו ושולפת
// family_id בעצמה (לא מקבלת אותו מהלקוח, כדי שאי אפשר יהיה לבקש checkout למשפחה אחרת).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const APP_URL = "https://homey-app-one.vercel.app";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const { interval } = await req.json().catch(() => ({}));
  if (interval !== "monthly" && interval !== "annual") return json({ error: "bad_interval" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // family_id + תפקיד נגזרים מהשרת — לא מתקבלים מהלקוח (מונע בקשת checkout למשפחה של מישהו אחר)
  const { data: profile } = await sb.from("profiles").select("family_id, role, full_name")
    .eq("id", userData.user.id).single();
  if (!profile?.family_id) return json({ error: "no_family" }, 400);
  if (profile.role !== "parent") return json({ error: "parents_only" }, 403);

  const { data: family } = await sb.from("families").select("name").eq("id", profile.family_id).single();

  const { data: cfg } = await sb.from("app_config").select("key, value")
    .in("key", ["price_monthly_ils", "price_annual_ils"]);
  const price = Number(cfg?.find((c) => c.key === `price_${interval}_ils`)?.value ?? (interval === "monthly" ? 19.9 : 199));

  const terminal = Number(Deno.env.get("CARDCOM_TERMINAL_NUMBER"));
  const apiName = Deno.env.get("CARDCOM_API_NAME")!;
  const returnValue = `${profile.family_id}|${interval}`;

  const body = {
    TerminalNumber: terminal,
    ApiName: apiName,
    Operation: "ChargeAndCreateToken",
    Amount: price,
    ISOCoinId: 1,
    ReturnValue: returnValue,
    ProductName: `Homey פרימיום — מנוי ${interval === "monthly" ? "חודשי" : "שנתי"}`,
    Language: "he",
    SuccessRedirectUrl: `${APP_URL}/?billing=success`,
    FailedRedirectUrl: `${APP_URL}/?billing=failed`,
    WebHookUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/billing-webhook`,
    Document: {
      DocumentTypeToCreate: "TaxInvoiceAndReceipt",
      Name: family?.name || profile.full_name || "לקוח Homey",
      Email: userData.user.email ?? undefined,
      IsSendByEmail: true,
      Products: [{ Description: `Homey פרימיום — מנוי ${interval === "monthly" ? "חודשי" : "שנתי"}`, Quantity: 1, UnitCost: price }],
    },
  };

  const res = await fetch("https://secure.cardcom.solutions/api/v11/LowProfile/Create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.ResponseCode !== 0) {
    console.error("cardcom checkout create failed", data);
    return json({ error: "cardcom_error", description: data.Description }, 502);
  }

  return json({ url: data.Url, lowProfileId: data.LowProfileId });
});
