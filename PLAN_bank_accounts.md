# תוכנית: חשבונות עו"ש + שווי נטו מדויק, שם משפחה בהרשמה, תיקון שדה תאריך

**סטטוס:** מאושר לביצוע (ראיון הושלם, 2 שאלות). לא בוצע עדיין.
**נועד ל:** מר הורביץ (Etamar Horvitz), Homey app — `C:\Users\micha\Projects\Homey-app`.

---

## 0. מה זה כולל, ומה לא

**בפנים (3 חלקים):**
1. **חשבונות עו"ש + שווי נטו מדויק** — הפיצ'ר המרכזי. תכונת פרימיום.
2. **שם משפחה/קבוצה נבחר בהרשמה** — מוצג במסך "מי משתמש עכשיו?".
3. **תיקון שגיאת עיצוב בשדה תאריך** — נראה ענק/לא מיושר במובייל (לפי צילום המסך).

**בחוץ (לא בסקופ, לפי בקשת המשתמש):** "פלטפורמה עסקית" — צוין כרצון עתידי, לא מתוכנן כאן בכלל.

---

## 1. Assumptions Ledger (כל מה שהוחלט בשבילך, עם תיוג)

| # | החלטה | תיוג |
|---|---|---|
| A1 | ניהול חשבונות עו"ש (הוספה/עריכה) = תכונת פרימיום בלבד, כמו חסכונות/נכסים. חינמי לא יכול להוסיף אף חשבון. | **(user)** — נבחר בראיון |
| A2 | כשאין אף חשבון עו"ש רשום למשפחה (כולל כל המשפחות ביום ההשקה, וכל משפחה חינמית לצמיתות), "יתרה חודשית נוכחית" נופלת חזרה לנוסחה הישנה: הכנסה מצטברת פחות הוצאה מצטברת (כמו היום). | **(user)** — נבחר בראיון |
| A3 | חשבון עו"ש = שדה תווית חופשי (טקסט, למשל "בנק לאומי — איתמר") + סכום + מטבע אופציונלי. אין רשימה סגורה של בנקים. | `[assumed: default — if wrong: קל להוסיף select בהמשך, שדה טקסט לא נעול]` — עקבי עם שדה "lender" בהלוואות שכבר קיים |
| A4 | "שווי נטו כולל" יתוקן לחסר גם יתרת הלוואות פתוחות (`loanState(l).balance` לכל הלוואה לא-גמורה). כרגע (`index.html:4970`) שווי נטו **לא** מחסיר הלוואות בכלל — זו טעות שקדמה לבקשה הזו (ההלוואות נוספו אחרי שהנוסחה נכתבה). | `[assumed: זה תיקון נכון פיננסית — if wrong: קל להחזיר]` — **דגל אדום שאני מעלה ביוזמתי, לא התבקש במפורש** |
| A5 | "יתרה חודשית נוכחית" (כשיש חשבונות) = סכום כל חשבונות העו"ש (מומר למטבע הראשי) **ועוד** תזרים החודש הקלנדרי הנוכחי (הכנסות פחות הוצאות מאז ה-1 לחודש, אותו scope כמו `forecast.spentSoFar`/`expectedIncome` הקיימים). המשתמש מעדכן ידנית את היתרה בחשבון כשהוא בודק את הבנק האמיתי שלו. | `[assumed: פירוש הביטוי "תוסיף חודשית" — if wrong: להחליף ל-lifetime flow]` |
| A6 | מיקום הכרטיס החדש בדשבורד: מייד אחרי הבאנר הרץ (NewsTicker) / באנר הנעילה של פרימיום, **לפני** רשת 4 האריחים הקיימת (יתרה נוכחית / חסכונות / נכסים / שווי נטו). רשת 4 האריחים **נשארת במקומה** — לא מוחלפת, רק אריח 1 משתנה שם+נוסחה. | `[assumed: פירוש "מתחת לבאנר הרץ... זה השינוי העיקרי" — if wrong: להזיז]` |
| A7 | הצגה למשפחה חינמית: הכרטיס מוצג (לא מוסתר), עם כפתור "הוסף חשבון" שמראה toast שדרוג + מנווט להגדרות — **בדיוק כמו** התנהגות חסכונות/נכסים היום, לא כמו הסתרה מלאה (WeeklyReviewBanner). | Executor's latitude — תואם את הדפוס הכי קרוב (חסכונות/נכסים, גם "פרימיום בלבד") |
| A8 | נתוני הדוגמה שנתת ("בנק לאומי - איתמר 10,000", "בנק מרכנתיל - נועה 2,000") ייכנסו רק כנתוני **דמו** (מסך "כניסת דמו מהירה"), באותו דפוס כמו הלוואת הדמו/חיובי הדמו הקיימים — לא נתונים אמיתיים במשפחה שלך. אם תרצה אותם גם אצלך באמת, תוסיף ידנית מהאפליקציה אחרי הפריסה. | `[assumed: "לדוגמה" = seed לדמו — if wrong: אכניס גם למשפחה האמיתית שלך ב-SQL]` |
| A9 | חשבון עו"ש לא מקושר לתנועה ספציפית (אין "שולם מחשבון X" בהוצאות/הכנסות/הוראות קבע). זה מחוץ לסקופ. | Non-goal, לא התבקש |
| A10 | שם המשפחה בהרשמה: שדה חדש בטופס ההרשמה (`signupType === 'create'`), עם ברירת מחדל מוצעת `משפחת ${name}` שאפשר לערוך, **במקום** היצירה האוטומטית הנוכחית `name + ' Family'` (מוזר, מערבב אנגלית). המשפחות הקיימות (כולל שלך) לא משתנות רטרואקטיבית — זה משפיע רק על הרשמות חדשות. | `[assumed: ברירת מחדל מוצעת ולא שדה חובה ריק — if wrong: להפוך לשדה חובה בלי הצעה]` |
| A11 | שם המשפחה לא ניתן לעריכה מאוחרת יותר מההגדרות בסבב הזה (v1). זו הרחבה עתידית קלה אם תרצה. | Non-goal ל-v1, מצוין כדי שלא תתפלא |
| A12 | תיקון שדה התאריך יהיה כלל-אפליקטיבי (CSS אחד לכל 4 המופעים של `type="date"` בקוד — טופס הוצאות, הלוואות, יעדים אישיים/משפחתיים), לא רק בטופס ההוצאות שבצילום המסך, כי כולם סובלים מאותה בעיית רינדור טבעי במובייל (iOS/Android). | `[assumed: תיקון גורף עדיף על תיקון נקודתי — if wrong: לצמצם לטופס הוצאות בלבד]` |
| A13 | `bank_accounts` מקבל עמודת `currency` אופציונלית (כמו `savings_pots`/`assets`), כדי שחשבון בדולרים למשל יומר נכון ל-`toPrimary`. | `[assumed: עקביות עם שאר טבלאות הכסף — if wrong: להסיר את השדה]` |
| A14 | אין הגבלת כמות חשבונות למשפחת פרימיום (כמו חסכונות/נכסים — בלי תקרה, רק חסימת insert לחינמי). | `[assumed: עקביות — if wrong: להוסיף תקרה]` |

