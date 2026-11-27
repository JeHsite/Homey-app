-- Homey — ימים קבועים של המשפחה המורחבת (ימי הולדת, ימי נישואין, אזכרות). להריץ פעם אחת ב-SQL Editor. Idempotent.
-- hebrew=true: חוזר כל שנה לפי התאריך העברי (heb_month בשם האנגלי של Intl, למשל 'Kislev', 'Adar II'; heb_day 1-30),
-- שמחושב בדפדפן בשמירה. אחרת חוזר לפי היום והחודש הלועזיים של date.
create table if not exists public.family_dates (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null default public.get_my_family_id() references public.families(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  kind text not null default 'birthday' check (kind in ('birthday', 'anniversary', 'memorial', 'other')),
  date date not null check (date between '1900-01-01' and '2100-01-01'),
  hebrew boolean not null default false,
  heb_month text check (heb_month is null or length(heb_month) <= 12),
  heb_day smallint check (heb_day is null or heb_day between 1 and 30),
  note text check (note is null or length(note) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists family_dates_family on public.family_dates (family_id);

alter table public.family_dates enable row level security;
drop policy if exists "family_dates_family" on public.family_dates;
create policy "family_dates_family" on public.family_dates
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- בדיקה: צריך לחזור 1
select count(*) as family_dates_table from information_schema.tables where table_schema = 'public' and table_name = 'family_dates';
