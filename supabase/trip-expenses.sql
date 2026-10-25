-- Homey — הוצאות בטיול (בכל מטבע) שמצטרפות לחשבון החודשי כשהטיול נגמר.
-- להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- trip_expenses: כל הוצאה בטיול, במטבע שבו שולמה, יחד עם הסכום במטבע הראשי של המשפחה לפי השער ביום ההזנה
--   (amount_primary). כך הסיכום מול התקציב לא זז כשהשער משתנה אחר כך.
-- trips.merged_at: מתי הוצאות הטיול צורפו לחודש. ריק = עוד לא (הטיול לא נגמר).
-- transactions.trip_id: שורות הסיכום שנוצרו מהטיול (שורה לכל קטגוריה). אם מוסיפים או מוחקים הוצאה אחרי
--   הצירוף, האפליקציה מוחקת את השורות של הטיול ויוצרת אותן מחדש, כך שאין כפילויות.

create table if not exists public.trip_expenses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'ILS',
  amount_primary numeric(14,2) not null check (amount_primary >= 0),
  category text not null default 'אחר',
  note text,
  date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists trip_expenses_trip on public.trip_expenses (trip_id, date);
create index if not exists trip_expenses_family on public.trip_expenses (family_id);

alter table public.trip_expenses enable row level security;
drop policy if exists "trip_expenses_family" on public.trip_expenses;
create policy "trip_expenses_family" on public.trip_expenses
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- family_id נלקח תמיד מהטיול עצמו, כך שאי אפשר לרשום הוצאה בטיול של משפחה אחרת
create or replace function public.trip_expenses_set_family() returns trigger
language plpgsql security definer as $$
begin
  select family_id into new.family_id from public.trips where id = new.trip_id;
  return new;
end;
$$;
drop trigger if exists trg_trip_expenses_set_family on public.trip_expenses;
create trigger trg_trip_expenses_set_family before insert or update on public.trip_expenses
  for each row execute function public.trip_expenses_set_family();

alter table public.trips add column if not exists merged_at timestamptz;
alter table public.transactions add column if not exists trip_id uuid references public.trips(id) on delete set null;
create index if not exists transactions_trip on public.transactions (trip_id);

-- מכסת הרשומות בתוכנית החינמית לא סופרת שורות שנוצרו אוטומטית (מהוראת קבע או מטיול), ולא חוסמת אותן.
-- (מחליף את הגרסה מ-bill-transactions.sql ומוסיף את trip_id.)
create or replace function public.check_transaction_limit() returns trigger
language plpgsql security definer as $$
declare
  is_free boolean;
  cnt int;
  lim int;
begin
  if new.bill_id is not null or new.trip_id is not null then
    return new;
  end if;
  select (plan = 'free') into is_free from public.family_plan where family_id = new.family_id;
  if not coalesce(is_free, false) then
    return new;
  end if;
  select coalesce(value::int, 40) into lim from public.app_config where key = 'free_transaction_limit';
  if lim is null then lim := 40; end if;
  select count(*) into cnt from public.transactions t
    where t.family_id = new.family_id
      and t.bill_id is null
      and t.trip_id is null
      and date_trunc('month', t.date::date) = date_trunc('month', now());
  if cnt >= lim then
    raise exception 'free_tier_limit: הגעתם למכסת הרשומות החודשית בתוכנית החינמית' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

select (select count(*) from public.trips) as trips, (select count(*) from public.trip_expenses) as trip_expenses;
