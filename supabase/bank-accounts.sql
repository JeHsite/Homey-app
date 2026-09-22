-- Homey — חשבונות עו"ש (עובר ושב). להריץ פעם אחת ב-SQL Editor. Idempotent.
-- תכונת פרימיום בלבד — אותה חסימה כמו savings_pots/assets (require_premium_for_insert,
-- מוגדרת כבר ב-billing-hardening.sql).

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  label text not null,
  balance numeric(14,2) not null,
  currency text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists bank_accounts_family on public.bank_accounts (family_id);

alter table public.bank_accounts enable row level security;
drop policy if exists "bank_accounts_family" on public.bank_accounts;
create policy "bank_accounts_family" on public.bank_accounts
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- פרימיום בלבד: משתמש בפונקציה הקיימת מ-billing-hardening.sql (fail-open אם אין family_plan).
drop trigger if exists trg_require_premium_bank_accounts on public.bank_accounts;
create trigger trg_require_premium_bank_accounts before insert on public.bank_accounts
  for each row execute function public.require_premium_for_insert();

select count(*) as bank_accounts_rows from public.bank_accounts;
