// Homey — תזכורות תשלום בפוש.
// מופעל ע"י pg_cron פעם בשעה (לא פעם ביום — כל משפחה בוחרת שעה ב-families.reminder_hour וימים
// בשבוע ב-families.reminder_days, והפונקציה בכל הפעלה שולחת רק למשפחות שהשעה והיום הנוכחיים
// בישראל תואמים את מה שהן בחרו).
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
  const messages = new Map<string, { title: string; body: string }>(); // family_id -> הודעה

  if (input.test) {
    // הודעה ידנית (מוגנת ב-CRON_SECRET): כותרת וטקסט אופציונליים, ואפשר להגביל למשפחה אחת עם family_id
    let q = supabase.from("push_subscriptions").select("family_id");
    if (input.family_id) q = q.eq("family_id", input.family_id);
    const { data: subs } = await q;
    const title = String(input.title || "Homey").slice(0, 60);
    const body = String(input.body || "בדיקה — ההתראות עובדות 🎉").slice(0, 180);
    for (const s of subs ?? []) messages.set(s.family_id, { title, body });
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

    // מסננים למשפחות שהשעה והיום הנוכחיים בישראל תואמים למה שהן בחרו
    // (ברירת מחדל: שעה 8, כל הימים — אם עדיין לא נבחר כלום, שומר על ההתנהגות הישנה של תזכורת יומית)
    const familyIds = [...byFamily.keys()];
    if (familyIds.length) {
      const { data: fams } = await supabase.from("families").select("id, reminder_hour, reminder_days").in("id", familyIds);
      const settingsByFamily = new Map((fams ?? []).map((f) => [
        f.id,
        { hour: f.reminder_hour ?? 8, days: f.reminder_days ?? [0, 1, 2, 3, 4, 5, 6] },
      ] as const));
      const thisHour = israelHour();
      const thisDow = israelDayOfWeek();
      for (const familyId of familyIds) {
        const s = settingsByFamily.get(familyId);
        if (!s || s.hour !== thisHour || !s.days.includes(thisDow)) byFamily.delete(familyId);
      }
    }

    for (const [familyId, list] of byFamily) {
      list.sort((a, b) => a.ahead - b.ahead);
      messages.set(familyId, list.length === 1
        ? { title: "Homey — תזכורת תשלום", body: `${list[0].title} (₪${list[0].amount}) לתשלום ${whenText(list[0].ahead)}` }
        : {
          title: `Homey — ${list.length} תשלומים קרובים`,
          body: list.map((x) => `${x.title} (₪${x.amount}) — ${whenText(x.ahead)}`).join("\n"),
        });
    }
  }

  if (!messages.size) return json({ sent: 0, removed: 0, failed: 0 });

  const { data: subs } = await supabase
    .from("push_subscriptions").select("id, family_id, endpoint, p256dh, auth")
    .in("family_id", [...messages.keys()]);

  let sent = 0, removed = 0, failed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    const msg = messages.get(s.family_id)!;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...msg, url: "./", tag: "homey-bills" }),
        { TTL: 60 * 60 * 12 },
      );
      sent++;
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

  return json({ sent, removed, failed });
});
