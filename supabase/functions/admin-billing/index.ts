// Homey — פעולות ניהול (רק למי שברשימת app_admins): רשימת משפחות, הענקת/ביטול פרימיום
// חינמי, עריכת מחירים. כל בדיקת ההרשאה מתבצעת כאן, בצד שרת — לא רק ב-UI.
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

  const { data: isAdmin } = await sb.from("app_admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  const { action, family_id, key, value } = await req.json().catch(() => ({} as Record<string, unknown>));

  if (action === "list") {
    const { data: families } = await sb.from("families").select("id, name, created_at").order("created_at");
    const { data: plans } = await sb.from("family_plan").select("*");
    const { data: subs } = await sb.from("family_subscriptions").select("*");
    const byId = new Map((plans ?? []).map((p) => [p.family_id, p]));
    const subsById = new Map((subs ?? []).map((s) => [s.family_id, s]));
    const rows = (families ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.created_at,
      plan: byId.get(f.id)?.plan ?? "free",
      premiumSource: byId.get(f.id)?.premium_source ?? null,
      subscriptionStatus: subsById.get(f.id)?.status ?? null,
    }));
    return json({ families: rows });
  }

  if (action === "grant") {
    if (!family_id) return json({ error: "family_id required" }, 400);
    await sb.from("family_plan").upsert({
      family_id, plan: "premium", premium_source: "admin_grant", premium_until: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "family_id" });
    return json({ ok: true });
  }

  if (action === "revoke") {
    if (!family_id) return json({ error: "family_id required" }, 400);
    // אם יש למשפחה הזו מנוי בתשלום פעיל, לא מורידים אותה בטעות ל-free — רק מבטלים מתנות אדמין
    const { data: plan } = await sb.from("family_plan").select("premium_source").eq("family_id", family_id).maybeSingle();
    if (plan?.premium_source !== "admin_grant") return json({ error: "not_admin_grant" }, 400);
    await sb.from("family_plan").update({
      plan: "free", premium_source: null, updated_at: new Date().toISOString(),
    }).eq("family_id", family_id);
    return json({ ok: true });
  }

  if (action === "get_config") {
    const { data } = await sb.from("app_config").select("key, value");
    return json({ config: data ?? [] });
  }

  if (action === "set_config") {
    if (!key || value === undefined) return json({ error: "key/value required" }, 400);
    await sb.from("app_config").upsert({ key, value: String(value), updated_at: new Date().toISOString() });
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
