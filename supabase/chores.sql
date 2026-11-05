-- Homey — תורנויות ונקודות לילדים. להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- chores: מטלת בית קבועה (לסדר חדר, לפנות כלים). assign_mode='rotate' = סבב בין הילדים שב-assignees,
--   לפי היום (מטלה יומית) או השבוע (מטלה שבועית), כך שכל מכשיר מחשב אותו ילד בלי לשמור "תור" בשרת.
-- chore_runs: המופע של מטלה ביום מסוים לילד מסוים. todo -> done (הילד סימן) -> approved (הורה אישר, הנקודות נכנסות)
--   או rejected. unique (chore_id, date, child_id) כדי ששני מכשירים לא ייצרו את אותו מופע פעמיים.
-- kid_points: יומן נקודות. חיובי = מטלה שאושרה. שלילי = פרס שמומש או המרה לדמי כיס. היתרה = הסכום.
-- chore_rewards: פרסים שאפשר לממש בנקודות (ערב סרט, שעת מסך...).
-- families.points_rate: כמה שקלים שווה נקודה בהמרה לדמי כיס (לא חובה).

create table if not exists public.chores (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  icon text not null default '⭐',
  points int not null default 5 check (points between 1 and 1000),
  assign_mode text not null default 'fixed' check (assign_mode in ('fixed', 'rotate')),
  assignees uuid[] not null default '{}',
  repeat text not null default 'daily' check (repeat in ('daily', 'weekly')),
  weekdays smallint[] not null default '{0,1,2,3,4,5,6}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists chores_family on public.chores (family_id);

create table if not exists public.chore_runs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  chore_id uuid not null references public.chores(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  date date not null,
  status text not null default 'todo' check (status in ('todo', 'done', 'approved', 'rejected')),
  points int not null,
  done_at timestamptz,
  approved_at timestamptz,
  unique (chore_id, date, child_id)
);
create index if not exists chore_runs_family_date on public.chore_runs (family_id, date);

create table if not exists public.kid_points (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  delta int not null,
  reason text,
  run_id uuid references public.chore_runs(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists kid_points_child on public.kid_points (child_id);
-- אישור אותה מטלה פעמיים לא יוסיף נקודות פעמיים
create unique index if not exists kid_points_one_per_run on public.kid_points (run_id) where run_id is not null;

create table if not exists public.chore_rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  icon text not null default '🎁',
  cost int not null check (cost between 1 and 100000),
  created_at timestamptz not null default now()
);

alter table public.families add column if not exists points_rate numeric(8,2);

do $$
declare t text;
begin
  foreach t in array array['chores', 'chore_runs', 'kid_points', 'chore_rewards'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_family" on public.%I', t, t);
    execute format('create policy "%s_family" on public.%I for all to authenticated using (family_id = public.get_my_family_id()) with check (family_id = public.get_my_family_id())', t, t);
  end loop;
end $$;

-- תכונת פרימיום (fail-open כמו בשאר)
drop trigger if exists trg_require_premium_chores on public.chores;
create trigger trg_require_premium_chores before insert on public.chores
  for each row execute function public.require_premium_for_insert();

select (select count(*) from public.chores) as chores, (select count(*) from public.chore_rewards) as rewards;
