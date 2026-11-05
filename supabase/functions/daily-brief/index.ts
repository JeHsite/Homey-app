// Homey — "הבוקר שלכם" + תזכורת שעה לפני אירוע/משימה, בפוש.
// מופעל ע"י pg_cron כל 15 דקות (daily-brief.sql). כל ריצה בודקת לפי שעון ישראל מה צריך לצאת עכשיו:
//   1. הבוקר שלכם: לכל הורה בשעה שבחר (push_prefs.brief_hour, ברירת מחדל 07:00), פעם ביום.
//      משימות להיום ובאיחור, אירועי היום בלו"ז, חיובים שיורדים היום, ופריטים ברשימת הקניות.
//   2. תזכורות: אירוע או משימה עם שעה, שמתחילים בעוד 40-65 דקות (חלון שמכסה ריצה כל 15 דקות).
// push_log מונע שליחה כפולה. מוגן בכותרת x-cron-secret, לכן "Verify JWT" כבוי לפונקציה הזו.
// בדיקה ידנית: POST עם x-cron-secret וגוף {"dry": true} מחזיר מה היה נשלח עכשיו, בלי לשלוח.
//               {"force_brief": true, "user_id": "<uuid>"} שולח הבוקר שלכם עכשיו למשתמש אחד (מתעלם מהשעה ומהיומן).
// פרטיות: פריט אישי של הורה נשלח רק אליו. פריטים זוגיים, משפחתיים ושל ילדים נשלחים לכל ההורים במשפחה.
// משימות, לו"ז וקניות הם תכונת פרימיום: למשפחה חינמית הבוקר שלכם כולל רק חיובים.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function israelNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const y = Number(get("year")), m = Number(get("month")), d = Number(get("day"));
  return {
    y, m, d, hour: Number(get("hour")) % 24, minute: Number(get("minute")),
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  };
}
const toMin = (t: string | null) => {
  if (!t) return null;
  const [h, mm] = String(t).split(":").map(Number);
  return h * 60 + (mm || 0);
};
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "");
const dowOf = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

type Ev = { id: string; family_id: string; kind: string; title: string; location: string | null; scope: string; person_kind: string | null;
  person_id: string | null; start_date: string; start_time: string | null; repeat: string; repeat_until: string | null };
type Task = { id: string; family_id: string; title: string; scope: string; person_kind: string | null; person_id: string | null;
  due_date: string | null; due_time: string | null };

