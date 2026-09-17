# Plan: מעבר Homey לתשלום — Cardcom, שתי רמות מנוי, נעילת Zoom

**עדכון 2026-09-18 (הרחבת ההגבלות)**: אחרי שהתוכנית הראשונית אושרה (Q6: "הצעה א — נעילת תכונות ספציפיות, לא הגבלת שימוש"), המשתמש ביקש בנפרד להוסיף גם הגבלת שימוש: מכסת רשומות הוצאות/הכנסות חודשית (ברירת מחדל 40, ניתנת לעריכה מהמסך ניהול), וחסימה מלאה של יצירת קופות חיסכון/נכסים חדשים לתוכנית החינמית (לא רק המרת מטבע כפי שתוכנן במקור). גם ערכות הנושא הוגבלו: 2 חינמיות (ent/light), 6 בפרימיום. זו הרחבה מפורשת של ההיקף המקורי, לא רק Feature ↔ Usage-cap שנבחר מראש. נוסף גם אכיפה אמיתית בצד שרת (טריגרים ב-`supabase/billing-hardening.sql`), לא רק UI — ראו שם. **דחוף**: אותו קובץ SQL כולל את הגירת Phase 9 (היה חסר עד עכשיו — כל המשפחות הקיימות היו בפועל plan='free' בפרודקשן מאז ה-push הראשון).

**עדכון סטטוס 2026-09-18**: כתוב ונדחף בקוד (עדיין לא נבדק חי מול Cardcom אמיתי — ממתין לפרטי גישה):
Phase 2 (`supabase/billing.sql`) ✅ כתוב, ממתין להרצה ע"י המשתמש · Phase 3 (4 Edge Functions: billing-checkout/billing-webhook/billing-cron/billing-cancel + admin-billing) ✅ כתובות, ממתינות לפריסה ע"י המשתמש אחרי שיהיו פרטי Cardcom · Phase 4 (הגבלת 5 התכונות) ✅ חי בקוד, נבדק בדפדפן · Phase 5 (מסך "מנוי" בהגדרות) ✅ חי בקוד · Phase 6 (מסך ניהול) ✅ כתוב, תלוי בזריעת `app_admins` + פריסת `admin-billing` · Phase 7 (נעילת zoom) ✅ חי בקוד, טרם אומת בפועל בטלפון · Phase 8 (מסמכים משפטיים) ✅ עודכנו (תנאים/פרטיות/נגישות). **עדיין לא בוצע**: Phase 0 (עוסק מורשה + חשבון Cardcom אמיתי), Phase 1 (שיחת בדיקה חיה מול Cardcom — התיעוד כבר נקרא ומתועד למטה), Phase 9 (הגירת משפחות קיימות ל-legacy), Phase 10 (מעבר לפרודקשן).

One-line goal: משפחות חדשות נרשמות ל-Homey בחינם עם סט תכונות בסיסי, יכולות לשדרג לפרימיום בתשלום חוזר דרך Cardcom; מר הורביץ יכול בעצמו, ממסך בתוך האפליקציה, לתת גישת פרימיום חינמית לכל משפחה שהוא בוחר; והאפליקציה לא מגיבה יותר למחוות pinch-zoom.

## Classification
Track: **Integration** (Cardcom הוא האלמנט המגדיר והמסוכן ביותר; רכיבי Feature/UI — הגבלת תכונות, מסך ניהול — נספחים לתוכו). Parked secondary asks: none — כל שלוש הבקשות (סליקה, נעילת zoom, מנגנון חינם לחברים) נכללות.

