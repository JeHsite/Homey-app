-- Homey — "קניות ומטבח": בנק מתכונים, תפריט שבועי, והיסטוריית קניות ל"נגמר לכם?". להריץ פעם אחת ב-SQL Editor,
-- אחרי shopping.sql. Idempotent.
--
-- recipes: מתכון של המשפחה. ingredients = [{name, qty, category}] (category = מחלקה בסופר, כמו ברשימת הקניות).
-- meal_plan: מה אוכלים ביום מסוים בארוחה מסוימת (slot = lunch/dinner). recipe_id או סתם טקסט חופשי (title).
-- shopping_purchases: כל פריט שנקנה ב"סיום קנייה". ממנו לומדים כל כמה זמן קונים כל דבר, ומציעים "נגמר לכם?".

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  icon text not null default '🍽️',
  ingredients jsonb not null default '[]'::jsonb,
  prep_minutes smallint,
  notes text,
  favorite boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists recipes_family on public.recipes (family_id);

create table if not exists public.meal_plan (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('lunch', 'dinner')),
  recipe_id uuid references public.recipes(id) on delete set null,
  title text not null check (char_length(title) between 1 and 80),
  unique (family_id, date, slot)
);
create index if not exists meal_plan_family_date on public.meal_plan (family_id, date);

create table if not exists public.shopping_purchases (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  category text,
  bought_at timestamptz not null default now()
);
create index if not exists shopping_purchases_family on public.shopping_purchases (family_id, bought_at desc);

do $$
declare t text;
begin
  foreach t in array array['recipes', 'meal_plan', 'shopping_purchases'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_family" on public.%I', t, t);
    execute format('create policy "%s_family" on public.%I for all to authenticated using (family_id = public.get_my_family_id()) with check (family_id = public.get_my_family_id())', t, t);
  end loop;
end $$;

drop trigger if exists trg_require_premium_recipes on public.recipes;
create trigger trg_require_premium_recipes before insert on public.recipes
  for each row execute function public.require_premium_for_insert();

select (select count(*) from public.recipes) as recipes, (select count(*) from public.meal_plan) as meals, (select count(*) from public.shopping_purchases) as purchases;