const occursToday = (e: Ev, today: string, dow: number) => {
  const sd = String(e.start_date).slice(0, 10);
  if (e.repeat !== "weekly") return sd === today;
  if (sd > today || (e.repeat_until && String(e.repeat_until).slice(0, 10) < today)) return false;
  return dowOf(sd) === dow;
};
// אישי של הורה: רק לו. כל השאר: לכל ההורים
const visibleTo = (x: { scope: string; person_kind: string | null; person_id: string | null }, userId: string) =>
  x.scope !== "personal" || x.person_kind === "child" || x.person_id === userId;

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
  const input = await req.json().catch(() => ({}));
  const now = israelNow();
  const nowMin = now.hour * 60 + now.minute;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let subsQ = supabase.from("push_subscriptions").select("id, family_id, user_id, endpoint, p256dh, auth");
  if (input.user_id) subsQ = subsQ.eq("user_id", input.user_id);
  const { data: subs, error: subsErr } = await subsQ;
  if (subsErr) return json({ error: subsErr.message }, 500);
  if (!subs?.length) return json({ sent: 0, reason: "no_subscriptions" });

  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const familyIds = [...new Set(subs.map((s) => s.family_id))];
  const [{ data: prefsRows }, { data: plans }] = await Promise.all([
    supabase.from("push_prefs").select("*").in("user_id", userIds),
    supabase.from("family_plan").select("family_id, plan").in("family_id", familyIds),
  ]);
  const prefs = new Map((prefsRows ?? []).map((p) => [p.user_id, p]));
  const pref = (uid: string) => prefs.get(uid) ?? { brief_enabled: true, brief_hour: 7, event_reminders: true, task_reminders: true };
  const premium = new Set((plans ?? []).filter((p) => p.plan === "premium").map((p) => p.family_id));

  // נתוני היום לכל המשפחות שיש להן מכשירים. טבלאות המערכים עשויות לא להיות קיימות עדיין: שגיאה = רשימה ריקה
  const prem = familyIds.filter((f) => premium.has(f));
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null; error: unknown }>) => { const r = await p; return r.error ? [] as T[] : (r.data ?? []); };
  const [events, tasks, bills, lists, items, children] = await Promise.all([
    prem.length ? safe<Ev>(supabase.from("family_events").select("id, family_id, kind, title, location, scope, person_kind, person_id, start_date, start_time, repeat, repeat_until").in("family_id", prem).lte("start_date", now.iso)) : [],
    prem.length ? safe<Task>(supabase.from("tasks").select("id, family_id, title, scope, person_kind, person_id, due_date, due_time").in("family_id", prem).eq("status", "todo").lte("due_date", now.iso)) : [],
    safe<{ family_id: string; title: string; amount: number; due_day: number }>(supabase.from("bills").select("family_id, title, amount, due_day").in("family_id", familyIds).eq("is_paid", false)),
    prem.length ? safe<{ id: string; family_id: string; kind: string }>(supabase.from("shopping_lists").select("id, family_id, kind").in("family_id", prem)) : [],
    prem.length ? safe<{ family_id: string; list_id: string }>(supabase.from("shopping_items").select("family_id, list_id").in("family_id", prem).eq("status", "open")) : [],
    safe<{ id: string; name: string }>(supabase.from("children").select("id, name").in("family_id", familyIds)),
  ]);
  const kidName = new Map(children.map((c) => [c.id, c.name]));
  const lastDay = new Date(Date.UTC(now.y, now.m, 0)).getUTCDate();
  const billToday = (b: { due_day: number }) => b.due_day === now.d || (now.d === lastDay && b.due_day > lastDay);
  const groceryLists = new Set(lists.filter((l) => l.kind === "grocery").map((l) => l.id));
  const todayEvents = events.filter((e) => occursToday(e, now.iso, now.dow));

  type Msg = { userId: string; familyId: string; key: string; title: string; body: string; tag: string };
  const out: Msg[] = [];

  for (const userId of userIds) {
    const familyId = subs.find((s) => s.user_id === userId)!.family_id;
    const p = pref(userId);
    const isPrem = premium.has(familyId);

    // 1. הבוקר שלכם
    const briefDue = input.force_brief || (p.brief_enabled && now.hour === p.brief_hour && now.minute < 15);
    if (briefDue) {
      const lines: string[] = [];
      if (isPrem) {
        const evs = todayEvents.filter((e) => e.family_id === familyId && visibleTo(e, userId))
          .sort((a, b) => (toMin(a.start_time) ?? 9999) - (toMin(b.start_time) ?? 9999));
        if (evs.length) {
          const shown = evs.slice(0, 3).map((e) => {
            const who = e.person_kind === "child" && e.person_id ? kidName.get(e.person_id) : null;
            return `${e.start_time ? hhmm(e.start_time) + " " : ""}${e.title}${who ? ` (${who})` : ""}`;
          });
          lines.push(`היום: ${shown.join(", ")}${evs.length > 3 ? ` ועוד ${evs.length - 3}` : ""}`);
        }
        const mine = tasks.filter((t) => t.family_id === familyId && visibleTo(t, userId));
        const dueToday = mine.filter((t) => String(t.due_date).slice(0, 10) === now.iso).length;
        const overdue = mine.filter((t) => String(t.due_date).slice(0, 10) < now.iso).length;
        if (dueToday || overdue) lines.push(`משימות: ${dueToday} להיום${overdue ? `, ${overdue} באיחור` : ""}`);
      }
      const bt = bills.filter((b) => b.family_id === familyId && billToday(b));
      if (bt.length) lines.push(`יורד היום: ${bt.slice(0, 2).map((b) => `${b.title} ₪${Math.round(Number(b.amount)).toLocaleString("he-IL")}`).join(", ")}${bt.length > 2 ? ` ועוד ${bt.length - 2}` : ""}`);
      if (isPrem) {
        const n = items.filter((i) => i.family_id === familyId && groceryLists.has(i.list_id)).length;
        if (n) lines.push(`ברשימת הקניות: ${n === 1 ? "פריט אחד" : `${n} פריטים`}`);
      }
      if (lines.length) out.push({ userId, familyId, key: `brief:${userId}:${now.iso}`, title: "Homey · הבוקר שלכם", body: lines.join("\n"), tag: "homey-brief" });
    }

    // 2. תזכורת שעה לפני
    if (isPrem && !input.force_brief) {
      const inWindow = (t: string | null) => { const m = toMin(t); return m != null && m - nowMin > 40 && m - nowMin <= 65; };
      if (p.event_reminders) {
        for (const e of todayEvents.filter((e) => e.family_id === familyId && visibleTo(e, userId) && inWindow(e.start_time))) {
          const who = e.person_kind === "child" && e.person_id ? kidName.get(e.person_id) : null;
          out.push({ userId, familyId, key: `ev:${e.id}:${now.iso}:${userId}`, title: `בעוד שעה: ${e.title}${who ? ` (${who})` : ""}`,
            body: [hhmm(e.start_time), e.location].filter(Boolean).join(" · "), tag: `homey-ev-${e.id}` });
        }
      }
      if (p.task_reminders) {
        for (const t of tasks.filter((t) => t.family_id === familyId && visibleTo(t, userId) && String(t.due_date).slice(0, 10) === now.iso && inWindow(t.due_time))) {
          out.push({ userId, familyId, key: `task:${t.id}:${now.iso}:${userId}`, title: `תזכורת: ${t.title}`, body: `עד ${hhmm(t.due_time)}`, tag: `homey-task-${t.id}` });
        }
      }
    }
  }

  // מסננים מה שכבר נשלח (חוץ מ-force_brief, שנועד לבדיקה)
  let toSend = out;
  if (out.length && !input.force_brief) {
    const { data: done } = await supabase.from("push_log").select("key").in("key", out.map((m) => m.key));
    const sentKeys = new Set((done ?? []).map((d) => d.key));
    toSend = out.filter((m) => !sentKeys.has(m.key));
  }
  if (input.dry) return json({ israel: now, would_send: toSend.map(({ key, title, body }) => ({ key, title, body })) });
  if (!toSend.length) return json({ sent: 0 });

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);
  let sent = 0, removed = 0, failed = 0;
  const delivered = new Set<string>();
  await Promise.all(subs.map(async (s) => {
    for (const msg of toSend.filter((m) => m.userId === s.user_id)) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: msg.title, body: msg.body, url: "./", tag: msg.tag }),
          { TTL: 60 * 60 * 2 },
        );
        sent++;
        delivered.add(msg.key);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          removed++;
          break;
        }
        failed++;
        console.error("push failed", code, (e as Error).message);
      }
    }
  }));
  if (delivered.size && !input.force_brief) {
    const { error } = await supabase.from("push_log").upsert([...delivered].map((key) => ({ key })), { onConflict: "key", ignoreDuplicates: true });
    if (error) console.error("push_log write failed", error.message);
  }
  return json({ sent, removed, failed });
});
