// Homey — סקירה שבועית עם AI (Claude): סיכום שבוע במוצ"ש 20:00, פתיחת שבוע בראשון 8:00 (שעון ישראל).
// מופעל ע"י pg_cron כמה פעמים בסופ"ש (ראו weekly_review.sql). הפונקציה בודקת בעצמה את שעון ישראל, כך שמעבר לשעון חורף לא דורש שינוי.
// מוגן בכותרת x-cron-secret — לכן "Verify JWT" כבוי לפונקציה הזו.
// בלי הסוד ANTHROPIC_API_KEY הפונקציה לא עושה כלום (מחזירה no_api_key), כך שאפשר לתזמן אותה מראש.
// בדיקה ידנית (POST עם x-cron-secret):
//   {"dry": true, "kind": "start"}                       — מחזיר את הנתונים שהיו נשלחים ל-Claude, בלי לקרוא לו ובלי לשמור
//   {"kind": "start", "family_id": "<uuid>", "force": true} — כותב סקירה עכשיו למשפחה אחת (ודורס את הקיימת) ושולח התראה
// ל-Claude נשלחים רק נתונים מסוכמים: סכומים לפי קטגוריה, חיובים קרובים ויעדים. בלי שמות בני משפחה, תיאורי הוצאות או אימייל.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const MODEL = "claude-sonnet-5";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Kind = "summary" | "start";
type Tx = { type: string; category: string | null; amount: number; date: string };

// היום והשעה לפי שעון ישראל (השרת רץ ב-UTC)
function israelNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    y: Number(get("year")), m: Number(get("month")), d: Number(get("day")),
    hour: Number(get("hour")) % 24,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

// חשבון ימים על התאריך הישראלי (ב-UTC כדי שלא יזוז בגלל אזור זמן)
const day = (y: number, m: number, d: number, add = 0) => new Date(Date.UTC(y, m - 1, d + add));
const iso = (dt: Date) => dt.toISOString().slice(0, 10);
const plusDays = (dt: Date, n: number) => new Date(dt.getTime() + n * 86400000);
const round = (n: number) => Math.round(n);

function sumByCategory(rows: Tx[]) {
  const map: Record<string, number> = {};
  for (const r of rows) map[r.category || "אחר"] = (map[r.category || "אחר"] || 0) + Number(r.amount || 0);
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, round(v)] as const).sort((a, b) => b[1] - a[1]));
}
const total = (rows: Tx[]) => round(rows.reduce((s, r) => s + Number(r.amount || 0), 0));

// ניקוי הטקסט שחוזר: בלי "—", בלי סימני קריאה ובלי אימוג'י (לפי סגנון האפליקציה)
const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/\p{Extended_Pictographic}️?/gu, "").replace(/\s*[—–]\s*/g, ", ")
    .replace(/!/g, ".").replace(/\s+/g, " ").trim().slice(0, max);

const SYSTEM = (kind: Kind) => `את/ה כותב/ת סקירה שבועית קצרה למשפחה ישראלית, באפליקציה לניהול משק בית בשם Homey.
סוג הסקירה: ${kind === "summary"
  ? "סיכום השבוע שמסתיים עכשיו (מוצאי שבת בערב)."
  : "פתיחת השבוע החדש (יום ראשון בבוקר), על סמך השבוע שעבר."}

כללים:
- עברית פשוטה וחמה, פנייה ברבים ("אתם"), משפטים קצרים.
- בלי אימוג'י, בלי סימני קריאה ובלי קו מפריד ארוך.
- השתמשו רק במספרים שבנתונים. אל תמציאו סכומים, קטגוריות או אירועים. סכומים בפורמט ₪1,234.
- זה לא ייעוץ השקעות: אל תמליצו על מניות, קרנות או מוצרים פיננסיים מסוימים.
- אם יש מעט נתונים, אמרו את זה בעדינות ותנו טיפים מעשיים כלליים.
- tips: בדיוק 3 טיפים, כל אחד משפט או שניים, מעשי לשבוע הקרוב וקשור לנתונים.
${kind === "summary"
  ? "- goals: עברו על previous_goals (היעדים שנקבעו לשבוע הזה) וקבעו לכל אחד met=true או met=false לפי הנתונים. אם אין previous_goals, החזירו goals ריק."
  : "- goals: קבעו 3 יעדים מדידים לשבוע (עם סכום או מספר), met=null. אפשר להיעזר ב-average_week_by_category וב-family_goals."}
- headline: עד 70 תווים, המסר הכי חשוב של השבוע.
- summary: 2 עד 3 משפטים.

החזירו JSON בלבד, בלי שום טקסט לפניו או אחריו:
{"headline": "...", "summary": "...", "tips": ["...", "...", "..."], "goals": [{"text": "...", "met": null}]}`;

