-- Homey — סידור הכלכלה בלי מחיקה (finance-tidy). להריץ פעם אחת ב-SQL Editor. Idempotent: אפשר להריץ שוב בלי נזק.
-- לפי הדוח "סידור הכלכלה Homey": סדר בנתונים עם דגלים ולא במחיקה. שום שורה קיימת לא משתנה בהרצה הזו.
--
-- 1. transactions: עמודות חדשות
--    created_by    מי הזין (מזהה פרופיל, לא auth.uid, כי באותו טלפון אפשר לבחור את הפרופיל של בן/בת הזוג)
--    source        מאיפה הגיעה: manual / sms / ocr / bill / trip / assistant
--    review_status reviewed / to_review (תיבת "לבדיקה": רק מה שנראה בעייתי)
--    hidden        מוסתרת במקום מחוקה; לא נספרת בשום סכום, ואפשר לשחזר
--    kind          regular / transfer (חיוב כרטיס אשראי, הפקדה לחיסכון: לא נספר כהוצאה) / adjustment (התאמת יתרה)
--    duplicate_of  כפילות שמוזגה: מצביעה על השורה שנשארה, ומוסתרת
--    loan_id       תשלום הלוואה שהוקלד ידנית, כדי שלא ייספר פעמיים
--    for_profile   של מי ההוצאה: ריק = משותף, אחרת מזהה הפרופיל
--    raw_text      הטקסט המקורי של ה-SMS / הקבלה (לכללים "תמיד לסווג X כ-Y")
-- 2. טבלאות חדשות: היסטוריית שינויים, כללי סיווג, "התעלם" בבדיקות הנתונים, "לא חויב החודש" בהוראות קבע
-- 3. profile_prefs: ברירת מחדל אישית ל"של מי ההוצאה" (בלי ערך התחלתי: כל הורה נשאל פעם אחת), וחיסכון חודשי לכל הורה
-- 4. מכסת התוכנית החינמית לא סופרת שורות מוסתרות וכפילויות; יתרת העו"ש לא מושפעת משורה מוסתרת או כפילות

