-- Homey — טבלת מנויי פוש. להריץ פעם אחת ב-SQL Editor.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

alter table public.push_subscriptions enable row level security;

-- כל משתמש רואה/מנהל רק את המכשירים שלו, ורק בתוך המשפחה שלו
drop policy if exists "push_own" on public.push_subscriptions;
create policy "push_own" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and family_id = get_my_family_id());

-- איפוס חודשי: ב-1 לכל חודש (00:00 UTC = 02:00-03:00 שעון ישראל, לפני התזכורות) כל החשבונות חוזרים ל"לא שולם".
-- select cron.schedule(
--   'homey-monthly-bill-reset',
--   '0 0 1 * *',
--   $$ update public.bills set is_paid = false where is_paid $$
-- );

-- תזמון יומי: 05:00 UTC = 08:00 בקיץ / 07:00 בחורף (שעון ישראל).
-- להחליף את <CRON_SECRET> בערך מקובץ הסודות המקומי. (צריך pg_cron ו-pg_net מופעלים)
-- select cron.schedule(
--   'homey-daily-reminders',
--   '0 5 * * *',
--   $$ select net.http_post(
--        url := 'https://fhmcalbsqgdghvbqucwd.supabase.co/functions/v1/send-reminders',
--        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--        body := '{}'::jsonb
--      ) $$
-- );
