// Homey — תזכורות תשלום בפוש.
// מופעל ע"י pg_cron פעם בשעה (לא פעם ביום — כל משפחה מגדירה כמה "תזכורות" (שעה+ימים) בטבלת
// family_reminder_slots, והפונקציה בכל הפעלה שולחת רק למשפחות שיש להן תזכורת שהשעה והיום
// הנוכחיים בישראל תואמים אותה).
// מוגן בכותרת x-cron-secret — לכן "Verify JWT" כבוי לפונקציה הזו.
// בדיקה ידנית: POST עם הכותרת x-cron-secret וגוף {"test": true} — שולח הודעת ניסיון לכל המנויים, בלי קשר לשעה.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// התאריך של היום לפי שעון ישראל (השרת רץ ב-UTC)
function israelDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// השעה העגולה הנוכחית בישראל (0-23) — מבוסס על שעון ישראל בפועל, כך שמעבר קיץ/חורף מטופל אוטומטית
function israelHour() {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem", hour: "numeric", hourCycle: "h23",
  }).format(new Date()));
}

// יום השבוע הנוכחי בישראל, 0=ראשון...6=שבת (אותה מוסכמה כמו Date.getDay() ב-JS)
function israelDayOfWeek() {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

// due_day -> בעוד כמה ימים (0-2). מטפל במעבר חודש, ובחשבון של יום 31 בחודש קצר (נחשב ליום האחרון).
function upcomingDueDays() {
  const { y, m, d } = israelDate();
  const map = new Map<number, number>();
  for (let ahead = 0; ahead <= 2; ahead++) {
    const date = new Date(Date.UTC(y, m - 1, d + ahead));
    const day = date.getUTCDate();
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    if (!map.has(day)) map.set(day, ahead);
    if (day === lastDay) for (let x = lastDay + 1; x <= 31; x++) if (!map.has(x)) map.set(x, ahead);
  }
  return map;
}

const whenText = (ahead: number) => (ahead === 0 ? "היום" : ahead === 1 ? "מחר" : "בעוד יומיים");

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC")!,
    Deno.env.get("VAPID_PRIVATE")!,
  );

  const input = await req.json().catch(() => ({}));
  type Msg = { title: string; body: string; tag: string };
  const messages = new Map<string, Msg[]>(); // family_id -> הודעות
  const addMessage = (familyId: string, m: Msg) => messages.set(familyId, [...(messages.get(familyId) ?? []), m]);
  const alertLog: { family_id: string; category: string; month: string; level: number }[] = [];

  if (input.test) {
    // הודעה ידנית (מוגנת ב-CRON_SECRET): כותרת וטקסט אופציונליים, ואפשר להגביל למשפחה אחת עם family_id
    let q = supabase.from("push_subscriptions").select("family_id");
    if (input.family_id) q = q.eq("family_id", input.family_id);
    const { data: subs } = await q;
    const title = String(input.title || "Homey").slice(0, 60);
    const body = String(input.body || "בדיקה — ההתראות עובדות 🎉").slice(0, 180);
    for (const s of subs ?? []) messages.set(s.family_id, [{ title, body, tag: "homey-test" }]);
  } else {
    const upcoming = upcomingDueDays();
    const { data: bills, error } = await supabase
      .from("bills").select("family_id, title, amount, due_day")
      .eq("is_paid", false).in("due_day", [...upcoming.keys()]);
    if (error) return json({ error: error.message }, 500);

    const byFamily = new Map<string, { title: string; amount: number; ahead: number }[]>();
    for (const b of bills ?? []) {
      const list = byFamily.get(b.family_id) ?? [];
      list.push({ title: b.title, amount: b.amount, ahead: upcoming.get(b.due_day)! });
      byFamily.set(b.family_id, list);
    }

    // מסננים למשפחות שיש להן תזכורת (family_reminder_slots) שהשעה והיום הנוכחיים בישראל תואמים לה.
    // משפחה יכולה להגדיר כמה תזכורות (שעות/ימים שונים) — מספיק שאחת מהן תואמת עכשיו.
    const familyIds = [...byFamily.keys()];
    if (familyIds.length) {
      const { data: slots } = await supabase
        .from("family_reminder_slots").select("family_id, hour, days")
        .in("family_id", familyIds);
      const thisHour = israelHour();
      const thisDow = israelDayOfWeek();
      const dueFamilies = new Set(
        (slots ?? [])
          .filter((s) => s.hour === thisHour && (s.days ?? []).includes(thisDow))
          .map((s) => s.family_id),
      );
      for (const familyId of familyIds) {
        if (!dueFamilies.has(familyId)) byFamily.delete(familyId);
      }
    }

    for (const [familyId, list] of byFamily) {
      list.sort((a, b) => a.ahead - b.ahead);
      addMessage(familyId, list.length === 1
        ? { title: "Homey — תזכורת תשלום", body: `${list[0].title} (₪${list[0].amount}) לתשלום ${whenText(list[0].ahead)}`, tag: "homey-bills" }
        : {
          title: `Homey — ${list.length} תשלומים קרובים`,
          body: list.map((x) => `${x.title} (₪${x.amount}) — ${whenText(x.ahead)}`).join("\n"),
          tag: "homey-bills",
        });
    }

    // התראות תקציב לפי קטגוריה: כל שעה, בלי קשר לשעות התזכורות. כל רמה (80% / חריגה) נשלחת פעם אחת לחודש לכל קטגוריה
    // (הטבלה category_budget_alerts מונעת שליחה כפולה).
    const { y, m } = israelDate();
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const monthStart = `${month}-01`;
    const monthEnd = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const { data: budgets } = await supabase.from("category_budgets").select("family_id, category, monthly_amount");
    if (budgets?.length) {
      const famIds = [...new Set(budgets.map((b) => b.family_id))];
      const { data: tx } = await supabase
        .from("transactions").select("family_id, category, amount")
        .eq("type", "expense").gte("date", monthStart).lt("date", monthEnd).in("family_id", famIds);
      const spent = new Map<string, number>();
      for (const t of tx ?? []) {
        const k = `${t.family_id}|${t.category}`;
        spent.set(k, (spent.get(k) ?? 0) + Number(t.amount));
      }
      const { data: logged, error: logErr } = await supabase
        .from("category_budget_alerts").select("family_id, category, level").eq("month", month).in("family_id", famIds);
      const done = new Set((logged ?? []).map((l) => `${l.family_id}|${l.category}|${l.level}`));
      const lines = new Map<string, string[]>();
      // בלי טבלת הלוג (לא הורץ budget-alerts.sql) לא שולחים — אחרת ההתראה הייתה חוזרת בכל שעה
      if (logErr) console.error("category_budget_alerts missing?", logErr.message);
      for (const b of logErr ? [] : budgets) {
        const budget = Number(b.monthly_amount);
        const s = spent.get(`${b.family_id}|${b.category}`) ?? 0;
        const level = s > budget ? 100 : s >= budget * 0.8 ? 80 : 0;
        if (!level || done.has(`${b.family_id}|${b.category}|${level}`)) continue;
        const fmt = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
        const line = level === 100
          ? `חרגתם מתקציב "${b.category}": ${fmt(s)} מתוך ${fmt(budget)}`
          : `הגעתם ל-80% מתקציב "${b.category}": ${fmt(s)} מתוך ${fmt(budget)}`;
        lines.set(b.family_id, [...(lines.get(b.family_id) ?? []), line]);
        alertLog.push({ family_id: b.family_id, category: b.category, month, level });
        if (level === 100) alertLog.push({ family_id: b.family_id, category: b.category, month, level: 80 });
      }
      for (const [familyId, list] of lines) {
        addMessage(familyId, { title: "Homey — התראת תקציב", body: list.join("\n"), tag: "homey-budget" });
      }
    }
  }

  if (!messages.size) return json({ sent: 0, removed: 0, failed: 0 });

  const { data: subs } = await supabase
    .from("push_subscriptions").select("id, family_id, endpoint, p256dh, auth")
    .in("family_id", [...messages.keys()]);

  let sent = 0, removed = 0, failed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      for (const msg of messages.get(s.family_id) ?? []) {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: msg.title, body: msg.body, url: "./", tag: msg.tag }),
          { TTL: 60 * 60 * 12 },
        );
        sent++;
      }
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        // מנוי שפג (המשתמש ביטל / מחק את האפליקציה) — מנקים
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      } else {
        failed++;
        console.error("push failed", code, (e as Error).message);
      }
    }
  }));

  if (alertLog.length) {
    const { error: logWriteErr } = await supabase
      .from("category_budget_alerts")
      .upsert(alertLog, { onConflict: "family_id,category,month,level", ignoreDuplicates: true });
    if (logWriteErr) console.error("alert log write failed", logWriteErr.message);
  }

  return json({ sent, removed, failed });
});
