-- Homey — הסרת בן משפחה ע"י הורה. להריץ פעם אחת ב-SQL Editor. Idempotent.
--
-- ילד: הפרופיל נמחק יחד עם הארנק, היעדים והשאלון שלו (kid_entries/kid_goals נמחקים ב-cascade).
-- הורה אחר: מאבד גישה למשפחה. החשבון שלו (אימייל וסיסמה) נשאר, וגם ההוצאות שרשם נשארות במשפחה.
--   נמחקים רק הדברים האישיים שלו: הפרופיל, יעדים אישיים, שאלון, PIN ומכשירי התראות.
--   הוא נרשם ב-family_removed_members, וטריגר חוסם אותו מלהצטרף שוב לאותה משפחה עם קוד הקבוצה.
-- כללים (נאכפים כאן בשרת, לא רק במסך): רק משתמש מחובר שהוא חבר במשפחה, רק בתוך המשפחה שלו,
-- ואי אפשר להסיר את עצמך (לזה יש "מחיקת חשבון"). כך תמיד נשאר לפחות הורה אחד.

create table if not exists public.family_removed_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null,
  removed_by uuid,
  removed_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
alter table public.family_removed_members enable row level security;
drop policy if exists "family_removed_members_read" on public.family_removed_members;
create policy "family_removed_members_read" on public.family_removed_members
  for select to authenticated
  using (family_id = public.get_my_family_id());

create or replace function public.remove_family_member(p_kind text, p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fam uuid;
  v_target_fam uuid;
begin
  if v_uid is null then
    return 'forbidden';
  end if;
  select family_id into v_fam from public.profiles where id = v_uid;
  if v_fam is null then
    return 'forbidden';
  end if;

  if p_kind = 'child' then
    select family_id into v_target_fam from public.children where id = p_id;
    if v_target_fam is null or v_target_fam <> v_fam then
      return 'not_found';
    end if;
    delete from public.personal_goals where owner_kind = 'child' and owner_id = p_id;
    delete from public.profile_setup where owner_kind = 'child' and owner_id = p_id;
    delete from public.children where id = p_id;
    return 'ok';
  elsif p_kind = 'parent' then
    if p_id = v_uid then
      return 'self';
    end if;
    select family_id into v_target_fam from public.profiles where id = p_id;
    if v_target_fam is null or v_target_fam <> v_fam then
      return 'not_found';
    end if;
    insert into public.family_removed_members (family_id, user_id, removed_by)
      values (v_fam, p_id, v_uid)
      on conflict (family_id, user_id) do update set removed_by = excluded.removed_by, removed_at = now();
    delete from public.personal_goals where owner_kind = 'parent' and owner_id = p_id;
    delete from public.profile_setup where owner_kind = 'parent' and owner_id = p_id;
    delete from public.push_subscriptions where user_id = p_id;
    delete from public.profile_pins where profile_id = p_id;
    delete from public.profiles where id = p_id;
    return 'ok';
  end if;
  return 'bad_kind';
end $$;

revoke all on function public.remove_family_member(text, uuid) from public, anon;
grant execute on function public.remove_family_member(text, uuid) to authenticated;

-- הורה שהוסר לא יכול להצטרף שוב לאותה משפחה (גם אם יש לו את קוד הקבוצה)
create or replace function public.block_removed_member_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.family_removed_members where family_id = new.family_id and user_id = new.id) then
    raise exception 'removed_from_family: החשבון הזה הוסר מהמשפחה' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_removed_member_join on public.profiles;
create trigger trg_block_removed_member_join before insert or update of family_id on public.profiles
  for each row execute function public.block_removed_member_join();

select proname from pg_proc where proname in ('remove_family_member', 'block_removed_member_join');
