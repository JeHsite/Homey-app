-- Homey — יעדים ושאלון פתיחה. להריץ פעם אחת ב-SQL Editor.
-- family_goals: יעדים משפחתיים (תקרת הוצאה, שווי, חיסכון חודשי) — כל המשפחה רואה.
-- personal_goals + profile_setup: של הורה — רק החשבון שלו; של ילד — ההורים במשפחה.

create table if not exists public.family_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  type text not null check (type in ('spending_cap', 'net_worth', 'monthly_saving')),
  title text not null,
  category text,
  target numeric(14,2) not null check (target > 0),
  deadline date,
  created_at timestamptz default now()
);
create index if not exists family_goals_family on public.family_goals (family_id);

create table if not exists public.personal_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  owner_id uuid not null,
  owner_kind text not null check (owner_kind in ('parent', 'child')),
  title text not null,
  area text,
  deadline date,
  steps jsonb not null default '[]'::jsonb,
  done boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists personal_goals_owner on public.personal_goals (owner_id);

create table if not exists public.profile_setup (
  owner_id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  owner_kind text not null check (owner_kind in ('parent', 'child')),
  audience text not null check (audience in ('parent', 'kid', 'teen')),
  answers jsonb not null default '{}'::jsonb,
  completed_at timestamptz default now()
);

alter table public.family_goals enable row level security;
alter table public.personal_goals enable row level security;
alter table public.profile_setup enable row level security;

drop policy if exists "family_goals_family" on public.family_goals;
create policy "family_goals_family" on public.family_goals
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- הורה: רק השורות שלו (owner_id = החשבון המחובר). ילד: כל הורה במשפחה של הילד.
drop policy if exists "personal_goals_owner" on public.personal_goals;
create policy "personal_goals_owner" on public.personal_goals
  for all to authenticated
  using (family_id = public.get_my_family_id() and (
    (owner_kind = 'parent' and owner_id = auth.uid())
    or (owner_kind = 'child' and exists (select 1 from public.children c where c.id = owner_id and c.family_id = public.get_my_family_id()))))
  with check (family_id = public.get_my_family_id() and (
    (owner_kind = 'parent' and owner_id = auth.uid())
    or (owner_kind = 'child' and exists (select 1 from public.children c where c.id = owner_id and c.family_id = public.get_my_family_id()))));

drop policy if exists "profile_setup_owner" on public.profile_setup;
create policy "profile_setup_owner" on public.profile_setup
  for all to authenticated
  using (family_id = public.get_my_family_id() and (
    (owner_kind = 'parent' and owner_id = auth.uid())
    or (owner_kind = 'child' and exists (select 1 from public.children c where c.id = owner_id and c.family_id = public.get_my_family_id()))))
  with check (family_id = public.get_my_family_id() and (
    (owner_kind = 'parent' and owner_id = auth.uid())
    or (owner_kind = 'child' and exists (select 1 from public.children c where c.id = owner_id and c.family_id = public.get_my_family_id()))));

-- בדיקה: שלוש הטבלאות קיימות
select 'family_goals' as table_name, count(*) from public.family_goals
union all select 'personal_goals', count(*) from public.personal_goals
union all select 'profile_setup', count(*) from public.profile_setup;
