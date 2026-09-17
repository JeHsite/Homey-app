-- Homey — תשתית תשלום: חינם/פרימיום, מנוי דרך Cardcom, אדמין להענקת פרימיום בחינם.
-- להריץ פעם אחת ב-SQL Editor. Idempotent (בטוח להריץ שוב).
-- ראו PLAN_billing.md לתוכנית המלאה.

-- ============ family_plan ============
-- לא עמודות על families הקיימת (בכוונה) — טבלה נפרדת נעולה כדי שאף authenticated
-- user לא יוכל "לתת לעצמו" פרימיום, אותו עיקרון כמו profile_pins.
create table if not exists public.family_plan (
  family_id uuid primary key references public.families(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','premium')),
  premium_source text check (premium_source in ('paid','legacy','admin_grant') or premium_source is null),
  premium_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.family_plan enable row level security;
drop policy if exists "family_plan_read_own" on public.family_plan;
create policy "family_plan_read_own" on public.family_plan
  for select to authenticated using (family_id = public.get_my_family_id());
-- בכוונה אין policy ל-insert/update/delete — רק service_role (Edge Functions) כותב.

-- מילוי לכל משפחה קיימת (free כברירת מחדל; מיגרציית הגירה נפרדת תעביר ל-premium/legacy)
insert into public.family_plan (family_id)
select id from public.families
on conflict (family_id) do nothing;

-- שורה אוטומטית לכל משפחה חדשה מעכשיו
create or replace function public.create_family_plan_row() returns trigger
language plpgsql security definer as $$
begin
  insert into public.family_plan (family_id) values (new.id)
  on conflict (family_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_create_family_plan on public.families;
create trigger trg_create_family_plan after insert on public.families
  for each row execute function public.create_family_plan_row();

-- ============ family_subscriptions ============
create table if not exists public.family_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  processor text not null default 'cardcom',
  processor_token text,
  token_card_month smallint,
  token_card_year smallint,
  low_profile_id text,
  interval text not null check (interval in ('monthly','annual')),
  status text not null default 'active' check (status in ('active','canceled','past_due','trialing')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists family_subscriptions_family_uq on public.family_subscriptions(family_id);
alter table public.family_subscriptions enable row level security;
drop policy if exists "family_subscriptions_read_own" on public.family_subscriptions;
create policy "family_subscriptions_read_own" on public.family_subscriptions
  for select to authenticated using (family_id = public.get_my_family_id());
-- אין policy לכתיבה מהלקוח — רק service_role.

-- ============ app_admins ============
-- נעולה לגמרי מלקוחות. שורה ראשונה נזרעת ידנית (למטה) — פעולת ה-SQL היחידה
-- שהמשתמש חייב לבצע בכל תהליך התשלום (בעיית ביצה-ותרנגולת: אין דרך לתת
-- הרשאת אדמין ראשונה מתוך האפליקציה עצמה).
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_admins enable row level security;
-- בכוונה בלי שום policy — לא ניתן לגעת מהלקוח בכלל.

-- ============ app_config ============
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
-- בלי policy — נקרא רק דרך Edge Functions.

insert into public.app_config (key, value) values
  ('price_monthly_ils', '19.90'),
  ('price_annual_ils', '199')
on conflict (key) do nothing;

-- ============ בדיקה ============
select
  (select count(*) from public.family_plan) as family_plan_rows,
  (select count(*) from public.families) as families_rows,
  (select count(*) from public.app_admins) as admins_count,
  (select count(*) from public.app_config) as config_rows;

-- ============ שלב הבא (חובה!) ============
-- כדי שיהיה לך אדמין ראשון (למסך הניהול), הרץ שורה זו עם ה-user_id שלך
-- (מוצא ב-Authentication -> Users בדשבורד של Supabase, או:
--  select id, email from auth.users where email = 'האימייל שלך';)
--
-- insert into public.app_admins (user_id) values ('<ה-UUID שלך כאן>');

-- ============ cron יומי לחיוב מנויים (רק אחרי שפורסת billing-cron ויש לך CRON_SECRET) ============
-- select cron.schedule(
--   'homey-daily-billing',
--   '0 4 * * *',
--   $$ select net.http_post(
--        url := 'https://fhmcalbsqgdghvbqucwd.supabase.co/functions/v1/billing-cron',
--        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--        body := '{}'::jsonb
--      ) $$
-- );
