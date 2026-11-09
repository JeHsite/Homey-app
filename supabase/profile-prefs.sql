-- Homey — העדפות אישיות לכל פרופיל, שעוברות בין מכשירים (טלפון / מחשב). להריץ פעם אחת ב-SQL Editor. Idempotent.
-- כרגע: task_default = מי רואה משימה שנכתבת בלי שם של אף אחד ('personal' = רק אני, 'family' = כל המשפחה).
-- אין ערך ברירת מחדל: כל עוד אין שורה, האפליקציה שואלת את המשתמש פעם אחת.

create table if not exists public.profile_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  family_id uuid not null default public.get_my_family_id() references public.families(id) on delete cascade,
  task_default text check (task_default in ('personal', 'family')),
  updated_at timestamptz not null default now()
);
alter table public.profile_prefs enable row level security;

-- כל הורה במשפחה יכול לקרוא ולשמור העדפות של פרופילים במשפחה שלו בלבד
-- (בטלפון אחד אפשר לבחור את הפרופיל של בן/בת הזוג, ואז נשמרת ההעדפה של הפרופיל שנבחר)
drop policy if exists "profile_prefs_family" on public.profile_prefs;
create policy "profile_prefs_family" on public.profile_prefs
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (
    family_id = public.get_my_family_id()
    and profile_id in (select id from public.profiles where family_id = public.get_my_family_id())
  );

-- בדיקה: צריך לחזור 0 (הטבלה קיימת וריקה)
select count(*) as profile_prefs from public.profile_prefs;
