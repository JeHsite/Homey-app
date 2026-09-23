-- Homey — תקציב חודשי לכל קטגוריית הוצאה. להריץ פעם אחת ב-SQL Editor. Idempotent.
-- כל שורה = קטגוריה אחת למשפחה. האפליקציה מציגה התראה ב-80% וגם בחריגה מהתקציב.

create table if not exists public.category_budgets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  category text not null,
  monthly_amount numeric(14,2) not null check (monthly_amount > 0),
  updated_at timestamptz not null default now(),
  unique (family_id, category)
);
create index if not exists category_budgets_family on public.category_budgets (family_id);

alter table public.category_budgets enable row level security;
drop policy if exists "category_budgets_family" on public.category_budgets;
create policy "category_budgets_family" on public.category_budgets
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

select count(*) as category_budgets_rows from public.category_budgets;