---

## 2. נתונים — SQL חדש: `supabase/bank-accounts.sql`

```sql
-- Homey — חשבונות עו"ש (עובר ושב). להריץ פעם אחת ב-SQL Editor. Idempotent.
-- תכונת פרימיום בלבד — אותה חסימה כמו savings_pots/assets (require_premium_for_insert,
-- מוגדרת כבר ב-billing-hardening.sql).

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  label text not null,
  balance numeric(14,2) not null,
  currency text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists bank_accounts_family on public.bank_accounts (family_id);

alter table public.bank_accounts enable row level security;
drop policy if exists "bank_accounts_family" on public.bank_accounts;
create policy "bank_accounts_family" on public.bank_accounts
  for all to authenticated
  using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

-- פרימיום בלבד: משתמש בפונקציה הקיימת מ-billing-hardening.sql (fail-open אם אין family_plan).
drop trigger if exists trg_require_premium_bank_accounts on public.bank_accounts;
create trigger trg_require_premium_bank_accounts before insert on public.bank_accounts
  for each row execute function public.require_premium_for_insert();

select count(*) as bank_accounts_rows from public.bank_accounts;
```

**עדכון ל-`supabase/delete_account.sql`** (הוסף שורה ברשימת המחיקה של נתוני משפחה, ליד `delete from public.savings_pots ...`):
```sql
delete from public.bank_accounts where family_id = v_fam;
```
זו עריכה ידנית לקובץ הקיים ולא סקריפט חדש — הפונקציה `delete_my_account()` כבר קיימת ב-DB, אז אחרי העריכה בקובץ צריך גם **להריץ מחדש** את כל `delete_account.sql` ב-SQL Editor כדי שהפונקציה בפועל תתעדכן (הרצה חוזרת בטוחה, `create or replace`). (הערה: זה בעצם לא-הכרחי — `bank_accounts.family_id` כבר עם `on delete cascade`, כמו `loans` שבכוונה לא מופיע ב-`delete_account.sql` בכלל. שומרים על זה בכל זאת בשביל עקביות עם `savings_pots`/`assets` שכן מפורטים שם במפורש.)

