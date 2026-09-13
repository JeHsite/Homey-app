-- Homey — סקירה שבועית עם AI. להריץ פעם אחת ב-SQL Editor.
-- סיכום שבוע במוצ"ש 20:00, פתיחת שבוע בראשון 8:00 (שעון ישראל). הסקירה נכתבת פעם אחת למשפחה, וכל ההורים רואים אותה.
-- הכתיבה לטבלה רק מהשרת (service role בפונקציה weekly-review), לכן יש policy לקריאה בלבד.

create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  week_start date not null,               -- יום ראשון של השבוע שהסקירה עוסקת בו
  kind text not null check (kind in ('summary', 'start')),
  content jsonb not null,                 -- {headline, summary, tips[3], goals[{text, met}]}
  model text,
  created_at timestamptz not null default now(),
  unique (family_id, week_start, kind)
);

alter table public.weekly_reviews enable row level security;

drop policy if exists "weekly_reviews_read" on public.weekly_reviews;
create policy "weekly_reviews_read" on public.weekly_reviews
  for select to authenticated
  using (family_id = public.get_my_family_id());

-- תזמון: בשבת ובראשון בשעות 05, 06, 17 ו-18 לפי UTC. כך 20:00 ו-8:00 בישראל נתפסים גם בשעון קיץ וגם בשעון חורף.
-- הפונקציה בודקת בעצמה את שעון ישראל ומדלגת בשאר השעות. עד שיוגדר ANTHROPIC_API_KEY היא לא עושה כלום.
-- להחליף את <CRON_SECRET> בערך מקובץ הסודות המקומי, ואז להסיר את סימני ההערה ולהריץ.
-- select cron.schedule(
--   'homey-weekly-review',
--   '0 5,6,17,18 * * 0,6',
--   $$ select net.http_post(
--        url := 'https://fhmcalbsqgdghvbqucwd.supabase.co/functions/v1/weekly-review',
--        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--        body := '{}'::jsonb,
--        timeout_milliseconds := 120000
--      ) $$
-- );

-- בדיקה: הטבלה קיימת
select count(*) as weekly_reviews from public.weekly_reviews;
