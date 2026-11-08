-- Homey — "מחר אצלכם" (סיכום ערב) ותזכורות לפי אחראי. להריץ פעם אחת ב-SQL Editor. Idempotent.
-- מוסיף לכל הורה שתי הגדרות: האם לקבל סיכום ערב, ובאיזו שעה (ברירת מחדל 20:00).
-- אין cron חדש: הפונקציה daily-brief כבר רצה כל 15 דקות ובודקת בעצמה מה צריך לצאת עכשיו.

alter table public.push_prefs add column if not exists evening_enabled boolean not null default true;
alter table public.push_prefs add column if not exists evening_hour smallint not null default 20;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_prefs_evening_hour_chk') then
    alter table public.push_prefs add constraint push_prefs_evening_hour_chk check (evening_hour between 0 and 23);
  end if;
end $$;

-- בדיקה: צריך לחזור 2
select count(*) as evening_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'push_prefs' and column_name in ('evening_enabled', 'evening_hour');