async function askClaude(apiKey: string, kind: Kind, data: unknown) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM(kind),
      messages: [{ role: "user", content: `הנתונים של המשפחה (JSON):\n${JSON.stringify(data)}` }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const body = await r.json();
  const text = (body.content ?? []).filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text).join("");
  const raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const content = {
    headline: clean(raw.headline, 90),
    summary: clean(raw.summary, 420),
    tips: (Array.isArray(raw.tips) ? raw.tips : []).slice(0, 3).map((t: unknown) => clean(t, 180)).filter(Boolean),
    goals: (Array.isArray(raw.goals) ? raw.goals : []).slice(0, 3).map((g: { text?: unknown; met?: unknown }) => ({
      text: clean(g?.text, 90),
      met: kind === "summary" && typeof g?.met === "boolean" ? g.met : null,
    })).filter((g: { text: string }) => g.text),
  };
  if (!content.headline || !content.tips.length) throw new Error("empty review");
  return content;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const input = await req.json().catch(() => ({}));
  const now = israelNow();
  const auto: Kind | null = now.dow === 6 && now.hour === 20 ? "summary" : now.dow === 0 && now.hour === 8 ? "start" : null;
  const kind: Kind | null = input.kind === "summary" || input.kind === "start" ? input.kind : auto;
  if (!kind) return json({ skipped: "not_review_time", israel: now });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey && !input.dry) return json({ skipped: "no_api_key" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // week_start = יום ראשון של השבוע הנוכחי (בשבת: לפני 6 ימים; בראשון: היום). כך גם האפליקציה מחשבת
  const weekStart = day(now.y, now.m, now.d, -now.dow);
  const today = day(now.y, now.m, now.d);
  // התקופה שנסקרת: בסיכום, השבוע הנוכחי עד היום. בפתיחה, השבוע הקודם (ראשון עד שבת)
  const periodStart = kind === "summary" ? weekStart : plusDays(weekStart, -7);
  const periodEnd = kind === "summary" ? plusDays(today, 1) : weekStart;
  const monthStart = day(now.y, now.m, 1);
  const since = iso(plusDays(periodStart < monthStart ? periodStart : monthStart, -28));

  let familyIds: string[];
  if (input.family_id) familyIds = [String(input.family_id)];
  else {
    const { data, error } = await supabase.from("families").select("id");
    if (error) return json({ error: error.message }, 500);
    familyIds = (data ?? []).map((f) => f.id);
  }

  if (apiKey) webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

  const results: Record<string, unknown>[] = [];
  for (const familyId of familyIds) {
    try {
      if (!input.force && !input.dry) {
        const { data: exists } = await supabase.from("weekly_reviews").select("id")
          .eq("family_id", familyId).eq("week_start", iso(weekStart)).eq("kind", kind).maybeSingle();
        if (exists) { results.push({ familyId, skipped: "exists" }); continue; }
      }

      const [{ data: tx }, { data: bills }, { data: pots }, { data: famGoals }, { data: prev }] = await Promise.all([
        supabase.from("transactions").select("type, category, amount, date").eq("family_id", familyId).gte("date", since),
        supabase.from("bills").select("title, category, amount, due_day").eq("family_id", familyId).eq("is_paid", false),
        supabase.from("savings_pots").select("name, target, current").eq("family_id", familyId),
        supabase.from("family_goals").select("type, title, category, target").eq("family_id", familyId),
        // בסיכום: היעדים שנקבעו בפתיחת השבוע הזה. בפתיחה: הסיכום של השבוע שעבר
        supabase.from("weekly_reviews").select("content").eq("family_id", familyId)
          .eq("kind", kind === "summary" ? "start" : "summary")
          .eq("week_start", iso(kind === "summary" ? weekStart : plusDays(weekStart, -7))).maybeSingle(),
      ]);

      const rows = (tx ?? []) as Tx[];
      const inRange = (r: Tx, s: Date, e: Date) => { const d = String(r.date).slice(0, 10); return d >= iso(s) && d < iso(e); };
      const expenses = rows.filter((r) => r.type === "expense");
      const period = expenses.filter((r) => inRange(r, periodStart, periodEnd));
      const before = expenses.filter((r) => inRange(r, plusDays(periodStart, -28), periodStart));
      if (!period.length && !before.length) { results.push({ familyId, skipped: "no_recent_data" }); continue; }

      const avgByCat = Object.fromEntries(Object.entries(sumByCategory(before)).map(([k, v]) => [k, round(v / 4)] as const));
      const monthRows = rows.filter((r) => inRange(r, monthStart, plusDays(today, 1)));
      const upcoming = (bills ?? []).filter((b) => {
        const ahead = (b.due_day - now.d + 31) % 31;
        return ahead <= 7;
      }).map((b) => ({ title: String(b.title).slice(0, 40), category: b.category, amount: round(Number(b.amount)), due_day: b.due_day }));

      const data = {
        review: kind,
        today: iso(today),
        period: { from: iso(periodStart), to: iso(plusDays(periodEnd, -1)) },
        currency: "₪",
        period_expense_total: total(period),
        period_expense_by_category: sumByCategory(period),
        period_income_total: total(rows.filter((r) => r.type === "income" && inRange(r, periodStart, periodEnd))),
        average_week_expense_prev_4_weeks: round(total(before) / 4),
        average_week_by_category: avgByCat,
        month_to_date: {
          day_of_month: now.d,
          days_in_month: new Date(Date.UTC(now.y, now.m, 0)).getUTCDate(),
          income: total(monthRows.filter((r) => r.type === "income")),
          expense: total(monthRows.filter((r) => r.type === "expense")),
        },
        unpaid_bills_next_7_days: upcoming,
        savings_goals: (pots ?? []).map((p) => ({ name: String(p.name).slice(0, 40), current: round(Number(p.current)), target: round(Number(p.target)) })),
        family_goals: (famGoals ?? []).map((g) => ({ type: g.type, title: String(g.title).slice(0, 40), category: g.category, target: round(Number(g.target)) })),
        previous_goals: kind === "summary" ? (prev?.content?.goals ?? []) : undefined,
        last_week_summary: kind === "start" ? (prev?.content?.headline ?? undefined) : undefined,
      };

      if (input.dry) { results.push({ familyId, data }); continue; }

      const content = await askClaude(apiKey!, kind, data);
      const { error: insErr } = await supabase.from("weekly_reviews").upsert(
        { family_id: familyId, week_start: iso(weekStart), kind, content, model: MODEL },
        { onConflict: "family_id,week_start,kind" },
      );
      if (insErr) throw new Error(insErr.message);

      // התראה לכל המכשירים של המשפחה
      const { data: subs } = await supabase.from("push_subscriptions")
        .select("id, endpoint, p256dh, auth").eq("family_id", familyId);
      let pushed = 0, removed = 0, failed = 0;
      await Promise.all((subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({
              title: kind === "summary" ? "Homey · סיכום השבוע" : "Homey · פתיחת שבוע",
              body: content.headline, url: "./", tag: "homey-review",
            }),
            { TTL: 60 * 60 * 12 },
          );
          pushed++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
            removed++;
          } else {
            failed++;
            console.error("push failed", code, (e as Error).message);
          }
        }
      }));
      results.push({ familyId, created: true, pushed, removed, failed });
    } catch (e) {
      console.error("review failed", familyId, (e as Error).message);
      results.push({ familyId, error: (e as Error).message });
    }
  }

  return json({ kind, week_start: iso(weekStart), model: MODEL, results });
});
