-- Homey — מונה סריקות קבלה (לכל משפחה, לחודש), כדי להגביל את עלות ה-AI. להריץ פעם אחת ב-SQL Editor. Idempotent.
-- רק הפונקציה scan-receipt כותבת ומונה, דרך service_role — לכן RLS דלוק בלי policies.

create table if not exists public.receipt_scans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists receipt_scans_family_month on public.receipt_scans (family_id, created_at);

alter table public.receipt_scans enable row level security;

select count(*) as receipt_scans_rows from public.receipt_scans;
