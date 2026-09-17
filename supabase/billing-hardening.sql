-- Homey — חיזוקי אבטחה + הגבלות נוספות לתוכנית החינמית.
-- להריץ פעם אחת ב-SQL Editor, אחרי billing.sql. Idempotent (בטוח להריץ שוב).
--
-- דחוף: הסעיף הראשון (הגירת משפחות קיימות) חייב לרוץ! בלי זה, כל המשפחות
-- הקיימות (כולל שלך) מסומנות כרגע plan='free' (ברירת המחדל מ-billing.sql),
-- וההגבלות למטה יתחילו לחסום גם אתכם.

-- ============ 1) הגירת משפחות קיימות ל-premium/legacy (Phase 9, דחוף) ============
-- כל משפחה שעדיין לא סומנה ע"י תשלום/מתנת אדמין -> פרימיום קבוע בחינם (ותיקה)
update public.family_plan
set plan = 'premium', premium_source = 'legacy', updated_at = now()
where premium_source is null;

-- ============ 2) הגבלות נוספות בתשלום חינם (בערכי app_config, ניתן לעריכה ממסך הניהול) ============
insert into public.app_config (key, value) values
  ('free_transaction_limit', '40')
on conflict (key) do nothing;

-- ============ 3) חסימת יצירת קופת חיסכון/נכס חדשים למשפחה חינמית ============
-- fail-open בכוונה: אם אין שורת family_plan (לא אמור לקרות אחרי billing.sql) —
-- לא חוסמים. עדיף לאפשר בטעות מאשר לשבור גישה למשתמש אמיתי.
create or replace function public.require_premium_for_insert() returns trigger
language plpgsql security definer as $$
declare
  is_free boolean;
begin
  select (plan = 'free') into is_free from public.family_plan where family_id = new.family_id;
  if coalesce(is_free, false) then
    raise exception 'premium_required: שדרוג לפרימיום נדרש כדי להוסיף עוד' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_require_premium_savings on public.savings_pots;
create trigger trg_require_premium_savings before insert on public.savings_pots
  for each row execute function public.require_premium_for_insert();

drop trigger if exists trg_require_premium_assets on public.assets;
create trigger trg_require_premium_assets before insert on public.assets
  for each row execute function public.require_premium_for_insert();

-- ============ 4) הגבלת כמות רשומות (הוצאות/הכנסות) בחודש למשפחה חינמית ============
create or replace function public.check_transaction_limit() returns trigger
language plpgsql security definer as $$
declare
  is_free boolean;
  cnt int;
  lim int;
begin
  select (plan = 'free') into is_free from public.family_plan where family_id = new.family_id;
  if not coalesce(is_free, false) then
    return new; -- פרימיום, או אין נתון (fail-open) -> לא חוסמים
  end if;

  select coalesce(value::int, 40) into lim from public.app_config where key = 'free_transaction_limit';
  if lim is null then lim := 40; end if;

  select count(*) into cnt from public.transactions t
    where t.family_id = new.family_id
      and date_trunc('month', t.date::date) = date_trunc('month', now());

  if cnt >= lim then
    raise exception 'free_tier_limit: הגעתם למכסת הרשומות החודשית בתוכנית החינמית' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_transaction_limit on public.transactions;
create trigger trg_check_transaction_limit before insert on public.transactions
  for each row execute function public.check_transaction_limit();

-- ============ בדיקה ============
select plan, premium_source, count(*) from public.family_plan group by plan, premium_source;
