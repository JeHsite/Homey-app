-- Homey — ריבוי מטבעות ליעדי חיסכון והשקעות/נכסים. להריץ פעם אחת ב-SQL Editor.

-- טבלת שערי המרה: rate_to_ils = כמה שקלים שווה יחידה אחת של המטבע, ליום נתון.
-- נתון משותף לכל המשפחות (לא תלוי family_id) — נכתב רק ע"י ה-Edge Function exchange-rate (service role).
create table if not exists public.exchange_rates (
  date date not null,
  currency text not null,
  rate_to_ils numeric(14,6) not null,
  primary key (date, currency)
);
alter table public.exchange_rates enable row level security;
drop policy if exists "exchange_rates_read" on public.exchange_rates;
create policy "exchange_rates_read" on public.exchange_rates
  for select to authenticated using (true);

alter table public.families add column if not exists currency text not null default '₪';
alter table public.savings_pots add column if not exists currency text;
alter table public.assets add column if not exists currency text;