-- ===== 1. transactions =====
alter table public.transactions add column if not exists created_by uuid;
alter table public.transactions add column if not exists source text;
alter table public.transactions add column if not exists review_status text not null default 'reviewed';
alter table public.transactions add column if not exists hidden boolean not null default false;
alter table public.transactions add column if not exists hidden_at timestamptz;
alter table public.transactions add column if not exists kind text not null default 'regular';
alter table public.transactions add column if not exists duplicate_of uuid references public.transactions(id) on delete set null;
alter table public.transactions add column if not exists loan_id uuid references public.loans(id) on delete set null;
alter table public.transactions add column if not exists for_profile uuid;
alter table public.transactions add column if not exists raw_text text;
alter table public.transactions add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_review_status_chk') then
    alter table public.transactions add constraint transactions_review_status_chk check (review_status in ('reviewed', 'to_review'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_kind_chk') then
    alter table public.transactions add constraint transactions_kind_chk check (kind in ('regular', 'transfer', 'adjustment'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_source_chk') then
    alter table public.transactions add constraint transactions_source_chk check (source is null or source in ('manual', 'sms', 'ocr', 'bill', 'trip', 'assistant'));
  end if;
end $$;

create index if not exists transactions_review on public.transactions (family_id, review_status) where review_status = 'to_review';
create index if not exists transactions_hidden on public.transactions (family_id) where hidden;

-- updated_at מתעדכן בכל שינוי
create or replace function public.touch_transaction_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_touch_transaction_updated_at on public.transactions;
create trigger trg_touch_transaction_updated_at before update on public.transactions
  for each row execute function public.touch_transaction_updated_at();

-- ===== 2. טבלאות חדשות =====
-- היסטוריית שינויים: נכתבת רק בטריגר (security definer); ההורים במשפחה יכולים לקרוא
create table if not exists public.transaction_history (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  transaction_id uuid not null,
  op text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);
create index if not exists transaction_history_tx on public.transaction_history (transaction_id, changed_at desc);
alter table public.transaction_history enable row level security;
drop policy if exists "transaction_history_read" on public.transaction_history;
create policy "transaction_history_read" on public.transaction_history
  for select to authenticated using (family_id = public.get_my_family_id());

create or replace function public.log_transaction_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and to_jsonb(OLD) - 'updated_at' = to_jsonb(NEW) - 'updated_at' then
    return null;
  end if;
  insert into public.transaction_history (family_id, transaction_id, op, changed_by, old_row, new_row)
  values (OLD.family_id, OLD.id, TG_OP, auth.uid(), to_jsonb(OLD), case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end);
  return null;
end;
$$;
drop trigger if exists trg_log_transaction_change on public.transactions;
create trigger trg_log_transaction_change after update or delete on public.transactions
  for each row execute function public.log_transaction_change();

-- כללי סיווג: "תמיד לסווג 'פז יקום' כ'תחבורה · דלק'"
create table if not exists public.finance_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null default public.get_my_family_id() references public.families(id) on delete cascade,
  match_text text not null,
  category text,
  sub text,
  kind text check (kind is null or kind in ('regular', 'transfer')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists finance_rules_unique on public.finance_rules (family_id, lower(match_text));
alter table public.finance_rules enable row level security;
drop policy if exists "finance_rules_family" on public.finance_rules;
create policy "finance_rules_family" on public.finance_rules
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- "התעלם" בכרטיס בריאות הנתונים, משותף לשני ההורים
create table if not exists public.data_check_dismissals (
  family_id uuid not null default public.get_my_family_id() references public.families(id) on delete cascade,
  check_key text not null,
  created_at timestamptz not null default now(),
  primary key (family_id, check_key)
);
alter table public.data_check_dismissals enable row level security;
drop policy if exists "data_check_dismissals_family" on public.data_check_dismissals;
create policy "data_check_dismissals_family" on public.data_check_dismissals
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- הוראת קבע שלא חויבה בחודש מסוים: יוצאת מהקבועים של אותו חודש
create table if not exists public.bill_skips (
  family_id uuid not null default public.get_my_family_id() references public.families(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  created_at timestamptz not null default now(),
  primary key (bill_id, month)
);
alter table public.bill_skips enable row level security;
drop policy if exists "bill_skips_family" on public.bill_skips;
create policy "bill_skips_family" on public.bill_skips
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- ===== 3. profile_prefs: העדפות אישיות לכל הורה =====
-- tx_owner_default: הוצאה חדשה נרשמת כ"משותף" / "שלי" / "לשאול כל פעם". ריק = עוד לא נבחר, והאפליקציה שואלת פעם אחת
-- savings_monthly: כמה ההורה מפריש לחיסכון כל חודש; הסכום של שני ההורים יורד מ"נשאר להוציא"
alter table public.profile_prefs add column if not exists tx_owner_default text;
alter table public.profile_prefs add column if not exists savings_monthly numeric;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profile_prefs_tx_owner_chk') then
    alter table public.profile_prefs add constraint profile_prefs_tx_owner_chk check (tx_owner_default is null or tx_owner_default in ('shared', 'mine', 'ask'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profile_prefs_savings_chk') then
    alter table public.profile_prefs add constraint profile_prefs_savings_chk check (savings_monthly is null or savings_monthly >= 0);
  end if;
end $$;

-- ===== 4. מכסה חינמית ויתרת עו"ש =====
-- מכסת הרשומות החודשית בתוכנית החינמית: שורות מוסתרות וכפילויות לא "גוזלות" מקום
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
      and not coalesce(t.hidden, false)
      and t.duplicate_of is null
      and date_trunc('month', t.date::date) = date_trunc('month', now());
  if cnt >= lim then
    raise exception 'free_tier_limit: הגעתם למכסת הרשומות החודשית בתוכנית החינמית' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- יתרת עו"ש: שורה מוסתרת או כפילות לא משפיעה על היתרה; הסתרה מחזירה את הסכום, שחזור מוריד שוב.
-- (העברה, למשל חיוב כרטיס אשראי, כן מורידה מהעו"ש: הכסף באמת יצא, רק שהוא לא "הוצאה")
create or replace function public.apply_transaction_to_account() returns trigger
language plpgsql security definer as $$
declare
  old_effect numeric := 0;
  new_effect numeric := 0;
begin
  if TG_OP in ('UPDATE', 'DELETE') and OLD.account_id is not null and not coalesce(OLD.hidden, false) and OLD.duplicate_of is null then
    old_effect := case when OLD.type = 'income' then OLD.amount else -OLD.amount end;
    update public.bank_accounts set balance = balance - old_effect, updated_at = now() where id = OLD.account_id;
  end if;
  if TG_OP in ('UPDATE', 'INSERT') and NEW.account_id is not null and not coalesce(NEW.hidden, false) and NEW.duplicate_of is null then
    new_effect := case when NEW.type = 'income' then NEW.amount else -NEW.amount end;
    update public.bank_accounts set balance = balance + new_effect, updated_at = now() where id = NEW.account_id;
  end if;
  return null;
end;
$$;

-- ===== בדיקה: צריך לחזור 11 / 4 / 2 =====
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'transactions'
     and column_name in ('created_by', 'source', 'review_status', 'hidden', 'hidden_at', 'kind', 'duplicate_of', 'loan_id', 'for_profile', 'raw_text', 'updated_at')) as transaction_columns,
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('transaction_history', 'finance_rules', 'data_check_dismissals', 'bill_skips')) as new_tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profile_prefs'
     and column_name in ('tx_owner_default', 'savings_monthly')) as pref_columns;
