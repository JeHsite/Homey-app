-- Homey: תמונת מצב של השימוש באפליקציה. קריאה בלבד, לא משנה שום נתון.
-- מחזיר רק מספרים מסוכמים: בלי שמות, בלי תיאורי הוצאות, בלי אימיילים.
-- להריץ ב-SQL Editor. שתי שאילתות נפרדות: להריץ כל אחת לבד (לסמן אותה ו-Run).

-- ===== שאילתה 1: שימוש ונתונים =====
with
fam as (select id from public.families),
prem as (select family_id from public.family_plan where plan = 'premium'),
tx as (select family_id, type, category, amount, date::date as d, account_id from public.transactions),
tx30 as (select * from tx where d >= current_date - 30),
last_tx as (select family_id, max(d) as last_d, count(distinct to_char(d, 'YYYY-MM')) as months from tx group by family_id),
rv as (select family_id, kind, week_start, created_at, content from public.weekly_reviews),
goals as (
  select (g->>'met') as met
  from rv, jsonb_array_elements(coalesce(rv.content->'goals', '[]'::jsonb)) g
  where rv.kind = 'summary'
)
select * from (values
  ('01 משפחות סה"כ',                          (select count(*) from fam)::text),
  ('02 משפחות פרימיום',                       (select count(*) from prem)::text),
  ('03 משפחות שרשמו משהו ב-30 יום',          (select count(distinct family_id) from tx30)::text),
  ('04 משפחות שלא רשמו כלום 14+ יום',       (select count(*) from last_tx where last_d < current_date - 14)::text),
  ('05 משפחות שמעולם לא רשמו תנועה',        (select count(*) from fam where id not in (select family_id from tx))::text),
  ('06 תנועות סה"כ',                          (select count(*) from tx)::text),
  ('07 תנועות ב-30 יום',                      (select count(*) from tx30)::text),
  ('08 ממוצע תנועות למשפחה פעילה (30 יום)', (select round(count(*)::numeric / nullif(count(distinct family_id), 0), 1) from tx30)::text),
  ('09 הכנסות / הוצאות ב-30 יום',             (select count(*) filter (where type = 'income') || ' / ' || count(*) filter (where type = 'expense') from tx30)),
  ('10 משפחות פעילות בלי אף הכנסה ב-60 יום', (select count(*) from (select family_id from tx where d >= current_date - 30 group by family_id
                                                 having count(*) filter (where type = 'income' and d >= current_date - 60) = 0) x)::text),
  ('11 % הוצאות בקטגוריה "אחר" או ריקה',     (select round(100.0 * count(*) filter (where category is null or category in ('אחר', '')) / nullif(count(*), 0), 1) from tx where type = 'expense')::text),
  ('12 משפחות עם חודש נתונים אחד בלבד',     (select count(*) from last_tx where months = 1)::text),
  ('13 תנועות מקושרות לחשבון בנק',           (select count(*) from tx where account_id is not null)::text),
  ('14 הוראות קבע / מסומנות שולם עכשיו',     (select count(*) || ' / ' || count(*) filter (where is_paid) from public.bills)),
  ('15 משפחות עם הוראות קבע',                (select count(distinct family_id) from public.bills)::text),
  ('16 הלוואות / משפחות עם הלוואה',          (select count(*) || ' / ' || count(distinct family_id) from public.loans)),
  ('17 תקציבי קטגוריה מוגדרים',              (select count(*) from public.category_budgets)::text),
  ('18 קופות חיסכון / יעדי משפחה',           ((select count(*) from public.savings_pots) || ' / ' || (select count(*) from public.family_goals))),
  ('19 סקירות שבועיות: סיכום / פתיחה',       (select count(*) filter (where kind = 'summary') || ' / ' || count(*) filter (where kind = 'start') from rv)),
  ('20 משפחות שקיבלו סקירה',                 (select count(distinct family_id) from rv)::text),
  ('21 סקירה אחרונה נוצרה ב',                (select coalesce(to_char(max(created_at) at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI'), 'אף פעם') from rv)),
  ('22 יעדים שבועיים: הושג / לא / לא נבדק',  (select count(*) filter (where met = 'true') || ' / ' || count(*) filter (where met = 'false') || ' / ' || count(*) filter (where met is null) from goals)),
  ('23 מכשירים רשומים להתראות',              (select count(*) from public.push_subscriptions)::text)
) as t(metric, value)
order by metric;


-- ===== שאילתה 2: האם המשימות המתוזמנות (cron) רצות =====
-- אם מקבלים שגיאה "schema cron does not exist", pg_cron לא מופעל ושום תזמון לא רץ.
select j.jobname, j.schedule, j.active,
       to_char(max(d.start_time) at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') as last_run,
       count(*) filter (where d.status = 'succeeded') as ok_runs,
       count(*) filter (where d.status = 'failed') as failed_runs
from cron.job j
left join cron.job_run_details d on d.jobid = j.jobid
group by j.jobname, j.schedule, j.active
order by j.jobname;
