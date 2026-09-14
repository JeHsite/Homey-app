-- Homey — שעת תזכורות ניתנת להגדרה לכל משפחה. להריץ פעם אחת ב-SQL Editor.

alter table public.families
  add column if not exists reminder_hour smallint not null default 8
  check (reminder_hour >= 0 and reminder_hour <= 23);

-- ה-cron הישן רץ פעם ביום בשעה קבועה (05:00 UTC). כדי שכל משפחה תוכל לבחור שעה משלה,
-- send-reminders עכשיו בודקת בעצמה בכל הפעלה איזו משפחה "צריכה" את התזכורת עכשיו —
-- ולכן ה-cron צריך לרוץ כל שעה, לא פעם ביום.
select cron.unschedule('homey-daily-reminders');

-- להחליף את <CRON_SECRET> בערך מקובץ הסודות המקומי (Downloads\homey-SECRETS-do-not-upload.txt), ואז להריץ.
select cron.schedule(
  'homey-hourly-reminders',
  '0 * * * *',
  $$ select net.http_post(
       url := 'https://fhmcalbsqgdghvbqucwd.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
       body := '{}'::jsonb
     ) $$
);

-- בדיקה: העמודה קיימת, וה-cron הישן נעלם והחדש קיים
select id, reminder_hour from public.families limit 3;
select jobname, schedule from cron.job where jobname like 'homey%reminder%';
