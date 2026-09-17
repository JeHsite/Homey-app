// Homey — cron יומי לחיוב מנויים (Cardcom Do Transaction) + ניקוי משפחות שפג תוקפן.
// מופעל ע"י pg_cron פעם ביום (jobname: homey-daily-billing). מוגן ב-x-cron-secret, כמו send-reminders.
// בדיקה ידנית: POST עם x-cron-secret וגוף {"test": true} — רץ בלי לחייב אף אחד באמת, רק מדפיס מה היה קורה.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const input = await req.json().catch(() => ({}));
  const dryRun = !!input.test;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const terminal = Number(Deno.env.get("CARDCOM_TERMINAL_NUMBER"));
  const apiName = Deno.env.get("CARDCOM_API_NAME")!;
  const now = new Date();

  // 1) חיוב חוזר: מנויים פעילים שהגיעו לתום התקופה
  const { data: due } = await sb.from("family_subscriptions")
    .select("*").eq("status", "active").lte("current_period_end", now.toISOString());

  const { data: cfg } = await sb.from("app_config").select("key, value")
    .in("key", ["price_monthly_ils", "price_annual_ils"]);
  const priceFor = (interval: string) =>
    Number(cfg?.find((c) => c.key === `price_${interval}_ils`)?.value ?? (interval === "monthly" ? 19.9 : 199));

  let charged = 0, failed = 0;
  for (const sub of due ?? []) {
    if (!sub.processor_token) { failed++; continue; }
    const periodTag = now.toISOString().slice(0, 7); // YYYY-MM — מזהה תקופה לאידמפוטנטיות
    const externalUniqTranId = `fam-${sub.family_id}-${periodTag}`;
    const amount = priceFor(sub.interval);

    if (dryRun) { charged++; continue; }

    const res = await fetch("https://secure.cardcom.solutions/api/v11/Transactions/Transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        TerminalNumber: terminal,
        ApiName: apiName,
        Amount: amount,
        Token: sub.processor_token,
        CardExpirationMMYY: `${String(sub.token_card_month).padStart(2, "0")}${String(sub.token_card_year).slice(-2)}`,
        ExternalUniqTranId: externalUniqTranId,
        ExternalUniqUniqTranIdResponse: true, // מזהה כפול לא יחייב שוב, רק יחזיר את התשובה המקורית
        NumOfPayments: 1,
        ISOCoinId: 1,
      }),
    });
    const data = await res.json();

    if (data.ResponseCode === 0) {
      const periodEnd = new Date(now);
      if (sub.interval === "monthly") periodEnd.setMonth(periodEnd.getMonth() + 1);
      else periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      await sb.from("family_subscriptions").update({
        current_period_end: periodEnd.toISOString(),
        status: "active",
        updated_at: now.toISOString(),
      }).eq("id", sub.id);
      charged++;
    } else {
      console.error("billing-cron: charge failed", sub.family_id, data);
      await sb.from("family_subscriptions").update({
        status: "past_due",
        updated_at: now.toISOString(),
      }).eq("id", sub.id);
      failed++;
    }
  }

  // 2) ניקוי: מנויים שבוטלו/נכשלו ועברו את תום התקופה ששולמה -> חוזרים לחינם
  let expired = 0;
  if (!dryRun) {
    const { data: toExpire } = await sb.from("family_subscriptions")
      .select("family_id").in("status", ["canceled", "past_due"]).lte("current_period_end", now.toISOString());
    for (const row of toExpire ?? []) {
      await sb.from("family_plan").update({
        plan: "free",
        premium_source: null,
        updated_at: now.toISOString(),
      }).eq("family_id", row.family_id);
      expired++;
    }
  }

  return json({ charged, failed, expired, dryRun });
});
