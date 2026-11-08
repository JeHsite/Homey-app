// בדיקות למפרש העברי. הרצה: node modules/heparse.test.js
// היום הקבוע לבדיקות: יום ראשון 8.11.2026
const { hpParse } = require('./heparse.js');
const ctx = { today: '2026-11-08', meId: 'p1', members: [{ id: 'p1', name: 'אבא', kind: 'parent' }, { id: 'p2', name: 'אמא', kind: 'parent' }, { id: 'k1', name: 'נועה', kind: 'child' }, { id: 'k2', name: 'איתי', kind: 'child' }] };
const cases = [
  ['נועה כדורגל כל שני 16:30', { kind: 'event', title: 'כדורגל', date: '2026-11-09', time: '16:30', repeat: 'weekly', people: ['k1'], tag: 'class' }],
  ['לקנות חלב ולחם', { kind: 'shopping', items: ['חלב', 'לחם'] }],
  ['רופא שיניים לאיתי מחר ב-5', { kind: 'event', title: 'רופא שיניים', date: '2026-11-09', time: '17:00', altTime: '05:00', people: ['k2'], tag: 'meeting' }],
  ['להתקשר לביטוח', { kind: 'task', title: 'להתקשר לביטוח', date: null, time: null, people: [] }],
  ['לשלם ארנונה מחרתיים', { kind: 'task', title: 'לשלם ארנונה', date: '2026-11-10' }],
  ['פגישה עם רואה חשבון ביום שלישי ב-10 בבוקר', { kind: 'event', date: '2026-11-10', time: '10:00', tag: 'meeting' }],
  ['דייט בחמישי בערב', { kind: 'event', title: 'דייט', date: '2026-11-12', time: '19:00', tag: 'date' }],
  ['אסיפת הורים 24/11 19:30', { kind: 'event', date: '2026-11-24', time: '19:30', tag: 'meeting' }],
  ['להוציא זבל כל יום', { kind: 'task', title: 'להוציא זבל', repeat: 'daily' }],
  ['פתק: הקוד של השער 4521', { kind: 'note', title: 'הקוד של השער 4521' }],
  ['לקחת את נועה ואיתי לסבתא בשישי ב-4 וחצי', { kind: 'event', date: '2026-11-13', time: '16:30', people: ['k1', 'k2'] }],
  ['ארוחת ערב משפחתית היום ב-19:00', { kind: 'event', date: '2026-11-08', time: '19:00' }],
  ['להזמין טיסות בעוד שבוע', { kind: 'task', date: '2026-11-15' }],
  ['שחייה איתי כל רביעי 17:00', { kind: 'event', date: '2026-11-11', time: '17:00', repeat: 'weekly', people: ['k2'], tag: 'class' }],
  ['לתקן את הברז בסוף השבוע', { kind: 'task', date: '2026-11-13' }],
  ['נועה כדורגל 16:30', { kind: 'event', date: '2026-11-08', time: '16:30', repeat: 'weekly', people: ['k1'], tag: 'class' }],
  ['נועה כדורגל מחר 16:00', { kind: 'event', date: '2026-11-09', repeat: 'none' }],
  ['אימון כושר מחר 7 בבוקר', { kind: 'event', date: '2026-11-09', time: '07:00', repeat: 'none' }],
  ['ארוחה אצל סבתא שישי 8 וחצי בערב', { kind: 'event', date: '2026-11-13', time: '20:30' }],
];
let fail = 0;
for (const [text, exp] of cases) {
  const r = hpParse(text, ctx);
  const bad = Object.entries(exp).filter(([k, v]) => JSON.stringify(r[k]) !== JSON.stringify(v));
  if (bad.length) { fail++; console.log('FAIL', text, '\n  expected', JSON.stringify(Object.fromEntries(bad)), '\n  got     ', JSON.stringify(Object.fromEntries(bad.map(([k]) => [k, r[k]])))); }
  else console.log('ok  ', text);
}
console.log(`${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
