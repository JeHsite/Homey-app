-- Homey — מערך "משימות ולו"ז" כאפליקציה מלאה: שגרות לילדים, ישיבת שבוע זוגית והסעות לחוגים.
-- להריץ פעם אחת ב-SQL Editor, אחרי tasks-schedule.sql, events.sql ו-chores.sql. Idempotent.
--
-- routines: שגרת בוקר/ערב של ילד: רשימת פריטים (items = [{id, text, icon}]) ונקודות על השלמת השגרה כולה.
-- routine_checks: מה סומן ביום מסוים. awarded = הנקודות כבר ניתנו (כדי לא לתת פעמיים).
-- couple_syncs: ישיבת השבוע של ההורים, אחת לשבוע (week_start = יום ראשון של השבוע שמתכננים).
-- family_events.drive_to / drive_from: מי מההורים מסיע לחוג ומי מחזיר.

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  kind text not null check (kind in ('morning', 'evening')),
  items jsonb not null default '[]'::jsonb,
  points int not null default 0 check (points between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (child_id, kind)
);

create table if not exists public.routine_checks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  date date not null,
  done_items text[] not null default '{}',
  completed_at timestamptz,
  awarded boolean not null default false,
  unique (routine_id, date)
);
create index if not exists routine_checks_family_date on public.routine_checks (family_id, date);

create table if not exists public.couple_syncs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  week_start date not null,
  notes text,
  mood smallint check (mood between 1 and 5),
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  unique (family_id, week_start)
);

alter table public.family_events add column if not exists drive_to uuid;
alter table public.family_events add column if not exists drive_from uuid;

do $$
declare t text;
begin
  foreach t in array array['routines', 'routine_checks', 'couple_syncs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_family" on public.%I', t, t);
    execute format('create policy "%s_family" on public.%I for all to authenticated using (family_id = public.get_my_family_id()) with check (family_id = public.get_my_family_id())', t, t);
  end loop;
end $$;

select (select count(*) from public.routines) as routines, (select count(*) from public.couple_syncs) as couple_syncs,
       (select count(*) from information_schema.columns where table_name = 'family_events' and column_name in ('drive_to', 'drive_from')) as drive_columns;
