// בדיקות לייבוא הודעה. הרצה: node modules/heparse.extract.test.js (היום הקבוע: ראשון 8.11.2026)
const { hpExtract } = require('./heparse.js');
const ctx = { today: '2026-11-08', meId: 'p1', members: [{ id: 'p1', name: 'אבא', kind: 'parent' }, { id: 'k1', name: 'נועה', kind: 'child' }] };
let fail = 0;
const check = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) { fail++; console.log('FAIL', name, '\n  expected', JSON.stringify(exp), '\n  got     ', JSON.stringify(got)); } else console.log('ok  ', name);
};
const pick = r => r.map(x => [x.kind, x.title, x.date, x.time, x.selected]);

// הודעת גננת טיפוסית
const msg1 = `הורים יקרים,
ביום שלישי 10/11 נצא לטיול שנתי ליער.
יש להגיע לגן ב-7:45.
להביא כובע, בקבוק מים וארוחת בוקר.
תודה!`;
check('גננת: טיול + שעה + להביא', pick(hpExtract(msg1, ctx)), [
  ['event', 'נצא לטיול שנתי ליער', '2026-11-10', null, true],
  ['task', 'יש להגיע לגן', '2026-11-10', '07:45', true],
  ['task', 'להביא כובע, בקבוק מים וארוחת בוקר', '2026-11-10', null, true]
]);

// שורות וואטסאפ עם חותמת זמן ושם השולח
const msg2 = `[9.11.2026, 08:14:22] מורה דנה: תזכורת: מחר אסיפת הורים ב-19:00
[9.11.2026, 08:15:01] מורה דנה: לשלם 50 ש"ח לקופת הכיתה עד יום חמישי`;
check('וואטסאפ: חותמת זמן נזרקת', pick(hpExtract(msg2, ctx)), [
  ['event', 'תזכורת: אסיפת הורים', '2026-11-09', '19:00', true],
  ['task', 'לשלם 50 ש"ח לקופת הכיתה עד', '2026-11-12', null, true]
]);

// שורה בלי תאריך ובלי הקשר: מוצגת, לא מסומנת
check('בלי תאריך = לא מסומן', pick(hpExtract('שימו לב שיש כינים בגן', ctx)), [['task', 'שימו לב שיש כינים בגן', null, null, false]]);
// ברכות נזרקות
check('ברכות נזרקות', hpExtract('בוקר טוב\nשבת שלום 🙏\nתודה רבה', ctx).length, 0);

console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
