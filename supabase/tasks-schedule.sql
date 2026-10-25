-- Homey — מערך "משימות ולו"ז": משימות שבועיות ולו"ז אישי, זוגי ומשפחתי. להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- scope:
--   personal = של אדם אחד (person_kind/person_id). אישי של הורה גלוי רק לו (נאכף כאן ב-RLS).
--              אישי של ילד גלוי להורים (לילדים אין התחברות משלהם, הם משתמשים בפרופיל על המכשיר של ההורה).
--   couple   = של שני ההורים. ילדים לא רואים (מוסתר במסך, כי הילד משתמש בסשן של הורה).
--   family   = של כל המשפחה. person_kind/person_id = מי אחראי (לא חובה).
-- family_events משמשת גם את מערך "פגישות, דייטים וחוגים" שייבנה אחר כך (kind = meeting/date/class).

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  scope text not null default 'family' check (scope in ('personal', 'couple', 'family')),
  person_kind text check (person_kind in ('parent', 'child')),
  person_id uuid,
  due_date date,
  due_time time,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekly')),
  status text not null default 'todo' check (status in ('todo', 'done')),
  done_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists tasks_family_due on public.tasks (family_id, due_date);

create table if not exists public.family_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null default 'general' check (kind in ('general', 'meeting', 'date', 'class')),
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  location text,
  scope text not null default 'family' check (scope in ('personal', 'couple', 'family')),
  person_kind text check (person_kind in ('parent', 'child')),
  person_id uuid,
  start_date date not null,
  start_time time,
  end_time time,
  repeat text not null default 'none' check (repeat in ('none', 'weekly')),
  repeat_until date,
  cost numeric(12,2),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists family_events_family_date on public.family_events (family_id, start_date);

alter table public.tasks enable row level security;
alter table public.family_events enable row level security;

-- נראה למשפחה, חוץ מפריט אישי של הורה אחר
drop policy if exists "tasks_visible" on public.tasks;
create policy "tasks_visible" on public.tasks
  for all to authenticated
  using (family_id = public.get_my_family_id()
         and (scope <> 'personal' or person_kind = 'child' or person_id = auth.uid()))
  with check (family_id = public.get_my_family_id()
         and (scope <> 'personal' or person_kind = 'child' or person_id = auth.uid()));

drop policy if exists "family_events_visible" on public.family_events;
create policy "family_events_visible" on public.family_events
  for all to authenticated
  using (family_id = public.get_my_family_id()
         and (scope <> 'personal' or person_kind = 'child' or person_id = auth.uid()))
  with check (family_id = public.get_my_family_id()
         and (scope <> 'personal' or person_kind = 'child' or person_id = auth.uid()));

-- תכונת פרימיום: חוסם יצירה למשפחה חינמית (אותה פונקציה כמו קופות חיסכון ונכסים, fail-open)
drop trigger if exists trg_require_premium_tasks on public.tasks;
create trigger trg_require_premium_tasks before insert on public.tasks
  for each row execute function public.require_premium_for_insert();
drop trigger if exists trg_require_premium_family_events on public.family_events;
create trigger trg_require_premium_family_events before insert on public.family_events
  for each row execute function public.require_premium_for_insert();

select (select count(*) from public.tasks) as tasks, (select count(*) from public.family_events) as family_events;
