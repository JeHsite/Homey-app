-- Homey — מחיקת חשבון עצמאית. להריץ פעם אחת ב-SQL Editor.
-- מוחק את המשתמש המחובר בלבד. אם הוא האחרון במשפחה — מוחק גם את כל נתוני המשפחה.
-- הכל בטרנזקציה אחת: אם משהו נכשל באמצע — שום דבר לא נמחק.

create or replace function public.delete_my_account() returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_fam uuid;
  v_left int;
begin
  if v_uid is null then
    return 'forbidden';
  end if;

  select family_id into v_fam from public.profiles where id = v_uid;

  -- המידע האישי של המשתמש
  delete from public.personal_goals where owner_kind = 'parent' and owner_id = v_uid;
  delete from public.profile_setup where owner_kind = 'parent' and owner_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.profile_pins where profile_id = v_uid;
  delete from public.profiles where id = v_uid;

  -- אם לא נשאר אף הורה במשפחה — מוחקים את כל נתוני המשפחה
  if v_fam is not null then
    select count(*) into v_left from public.profiles where family_id = v_fam;
    if v_left = 0 then
      delete from public.kid_entries where family_id = v_fam;
      delete from public.kid_goals where family_id = v_fam;
      delete from public.personal_goals where family_id = v_fam;
      delete from public.profile_setup where family_id = v_fam;
      delete from public.family_goals where family_id = v_fam;
      delete from public.push_subscriptions where family_id = v_fam;
      delete from public.transactions where family_id = v_fam;
      delete from public.bills where family_id = v_fam;
      delete from public.notes where family_id = v_fam;
      delete from public.trips where family_id = v_fam;
      delete from public.gifts where family_id = v_fam;
      delete from public.savings_pots where family_id = v_fam;
      delete from public.assets where family_id = v_fam;
      delete from public.custom_categories where family_id = v_fam;
      delete from public.children where family_id = v_fam;
      delete from public.families where id = v_fam;
    end if;
  end if;

  -- ולבסוף החשבון עצמו (אימייל וסיסמה)
  delete from auth.users where id = v_uid;
  return 'ok';
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- בדיקה: הפונקציה קיימת
select proname from pg_proc where proname = 'delete_my_account';