---

## 3. שינויי לקוח — `index.html`

כל הפניה היא ל-anchors בקוד הנוכחי (השורות עשויות לזוז מעט אחרי שינויים קודמים באותה עריכה — לחפש לפי המחרוזת, לא רק המספר).

### 3.1 חלק 1 — חשבונות עו"ש ושווי נטו

**State (ליד `const [loans, setLoans] = useState([]);`):**
```js
const [bankAccounts, setBankAccounts] = useState([]);
```

**טעינה (Promise.all הראשי, `index.html:4871`):** זהירות — זו הרס\'ה positional destructuring, לא named. השורה היום:
```js
const [tx, bl, nt, tr, gf, sp, as, cc, fam, rs, fp, fs, ln] = await Promise.all([sb.from('transactions')..., ..., sb.from('loans').select('*').eq('family_id', familyId)]);
```
**חובה** להוסיף גם ל-array השאילתות **וגם** למערך ה-destructure, **באותה עמדה יחסית** (הכי בטוח: בסוף שניהם, מייד אחרי `ln`):
```js
const [tx, bl, nt, tr, gf, sp, as, cc, fam, rs, fp, fs, ln, ba] = await Promise.all([
  /* ...כל השאילתות הקיימות כסדרן..., */
  sb.from('loans').select('*').eq('family_id', familyId),
  sb.from('bank_accounts').select('*').eq('family_id', familyId)
]);
```
ואז (ליד `setLoans((ln?.data || []).map(mapLoanRow));`):
```js
setBankAccounts((ba?.data || []).map(r => ({ id: r.id, label: r.label, balance: Number(r.balance), currency: r.currency || null })));
```
**זו לא טעות קוסמטית** — אם מוסיפים רק את השאילתה בלי להוסיף שם משתנה תואם ב-destructure, כל המערכים "יזוזו" ותקבלו `ReferenceError`/ערכים שגויים בכל הדשבורד עבור כל משפחה אמיתית (לא-דמו) בטעינה.

**דמו (`index.html:4759` אזור, ליד `setLoans([{... דמו ...}])`):**
```js
setBankAccounts([
  { id: 'demo-bank-1', label: 'בנק לאומי — איתמר', balance: 10000, currency: null },
  { id: 'demo-bank-2', label: 'בנק מרכנתיל — נועה', balance: 2000, currency: null }
]);
```

**איפוס נתונים (`resetAllData`, `index.html:4545`):** הוסף `'bank_accounts'` לרשימה `['transactions', 'bills', 'loans', 'notes', ...]`, ו-`setBankAccounts([]);`.

**גיבוי JSON (`downloadBackup`):** יש **שני** מסלולים, ושניהם עם אותה מלכודת positional destructuring:
- ענף isDemo: להוסיף `bankAccounts` לאובייקט `data` הנשלח.
- ענף Supabase, `index.html:4576`:
  ```js
  const [tx, bl, nt, tr, gf, sp, as, cc, ch, fg, pg, ke, kg, ln] = await Promise.all(['transactions', 'bills', 'notes', 'trips', 'gifts', 'savings_pots', 'assets', 'custom_categories', 'children', 'family_goals', 'personal_goals', 'kid_entries', 'kid_goals', 'loans'].map(t => sb.from(t).select('*').eq('family_id', familyId)));
  ```
  להוסיף `'bank_accounts'` לסוף מערך שמות הטבלאות, **ו-**`ba` לסוף מערך ה-destructure (אותה כלל כמו למעלה), ואז `bankAccounts: ba.data ?? []` באובייקט `data`.

