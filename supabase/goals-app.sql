-- Homey — "יעדים אישיים" כאפליקציה מלאה: יעדים עם מדד התקדמות, הרגלים יומיים עם רצף, וצ'ק-אין שבועי.
-- להריץ פעם אחת ב-SQL Editor, אחרי goals.sql. Idempotent.
--
-- personal_goals (קיים) מקבל:
--   progress_kind: 'steps' = אבני דרך (steps, כמו עד היום) / 'number' = מספר מול יעד (למשל 12 ספרים, 10 ק"ג)
--                  / 'savings' = מקושר לקופת חיסכון (pot_id), וההתקדמות נלקחת ממנה
--   target, current, unit, pot_id, why (למה זה חשוב לי), done_at
-- habits: הרגל (לקרוא 20 דקות, אימון). per_week = כמה פעמים בשבוע זה נחשב הצלחה. goal_id = לאיזה יעד הוא שייך (לא חובה).
-- habit_logs: יום שבו ההרגל בוצע (שורה = בוצע).
-- goal_checkins: צ'ק-אין שבועי לכל יעד, ציון 1-5 והערה.
-- הרשאות כמו personal_goals: של הורה = רק החשבון שלו. של ילד = ההורים במשפחה.

alter table public.personal_goals add column if not exists progress_kind text not null default 'steps' check (progress_kind in ('steps', 'number', 'savings'));
alter table public.personal_goals add column if not exists target numeric(14,2);
alter table public.personal_goals add column if not exists current numeric(14,2) not null default 0;
alter table public.personal_goals add column if not exists unit text;
alter table public.personal_goals add column if not exists pot_id uuid references public.savings_pots(id) on delete set null;
alter table public.personal_goals add column if not exists why text;
alter table public.personal_goals add column if not exists done_at timestamptz;

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  owner_id uuid not null,
  owner_kind text not null check (owner_kind in ('parent', 'child')),
  goal_id uuid references public.personal_goals(id) on delete set null,
  title text not null check (char_length(title) between 1 and 80),
  icon text not null default '✨',
  per_week smallint not null default 7 check (per_week between 1 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists habits_owner on public.habits (owner_id);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  owner_id uuid not null,
  owner_kind text not null check (owner_kind in ('parent', 'child')),
  date date not null,
  unique (habit_id, date)
);
create index if not exists habit_logs_owner_date on public.habit_logs (owner_id, date);

create table if not exists public.goal_checkins (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  goal_id uuid not null references public.personal_goals(id) on delete cascade,
  owner_id uuid not null,
  owner_kind text not null check (owner_kind in ('parent', 'child')),
  week_start date not null,
  score smallint not null check (score between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  unique (goal_id, week_start)
);

do $$
declare t text;
declare cond text := 'family_id = public.get_my_family_id() and ((owner_kind = ''parent'' and owner_id = auth.uid()) or (owner_kind = ''child'' and exists (select 1 from public.children c where c.id = owner_id and c.family_id = public.get_my_family_id())))';
begin
  foreach t in array array['habits', 'habit_logs', 'goal_checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_owner" on public.%I', t, t);
    execute format('create policy "%s_owner" on public.%I for all to authenticated using (%s) with check (%s)', t, t, cond, cond);
  end loop;
end $$;

-- תכונת פרימיום להרגלים (היעדים עצמם נשארים כמו שהיו)
drop trigger if exists trg_require_premium_habits on public.habits;
create trigger trg_require_premium_habits before insert on public.habits
  for each row execute function public.require_premium_for_insert();

select (select count(*) from public.habits) as habits, (select count(*) from public.goal_checkins) as checkins,
       (select count(*) from information_schema.columns where table_name = 'personal_goals' and column_name in ('progress_kind', 'target', 'current', 'unit', 'pot_id', 'why', 'done_at')) as new_columns;
