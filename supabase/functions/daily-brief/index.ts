// Homey — "הבוקר שלכם" + תזכורת שעה לפני אירוע/משימה, בפוש.
// מופעל ע"י pg_cron כל 15 דקות (daily-brief.sql). כל ריצה בודקת לפי שעון ישראל מה צריך לצאת עכשיו:
//   1. הבוקר שלכם: לכל הורה בשעה שבחר (push_prefs.brief_hour, ברירת מחדל 07:00), פעם ביום.
//      משימות להיום ובאיחור, אירועי היום בלו"ז, חיובים שיורדים היום, ופריטים ברשימת הקניות.
//   2. תזכורות: אירוע או משימה עם שעה, שמתחילים בעוד 40-65 דקות (חלון שמכסה ריצה כל 15 דקות).
//      רק למי שאחראי: פריט של הורה מסוים = רק לו; חוג עם מסיע מוגדר = רק למסיע (הלוך לפני ההתחלה, חזור לפני הסיום);
//      משפחתי/זוגי/של ילד בלי אחראי = לכל ההורים.
//   4. סיכום השבוע (בבוקר של יום ראשון, בתוך "הבוקר שלכם", זהה לשני ההורים): כמה יצא שוטף בשבוע שעבר מול השבוע
//      שלפניו, על מה הכי הרבה, וכמה תנועות מחכות לבדיקה. בלי העברות, מוסתרות וכפילויות (finance-tidy.sql).
//   3. מחר אצלכם (evening-digest.sql): בשעה שבחר (ברירת מחדל 20:00): מה יש מחר, מי מסיע, חוג בלי מסיע, המשימות שלו למחר.
// push_log מונע שליחה כפולה. מוגן בכותרת x-cron-secret, לכן "Verify JWT" כבוי לפונקציה הזו.
// בדיקה ידנית: POST עם x-cron-secret וגוף {"dry": true} מחזיר מה היה נשלח עכשיו, בלי לשלוח.
//               {"force_brief": true, "user_id": "<uuid>"} שולח הבוקר שלכם עכשיו למשתמש אחד (מתעלם מהשעה ומהיומן).
//               {"force_evening": true, "user_id": "<uuid>"} אותו דבר לסיכום הערב.
//               {"force_brief": true, "force_weekly": true, "user_id": "<uuid>"} הבוקר שלכם עם סיכום השבוע, גם אם היום לא ראשון.
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
const addDays = (iso: string, n: number) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const toMin = (t: string | null) => {
  if (!t) return null;
  const [h, mm] = String(t).split(":").map(Number);
  return h * 60 + (mm || 0);
};
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "");
const dowOf = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