**CRUD — `submitBankAccount`/`deleteBankAccount`** (ליד `submitLoan`/`deleteLoan`, `index.html:5402` אזור): לבנות באותו מבנה כללי כמו `submitLoan`/`deleteLoan` (state update אופטימי + קריאה ל-Supabase + טיפול בשגיאה), **אבל שימו לב**: `submitLoan` בודק מחרוזת שגיאה `'free_tier_limit'` (מגיע מ-trigger אחר, `check_loan_limit`, ספירתי). לחשבונות עו"ש **אין** trigger כזה — יש רק `require_premium_for_insert` שזורק `'premium_required'` (`billing-hardening.sql:29`). ההגנה המרכזית היא **צד-לקוח**, כמו בחסכונות/נכסים (`index.html:6674` ו-`6851` בערך — הבדיקה `if (!isPremium) { showToast(...); setActiveTab('settings'); return; }` **לפני** שליחת הבקשה בכלל): לבדוק `!isPremium` בתחילת `submitBankAccount` ולחסום שם. כתוספת הגנתית (לא במקום), אפשר גם לתפוס `error.message.includes('premium_required')` מהשרת כגיבוי. שדות: `label` (חובה, non-empty), `balance` (חובה, `Number`, **מותר שלילי** — עו"ש יכול להיות במינוס, אין בדיקת `> 0`), `currency` (אופציונלי). ב-update, לעדכן גם `updated_at: new Date().toISOString()`.

