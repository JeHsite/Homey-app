-- Homey — מערך "פגישות, דייטים וחוגים". משתמש בטבלה family_events (מ-tasks-schedule.sql) ומרחיב אותה.
-- להריץ פעם אחת ב-SQL Editor, אחרי tasks-schedule.sql. Idempotent.
--
-- family_events:
--   with_whom  = עם מי הפגישה (טקסט חופשי)
--   planner_id = בדייט: מי מההורים מתכנן אותו
--   rating     = בדייט שעבר: דירוג 1-5
--   bill_id    = בחוג: הוראת הקבע בכלכלה שנוצרה עבור העלות החודשית שלו
-- date_ideas: בנק רעיונות לדייטים (בבית / בחוץ / חוויה, ורמת עלות).

alter table public.family_events add column if not exists with_whom text;
alter table public.family_events add column if not exists planner_id uuid;
alter table public.family_events add column if not exists rating smallint check (rating between 1 and 5);
alter table public.family_events add column if not exists bill_id uuid references public.bills(id) on delete set null;

create table if not exists public.date_ideas (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  place text not null default 'out' check (place in ('home', 'out', 'experience')),
  cost_level smallint not null default 2 check (cost_level between 1 and 3),
  used_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists date_ideas_family on public.date_ideas (family_id);

alter table public.date_ideas enable row level security;
drop policy if exists "date_ideas_family" on public.date_ideas;
create policy "date_ideas_family" on public.date_ideas
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

select (select count(*) from public.date_ideas) as date_ideas,
       (select count(*) from information_schema.columns where table_name = 'family_events' and column_name in ('with_whom', 'planner_id', 'rating', 'bill_id')) as new_columns;
