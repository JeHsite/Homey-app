-- Homey — מערך "קניות": רשימות קניות משותפות (מתעדכנות בזמן אמת בכל המכשירים), קניות לבית ובזבוזים.
-- להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- shopping_lists: רשימה (kind='grocery' לסופר ולשוטף, kind='home' לקניות לבית: מוצרים גדולים עם מחיר משוער ועדיפות).
-- shopping_items: פריט ברשימה. staple = פריט קבוע (חלב, לחם...) שאפשר להחזיר לרשימה בלחיצה אחרי כל קנייה.
-- transactions.tag: 'impulse' = בזבוז (קנייה לא מתוכננת). נרשם כהוצאה רגילה בכלכלה, עם תג שמאפשר לסכם אותו.
-- families.splurge_limit: תקרת בזבוזים חודשית שהמשפחה קבעה (לא חובה).

create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'grocery' check (kind in ('grocery', 'home')),
  created_at timestamptz not null default now()
);
create index if not exists shopping_lists_family on public.shopping_lists (family_id);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  qty text,
  category text not null default 'אחר',
  note text,
  est_price numeric(12,2),
  priority smallint not null default 2 check (priority between 1 and 3),
  staple boolean not null default false,
  status text not null default 'open' check (status in ('open', 'bought')),
  added_by text,
  bought_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shopping_items_list on public.shopping_items (list_id, status);
create index if not exists shopping_items_family on public.shopping_items (family_id);

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
drop policy if exists "shopping_lists_family" on public.shopping_lists;
create policy "shopping_lists_family" on public.shopping_lists
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());
drop policy if exists "shopping_items_family" on public.shopping_items;
create policy "shopping_items_family" on public.shopping_items
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- family_id של פריט נלקח תמיד מהרשימה שלו, כך שאי אפשר להוסיף פריט לרשימה של משפחה אחרת
create or replace function public.shopping_items_set_family() returns trigger
language plpgsql security definer as $$
begin
  select family_id into new.family_id from public.shopping_lists where id = new.list_id;
  return new;
end;
$$;
drop trigger if exists trg_shopping_items_set_family on public.shopping_items;
create trigger trg_shopping_items_set_family before insert or update on public.shopping_items
  for each row execute function public.shopping_items_set_family();

-- תכונת פרימיום: יצירת רשימות חסומה למשפחה חינמית (fail-open כמו בשאר)
drop trigger if exists trg_require_premium_shopping_lists on public.shopping_lists;
create trigger trg_require_premium_shopping_lists before insert on public.shopping_lists
  for each row execute function public.require_premium_for_insert();

alter table public.transactions add column if not exists tag text;
alter table public.families add column if not exists splurge_limit numeric(12,2);

-- עדכונים בזמן אמת: כשאחד מוסיף או מסמן פריט, זה מופיע מיד אצל השני (גם בסופר).
-- replica identity full: כדי שגם מחיקה תגיע עם family_id ותעבור את הסינון לפי משפחה
alter table public.shopping_items replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shopping_items') then
    execute 'alter publication supabase_realtime add table public.shopping_items';
  end if;
end $$;

select (select count(*) from public.shopping_lists) as lists, (select count(*) from public.shopping_items) as items;