type Ev = { id: string; family_id: string; kind: string; title: string; location: string | null; scope: string; person_kind: string | null;
  person_id: string | null; start_date: string; start_time: string | null; end_time: string | null; repeat: string; repeat_until: string | null;
  drive_to?: string | null; drive_from?: string | null };
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
// מי מקבל תזכורת: הורה אחראי = רק הוא. חוג עם מסיע = רק המסיעים. אחרת: כל מי שרואה את הפריט
const remindsUser = (x: { scope: string; kind?: string; person_kind: string | null; person_id: string | null; drive_to?: string | null; drive_from?: string | null }, userId: string) => {
  if (x.person_kind === "parent" && x.person_id) return x.person_id === userId;
  if (x.kind === "class" && (x.drive_to || x.drive_from)) return x.drive_to === userId || x.drive_from === userId;
  return visibleTo(x, userId);
};

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
  // עמודות הערב קיימות רק אחרי evening-digest.sql; בלי ערך = ברירת המחדל (פעיל, 20:00)
  const pref = (uid: string) => {
    const p = prefs.get(uid) ?? { brief_enabled: true, brief_hour: 7, event_reminders: true, task_reminders: true };
    return { ...p, evening_enabled: p.evening_enabled ?? true, evening_hour: p.evening_hour ?? 20 };
  };
  const tomorrow = addDays(now.iso, 1);
  const tomorrowDow = (now.dow + 1) % 7;
  const premium = new Set((plans ?? []).filter((p) => p.plan === "premium").map((p) => p.family_id));

  // נתוני היום לכל המשפחות שיש להן מכשירים. טבלאות המערכים עשויות לא להיות קיימות עדיין: שגיאה = רשימה ריקה
  const prem = familyIds.filter((f) => premium.has(f));
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null; error: unknown }>) => { const r = await p; return r.error ? [] as T[] : (r.data ?? []); };
  type Tx = { family_id: string; amount: number; category: string | null; date: string; review_status: string | null };
  const [events, tasks, bills, lists, items, children, weekTx] = await Promise.all([
    prem.length ? (async () => {
      const base = "id, family_id, kind, title, location, scope, person_kind, person_id, start_date, start_time, end_time, repeat, repeat_until";
      const r = await supabase.from("family_events").select(base + ", drive_to, drive_from").in("family_id", prem).lte("start_date", tomorrow);
      return r.error ? safe<Ev>(supabase.from("family_events").select(base).in("family_id", prem).lte("start_date", tomorrow)) : (r.data ?? []) as Ev[];
    })() : [],
    prem.length ? safe<Task>(supabase.from("tasks").select("id, family_id, title, scope, person_kind, person_id, due_date, due_time").in("family_id", prem).eq("status", "todo").lte("due_date", tomorrow)) : [],
    safe<{ family_id: string; title: string; amount: number; due_day: number }>(supabase.from("bills").select("family_id, title, amount, due_day").in("family_id", familyIds).eq("is_paid", false)),
    prem.length ? safe<{ id: string; family_id: string; kind: string }>(supabase.from("shopping_lists").select("id, family_id, kind").in("family_id", prem)) : [],
    prem.length ? safe<{ family_id: string; list_id: string }>(supabase.from("shopping_items").select("family_id, list_id").in("family_id", prem).eq("status", "open")) : [],
    safe<{ id: string; name: string }>(supabase.from("children").select("id, name").in("family_id", familyIds)),
    // סיכום השבוע: רק ביום ראשון (או בבדיקה). שוטף בלבד: בלי הוראות קבע, העברות, מוסתרות וכפילויות
    (now.dow === 0 || input.force_weekly) ? safe<Tx>(supabase.from("transactions").select("family_id, amount, category, date, review_status")
      .in("family_id", familyIds).eq("type", "expense").is("bill_id", null).neq("kind", "transfer").eq("hidden", false).is("duplicate_of", null)
      .gte("date", addDays(now.iso, -14)).lte("date", now.iso)) : Promise.resolve([] as Tx[]),
  ]);
  // ימי הולדת (birthdays.sql). לפני ה-SQL השאילתה נכשלת ופשוט אין ימי הולדת
  type Bday = { id: string; family_id: string; name: string; birth_date: string };
  const [bdParents, bdKids] = await Promise.all([
    safe<{ id: string; family_id: string; full_name: string | null; birth_date: string | null }>(supabase.from("profiles").select("id, family_id, full_name, birth_date").in("family_id", familyIds).not("birth_date", "is", null)),
    safe<{ id: string; family_id: string; name: string; birth_date: string | null }>(supabase.from("children").select("id, family_id, name, birth_date").in("family_id", familyIds).not("birth_date", "is", null)),
  ]);
  const bdays: Bday[] = [
    ...bdParents.map((p) => ({ id: p.id, family_id: p.family_id, name: String(p.full_name || "").trim().split(/\s+/)[0], birth_date: String(p.birth_date) })),
    ...bdKids.map((k) => ({ id: k.id, family_id: k.family_id, name: String(k.name || "").trim().split(/\s+/)[0], birth_date: String(k.birth_date) })),
  ].filter((b) => b.name);
  // מי חוגג בתאריך מסוים (נולדו ב-29.2: בשנה לא מעוברת ב-28.2), עם הגיל
  const bdaysOn = (familyId: string, iso: string) => {
    const y = Number(iso.slice(0, 4));
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return bdays.filter((b) => b.family_id === familyId).map((b) => {
      const md = b.birth_date.slice(5, 10) === "02-29" && !leap ? "02-28" : b.birth_date.slice(5, 10);
      const age = y - Number(b.birth_date.slice(0, 4));
      return md === iso.slice(5, 10) && age > 0 ? { ...b, age } : null;
    }).filter(Boolean) as (Bday & { age: number })[];
  };
  // ימים קבועים במשפחה המורחבת (family-dates.sql). לועזי: יום+חודש. עברי: לפי Intl he-u-ca-hebrew, כמו באפליקציה
  type FDate = { id: string; family_id: string; name: string; kind: string; date: string; hebrew: boolean; heb_month: string | null; heb_day: number | null };
  const fdates = await safe<FDate>(supabase.from("family_dates").select("id, family_id, name, kind, date, hebrew, heb_month, heb_day").in("family_id", familyIds));
  const hebFmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const heb = (iso: string) => {
    const p = hebFmt.formatToParts(new Date(iso + "T12:00:00Z"));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return { m: g("month"), d: Number(g("day")), y: Number(g("year")) };
  };
  const fdYears = (f: FDate, iso: string): number | null => {
    if (iso < String(f.date).slice(0, 10)) return null;
    const fd = String(f.date).slice(0, 10);
    if (!f.hebrew || !f.heb_month) {
      const y = Number(iso.slice(0, 4));
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const md = fd.slice(5) === "02-29" && !leap ? "02-28" : fd.slice(5);
      return md === iso.slice(5) ? y - Number(fd.slice(0, 4)) : null;
    }
    const h = heb(iso), w = f.heb_month;
    const monthOk = h.m === w || (w === "Adar" && h.m === "Adar II") || ((w === "Adar I" || w === "Adar II") && h.m === "Adar");
    const dayOk = h.d === f.heb_day || (f.heb_day === 30 && h.d === 29 && heb(addDays(iso, 1)).d === 1);
    return monthOk && dayOk ? h.y - heb(fd).y : null;
  };
  const fdLines = (familyId: string, iso: string) => fdates.filter((f) => f.family_id === familyId).map((f) => {
    const y = fdYears(f, iso);
    if (y === null || (y <= 0 && f.kind !== "other")) return null;
    if (f.kind === "birthday") return `🎂 יום הולדת ${y} ל${f.name}`;
    if (f.kind === "anniversary") return `💍 יום נישואין ${y}: ${f.name}`;
    if (f.kind === "memorial") return `🕯️ אזכרה: ${f.name}`;
    return `📌 ${f.name}`;
  }).filter(Boolean) as string[];
  const shekel = (v: number) => `₪${Math.round(v).toLocaleString("he-IL")}`;
  const weekLines = (familyId: string) => {
    const lastStart = addDays(now.iso, -7), prevStart = addDays(now.iso, -14);
    const mine = weekTx.filter((t) => t.family_id === familyId);
    const inRange = (t: Tx, from: string, to: string) => { const d = String(t.date).slice(0, 10); return d >= from && d < to; };
    const last = mine.filter((t) => inRange(t, lastStart, now.iso));
    const prev = mine.filter((t) => inRange(t, prevStart, lastStart));
    const lastSum = last.reduce((x, t) => x + Number(t.amount), 0);
    const prevSum = prev.reduce((x, t) => x + Number(t.amount), 0);
    const lines: string[] = [];
    if (!last.length) return lines;
    const diff = lastSum - prevSum;
    lines.push(`השבוע שעבר: ${shekel(lastSum)} שוטף${prev.length ? `, ${shekel(Math.abs(diff))} ${diff <= 0 ? "פחות" : "יותר"} מהשבוע שלפניו` : ""}`);
    const byCat: Record<string, number> = {};
    last.forEach((t) => { const c = t.category || "אחר"; byCat[c] = (byCat[c] || 0) + Number(t.amount); });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (top) lines.push(`הכי הרבה: ${top[0]} ${shekel(top[1])}`);
    const review = mine.filter((t) => t.review_status === "to_review").length;
    if (review) lines.push(`לבדיקה באפליקציה: ${review === 1 ? "תנועה אחת" : `${review} תנועות`}`);
    return lines;
  };
  const kidName = new Map(children.map((c) => [c.id, c.name]));
  const lastDay = new Date(Date.UTC(now.y, now.m, 0)).getUTCDate();
  const billToday = (b: { due_day: number }) => b.due_day === now.d || (now.d === lastDay && b.due_day > lastDay);
  const groceryLists = new Set(lists.filter((l) => l.kind === "grocery").map((l) => l.id));
  const todayEvents = events.filter((e) => occursToday(e, now.iso, now.dow));
  const tomorrowEvents = events.filter((e) => occursToday(e, tomorrow, tomorrowDow));
  const kidOf = (e: Ev) => (e.person_kind === "child" && e.person_id ? kidName.get(e.person_id) : null);

  type Msg = { userId: string; familyId: string; key: string; title: string; body: string; tag: string };
  const out: Msg[] = [];

  for (const userId of userIds) {
    const familyId = subs.find((s) => s.user_id === userId)!.family_id;
    const p = pref(userId);
    const isPrem = premium.has(familyId);

    // 1. הבוקר שלכם
    const briefDue = input.force_brief || (!input.force_evening && p.brief_enabled && now.hour === p.brief_hour && now.minute < 15);
    if (briefDue) {
      const lines: string[] = [];
      for (const b of bdaysOn(familyId, now.iso)) lines.push(b.id === userId ? `🎂 יום הולדת ${b.age} שמח` : `🎂 היום יום ההולדת של ${b.name} (${b.age})`);
      for (const b of bdaysOn(familyId, addDays(now.iso, 7)).filter((b) => b.id !== userId)) lines.push(`🎂 בעוד שבוע: יום הולדת ${b.age} ל${b.name}`);
      for (const l of fdLines(familyId, now.iso)) lines.push(`היום: ${l}`);
      for (const l of fdLines(familyId, addDays(now.iso, 7))) lines.push(`בעוד שבוע: ${l}`);
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
        const mine = tasks.filter((t) => t.family_id === familyId && visibleTo(t, userId) && String(t.due_date).slice(0, 10) <= now.iso);
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
      // ביום ראשון: סיכום השבוע שעבר מצטרף לאותה התראה (לא התראה נוספת)
      const weekly = (now.dow === 0 || input.force_weekly) ? weekLines(familyId) : [];
      if (weekly.length) lines.push(...weekly);
      if (lines.length) out.push({ userId, familyId, key: `brief:${userId}:${now.iso}`, title: weekly.length ? "Homey · הבוקר שלכם + סיכום השבוע" : "Homey · הבוקר שלכם", body: lines.join("\n"), tag: "homey-brief" });
    }

    // 2. תזכורת שעה לפני (רק למי שאחראי)
    if (isPrem && !input.force_brief && !input.force_evening) {
      const inWindow = (t: string | null) => { const m = toMin(t); return m != null && m - nowMin > 40 && m - nowMin <= 65; };
      if (p.event_reminders) {
        for (const e of todayEvents.filter((e) => e.family_id === familyId && remindsUser(e, userId) && inWindow(e.start_time))) {
          const who = kidOf(e);
          // חוג שהוא מסיע הלוך: "להסיע את נועה לכדורגל". מי שרק מחזיר יקבל תזכורת לפני הסיום
          if (e.kind === "class" && (e.drive_to || e.drive_from) && e.drive_to !== userId) continue;
          const title = e.kind === "class" && e.drive_to === userId ? `בעוד שעה: להסיע${who ? ` את ${who}` : ""} ל${e.title}` : `בעוד שעה: ${e.title}${who ? ` (${who})` : ""}`;
          out.push({ userId, familyId, key: `ev:${e.id}:${now.iso}:${userId}`, title,
            body: [hhmm(e.start_time), e.location].filter(Boolean).join(" · "), tag: `homey-ev-${e.id}` });
        }
        // איסוף בסוף החוג, למי שמחזיר
        for (const e of todayEvents.filter((e) => e.family_id === familyId && e.kind === "class" && e.drive_from === userId && inWindow(e.end_time))) {
          const who = kidOf(e);
          out.push({ userId, familyId, key: `pick:${e.id}:${now.iso}:${userId}`, title: `בעוד שעה: לאסוף${who ? ` את ${who}` : ""} מ${e.title}`,
            body: [hhmm(e.end_time), e.location].filter(Boolean).join(" · "), tag: `homey-pick-${e.id}` });
        }
      }
      if (p.task_reminders) {
        for (const t of tasks.filter((t) => t.family_id === familyId && remindsUser(t, userId) && String(t.due_date).slice(0, 10) === now.iso && inWindow(t.due_time))) {
          out.push({ userId, familyId, key: `task:${t.id}:${now.iso}:${userId}`, title: `תזכורת: ${t.title}`, body: `עד ${hhmm(t.due_time)}`, tag: `homey-task-${t.id}` });
        }
      }
    }

    // 3. מחר אצלכם: סיכום ערב
    const eveningDue = input.force_evening || (!input.force_brief && p.evening_enabled && now.hour === p.evening_hour && now.minute < 15);
    if (isPrem && eveningDue) {
      const lines: string[] = [];
      for (const b of bdaysOn(familyId, tomorrow).filter((b) => b.id !== userId)) lines.push(`🎂 מחר יום ההולדת של ${b.name} (${b.age})`);
      for (const l of fdLines(familyId, tomorrow)) lines.push(`מחר: ${l}`);
      const evs = tomorrowEvents.filter((e) => e.family_id === familyId && visibleTo(e, userId))
        .sort((a, b) => (toMin(a.start_time) ?? 9999) - (toMin(b.start_time) ?? 9999));
      if (evs.length) {
        const shown = evs.slice(0, 4).map((e) => `${e.start_time ? hhmm(e.start_time) + " " : ""}${e.title}${kidOf(e) ? ` (${kidOf(e)})` : ""}`);
        lines.push(`מחר: ${shown.join(", ")}${evs.length > 4 ? ` ועוד ${evs.length - 4}` : ""}`);
      }
      const rides = evs.filter((e) => e.kind === "class").flatMap((e) => [
        e.drive_to === userId ? `${hhmm(e.start_time)} להסיע${kidOf(e) ? ` את ${kidOf(e)}` : ""} ל${e.title}` : null,
        e.drive_from === userId ? `${hhmm(e.end_time) || "בסוף"} לאסוף${kidOf(e) ? ` את ${kidOf(e)}` : ""} מ${e.title}` : null,
      ]).filter(Boolean);
      if (rides.length) lines.push(`🚗 עליך: ${rides.join(", ")}`);
      const noDriver = evs.filter((e) => e.kind === "class" && "drive_to" in e && (!e.drive_to || !e.drive_from));
      if (noDriver.length) lines.push(`⚠️ בלי מסיע: ${noDriver.slice(0, 2).map((e) => `${e.title}${kidOf(e) ? ` (${kidOf(e)})` : ""}`).join(", ")}`);
      const myTasks = tasks.filter((t) => t.family_id === familyId && String(t.due_date).slice(0, 10) === tomorrow
        && (t.person_id === userId || (!t.person_id && t.scope !== "personal")));
      if (myTasks.length) lines.push(`משימות שלך למחר: ${myTasks.slice(0, 3).map((t) => t.title).join(", ")}${myTasks.length > 3 ? ` ועוד ${myTasks.length - 3}` : ""}`);
      const late = tasks.filter((t) => t.family_id === familyId && t.person_id === userId && String(t.due_date).slice(0, 10) < now.iso).length;
      if (late) lines.push(`באיחור אצלך: ${late === 1 ? "משימה אחת" : `${late} משימות`}`);
      if (lines.length) out.push({ userId, familyId, key: `evening:${userId}:${tomorrow}`, title: "Homey · מחר אצלכם", body: lines.join("\n"), tag: "homey-evening" });
    }
  }

  // מסננים מה שכבר נשלח (חוץ מ-force_brief / force_evening, שנועדו לבדיקה)
  let toSend = out;
  if (out.length && !input.force_brief && !input.force_evening) {
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
  if (delivered.size && !input.force_brief && !input.force_evening) {
    const { error } = await supabase.from("push_log").upsert([...delivered].map((key) => ({ key })), { onConflict: "key", ignoreDuplicates: true });
    if (error) console.error("push_log write failed", error.message);
  }
  return json({ sent, removed, failed });
});