**רכיב `BankAccountsCard`** (ליד `LoansCard`, `index.html:8975` אזור) — להעתיק את מבנה `LoansCard` (רשימה + טופס הוספה/עריכה + כפתורי מחיקה/עריכה), בלי הלוח/סימולטור (לא רלוונטי לעו"ש). תוכן:
- כותרת "עובר ושב" עם אייקון `IBank` (אותו אייקון ש-`LoansCard` כבר משתמש בו, `index.html:9076`), כפתור "הוסף חשבון".
- אריח סיכום אחד: "סה״כ בעו״ש" = סכום כל החשבונות (מומר למטבע ראשי דרך `toPrimary`).
- רשימת חשבונות: תווית + יתרה + כפתורי עריכה/מחיקה (זהה חזותית ל-`LoansCard`/`bills`).
- **פרימיום:** אם `!isPremium`, לחיצה על "הוסף חשבון" מציגה `showToast('ניהול חשבונות עו"ש הוא תכונת פרימיום — שדרגו בהגדרות')` + `setActiveTab('settings')` (אותו דפוס כמו חסכונות/השקעות), הכרטיס עצמו כן מוצג עם הרשימה (ריקה או מה שכבר קיים).
- `EmptyState` כש-`bankAccounts.length === 0`: "עוד לא הוספתם חשבון עו"ש".

**חישובי סיכום (`index.html:4959-4970` אזור):**
```js
const totalBankBalance = bankAccounts.reduce((s, b) => {
  const v = toPrimary(b.balance, b.currency, currency, rates);
  return v === null ? s : s + v;
}, 0);
// שימו לב: monthKey() הקיימת (index.html:4971) מחשבת לפי זמן מקומי (getFullYear/getMonth),
// לא UTC. חובה להשתמש באותה פונקציה בדיוק — לא new Date().toISOString() — אחרת יש חוסר
// עקביות של עד כמה שעות סביב חצות ה-1 לחודש בזמן ישראל, ביחס ל-forecast שמשתמש באותו monthKey().
const thisKey = monthKey(new Date().toISOString());
const monthIncome = transactions.filter(t => t.type === 'income' && monthKey(t.date) === thisKey).reduce((s, t) => s + t.amount, 0);
const monthExpense = transactions.filter(t => t.type === 'expense' && monthKey(t.date) === thisKey).reduce((s, t) => s + t.amount, 0);
const currentBalance = bankAccounts.length > 0
  ? totalBankBalance + (monthIncome - monthExpense)
  : balance; // נופל חזרה לנוסחה הישנה (A2) — income/expense המצטברים הקיימים
const totalLoanBalance = loans.reduce((s, l) => {
  const st = loanState(l);
  return st.done ? s : s + st.balance;
}, 0);
const netWorth = currentBalance + totalSavings + totalAssets - totalLoanBalance;
```
שימו לב: `balance` (income - expense מצטבר) **נשאר קיים בקוד** כפי שהוא היום — הוא עדיין המקור לנפילה-לאחור. `currentBalance` הוא המשתנה החדש שמוזן לאריח ולשווי הנטו.

**רשת 4 האריחים (`index.html:6002`, המחרוזת `[[IDollar, 'יתרה נוכחית', balance, ...`):** לעדכן את המערך:
```js
[[IDollar, 'יתרה חודשית נוכחית', currentBalance, 'var(--cyan)', 'expenses'],
 [IPiggyBank, 'סה"כ חסכונות', totalSavings, 'var(--bronze)', 'savings'],
 [ITrendingUp, 'השקעות ונכסים', totalAssets, 'var(--pos-soft)', 'investments'],
 [ITrophy, 'שווי נטו כולל', netWorth, 'var(--text)', null]]
```
(רק שינוי label ל"יתרה חודשית נוכחית" ומשתנה ל-`currentBalance` — שאר השורה זהה.)

**מיקום הכרטיס (A6):** להוסיף `React.createElement(BankAccountsCard, {...})` בין ה-`NewsTicker`/באנר-הנעילה לבין ה-`div` של רשת 4 האריחים (מייד לפני ה-`div` עם `className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"` שמכיל את המערך שצוין למעלה, `index.html:6001-6002`).

### 3.2 חלק 2 — שם משפחה בהרשמה

ב-`LoginScreen` (`index.html:2963` אזור):
- state חדש: `const [familyDisplayName, setFamilyDisplayName] = useState('');`
- כש-`signupType === 'create'` וה-name משתנה, אפשר (executor's latitude) להציע ברירת מחדל `משפחת ${name}` בשדה החדש כל עוד המשתמש לא הקליד בעצמו (דפוס נפוץ: `useEffect` שמעדכן רק אם השדה עוד ריק/לא "נגע בו").
- שדה קלט חדש בטופס ה-signup (ליד שדה השם), placeholder: `"שם המשפחה/קבוצה (יוצג לבני המשפחה שלכם)"`, מוצג רק כש-`signupType === 'create'`.
- ב-`submit()`, בענף `signupType === 'create'` (`index.html:3027`), להחליף:
  ```js
  const {data: family, error: famErr} = await sb.from('families').insert({
    name: (familyDisplayName.trim() || `משפחת ${name}`),
    group_code: code
  }).select().single();
  ```
- ולידציה: לא חובה קשיחה (כי יש ברירת מחדל אוטומטית) — אין שדה נוסף לבדוק ב-validation הקיימת.
- אין שינוי בשום מקום אחר — `familyInfo.name`/`familyName` כבר מוזרמים בכל האפליקציה (מסך "מי משתמש עכשיו?", ההגדרות, הדוח החודשי) ויציגו את הערך החדש אוטומטית.

### 3.3 חלק 3 — תיקון שדה תאריך במובייל

הבעיה: `input[type="date"]` ברוב הדפדפנים הניידים (iOS Safari בפרט) מרנדר עם גובה תוכן פנימי גדול משמעותית מטקסט רגיל, ואין לו כרגע שום כלל CSS ייעודי — הוא רק יורש את `.ent-input` הכללי, שמניח padding קבוע (`pt-5 pb-1.5` וכו') שמתאים לטקסט אבל לא לרכיב התאריך הילידי.

**תיקון (CSS גלובלי, ליד הגדרת `.ent-input` ב-`index.html:541`).** בכוונה **בלי** `-webkit-appearance: none`/`appearance: none` — זה ידוע כמסוכן ספציפית ב-iOS Safari (יכול להסתיר/לשבש את אייקון הלוח שנה הילידי במקום רק לתקן גודל). במקום זה, `min-height` + מרכוז אנכי ב-flex, שלא נוגע ב-appearance:
```css
input[type="date"].ent-input, .ent-input[type="date"] {
  min-height: 44px;
  padding-top: 0;
  padding-bottom: 0;
  display: flex;
  align-items: center;
}
```
זה מכסה את 3 המופעים עם `className: inputClass`/`goalInputCls` (שכולם כוללים `ent-input`). **המופע הרביעי** — הרכיב נקרא בפועל `DateField` (**לא** "FloatingDateField", `index.html:1578`; זה שבצילום המסך, עם ה-label הצף מעל) — צריך טיפול נקודתי כי יש לו `pt-5 pb-1.5` שונה בכוונה בשביל ה-label הצף:
```css
.ent-floating-date { min-height: 52px; padding-top: 18px; }
```
ולהוסיף `ent-floating-date` ל-className של אותו input הספציפי (`index.html:1591`, המחרוזת `"ent-input w-full px-4 pt-5 pb-1.5 rounded-xl text-sm outline-none"`). שני הכללים ביחד נותנים לכל 4 המופעים גובה מינימלי עקבי (44px/52px) בלי לגעת בעיבוד הילידי של הדפדפן.

**חשוב לגבי אימות:** הבאג דווח ב-iOS Safari. הדפדפן האוטומטי הזמין בסביבה הזו (preview pane) מבוסס Chromium ומרנדר את שדה התאריך הילידי אחרת לגמרי מ-Safari — בדיקה בו **לא** תגלה אם הבאג האמיתי תוקן. לכן שלב הבנייה חייב לכלול אימות ידני שלך במובייל אמיתי (צילום מסך אחרי הפריסה), לא רק בדיקה אוטומטית. ראו סעיף 4, שלב 2.

---

## 4. סדר בנייה (Build Phases)

**בדיקת syntax אחרי כל שלב קליינט** (לפני commit) — אין בפרויקט `chk.js` מוכן (זה קובץ scratchpad זמני מחוץ ל-repo, לא ניתן להסתמך עליו כ"קיים"); המבצע צריך ליצור בדיקה כזו בעצמו, למשל סקריפט Node קטן שמחלץ את בלוקי ה-`<script>` מתוך `index.html` (regex: `/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g`) ומריץ `new vm.Script(code)` על כל אחד מהם כדי לתפוס שגיאות תחביר (חוסר סוגריים וכו') לפני שרואים אותן בדפדפן. זו לא ספריית build אמיתית (אין JSX/npm בפרויקט הזה בכלל) — זה רק גדר תחביר מהירה.

1. **SQL:** להריץ `bank-accounts.sql` ב-Supabase (המשתמש מריץ בעצמו, כמו תמיד). לעדכן ולהריץ מחדש את `delete_account.sql`.
2. **קליינט — חלק 3 קודם (הכי קטן, אפס תלות):** תיקון CSS לשדה תאריך. בדיקה אוטומטית בדפדפן במצב מובייל (375px) בטופס הוצאות + טופס הלוואה + טופס יעד היא רק חלקית (ראו הערת iOS/Chromium למעלה) — **חובה גם אימות ידני שלך** (צילום מסך אמיתי מהטלפון) לפני שהפריט הזה נסגר כ"תוקן".
3. **קליינט — חלק 2:** שדה שם משפחה בהרשמה. לבדוק בזרימת יצירת משפחה בדמו/ידנית שהשם מופיע נכון במסך "מי משתמש עכשיו?".
4. **קליינט — חלק 1 (הכי גדול):** state, טעינה (כולל תיקון ה-destructure בשני המקומות, סעיף 3.1), CRUD, `BankAccountsCard`, חישובי סיכום, רשת אריחים, מיקום. לבדוק:
   - בדיקת חישוב טהורה (כמו שנעשה ל-`loanSchedule` בהלוואות — Node script על הפונקציות המבודדות) שמוודאת: `currentBalance` נופל לנוסחה הישנה כש-`bankAccounts.length===0`, ומחשב נכון כש-יש חשבונות (כולל בדיקת גבול חודש: תאריך ב-1 לחודש לפני/אחרי חצות שעון ישראל, מול `monthKey` המקומי); `netWorth` מחסיר הלוואות פעילות בלבד (לא הלוואות שהסתיימו).
   - בדיקה בדפדפן (preview_start "homey", מצב דמו): הכרטיס מופיע במקום הנכון, מוסיף/עורך/מוחק חשבון, האריח הראשון מתעדכן בזמן אמת, "שווי נטו כולל" משקף את החיסור של ההלוואה שנוספה קודם בסשן. **חשוב במיוחד:** לרענן את הדף (לא רק state בזיכרון) אחרי הטעינה הראשונית ולוודא שאין `ReferenceError`/קונסול אדום — זו בדיוק הבדיקה שתופסת את מלכודת ה-destructure אם היא נשארה.
   - בדיקת מצב חינמי (אם אפשר לדמות): כפתור "הוסף חשבון" מציג toast שדרוג ולא שולח insert.
5. **commit + push** אחרי אישור סופי מהמשתמש (לא לפני, לפי המוסכם בסשן — תמיד לתת לו לראות/לאשר לפני push, גם אם commit מקומי מותר).

---

## 5. Landmines & Adaptations

- **שינוי מספר כותרת לכל המשתמשים הקיימים ביום ההשקה:** מטופל ע"י A2 (נפילה לנוסחה הישנה) — בלי זה, כל משפחה (כולל שלך) הייתה רואה ₪0 ביום הפריסה. **בלי ההחלטה הזו התוכנית הייתה שונה לגמרי** (הייתי צריך להריץ מיגרציית seed ל-DB לכל משפחה, מה שהרבה יותר מסוכן ופולשני) — זו הסיבה שזו הייתה שאלה, לא ברירת מחדל.
- **שווי נטו שיורד (A4):** אחרי הפריסה "שווי נטו כולל" אצלך **יקטן** (כי עכשיו הוא מחסיר את יתרת ההלוואה שהוספת מוקדם יותר בסשן). זה השיפור הנכון פיננסית, אבל זה שינוי גלוי שכדאי שתדע מראש ולא תופתע ממנו.
- **מטבע:** אם למשפחה יש `family_plan.plan==='premium'` אבל `family_plan` עצמו `null`/חסר (מצב תיאורטי, fail-open) — הטריגר `require_premium_for_insert` כבר מטפל בזה (לא חוסם, `coalesce(is_free,false)`), אין צורך בטיפול נוסף.
- **הלוואות שהסתיימו (`st.done`) לא נכללות בחיסור שווי הנטו** — מכוון, הלוואה גמורה לא צריכה להוריד כלום.
- **ירידה חוזרת כל 1 לחודש (לא רק פעם אחת ביום ההשקה):** מרגע שיש למשפחה חשבונות עו"ש, `currentBalance = totalBankBalance + תזרים החודש הנוכחי`. ב-1 לכל חודש התזרים מתאפס ל-0, כך שהמספר "קופץ" למטה בחזרה ל-`totalBankBalance` הגולמי — לא בגלל אירוע כספי אמיתי, אלא כי המשתמש עוד לא עדכן ידנית את יתרת הבנק. זו התנהגות חוזרת, לא חד-פעמית, וכדאי שתדע מראש שזה יקרה כל חודש (ולא לפרש את זה כבאג) — הפתרון שלך הוא לעדכן את יתרות החשבונות מדי פעם כשאתה בודק את הבנק האמיתי.

---

## 6. מחוץ לסקופ (מוצהר)

- "פלטפורמה עסקית" — לא נוגעים, רק רשמנו את הרצון לעתיד.
- קישור תנועה ספציפית לחשבון עו"ש (A9).
- עריכת שם משפחה אחרי ההרשמה (A11) — אפשר להוסיף מאוחר יותר בקלות (עדכון `families.name` מהגדרות, אותו דפוס כמו שאר SettingsSection).
- רשימת בנקים סגורה/dropdown (A3) — שדה חופשי מספיק ל-v1.

---

## 7. אימות סופי (checklist לפני "מוכן")

- [ ] `bank-accounts.sql` רץ, `delete_account.sql` עודכן והורץ מחדש.
- [ ] בדיקת syntax (vm.Script על בלוקי ה-script) — 0 שגיאות.
- [ ] טעינה בדפדפן (לא-דמו) בלי `ReferenceError` בקונסול — מוודא שתיקון ה-destructure נכון.
- [ ] דמו: 2 חשבונות עו"ש נטענים עם הערכים שנתת, אריח ראשון = סכומם + תזרים החודש.
- [ ] משפחה בלי חשבונות (כל משפחה קיימת) → אריח ראשון זהה למה שהיה לפני השינוי.
- [ ] שווי נטו מחסיר הלוואה פעילה, לא מחסיר הלוואה שהסתיימה.
- [ ] טופס הרשמה חדש מציג שדה שם משפחה, ברירת מחדל "משפחת <שם>" ניתנת לעריכה, ומופיעה נכון במסך "מי משתמש עכשיו?".
- [ ] שדה תאריך — בדיקה אוטומטית (375px) **ואימות ידני שלך במובייל אמיתי** (iOS/Android), לא רק הדפדפן האוטומטי.
- [ ] לא נדחף ל-git עד אישור מפורש.
