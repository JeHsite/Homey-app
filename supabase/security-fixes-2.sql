-- Homey — תיקוני אבטחה שנשארו (2026-11-27). להריץ פעם אחת ב-SQL Editor. Idempotent: אפשר להריץ שוב בלי נזק.

-- 1. נקודה 20 בדוח: תמונת פרופיל עד 200,000 תווים (JPEG 256x256 בפועל הוא בערך 100-150KB). מדלג אם כבר קיים
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_photo_url_len') then
    alter table public.profiles add constraint profiles_photo_url_len check (photo_url is null or length(photo_url) < 200000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'children_photo_url_len') then
    alter table public.children add constraint children_photo_url_len check (photo_url is null or length(photo_url) < 200000) not valid;
  end if;
end $$;

-- 2. מונה סריקות קבלה: בלי הטבלה המכסה החודשית של scan-receipt לא נאכפת. רק הפונקציה כותבת (service role), לכן RLS בלי policies
create table if not exists public.receipt_scans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists receipt_scans_family_month on public.receipt_scans (family_id, created_at);
alter table public.receipt_scans enable row level security;

-- 3. בדיקה: כל טבלה ב-public, האם RLS דלוק וכמה policies יש לה.
-- צריך לחזור ריק. כל שורה שחוזרת היא טבלה בלי הגנה (rls_on = false). את התוצאה להעתיק לצ'אט
select c.relname as table_name, c.relrowsecurity as rls_on, count(p.policyname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relkind = 'r'
group by c.relname, c.relrowsecurity
having not c.relrowsecurity
order by c.relname;
