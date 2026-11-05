-- Homey — "הבוקר שלכם" ותזכורות לאירועים ולמשימות בפוש. להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- push_prefs: העדפות התראות לכל הורה (שורה למשתמש). אין שורה = ברירת המחדל: הבוקר שלכם ב-07:00, תזכורות פעילות.
-- push_log: יומן שליחה, כדי שאותה התראה לא תישלח פעמיים (כתיבה רק מהשרת, בלי policy ללקוח).
-- הפונקציה daily-brief רצה כל 15 דקות (ראו cron למטה), ובכל ריצה בודקת בעצמה מה צריך לצאת עכשיו לפי שעון ישראל.

create table if not exists public.push_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  brief_enabled boolean not null default true,
  brief_hour smallint not null default 7 check (brief_hour between 0 and 23),
  event_reminders boolean not null default true,
  task_reminders boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
drop policy if exists "push_prefs_own" on public.push_prefs;
create policy "push_prefs_own" on public.push_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and family_id = public.get_my_family_id());

create table if not exists public.push_log (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
create index if not exists push_log_sent on public.push_log (sent_at);

-- תזמון: כל 15 דקות. להחליף את <CRON_SECRET> בערך מקובץ הסודות המקומי (אותו סוד של send-reminders),
-- ואז להסיר את סימני ההערה ולהריץ את החלק הזה בנפרד. (צריך pg_cron ו-pg_net מופעלים, כמו לתזכורות התשלום)
-- select cron.schedule(
--   'homey-daily-brief',
--   '*/15 * * * *',
--   $$ select net.http_post(
--        url := 'https://fhmcalbsqgdghvbqucwd.supabase.co/functions/v1/daily-brief',
--        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--        body := '{}'::jsonb,
--        timeout_milliseconds := 60000
--      ) $$
-- );

-- ניקוי יומן ישן פעם ביום (לא חובה)
-- select cron.schedule('homey-push-log-cleanup', '30 3 * * *', $$ delete from public.push_log where sent_at < now() - interval '14 days' $$);

select (select count(*) from public.push_prefs) as push_prefs, (select count(*) from public.push_log) as push_log;
