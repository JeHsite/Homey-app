-- Homey — כמה תזכורות תשלום למשפחה (במקום שעה+ימים בודדים על families). להריץ פעם אחת ב-SQL Editor.
-- כל שורה = "תזכורת": שעה + ימים בשבוע. אפשר כמה שורות למשפחה (למשל 8:00 בימי א/ג, ו-18:00 בימי ה).

create table if not exists public.family_reminder_slots (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  hour smallint not null check (hour >= 0 and hour <= 23),
  days smallint[] not null default '{0,1,2,3,4,5,6}',
  created_at timestamptz not null default now()
);
create index if not exists family_reminder_slots_family on public.family_reminder_slots (family_id);

alter table public.family_reminder_slots enable row level security;

drop policy if exists "family_reminder_slots_family" on public.family_reminder_slots;
create policy "family_reminder_slots_family" on public.family_reminder_slots
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- הגירה: לכל משפחה שיש לה כבר reminder_hour/reminder_days (מ-reminder-hour.sql / reminder-days.sql),
-- יוצרים שורת תזכורת אחת מקבילה — כדי שההתנהגות הקיימת לא תשתנה. רק אם עוד אין לה תזכורות.
insert into public.family_reminder_slots (family_id, hour, days)
select f.id, f.reminder_hour, f.reminder_days
from public.families f
where not exists (select 1 from public.family_reminder_slots s where s.family_id = f.id);

-- בדיקה
select f.id as family_id, f.name, s.id as slot_id, s.hour, s.days
from public.families f
left join public.family_reminder_slots s on s.family_id = f.id
order by f.id, s.hour;
