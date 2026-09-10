-- Homey — "הכסף שלי" לילדים: ארנק, הוצאות ויעדי חיסכון לכל ילד. להריץ פעם אחת ב-SQL Editor.
-- נפרד מטבלאות המשפחה (transactions / savings_pots) כדי שהכסף של הילדים לא ישפיע על תקציב הבית.

create table if not exists public.kid_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  amount numeric(12,2) not null check (amount >= 0),
  note text,
  date date not null default current_date,
  created_at timestamptz default now()
);
create index if not exists kid_entries_child_date on public.kid_entries (child_id, date desc);

create table if not exists public.kid_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  title text not null,
  category text not null,
  target numeric(12,2) not null check (target > 0),
  saved numeric(12,2) not null default 0 check (saved >= 0),
  created_at timestamptz default now()
);
create index if not exists kid_goals_child on public.kid_goals (child_id);

alter table public.kid_entries enable row level security;
alter table public.kid_goals enable row level security;

-- רק בני המשפחה, ורק על ילד שבאמת שייך למשפחה
drop policy if exists "kid_entries_family" on public.kid_entries;
create policy "kid_entries_family" on public.kid_entries
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id()
    and exists (select 1 from public.children c where c.id = child_id and c.family_id = public.get_my_family_id()));

drop policy if exists "kid_goals_family" on public.kid_goals;
create policy "kid_goals_family" on public.kid_goals
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id()
    and exists (select 1 from public.children c where c.id = child_id and c.family_id = public.get_my_family_id()));

-- בדיקה: שתי הטבלאות קיימות
select 'kid_entries' as table_name, count(*) from public.kid_entries
union all
select 'kid_goals', count(*) from public.kid_goals;
