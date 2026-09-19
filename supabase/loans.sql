-- Homey — הלוואות (בנקאיות/משכנתא/רכב). להריץ פעם אחת ב-SQL Editor. Idempotent.
-- כל משפחה רואה ומנהלת רק את ההלוואות שלה (אותה הרשאה כמו יעדים משפחתיים).

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  kind text not null default 'bank' check (kind in ('bank','mortgage','car','other')),
  lender text,
  principal numeric(14,2) not null check (principal > 0),
  annual_rate numeric(6,3) not null default 0 check (annual_rate >= 0 and annual_rate <= 100),
  term_months int not null check (term_months between 1 and 480),
  first_payment_date date not null,
  method text not null default 'spitzer' check (method in ('spitzer','equal_principal')),
  rate_type text not null default 'fixed' check (rate_type in ('fixed','fixed_cpi','prime','variable')),
  monthly_override numeric(14,2) check (monthly_override is null or monthly_override > 0),
  created_at timestamptz default now()
);
create index if not exists loans_family on public.loans (family_id);

alter table public.loans enable row level security;
drop policy if exists "loans_family" on public.loans;
create policy "loans_family" on public.loans
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- תוכנית חינמית: הלוואה אחת בלבד (אכיפה בשרת; fail-open כמו שאר ההגבלות —
-- חוסם רק כשהמשפחה בוודאות 'free').
create or replace function public.check_loan_limit() returns trigger
language plpgsql security definer as $$
declare
  is_free boolean;
  cnt int;
begin
  select (plan = 'free') into is_free from public.family_plan where family_id = new.family_id;
  if not coalesce(is_free, false) then
    return new;
  end if;
  select count(*) into cnt from public.loans where family_id = new.family_id;
  if cnt >= 1 then
    raise exception 'free_tier_limit: בתוכנית החינמית אפשר לעקוב אחרי הלוואה אחת' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_check_loan_limit on public.loans;
create trigger trg_check_loan_limit before insert on public.loans
  for each row execute function public.check_loan_limit();

-- מחיקת חשבון: ההלוואות נמחקות אוטומטית יחד עם המשפחה (on delete cascade).

-- בדיקה
select count(*) as loans_rows from public.loans;
