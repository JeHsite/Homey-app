-- Homey — ימים בשבוע לשליחת תזכורות (בנוסף לשעה מ-reminder-hour.sql). להריץ פעם אחת ב-SQL Editor.
-- reminder_days: מספרי ימים 0-6 (0=ראשון...6=שבת, אותה מוסכמה כמו Date.getDay() ב-JS).
-- ברירת מחדל = כל הימים, כדי לא לשנות התנהגות קיימת למשפחות שלא בחרו כלום.

alter table public.families
  add column if not exists reminder_days smallint[] not null default '{0,1,2,3,4,5,6}';

-- בדיקה
select id, reminder_hour, reminder_days from public.families limit 3;
