-- Homey — חופשות וטיולים כאפליקציה: רשימת ציוד, תוכנית יומית ומסמכי נסיעה. להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- trip_packing: פריט ציוד בטיול. person_id ריק = ציוד משותף; אחרת של בן משפחה (הורה או ילד). category = "לפני היציאה" לפעולות
-- trip_plan:    שורה בתוכנית היומית: יום, שעה (טקסט חופשי, למשל "09:30" או "בוקר"), מה, הערה
-- travel_docs:  תוקף מסמכים לכל בן משפחה (דרכון, ויזה, ביטוח, רישיון בינלאומי). בכוונה בלי מספרי מסמכים: רק סוג ותאריך תוקף
-- family_id בטבלאות הטיול נלקח תמיד מהטיול עצמו (טריגר), כך שאי אפשר לכתוב לטיול של משפחה אחרת.

create table if not exists public.trip_packing (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  person_id uuid,
  text text not null check (length(text) between 1 and 120),
  category text,
  checked boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists trip_packing_trip on public.trip_packing (trip_id, sort);

create table if not exists public.trip_plan (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  day date not null,
  time_text text check (time_text is null or length(time_text) <= 20),
  title text not null check (length(title) between 1 and 140),
  note text check (note is null or length(note) <= 400),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists trip_plan_trip on public.trip_plan (trip_id, day, sort);

-- family_id מהטיול
create or replace function public.trip_child_set_family() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select family_id into new.family_id from public.trips where id = new.trip_id;
  if new.family_id is null then
    raise exception 'trip_not_found';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_trip_packing_family on public.trip_packing;
create trigger trg_trip_packing_family before insert or update of trip_id on public.trip_packing
  for each row execute function public.trip_child_set_family();
drop trigger if exists trg_trip_plan_family on public.trip_plan;
create trigger trg_trip_plan_family before insert or update of trip_id on public.trip_plan
  for each row execute function public.trip_child_set_family();

alter table public.trip_packing enable row level security;
drop policy if exists "trip_packing_family" on public.trip_packing;
create policy "trip_packing_family" on public.trip_packing
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

alter table public.trip_plan enable row level security;
drop policy if exists "trip_plan_family" on public.trip_plan;
create policy "trip_plan_family" on public.trip_plan
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

create table if not exists public.travel_docs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null default public.get_my_family_id() references public.families(id) on delete cascade,
  person_id uuid,
  person_name text not null check (length(person_name) between 1 and 60),
  doc_type text not null default 'passport' check (doc_type in ('passport', 'visa', 'insurance', 'license', 'other')),
  expires_on date not null,
  note text check (note is null or length(note) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists travel_docs_family on public.travel_docs (family_id, expires_on);
alter table public.travel_docs enable row level security;
drop policy if exists "travel_docs_family" on public.travel_docs;
create policy "travel_docs_family" on public.travel_docs
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- בדיקה: צריך לחזור 3
select count(*) as trip_app_tables from information_schema.tables
where table_schema = 'public' and table_name in ('trip_packing', 'trip_plan', 'travel_docs');
