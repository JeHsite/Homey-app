-- Homey — ימי הולדת של בני המשפחה (הורים וילדים). להריץ פעם אחת ב-SQL Editor. Idempotent.
-- התאריך נערך בפרופיל ("עריכת פרופיל" במסך מי משתמש), ומוצג כל שנה בלוח החודשי ובמסך "היום".
-- ההרשאות לא משתנות: אותן policies של profiles/children שכבר מגינות על סטטוס ותמונה.
alter table public.profiles add column if not exists birth_date date;
alter table public.children add column if not exists birth_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_birth_date_range') then
    alter table public.profiles add constraint profiles_birth_date_range check (birth_date is null or birth_date between '1900-01-01' and '2100-01-01') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'children_birth_date_range') then
    alter table public.children add constraint children_birth_date_range check (birth_date is null or birth_date between '1900-01-01' and '2100-01-01') not valid;
  end if;
end $$;

-- בדיקה: צריך לחזור 2
select count(*) as birthday_columns from information_schema.columns
where table_schema = 'public' and column_name = 'birth_date' and table_name in ('profiles', 'children');
