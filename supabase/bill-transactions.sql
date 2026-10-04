-- Homey — הוראת קבע שמסומנת "שולם" יוצרת הוצאה אמיתית. להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- bill_id: קישור מהוצאה להוראת הקבע שיצרה אותה. כך:
--   * הדוח החודשי, הפילוח לפי קטגוריות והסקירה השבועית רואים את הוראות הקבע כהוצאה בחודש שבו ירדו.
--   * ביטול הסימון "שולם" מוחק את ההוצאה של אותו חודש בלבד.
--   * האיפוס החודשי (is_paid=false ב-1 לחודש) לא נוגע בהוצאות של החודש הקודם, אז ההיסטוריה נשמרת.
-- ON DELETE SET NULL: מחיקת הוראת קבע לא מוחקת את ההוצאות שכבר נרשמו ממנה.

alter table public.transactions add column if not exists bill_id uuid references public.bills(id) on delete set null;
create index if not exists transactions_bill on public.transactions (bill_id);

-- מכסת הרשומות בתוכנית החינמית לא סופרת הוצאות שנוצרו מהוראת קבע (המשתמש לא הקליד אותן),
-- ולא חוסמת אותן — אחרת סימון "שולם" היה נכשל למשפחה שהגיעה למכסה.
create or replace function public.check_transaction_limit() returns trigger
language plpgsql security definer as $$
declare
  is_free boolean;
  cnt int;
  lim int;
begin
  if new.bill_id is not null then
    return new;
  end if;

  select (plan = 'free') into is_free from public.family_plan where family_id = new.family_id;
  if not coalesce(is_free, false) then
    return new; -- פרימיום, או אין נתון (fail-open) -> לא חוסמים
  end if;

  select coalesce(value::int, 40) into lim from public.app_config where key = 'free_transaction_limit';
  if lim is null then lim := 40; end if;

  select count(*) into cnt from public.transactions t
    where t.family_id = new.family_id
      and t.bill_id is null
      and date_trunc('month', t.date::date) = date_trunc('month', now());

  if cnt >= lim then
    raise exception 'free_tier_limit: הגעתם למכסת הרשומות החודשית בתוכנית החינמית' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- בדיקה: העמודה קיימת
select count(*) filter (where bill_id is not null) as bill_transactions, count(*) as all_transactions
from public.transactions;
