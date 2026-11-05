-- Homey — עוזר AI משפחתי: מונה הודעות יומי לכל משפחה (תקרת עלות). להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- assistant_usage: כמה הודעות המשפחה שלחה לעוזר בכל יום (שעון ישראל). אין policy ללקוח, כך שאי אפשר לאפס אותו מהדפדפן;
-- הספירה עוברת רק דרך assistant_bump, שרצה עם הרשאות מוגבלות (security definer) ובודקת את המשפחה של המשתמש המחובר.
-- assistant_bump(p_limit): מוסיף 1 ומחזיר כמה נשאר היום, או -1 אם המשפחה כבר הגיעה לתקרה (ואז לא מוסיף).

create table if not exists public.assistant_usage (
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (family_id, day)
);
alter table public.assistant_usage enable row level security;

create or replace function public.assistant_bump(p_limit int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_fam uuid := public.get_my_family_id();
  v_day date := (now() at time zone 'Asia/Jerusalem')::date;
  v_count int;
begin
  if v_fam is null then
    return -1;
  end if;
  insert into public.assistant_usage (family_id, day, count) values (v_fam, v_day, 0)
    on conflict (family_id, day) do nothing;
  select count into v_count from public.assistant_usage where family_id = v_fam and day = v_day for update;
  if v_count >= p_limit then
    return -1;
  end if;
  update public.assistant_usage set count = count + 1 where family_id = v_fam and day = v_day;
  return p_limit - v_count - 1;
end $$;

revoke all on function public.assistant_bump(int) from public, anon;
grant execute on function public.assistant_bump(int) to authenticated;

select proname from pg_proc where proname = 'assistant_bump';