## Interview Ledger
1. תחום: PWA/אתר בלבד, לא חנויות אפליקציה בקרוב → **אתר/PWA בלבד** (משפיע ישירות: לא נדרש Apple/Google IAP).
2. מוכנות עסקית: עוסק מורשה/חשבון עסקי → **לא בטוח, ביקש הסבר** (ניתן הסבר בצ'אט; שלב 0 בתוכנית כולל אימות/הקמה).
3. חברת סליקה → **Cardcom**.
4. מודל תשלום → **מנוי חודשי מתחדש + אופציה שנתית**.
5. Checkpoint: נעילת pinch-zoom מתנגשת עם WCAG 1.4.4/1.4.10 ועם הצהרת הנגישות הקיימת → **מאושר, נעילה מלאה, עם עדכון ההצהרה**.
6. הבדל חינם/תשלום → **הצעה א: נעילת תכונות פרימיום ספציפיות** (לא הגבלת שימוש/היסטוריה).
7. משפחות קיימות בהשקה → **כולן עוברות לפרימיום בחינם לצמיתות (Legacy Free)**.
8. מנגנון חברים בחינם → **מסך ניהול בתוך האפליקציה, רק למר הורביץ**.

8/14 שאלות נוצלו.

## Goal & Success Criteria
- משפחה חדשה שנרשמת אחרי ההשקה מתחילה בתוכנית `free`, רואה 5 תכונות פרימיום נעולות עם כפתור שדרוג.
- לחיצה על "שדרג לפרימיום" פותחת עמוד תשלום מאובטח של Cardcom (לא בטופס שלנו), משלימה חיוב, והמשפחה הופכת ל-`premium` תוך דקה (לאחר אישור ה-webhook), עם חידוש חודשי/שנתי אוטומטי.
- ביטול מנוי מתוך ההגדרות עוצר חיובים עתידיים; הגישה לפרימיום נשארת עד סוף התקופה ששולמה, ואז חוזרת ל-`free` אוטומטית (cron יומי).
- מר הורביץ, ורק הוא, רואה טאב "ניהול" ובו רשימת משפחות עם כפתור שמעניק/מבטל פרימיום חינמי לכל משפחה שיבחר — בלי תשלום, בלי SQL.
- כל המשפחות שהיו רשומות לפני מועד ההשקה ממשיכות לקבל פרימיום מלא בחינם לצמיתות, ללא פעולה נדרשת מצידן.
- באפליקציה בנייד, מחוות צביטה (pinch) לא מגדילות/מקטינות עוד את הדף; הגדלת תוכן עדיין אפשרית רק דרך הגדרת "גודל גופן" הקיימת בהגדרות. הצהרת הנגישות מגלה את הפשרה הזו במפורש.
- כל תשלום מייצר קבלה/חשבונית חוקית (עוסק מורשה) ללקוח.

## Current State
- Homey הוא קובץ `index.html` יחיד, React ללא build step (verified: `index.html`), Supabase (`fhmcalbsqgdghvbqucwd`) עם RLS דרך `get_my_family_id()`.
- אין שום תשתית מנוי/תשלום/plan/premium קיימת (verified: `grep -i "plan|premium|subscription|is_paid|tier" index.html` — הפגיעות היחידה `is_paid` שייכת לסטטוס תשלום של חיוב בודד, לא קשורה למנוי).
- אין מושג "אדמין" ברמת האפליקציה (verified: `grep -i "super_admin|app_admin|is_admin"` — רק `service_role` בפונקציות שרת).
- `viewport` meta הוא סטנדרטי לגמרי, בלי הגבלת zoom (verified: `index.html:5`).
- 4 Edge Functions פרוסות כיום: `weekly-review`, `exchange-rate`, `send-reminders`, `market-news` — כולן נפרסות ידנית דרך Code tab בדשבורד Supabase (verified: `supabase/functions/`; אין CLI מחובר, לפי [[project_homey_app]]).
- pg_cron כבר בשימוש לשני jobs (איפוס חיובים חודשי, תזכורות שעתיות) — verified: memory + `reminder-slots.sql`.
- תכונות המועמדות לנעילת פרימיום (verified מ-[[project_homey_improvement_checklist]]): סקירת AI שבועית (#1, עולה כסף אמיתי ל-Anthropic per-family), ריבוי מטבעות (#7), ייצוא דוח חודשי (#9), יעדי חיסכון לילדים (חלק מ-KidMoney/goals.sql), תזכורות מרובות (#12ג).
- אתר כבר עבר עדכון נגישות משמעותי לפני כמה ימים (קונטרסט, focus trap, skip-link — #6 ב[[project_homey_improvement_checklist]]) — משמעותי כי נעילת zoom סותרת את זה חלקית (ראה Landmines).
- מר הורביץ (user): אין לו כרגע ודאות לגבי עוסק מורשה/חשבון עסקי; מתקשה עקבית בפעולות דשבורד (Supabase/Anthropic Console) וצריך הדרכה צעד-אחר-צעד או שהעבודה תתבצע ישירות עבורו.

## Scope (v1)
1. שתי רמות: `free` (הבסיס המלא של האפליקציה כמות שהיא היום, למשפחה שלמה, ללא הגבלת חברים/היסטוריה) ו-`premium` (5 התכונות שצוינו למעלה).
2. אינטגרציית Cardcom: checkout מאורח (hosted), חיוב חוזר חודשי/שנתי, webhook מאומת, ביטול עצמי.
3. מסך ניהול פנימי (רק למר הורביץ): הענקה/ביטול פרימיום חינמי למשפחה בודדת, עריכת מחיר.
4. נעילת pinch-zoom מלאה בנייד (viewport + CSS + JS fallback), עם עדכון הצהרת הנגישות.
5. עדכון מסמכי פרטיות/תנאי שימוש בהתאם.
6. הגירת כל המשפחות הקיימות ל-`premium` (מקור `legacy`) בזמן ההשקה.

## Out of Scope & Parked Items
- תמיכה ב-Apple IAP / Google Play Billing — לא רלוונזי כרגע, האפליקציה PWA בלבד (הוחלט ב-Q1).
- יותר מחברת סליקה אחת (Cardcom בלבד ב-v1) — אפשר להוסיף עוד בעתיד אם Cardcom לא יתאים.
- תוכנית "ביניים"/Tier שלישי — רק חינם/פרימיום.
- הנחות/קופונים למשתמשי קצה (רק מר הורביץ יכול להעניק חינם, אין מנגנון קוד-קופון עצמאי למשתמשים) — הוחלט ב-Q8.
- שינוי ל-χ-store readiness (סעיף 14 ברשימת הבקלוג) — לא חלק מהיקף זה.
- בדיקת קורא-מסך אמיתי (NVDA/VoiceOver) — כבר מתועד כפתוח ב[[project_homey_improvement_checklist]] #6, לא חלק מהתוכנית הזו.

## Approach
אינטגרציית תשלום קלאסית מבוססת-webhook: הלקוח לעולם לא נוגע בפרטי כרטיס (Cardcom LowProfile hosted page) — כך שטווח ה-PCI-DSS נשאר אצל Cardcom ולא אצלנו, עקבי עם הגישה הזהירה שכבר יושמה באתר (PIN בצד שרת, RLS על הכל). מקור האמת לסטטוס תשלום הוא תמיד ה-webhook מ-Cardcom (server-to-server), לא מה שהלקוח "חושב" שקרה אחרי חזרה מהתשלום — כדי למנוע מצב שבו לקוח סוגר את הדפדפן/עורך תשובה מזויפת ומקבל פרימיום בלי לשלם. "אדמין" הוא concept חדש לגמרי באפליקציה: טבלת `app_admins` נעולה ב-RLS (רק service_role), נזרעת בפעם הראשונה עם שורה אחת שמר הורביץ מריץ ב-SQL Editor (אין דרך "בטוחה" לתת לעצמו הרשאת אדמין ראשונה מתוך האפליקציה עצמה — בעיית ביצה-ותרנגולת, ולכן זו פעולת ה-SQL היחידה שהוא חייב לבצע בכל התהליך). כל בדיקות ההרשאה (אדמין, בעלות על family_id) מתבצעות בצד שרת (Edge Function עם service role, קורא `auth.uid()` מה-JWT), לא רק ב-UI — כדי לא לחזור על הפער שנמצא ותוקן ב-[[SecurityCheckSites]] (סעיף 4/11 ברשימה של 20 הנקודות).

**executor's choice**: מיקום מדויק של טאב "ניהול" בניווט, עיצוב מסך הניהול, שמות עמודות פנימיים בטבלאות — כל עוד עקביים עם שאר האפליקציה (Tailwind precompiled — ראה [[project_homey_app]]).

## Requirements
- **R1**: WHEN משפחה חדשה נרשמת THE SYSTEM SHALL להגדיר לה `plan = 'free'` כברירת מחדל (שורת `family_plan` נוצרת אוטומטית, למשל דרך trigger `after insert on families`).
- **R2**: WHEN משפחה ב-`free` מנסה לגשת לאחת מ-5 התכונות הנעולות THE SYSTEM SHALL להציג מסך/כרטיס נעילה עם כפתור לשדרוג, ולא את התוכן עצמו.
- **R3**: WHEN משתמש (הורה בלבד, לא ילד) לוחץ "שדרג לפרימיום" THE SYSTEM SHALL לפתוח עמוד checkout מאורח של Cardcom עבור ה-`family_id` שלו בלבד (לא ניתן לספק family_id אחר מהלקוח — הפונקציה גוזרת אותו מה-JWT בצד שרת).
- **R4**: WHEN Cardcom שולח webhook על עסקה (עם `LowProfileId` בלבד, ללא שאר הפרטים) THE SYSTEM SHALL (א) **לא לסמוך על גוף ה-webhook עצמו** — לפנות מיד בעצמנו, שרת-לשרת, ל-`LowProfile/GetLpResult` של Cardcom (עם ה-`TerminalNumber`/`ApiName` השמורים אצלנו) ולקבל את הפרטים האמיתיים והמאומתים של העסקה; זהו מנגנון האימות הרשמי של Cardcom עצמה (verified: תיעוד "שלב 1+2" — "לא נשתמש במידע שמגיע ישירות מהדיווח... נשלח קריאה ל-GetLpResult לבדיקת תקינות הדיווח"), (ב) לוודא מתוך תשובת `GetLpResult` ש-`ResponseCode==0` וש-`TranzactionInfo.Amount`/`CoinId` תואמים למחיר התוכנית הרלוונטי (מ-`app_config`) — ורק אם שניהם עוברים, לעדכן `family_plan.plan = 'premium'` ו-`family_subscriptions`. תשובת GetLpResult עם סכום שגוי/לא-תואם נדחית ונרשמת ללוג שגיאה, לא מבוצעת.
- **R5**: WHEN אותו webhook מגיע פעמיים (retry — Cardcom עצמה מנסה עד 7 פעמים אם השרת שלנו לא מחזיר HTTP 200, verified: אותו תיעוד) THE SYSTEM SHALL לזהות זאת לפי `LowProfileId`/`TranzactionId` (מפתח ייחודי ב-`family_subscriptions`) ולא לעבד פעמיים. לחיובים חוזרים (חודשי/שנתי, ביוזמתנו ולא webhook) — Cardcom מספקת הגנה מובנית: שדה `ExternalUniqTranId` ב-`Do Transaction`, שאם נשלח פעם שנייה עם אותו ערך מחזיר קוד שגיאה 608 ולא מחייב שוב (verified: תיעוד "שלב 3 - Do Transaction" + מאמר "מניעת עסקאות כפולות בחיוב אסימונים") — המפתח שלנו: `family_id + תקופת חיוב (למשל 2026-11)`.
- **R6**: WHEN משתמש מבטל מנוי בהגדרות THE SYSTEM SHALL לקרוא ל-Cardcom לעצור חיוב חוזר, לסמן `status='canceled'`, ולהשאיר `plan='premium'` עד `current_period_end`.
- **R7**: WHEN cron יומי רץ THE SYSTEM SHALL להעביר ל-`plan='free'` כל משפחה עם `family_subscriptions.status IN ('canceled','past_due')` שעברה את `current_period_end`.
- **R8**: WHEN מר הורביץ (ורק הוא, מאומת ב-`app_admins` בצד שרת) פותח את מסך הניהול THE SYSTEM SHALL להציג רשימת כל המשפחות עם הסטטוס הנוכחי שלהן.
- **R9**: WHEN מר הורביץ לוחץ "תן פרימיום בחינם" על משפחה THE SYSTEM SHALL לסמן `plan='premium', premium_source='admin_grant'` בלי ליצור רשומת `family_subscriptions` (אין חיוב, אין תוקף אוטומטי שפג).
- **R10**: WHEN משתמש שאינו ברשימת `app_admins` מנסה לקרוא לפונקציית האדמין (ישירות, לא דרך ה-UI) THE SYSTEM SHALL להחזיר שגיאת הרשאה (401/403) ולא לבצע שינוי.
- **R11**: WHEN דף נטען בנייד THE SYSTEM SHALL למנוע pinch-zoom (מחוות שני אצבעות) ו-double-tap-zoom, מבלי לשבור גלילה רגילה או גרירה בתוך הדונאט/אזור הילדים.
- **R12**: WHEN משפחה קיימת לפני מועד ההשקה (מיגרציית שלב 9) THE SYSTEM SHALL כבר להיות מסומנת `family_plan.plan='premium', premium_source='legacy'` לפני שכל שאר הקוד עולה לפרודקשן.
- **R13**: WHEN לקוח (לא service_role) מנסה לכתוב ישירות ל-`family_plan` דרך ה-API הציבורי של Supabase (PostgREST) THE SYSTEM SHALL לחסום את זה לחלוטין — אין שום policy שמתירה INSERT/UPDATE/DELETE ללקוח על הטבלה הזו, רק SELECT על השורה של המשפחה שלו. כתיבה מתבצעת אך ורק מתוך Edge Functions עם ה-service role key.

## Key Decisions
- חברת סליקה: **Cardcom** (user).
- מודל: מנוי חוזר חודשי + שנתי מוזל (user).
- הבדל בין תוכניות: נעילת 5 תכונות ספציפיות, לא הגבלת שימוש/היסטוריה (user).
- משפחות קיימות: כולן פרימיום חינם לצמיתות (user).
- מנגנון חברים בחינם: מסך ניהול בתוך האפליקציה (user).
- נעילת zoom: מלאה, מאושרת למרות ניגוד ל-WCAG (user, לאחר checkpoint מפורש).
- Checkout: hosted/LowProfile (Cardcom) ולא הזנת כרטיס בטופס שלנו — [assumed: מקטין scope PCI-DSS דרסטית, תואם לגישת האבטחה הקיימת באתר — אם Cardcom לא תומך hosted checkout בפועל, זה יתגלה ויתוקן כבר בשלב 1 (קריאת התיעוד האמיתי)].
- מקור אמת לסטטוס תשלום: ה-webhook מ-Cardcom, לא תשובת ה-redirect בצד הלקוח — [assumed: best practice סטנדרטי לאינטגרציות סליקה, לא ספציפי ל-Cardcom].

## Data & State Changes
מיגרציה חדשה `supabase/billing.sql` (idempotent, בסגנון שאר הקבצים ב-`supabase/`):

**עיצוב מכוון**: `plan`/`premium_source`/`premium_until` **לא** נוספים כעמודות על `families` הקיימת — נמנעים בכוונה מלנגוע ב-RLS הקיימת של הטבלה הזו (שלא אומתה מחדש בשיחה הזו) ומהצורך להבטיח שאף authenticated user לא יכול לכתוב לעמודות האלה בעצמו (self-grant). במקום זה, טבלה נפרדת לגמרי, בלי שום policy כתיבה ללקוח כלל — אותו פאטרן בדיוק שכבר הוכיח את עצמו באתר הזה עבור `profile_pins` (PIN הועבר לטבלה נפרדת נעולה ב-2026-09-10, ראו [[project_homey_app]]):

```sql
create table if not exists public.family_plan (
  family_id uuid primary key references public.families(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','premium')),
  premium_source text check (premium_source in ('paid','legacy','admin_grant') or premium_source is null),
  premium_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.family_plan enable row level security;
create policy "family_plan_read_own" on public.family_plan
  for select to authenticated using (family_id = public.get_my_family_id());
-- בכוונה אין שום policy ל-insert/update/delete — לקוח לא יכול לגעת בטבלה הזו בשום צורה (R13).
-- מילוי לכל משפחה קיימת (ברירת מחדל free — Phase 9 ידרוס ל-premium/legacy אחרי שכל שאר השלבים בפרודקשן):
insert into public.family_plan (family_id)
select id from public.families
on conflict (family_id) do nothing;

-- שורה אוטומטית ל-plan='free' לכל משפחה חדשה מעכשיו:
create or replace function public.create_family_plan_row() returns trigger
language plpgsql security definer as $$
begin
  insert into public.family_plan (family_id) values (new.id)
  on conflict (family_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_create_family_plan on public.families;
create trigger trg_create_family_plan after insert on public.families
  for each row execute function public.create_family_plan_row();

create table if not exists public.family_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  processor text not null default 'cardcom',
  processor_token text,        -- Cardcom Token (מ-TokenInfo.Token)
  token_card_month smallint,   -- מ-TokenInfo.CardMonth, נחוץ ל-CardExpirationMMYY בחיוב חוזר
  token_card_year smallint,    -- מ-TokenInfo.CardYear
  low_profile_id text,         -- מהעסקה הראשונה, לדדופ (R5)
  interval text not null check (interval in ('monthly','annual')),
  status text not null default 'active' check (status in ('active','canceled','past_due','trialing')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists family_subscriptions_family_uq on public.family_subscriptions(family_id);
alter table public.family_subscriptions enable row level security;
create policy "family_subscriptions_read_own" on public.family_subscriptions
  for select to authenticated using (family_id = public.get_my_family_id());
-- אין policy לכתיבה מהלקוח בכלל — רק service_role (Edge Functions) כותב לטבלה הזו.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_admins enable row level security;
-- בכוונה בלי שום policy — נעול לגמרי מלקוחות, רק service_role יכול לקרוא/לכתוב.

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
-- בלי policy — נקרא רק דרך Edge Functions (checkout צריך את המחיר, אבל בצד שרת).
```

**Rollback**: כל השינויים הם טבלאות/trigger/function חדשים לגמרי — לא נוגעים בטבלת `families` הקיימת ולא בנתונים קיימים בה; rollback = `drop trigger`/`drop function`/`drop table` (אין קשר לוגי הפוך שידרוש שחזור נתונים, כי שום דבר לא נמחק במעבר).

## Interfaces, Integrations & Credentials
**Verified API Facts** (verified: תיעוד רשמי נקרא בפועל — `cardcomapi.zendesk.com`, מאמרי "שלב 1+2" ו"שלב 3 - Do Transaction", ב-2026-09-18):

- **יצירת checkout** — `POST https://secure.cardcom.solutions/api/v11/LowProfile/Create`. שדות מרכזיים: `TerminalNumber`, `ApiName`, `Operation` (`"ChargeAndCreateToken"` — חיוב ראשון + יצירת אסימון לחיובים עתידיים, זה מה שנשתמש בו), `Amount`, `ISOCoinId` (1=שקל), `ReturnValue` (עד 250 תווים, מוחזר אלינו כפי שהוא — נשים בו `family_id`+`interval` שלנו כי אנחנו יוצרים את הקריאה בעצמנו בצד שרת), `SuccessRedirectUrl`/`FailedRedirectUrl`, `WebHookUrl`, ואופציונלית `Document` (ראה חשבונית למטה). תשובה: `ResponseCode` (0=הצלחה), `LowProfileId` (מזהה עסקה ייחודי), `Url` (קישור לדף התשלום עצמו — זה מה שפותחים ללקוח).
- **אימות ה-webhook (מנגנון Cardcom הרשמי, לא חתימה/HMAC)**: ה-webhook עצמו שולח רק הודעה שמשהו קרה; **חובה** (זו ההנחיה הרשמית של Cardcom עצמה, לא שלנו) לפנות מיד לאחר מכן שרת-לשרת ל-`POST https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult` עם `TerminalNumber`/`ApiName`/`LowProfileId`, ולסמוך **רק** על מה שחוזר משם (`ResponseCode`, `TranzactionInfo.Amount`, `TokenInfo.Token`/`TokenExDate`/`CardYear`/`CardMonth`). זו בדיוק ההגנה מפני זיוף/replay שתוכננה במקור כ"אימות חתימה" — התבררה כפשוטה וחזקה יותר.
- **חיוב חוזר (חודשי/שנתי, ביוזמתנו)** — `POST https://secure.cardcom.solutions/api/v11/Transactions/Transaction` ("Do Transaction") עם `TerminalNumber`, `ApiName`, `Amount`, `Token` (מה-LowProfile הראשון), `CardExpirationMMYY` (מ-`TokenInfo.CardYear`/`CardMonth` שנשמרו), ו-**`ExternalUniqTranId`** — מזהה ייחודי שאנחנו קובעים (`family_id`+תקופת חיוב, למשל `"fam-<uuid>-2026-11"`); אם אותו מזהה יישלח שוב, Cardcom **עצמה** מחזירה קוד שגיאה 608 ולא מחייבת שוב — הגנת אידמפוטנטיות מובנית, לא צריך לבנות בעצמנו (verified: תיעוד "Do Transaction" + מאמר "מניעת עסקאות כפולות בחיוב אסימונים").
- **ביטול**: אין endpoint נפרד ל"ביטול מנוי" כי אין הוראת-קבע-בענן אצל Cardcom בארכיטקטורה הזו — **אנחנו** מריצים את החיוב החוזר (cron), אז "ביטול" הוא פשוט: להפסיק לקרוא ל-Do Transaction לאותה משפחה (`family_subscriptions.status='canceled'`), לא קריאת API נוספת ל-Cardcom.
- **חשבונית/קבלה — נפתר**: `Document` object (`DocumentTypeToCreate: "TaxInvoiceAndReceipt"`) קיים **באותה קריאה בדיוק** (גם ב-LowProfile/Create וגם ב-Do Transaction) ומפיק חשבונית מס+קבלה ישראלית חוקית אוטומטית — כולל שליחה במייל ללקוח. דורש הפעלת "מודל מסמכים" בחשבון Cardcom (שלב 0). **A4 מתעדכן**: זה פותר את דרישת החשבונית בלי אינטגרציה נפרדת ל-Green Invoice — Green Invoice נשאר רק כגיבוי אם "מודל מסמכים" לא ייתן מענה מספק.
- Auth & Secrets (סודות ב-Supabase secrets, לא בקוד): `CARDCOM_TERMINAL_NUMBER`, `CARDCOM_API_NAME`, `CARDCOM_API_PASSWORD` — לפרודקשן; לבדיקה: `TerminalNumber=1000` (טרמינל בדיקה ציבורי — verified) + `ApiName`/`ApiPassword` לבדיקה שיתקבלו מ-Cardcom (לפנות ל-dev@secure.cardcom.co.il או 03-9436100 שלוחה 2 אם לא מתגלה מיד ערך ציבורי עובד — זה עדיין הפריט הפתוח היחיד ב-Phase 1).
- Edge Functions חדשות (Deno, נפרסות ידנית דרך Code tab כמו כל הפונקציות הקיימות — verified: [[project_homey_app]]):
  - `billing-checkout` — מאומת (JWT רגיל), גוזר `family_id` מהטוקן, קורא ל-`LowProfile/Create` (`Operation=ChargeAndCreateToken`), מחזיר את ה-`Url` לניתוב.
  - `billing-webhook` — ציבורי (Cardcom קורא לזה עם `LowProfileId` בלבד), **מיד** קורא בעצמו ל-`LowProfile/GetLpResult` ולא סומך על גוף הבקשה הנכנסת (R4).
  - `billing-recur` (cron, לא HTTP ציבורי) — רץ יומי, בודק אילו `family_subscriptions` פעילות הגיעו ל-`current_period_end`, קורא ל-`Do Transaction` עם `Token`+`ExternalUniqTranId` ייחודי לתקופה.
  - `billing-cancel` — מאומת, גוזר `family_id` מהטוקן, מסמן `status='canceled'` (לא קורא ל-Cardcom כלל — ראה למעלה).
  - `admin-billing` — מאומת, בודק `app_admins` בצד שרת לפני כל פעולה; פעולות: `list` (כל המשפחות), `grant`/`revoke` (פרימיום חינמי), `get_config`/`set_config` (מחירים).
- Cron: `homey-daily-billing-recur` (החיוב החוזר עצמו, למעלה) + `homey-daily-plan-expiry` (אותו pattern כמו `homey-monthly-bill-reset`/`homey-hourly-reminders`) — מעביר ל-`free` משפחות שהחיוב שלהן נכשל/בוטל ועברו את `current_period_end`.
- הרחבה לתיעוד קיים: Privacy Policy מקבל סעיף על Cardcom כמעבד תשלומים (לא שומר/רואה מספרי כרטיס אצלנו — hosted checkout, האסימון עצמו מנוהל ב-Cardcom), Terms מקבל סעיף חיוב/ביטול/מדיניות זיכוי.

## Edge Cases & Failure Handling
- Cardcom למטה/איטי בזמן checkout → מציג הודעת שגיאה ברורה למשתמש, לא תולה, לא נותן פרימיום "על הדרך" (fail loudly, לא silent).
- webhook מגיע לפני שהלקוח חזר לאתר → זה בסדר, ה-webhook הוא מקור האמת ממילא; ה-UI פשוט יראה `premium` ברגע ה-refresh/polling הבא.
- webhook מגיע עם family_id/subscription שלא קיימים (עריכה/שיבוש) → נדחה בלוג שגיאה, לא נכשל בשקט.
- חיוב חוזר נכשל (`past_due`, כרטיס פג תוקף) → המשפחה נשארת `premium` עד `current_period_end` (חסד קצר), cron מוריד ל-`free` בזמן. **לא** נשלחת התראה יזומה ללקוח על כשל חיוב ב-v1 (out of scope — [assumed: Cardcom עצמו שולח מייל כשל חיוב, לא אומת בפועל; אם יתברר שלא בשלב 1, זו תוספת עתידית, לא חוסמת).
- מישהו מנסה להציף את `billing-checkout`/`billing-cancel` בבקשות חוזרות (בטעות או בזדון) → [assumed: הגבלת קצב בסיסית ברמת הפונקציה עצמה — cooldown של כמה שניות לכל `family_id`, לא רק הסתמכות על הגבלות הפלטפורמה של Supabase — בהתאם לעיקרון שכבר מתועד ב[[reference_securitychecksites_skill]] (סעיף 5, rate limiting על נתיבים שעולים כסף)].
- מנהל (מר הורביץ) נותן פרימיום חינם למשפחה שכבר משלמת בפועל → `admin_grant` לא דורס רשומת `family_subscriptions` פעילה; ה-UI במסך הניהול צריך להראות אם למשפחה יש כבר מנוי משולם לפני שנותנים "חינם" (מניעת בלבול, לא קריטי לוגית כי `plan='premium'` ממילא כבר true).
- ילד (פרופיל לא-הורה) מנסה לגשת לכפתור שדרוג/ביטול → לא אמור להיות נגיש בכלל ב-UI לילדים (התוכניות/הגדרות חשבון כבר מוגבלות להורים באפליקציה כיום).
- מישהו מנסה לקרוא ל-`admin-billing` בלי JWT של אדמין (curl ישיר) → 403, שום שינוי DB (R10).

## Risks, Landmines & Adaptations
- **API של Cardcom** — **עודכן 2026-09-18**: נקרא בפועל (תיעוד רשמי, `cardcomapi.zendesk.com`), כולל endpoints/שדות/מנגנון אימות מדויקים (ראו Interfaces). הפער שנותר קטן בהרבה מהמתוכנן במקור: רק לקבל `ApiName`/`ApiPassword` עובדים לטרמינל הבדיקה 1000 ולהריץ שיחה חיה אחת (Phase 1). העיקרון שהונח מראש (webhook לא אמין כשלעצמו, לוודא מול השרת עצמו, אידמפוטנטיות) התברר כתואם בדיוק להנחיה הרשמית של Cardcom.
- **נעילת pinch-zoom מתנגשת עם WCAG 1.4.4/1.4.10** ועם עבודת הנגישות שנעשתה השבוע → מר הורביץ אישר זאת במפורש אחרי checkpoint ייעודי; ההסתגלות: הצהרת הנגישות מתעדכנת לגלות את החריגה הזו במפורש ומפנה למנגנון החלופי (גודל גופן קיים בהגדרות). זה לא "מוסתר" — מתועד כהחלטה מודעת.
- **אימות הרשאת אדמין** — הפער הכי מסוכן מבחינת אבטחה בכל התוכנית הזו (הענקת גישה בחינם = ערך כספי אמיתי). הוסתגל ע"י: `app_admins` נעולה ב-RLS בלי שום policy ללקוח, כל בדיקת "האם אני אדמין" קורית בצד שרת (Edge Function עם service role), לא ב-UI בלבד — תואם ישירות את הפער מסוג SecurityCheckSites סעיף 4/11 שכבר תועד ותוקן פעם אחת באתר הזה (PIN) ולא צריך לחזור עליו.
- **חשבונית/מע"מ** — לא היה חלק מהבקשה המקורית של מר הורביץ, אבל זו דרישת חוק מחייבת ברגע שגובים כסף בישראל → נוסף כשלב 0 מפורש עם החלטה שצריך לקבל בפועל (לא הונח כאן), כדי שהתוכנית לא "תשכח" חובה חוקית.
- **residual risk**: מדיניות זיכוי/ביטול מדויקת (האם יש זיכוי חלקי על תקופה שכבר שולמה) לא הוגדרה על ידי המשתמש → הונחה ברירת מחדל שמרנית (אין זיכוי חלקי, רק עצירת חיובים עתידיים) ומסומנת ל-A5 בטבלת ההנחות; מומלץ לוודא מול רואה חשבון/עו"ד לפני השקה, בהתאם ל[[reference_israeli_site_launch_checklist]] הקיים של המשתמש.
- **residual risk**: לא ניתן לאמת מחוות מגע (pinch-zoom) בסביבת הבדיקה האוטומטית של Claude (Browser pane מדווח `visibilityState:"hidden"` וזה כלי עכבר/מקלדת, לא מגע אמיתי) — verified: [[feedback_remote_debugging_ceiling]]. Phase 7 יסומן כטעון בדיקה בפועל על טלפון של מר הורביץ, לא רק בסביבה האוטומטית.

## Assumptions Ledger
| ID | Assumption | Basis | Blast radius if wrong | Check |
|----|-----------|-------|----------------------|-------|
| A1 | Checkout דרך Cardcom LowProfile/hosted page (Iframe/Redirect), לא טופס כרטיס עצמאי | [assumed, אך מחוזק ע"י תיעוד ציבורי שנמצא: `LowProfile/Create`, תמיכה ב-Iframe/Redirect קיימת — verified: `secure.cardcom.solutions/Api/v11/Docs` + מרכז תמיכה למפתחים; הצורה המדויקת של הבקשה/תשובה עדיין לא נקראה שורה-שורה] | בינוני (ירד מגבוה) — כל Phase 3 יכתב מחדש אם הפרטים המדויקים שונים, אך העיקרון עצמו כבר מאומת חלקית | Phase 1 |
| A2 | מחיר התחלתי: ₪19.90/חודש, ₪199/שנה | [assumed: עוגן תמחור SaaS נפוץ, ניתן לעריכה ממסך הניהול] | נמוך — שדה עריכה, לא קוד קשיח | ניתן לשינוי מיידי במסך הניהול (R9 UI) |
| A3 | אין זיכוי חלקי על ביטול באמצע תקופה, רק עצירת חיוב עתידי | [assumed: מדיניות שמרנית נפוצה בעולם ה-SaaS] | בינוני — נושא צרכני/משפטי | לאמת מול עו"ד/רו"ח לפני השקה, לפי [[reference_israeli_site_launch_checklist]] |
| A4 | פתרון חשבונית: `Document` object המובנה ב-API של Cardcom (`DocumentTypeToCreate: "TaxInvoiceAndReceipt"`), לא Green Invoice | **verified**: תיעוד API רשמי — קיים באותה קריאה בדיוק (LowProfile/Create ו-Do Transaction), דורש הפעלת "מודל מסמכים" בחשבון (שלב 0) | נמוך — כבר אומת, Green Invoice נשאר רק גיבוי תיאורטי | Phase 0 (להפעיל את המודל בחשבון האמיתי) |
| A5 | Cardcom מציע סביבת sandbox/בדיקה לפני חיוב אמיתי | **verified**: מרכז התמיכה של Cardcom — טרמינל בדיקה ציבורי קבוע `TerminalNumber=1000`, `UserName=test9611`, ללא צורך בחשבון אמיתי; עסקאות מתחת ל-₪5,000 מדמות הצלחה, מעל זה מדמות כישלון | נמוך — כבר אומת, לא רק הונח | Phase 1 |
| A6 | 5 התכונות הנעולות: AI שבועי, ריבוי מטבעות, ייצוא דוח, יעדי חיסכון לילדים, תזכורות מרובות | (user, הצעה א שאושרה) | נמוך — קל להוסיף/להוריד תכונה מהרשימה אחר כך | Phase 4 |
| A7 | טאב "ניהול" מוצג רק כש-`family_id` שווה למשפחה של מר הורביץ (בדיקת UX בלבד; האכיפה האמיתית תמיד בצד שרת) | executor's choice | נמוך | Phase 6 |
| A8 | Cooldown בסיסי (כמה שניות לכל family_id) על billing-checkout/billing-cancel, לא הגבלת קצב מתקדמת | [assumed: מספיק ל-v1, בהתאם לרוח SecurityCheckSites סעיף 5] | נמוך — קל להחמיר בהמשך | Phase 3 |

## Open Items (none blocking)
- האם לשלוח מייל/פוש כשחיוב חוזר נכשל (`past_due`) — לא בהיקף v1, ברירת מחדל: מסתמכים על מייל שנשלח מ-Cardcom עצמו (אם קיים) ועל ה-cron שמוריד לפרימיום.
- האם להציג במסך הניהול היסטוריית "מי קיבל חינם ומתי" (audit log) — לא התבקש; ברירת מחדל: אין, אפשר להוסיף `granted_at`/`granted_by` לעמודות הקיימות בעתיד בלי מיגרציה כואבת.

## Verification
- Phase 1: `curl` נגד Cardcom sandbox מפיק תשובה תואמת לתיעוד שנקרא בפועל.
- Phase 2: `curl` אנונימי **וגם** `curl` עם JWT של משתמש מאומת רגיל נגד `family_plan`/`family_subscriptions`/`app_admins`/`app_config` — כולן חוסמות כתיבה (אותה שיטה אמפירית כמו ב-`security-review-homey-app-2026-09-15.md`, הפעם גם עם משתמש אמיתי ולא רק אנונימי, כדי לפסול במפורש self-grant).
- Phase 3: מחזור sandbox מלא — checkout → webhook מתקבל ומאומת (כולל בדיקת סכום/מטבע) → `family_plan.plan` הופך `premium` → ביטול → cron מדמה יום קדימה (או הרצה ידנית) → `plan` חוזר `free`.
- Phase 4: פרופיל דמו `free` רואה 5 מסכי נעילה; פרופיל דמו `premium` רואה הכל פתוח.
- Phase 6: קריאה ל-`admin-billing` עם JWT לא-אדמין מחזירה 403 בפועל (curl).
- Phase 7: **מר הורביץ בודק בעצמו בטלפון** (לא ניתן לאימות אוטומטי) שאין pinch-zoom, וגלילה/דונאט/גרירת ילדים עדיין עובדים.
- Phase 9: `select count(*) from family_plan where plan='premium' and premium_source='legacy'` תואם למספר המשפחות שהיו קיימות לפני ההשקה.
- Phase 10: עסקה אמיתית אחת (₪1, מוחזרת) בפרודקשן מצליחה מקצה-לקצה.

## Build Phases

**עדכון סדר (אחרי אימות שיש טרמינל בדיקה ציבורי של Cardcom — `TerminalNumber=1000`, `UserName=test9611` — verified: מרכז התמיכה של Cardcom): Phase 0 (עוסק מורשה + חשבון Cardcom אמיתי) לא חוסם יותר את Phase 1 ואילך. כל הבנייה הטכנית (Phases 1-9) רצה מול טרמינל הבדיקה הציבורי, בלי צורך בשום חשבון עסקי אמיתי. Phase 0 רץ במקביל (בזמן הפנוי של מר הורביץ) ורק צריך להיות גמור לפני Phase 10.**

- [ ] Phase 1: אימות API אמיתי של Cardcom (מול טרמינל הבדיקה הציבורי — לא חוסם, לא דורש חשבון) — **תיעוד כבר נקרא ומתועד בתוכנית (ראו Interfaces); נותר רק לבצע שיחה חיה אחת**
      Done when: שיחת בדיקה אחת מקצה-לקצה מול `TerminalNumber=1000` (LowProfile/Create → תשלום → webhook → GetLpResult → Do Transaction לחיוב חוזר עם ExternalUniqTranId) עברה בפועל, כולל וידוא שקוד 608 באמת חוזר על ExternalUniqTranId כפול.
      Steps: להשיג `ApiName`/`ApiPassword` לטרמינל הבדיקה (1000) — אם לא נמצא ערך ציבורי עובד, לפנות ל-dev@secure.cardcom.co.il / 03-9436100 שלוחה 2; לבצע `LowProfile/Create` בדיקה (סכום מתחת ל-₪5,000 = הצלחה מדומה); לוודא את מחזור ה-webhook→GetLpResult; לבצע `Do Transaction` על הטוקן שנוצר, פעמיים עם אותו `ExternalUniqTranId`, ולוודא קוד 608 בפעם השנייה.
      Covers: R3, R4, R5; checks: A1, A5

- [ ] Phase 0: מוכנות עסקית וחוקית (רץ במקביל ל-Phases 1-9, לא חוסם אותם; חייב להיגמר לפני Phase 10)
      Done when: יש בידי מר הורביץ (ב-`Downloads\homey-SECRETS-do-not-upload.txt`) פרטי חשבון Cardcom **אמיתי** (production, לא בדיקה), אישור שיש עוסק מורשה/פטור + חשבון בנק עסקי, והחלטה על פתרון חשבונית.
      Steps: להחליט עוסק פטור מול מורשה (מומלץ לוודא מול רו"ח — עוסק פטור פשוט יותר להתחלה, תקרת מחזור ₪122,833 ל-2026, לא מוציא חשבונית מס; עוסק מורשה נדרש אם צפוי לעבור את התקרה או שרוצים לגבות מע"מ); למלא טופס 821 (מע"מ) + 5329 (מס הכנסה) באתר רשות המסים; לפתוח/לייעד חשבון בנק עסקי; להגיש בקשה לחשבון Cardcom אמיתי (`cardcom.solutions`); לברר מול Cardcom האם יש תוסף חשבוניות מובנה, אחרת Green Invoice כגיבוי.
      Covers: הקדמה ל-Phase 10; checks: A4

- [ ] Phase 2: סכימת DB (billing.sql)
      Done when: `supabase/billing.sql` רץ ב-SQL Editor; curl אנונימי **וגם** curl עם JWT מאומת של משתמש רגיל (לא רק אנונימי) נגד `family_plan`/`family_subscriptions`/`app_admins`/`app_config` — כולם חסומים לכתיבה (רק קריאה עצמית מותרת ב-`family_plan`/`family_subscriptions`).
      Steps: לכתוב את המיגרציה (למעלה, כולל ה-trigger שיוצר שורת `family_plan` אוטומטית לכל משפחה חדשה, ומילוי שורת `free` לכל משפחה קיימת כבר עכשיו); להנחות את מר הורביץ להריץ אותה; לבדוק RLS אמפירית (curl אנונימי + curl עם JWT אמיתי שמנסה לכתוב).
      Covers: R1, R12, R13; checks: none (סכימה בסיסית, לא תלויה בהנחה)

- [ ] Phase 3: Edge Functions לסליקה (billing-checkout, billing-webhook, billing-recur cron, billing-cancel)
      Done when: מחזור sandbox מלא עובד קצה-לקצה (ראה Verification).
      Steps: לכתוב את 4 הפונקציות + 2 cron jobs חדשים (billing-recur לחיוב עצמו, plan-expiry לניקוי) — כולל וידוא סכום/מטבע דרך GetLpResult לפי R4, ו-ExternalUniqTranId ייחודי לתקופה בכל חיוב חוזר לפי R5, ו-cooldown בסיסי לכל family_id ב-checkout/cancel; לפרוס ידנית (Code tab, כמו הפונקציות הקיימות); לוודא "Verify JWT" מכובה נכון לכל פונקציה (checkout/cancel דורשים JWT רגיל של המשתמש; webhook ציבורי לגמרי כלפי Cardcom, אך לא סומך על גופו — ראה R4); לבדוק עם curl.
      Covers: R3, R4, R5, R6, R7; checks: A1

- [ ] Phase 4: הגבלת תכונות בצד לקוח (isPremium)
      Done when: משפחת דמו free/premium מציגות נכון 5 מסכי נעילה/פתיחה.
      Steps: להוסיף `isPremium(family)`; לעטוף כל אחת מ-5 הנקודות; לבנות כרטיס נעילה אחיד עם כפתור לשדרוג.
      Covers: R2; checks: A6

- [ ] Phase 5: מסך "מנוי" בהגדרות
      Done when: שדרוג+ביטול עובדים מקצה-לקצה מול sandbox מתוך ה-UI עצמו.
      Steps: סעיף חדש בהגדרות עם סטטוס נוכחי, כפתור שדרוג (קורא ל-billing-checkout, פותח redirect), כפתור ביטול (עם דיאלוג אישור) לפרימיום ששולם.
      Covers: R3, R6

- [ ] Phase 6: מסך ניהול (רק מר הורביץ)
      Done when: curl עם JWT לא-אדמין מקבל 403; מר הורביץ רואה ומפעיל את המסך בפועל.
      Steps: לזרוע ידנית שורה ראשונה ב-`app_admins` (השלב היחיד שדורש SQL Editor מהמשתמש בכל התהליך — בעיית ביצה-ותרנגולת); לכתוב `admin-billing` Edge Function (list/grant/revoke/config); טאב ניהול חדש בניווט + מסך רשימת משפחות עם כפתור הענקה/ביטול ועריכת מחיר.
      Covers: R8, R9, R10; checks: A2, A7

- [ ] Phase 7: נעילת pinch-zoom
      Done when: מאומת בפועל על טלפון (לא בסביבה האוטומטית) שאין pinch/double-tap zoom, וגלילה/דונאט/אזור ילדים עדיין תקינים.
      Steps: עדכון meta viewport; `touch-action` ב-CSS על html/body; JS fallback ל-gesturestart/gesturechange + מניעת double-tap; בדיקת regression ידנית לדונאט/TrendLines/גרירות באזור הילדים.
      Covers: R11; checks: none (בדיקה ישירה, לא תלויה בהנחה טכנית)

- [ ] Phase 8: עדכון מסמכים משפטיים
      Done when: 3 הטאבים ב-LegalDoc (פרטיות/תנאי שימוש/נגישות) מציגים טקסט מעודכן עם תאריך עדכון חדש.
      Steps: פרטיות — סעיף Cardcom כמעבד תשלום; תנאי שימוש — מחיר, חידוש אוטומטי, מדיניות ביטול/זיכוי (A3); נגישות — גילוי נעילת ה-zoom + הפניה לגודל גופן.
      Covers: — (דרישת ציות, לא R ממוספר); checks: A3

- [ ] Phase 9: הגירת משפחות קיימות
      Done when: כל המשפחות שהיו קיימות לפני מועד זה מסומנות `family_plan.plan='premium', premium_source='legacy'`.
      Steps: `update family_plan set plan='premium', premium_source='legacy' where family_id in (select id from families where created_at < <תאריך ההשקה>)` (מריץ מר הורביץ, אחרי כל שלב 0-8).
      Covers: R12

- [ ] Phase 10: חזרה כללית + מעבר לפרודקשן (דורש Phase 0 גמור)
      Done when: עסקה אמיתית אחת (₪1, מוחזרת) עוברת בפרודקשן מקצה-לקצה, עם חשבון Cardcom אמיתי וחשבונית/קבלה חוקית שהופקה בפועל.
      Steps: לוודא ש-Phase 0 גמור (עוסק + חשבון Cardcom אמיתי + פתרון חשבונית); להחליף סודות Cardcom מטרמינל הבדיקה (1000) לטרמינל האמיתי; לחזור על כל תרחיש הבדיקה (Verification) מול הסביבה האמיתית; עסקת ₪1 אמיתית; לוודא שהופקה חשבונית/קבלה; לבטל/להחזיר אותה.
      Covers: כל ה-R; checks: A1, A4
