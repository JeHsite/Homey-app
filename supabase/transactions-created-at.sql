-- Homey — זמן הזנה לכל רשומה, כדי שברשימת ההוצאות מה שהוזן אחרון יופיע ראשון.
-- להריץ פעם אחת ב-SQL Editor. Idempotent: אם העמודה כבר קיימת, לא קורה כלום.
-- רשומות קיימות מקבלות את זמן ההרצה (אין דרך לדעת מתי הוזנו), ולכן ביניהן הסדר נשאר לפי תאריך ההוצאה.

alter table public.transactions add column if not exists created_at timestamptz not null default now();
create index if not exists transactions_family_created on public.transactions (family_id, created_at desc);

select count(*) as transactions, max(created_at) as latest_entry from public.transactions;
