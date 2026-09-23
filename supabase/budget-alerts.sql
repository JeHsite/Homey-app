-- Homey — לוג התראות תקציב שנשלחו (מונע שליחה כפולה). להריץ פעם אחת ב-SQL Editor. Idempotent.
-- דורש שכבר הורץ category-budgets.sql. הפונקציה send-reminders (שרצה כל שעה) היא היחידה שכותבת לטבלה הזו,
-- דרך service_role — לכן RLS דלוק בלי policies (משתמשי האפליקציה לא ניגשים אליה).

create table if not exists public.category_budget_alerts (
  family_id uuid not null references public.families(id) on delete cascade,
  category text not null,
  month text not null,
  level smallint not null check (level in (80, 100)),
  created_at timestamptz not null default now(),
  primary key (family_id, category, month, level)
);

alter table public.category_budget_alerts enable row level security;

select count(*) as category_budget_alerts_rows from public.category_budget_alerts;
