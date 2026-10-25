-- Homey — היסטוריית שווי לנכסים והשקעות: כל עדכון שווי נשמר עם תאריך, בשביל הגרף.
-- להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- assets.value נשאר "השווי האחרון" (לפי התאריך המאוחר ביותר), כך שכל החישובים הקיימים
-- (שווי נקי, יעדים, התפלגות) ממשיכים לעבוד בלי שינוי. הטריגר למטה שומר על זה מסונכרן.

create table if not exists public.asset_values (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  value numeric(14,2) not null check (value >= 0),
  valued_at date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists asset_values_asset_date on public.asset_values (asset_id, valued_at);
create index if not exists asset_values_family on public.asset_values (family_id);

alter table public.asset_values enable row level security;
drop policy if exists "asset_values_family" on public.asset_values;
create policy "asset_values_family" on public.asset_values
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- family_id נלקח תמיד מהנכס עצמו (לא סומכים על מה שהלקוח שלח), ואז ה-RLS בודק שזו המשפחה שלי.
-- כך אי אפשר לרשום שווי לנכס של משפחה אחרת.
create or replace function public.asset_values_set_family() returns trigger
language plpgsql security definer as $$
begin
  select family_id into new.family_id from public.assets where id = new.asset_id;
  return new;
end;
$$;
drop trigger if exists trg_asset_values_set_family on public.asset_values;
create trigger trg_asset_values_set_family before insert or update on public.asset_values
  for each row execute function public.asset_values_set_family();

-- אחרי כל שינוי בהיסטוריה: assets.value = השווי בתאריך המאוחר ביותר
create or replace function public.asset_values_sync_latest() returns trigger
language plpgsql security definer as $$
declare
  aid uuid := coalesce(new.asset_id, old.asset_id);
  latest numeric;
begin
  select value into latest from public.asset_values
    where asset_id = aid order by valued_at desc, created_at desc limit 1;
  if latest is not null then
    update public.assets set value = latest where id = aid;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_asset_values_sync_latest on public.asset_values;
create trigger trg_asset_values_sync_latest after insert or update or delete on public.asset_values
  for each row execute function public.asset_values_sync_latest();

-- נקודה ראשונה לכל נכס קיים שעוד אין לו היסטוריה: השווי הנוכחי, בתאריך היצירה של הנכס אם יש עמודה כזו
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'assets' and column_name = 'created_at') then
    execute 'insert into public.asset_values (family_id, asset_id, value, valued_at)
             select a.family_id, a.id, a.value, coalesce(a.created_at::date, current_date) from public.assets a
             where not exists (select 1 from public.asset_values v where v.asset_id = a.id)';
  else
    insert into public.asset_values (family_id, asset_id, value, valued_at)
    select a.family_id, a.id, a.value, current_date from public.assets a
    where not exists (select 1 from public.asset_values v where v.asset_id = a.id);
  end if;
end $$;

-- בדיקה: כמה נכסים וכמה נקודות שווי
select (select count(*) from public.assets) as assets, (select count(*) from public.asset_values) as asset_values;
