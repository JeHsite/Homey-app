// Homey — ביטול מנוי פרימיום ששולם. לא קוראת ל-Cardcom בכלל: אנחנו (לא Cardcom) מריצים
// את החיוב החוזר עצמו דרך billing-cron, אז "ביטול" הוא פשוט הפסקת החיובים העתידיים בצד שלנו.
// הגישה לפרימיום נשארת עד current_period_end (לא זיכוי חלקי — ראה PLAN_billing.md, A3).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await sb.from("profiles").select("family_id, role")
    .eq("id", userData.user.id).single();
  if (!profile?.family_id) return json({ error: "no_family" }, 400);
  if (profile.role !== "parent") return json({ error: "parents_only" }, 403);

  const { error } = await sb.from("family_subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("family_id", profile.family_id).eq("status", "active");
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
});
