-- Homey — חשבון ראשי + עדכון אוטומטי של יתרת עו"ש לפי הוצאות/הכנסות מקושרות.
-- להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- is_primary: חשבון אחד בלבד יכול להיות ראשי לכל משפחה (נאכף ב-unique index חלקי).
-- account_id: קישור אופציונלי מרשומת transactions לחשבון עו"ש שממנו ירד/אליו נוסף הכסף.
--   NULL = לא מקושר (למשל מזומן) — לא משפיע על שום חשבון. ON DELETE SET NULL כדי שמחיקת
--   חשבון לא תמחק את ההיסטוריה של ההוצאות עצמן.
-- הטריגר מעדכן את bank_accounts.balance אוטומטית בכל הוספה/עדכון/מחיקה של transactions עם
-- account_id, כדי שלא יצטרכו לעדכן ידנית את היתרה במסך "עובר ושב". חל רק מרגע ההרצה קדימה —
-- transactions ישנות לא מקושרות אוטומטית ולא משנות יתרה קיימת.

alter table public.bank_accounts add column if not exists is_primary boolean not null default false;
create unique index if not exists bank_accounts_one_primary on public.bank_accounts (family_id) where is_primary;

alter table public.transactions add column if not exists account_id uuid references public.bank_accounts(id) on delete set null;
create index if not exists transactions_account on public.transactions (account_id);

create or replace function public.apply_transaction_to_account() returns trigger
language plpgsql security definer as $$
declare
  old_effect numeric := 0;
  new_effect numeric := 0;
begin
  if TG_OP in ('UPDATE', 'DELETE') and OLD.account_id is not null then
    old_effect := case when OLD.type = 'income' then OLD.amount else -OLD.amount end;
    update public.bank_accounts set balance = balance - old_effect, updated_at = now() where id = OLD.account_id;
  end if;
  if TG_OP in ('UPDATE', 'INSERT') and NEW.account_id is not null then
    new_effect := case when NEW.type = 'income' then NEW.amount else -NEW.amount end;
    update public.bank_accounts set balance = balance + new_effect, updated_at = now() where id = NEW.account_id;
  end if;
  return null; -- AFTER trigger, הערך המוחזר לא נבדק
end;
$$;

drop trigger if exists trg_apply_transaction_to_account on public.transactions;
create trigger trg_apply_transaction_to_account
  after insert or update or delete on public.transactions
  for each row execute function public.apply_transaction_to_account();

select count(*) as bank_accounts_with_primary_col from public.bank_accounts;
