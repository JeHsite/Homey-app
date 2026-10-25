-- Homey — סגירת חודש: שורה אחת לכל משפחה לכל חודש שנסגר, כדי שמסך הסגירה יקפוץ פעם אחת בלבד
-- (לכל ההורים במשפחה) וכדי לזכור כמה הועבר לחיסכון. להריץ פעם אחת ב-SQL Editor. Idempotent.

create table if not exists public.month_closes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),     -- החודש שנסגר, למשל 2026-10
  summary jsonb not null default '{}'::jsonb,              -- הכנסות/קבועות/שוטפות/נשאר בזמן הסגירה
  moved_amount numeric(14,2) not null default 0 check (moved_amount >= 0),
  pot_id uuid references public.savings_pots(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz not null default now(),
  unique (family_id, month)
);

alter table public.month_closes enable row level security;
drop policy if exists "month_closes_family" on public.month_closes;
create policy "month_closes_family" on public.month_closes
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

select count(*) as month_closes from public.month_closes;
