-- Homey — קוד PIN מוצפן ונבדק בשרת. להריץ פעם אחת ב-SQL Editor.
-- לפני: הקודים נשמרו כטקסט גלוי ב-profiles.pin, נשלחו לכל מכשיר במשפחה ונבדקו בדפדפן.
-- אחרי: גיבוב bcrypt בטבלה שאי אפשר לקרוא ממנה, בדיקה בשרת, נעילה ל-5 דקות אחרי 5 ניסיונות שגויים.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profile_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz
);
-- בכוונה אין policies: אי אפשר לקרוא או לכתוב ישירות, רק דרך הפונקציות למטה
alter table public.profile_pins enable row level security;

alter table public.profiles add column if not exists has_pin boolean not null default false;

-- העברת הקודים הקיימים לגיבוב, ומחיקת הטקסט הגלוי
insert into public.profile_pins (profile_id, pin_hash)
  select id, extensions.crypt(pin::text, extensions.gen_salt('bf'))
  from public.profiles
  where coalesce(pin::text, '') <> ''
  on conflict (profile_id) do nothing;
update public.profiles
  set has_pin = (coalesce(pin::text, '') <> ''), pin = null
  where pin is not null;

-- מעכשיו: אי אפשר לשמור קוד גלוי ב-profiles, ו-has_pin משתנה רק דרך set_pin
create or replace function public.profiles_protect_pin() returns trigger
language plpgsql as $$
begin
  new.pin := null;
  if current_setting('homey.pin_ctx', true) is distinct from 'on' then
    new.has_pin := case when tg_op = 'INSERT' then false else old.has_pin end;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_pin on public.profiles;
create trigger profiles_protect_pin before insert or update on public.profiles
  for each row execute function public.profiles_protect_pin();

-- בדיקה פנימית עם מונה ניסיונות. מחזירה: ok | wrong | locked | none
create or replace function public._homey_check_pin(p_profile_id uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r public.profile_pins;
begin
  select * into r from public.profile_pins where profile_id = p_profile_id for update;
  if not found then return 'none'; end if;
  if r.locked_until is not null and r.locked_until > now() then return 'locked'; end if;
  if p_pin is not null and r.pin_hash = extensions.crypt(p_pin, r.pin_hash) then
    update public.profile_pins set failed_attempts = 0, locked_until = null where profile_id = p_profile_id;
    return 'ok';
  end if;
  update public.profile_pins set
    failed_attempts = case when r.failed_attempts + 1 >= 5 then 0 else r.failed_attempts + 1 end,
    locked_until    = case when r.failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
  where profile_id = p_profile_id;
  return 'wrong';
end $$;
revoke all on function public._homey_check_pin(uuid, text) from public, anon, authenticated;

-- כניסה לפרופיל. מחזירה: ok | wrong | locked | none | forbidden
create or replace function public.verify_pin(p_profile_id uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.profiles where id = p_profile_id and family_id = public.get_my_family_id()) then
    return 'forbidden';
  end if;
  return public._homey_check_pin(p_profile_id, p_pin);
end $$;
revoke all on function public.verify_pin(uuid, text) from public, anon;
grant execute on function public.verify_pin(uuid, text) to authenticated;

-- הגדרה / שינוי / הסרה (p_new_pin ריק = הסרה). מחזירה: ok | wrong_pin | locked | invalid_pin | forbidden
-- כשכבר יש קוד: צריך את הקוד הנוכחי, או שבעל הפרופיל התחבר עם סיסמה ב-10 הדקות האחרונות ("שכחתי קוד").
create or replace function public.set_pin(p_profile_id uuid, p_new_pin text, p_current_pin text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_check text;
  v_fresh_login boolean;
begin
  if not exists (select 1 from public.profiles where id = p_profile_id and family_id = public.get_my_family_id()) then
    return 'forbidden';
  end if;
  if coalesce(p_new_pin, '') <> '' and p_new_pin !~ '^[0-9]{4,6}$' then
    return 'invalid_pin';
  end if;
  if exists (select 1 from public.profile_pins where profile_id = p_profile_id) then
    v_fresh_login := auth.uid() = p_profile_id and exists (
      select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
      where a ->> 'method' = 'password'
        and (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 600);
    if not coalesce(v_fresh_login, false) then
      v_check := public._homey_check_pin(p_profile_id, p_current_pin);
      if v_check <> 'ok' then
        return case when v_check = 'locked' then 'locked' else 'wrong_pin' end;
      end if;
    end if;
  end if;

  perform set_config('homey.pin_ctx', 'on', true);
  if coalesce(p_new_pin, '') = '' then
    delete from public.profile_pins where profile_id = p_profile_id;
    update public.profiles set has_pin = false where id = p_profile_id;
  else
    insert into public.profile_pins (profile_id, pin_hash)
      values (p_profile_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf')))
      on conflict (profile_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
    update public.profiles set has_pin = true where id = p_profile_id;
  end if;
  perform set_config('homey.pin_ctx', 'off', true);
  return 'ok';
end $$;
revoke all on function public.set_pin(uuid, text, text) from public, anon;
grant execute on function public.set_pin(uuid, text, text) to authenticated;

-- בדיקה: כמה פרופילים מוגנים, ושלא נשאר אף קוד גלוי
select count(*) filter (where has_pin) as protected_profiles,
       count(*) filter (where pin is not null) as plaintext_left
from public.profiles;
