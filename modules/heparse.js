/* Homey — מפרש עברי מקומי לשורת ההוספה המהירה ("נועה כדורגל כל שני 16:30").
 * דטרמיניסטי, מיידי, עובד בלי רשת. מחזיר פריט מוצע + טווחי המילים שזוהו (להדגשה ולביטול בהקשה).
 * לא תלוי ב-React. הפונקציות כאן טהורות כדי שאפשר יהיה לבדוק אותן מול משפטים אמיתיים (heparse.test.js).
 *
 * החלטות (לפי דוח "ייעול משימות ולוז Homey"):
 * - אין שדה "אישי/זוגי/משפחתי": ההיקף נגזר מהאנשים. רק אני = אישי, ילד = של הילד, דייט = זוגי.
 * - "שני"/"ראשון" הם יום רק אחרי "כל" / "יום" / קידומת ב' או כמילה עצמאית בסוף; אחרת מספר.
 * - שעה 1-7 בלי "בבוקר" = אחר הצהריים (עם חלופה), 8-11 = בוקר, 12 = צהריים.
 * - השבוע מתחיל בראשון. "סוף השבוע" = שישי.
 */

const HP_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HP_DAY_LETTERS = { "א'": 0, "ב'": 1, "ג'": 2, "ד'": 3, "ה'": 4, "ו'": 5, "ש'": 6 };
const HP_PREFIX = '(?:[ובלמהש]{0,2})';
// מילות מפתח לסוג הפריט
const HP_TAGS = [
  ['class', /(חוג|כדורגל|כדורסל|שחי(י)?ה|ג'?ודו|קראטה|בלט|ריקוד|התעמלות|טניס|גיטרה|פסנתר|תופים|ציור|אימון|שחמט|רובוטיקה|תיאטרון|צופים|בני עקיבא|מכבי צעיר)/],
  ['date', /(דייט|ערב זוגי|יציאה זוגית|יום נישואין)/],
  ['meeting', /(פגישה|פגישת|תור |תור$|רופא|רופאה|רופאת|רופא שיניים|אסיפה|אסיפת|ראיון|שיחה עם|יועץ|יועצת|עורך דין|רואה חשבון|בנק|מוסך|טסט)/]
];
const HP_SHOP = /^\s*(לקנות|לקנות:|קניות:|לקנייה:|תקנו|תקנה|תקני)\s*/;
const HP_NOTE = /^\s*(פתק:|פתק |לזכור:|רעיון:)\s*/;

const hpIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hpParseIso = s => new Date(String(s).slice(0, 10) + 'T00:00:00');
const hpAdd = (iso, n) => { const d = hpParseIso(iso); d.setDate(d.getDate() + n); return hpIso(d); };
const hpNextDow = (todayIso, dow, includeToday) => { const t = hpParseIso(todayIso).getDay(); let diff = (dow - t + 7) % 7; if (diff === 0 && !includeToday) diff = 7; return hpAdd(todayIso, diff); };
const hpTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;

/**
 * @param {string} text
 * @param {{ today: string, members: {id,name,kind}[], meId: string }} ctx
 * @returns {{ kind:'event'|'task'|'shopping'|'note', title:string, date:string|null, time:string|null, altTime:string|null,
 *   repeat:'none'|'daily'|'weekly', people:string[], tag:'class'|'meeting'|'date'|null, items?:string[], spans:{start:number,end:number,type:string}[], unknownTime:boolean }}
 */
function hpParse(text, ctx) {
  const raw = String(text || '');
  const today = ctx.today;
  const spans = [];
  const out = { kind: 'task', title: '', date: null, time: null, altTime: null, repeat: 'none', people: [], tag: null, spans, unknownTime: false };
  let work = raw; // מחליפים חלקים שזוהו ברווחים כדי לשמור על האינדקסים
  const take = (m, type) => { if (!m) return; const start = m.index, end = m.index + m[0].length; spans.push({ start, end, type }); work = work.slice(0, start) + ' '.repeat(end - start) + work.slice(end); };
  const find = (re, type) => { const m = re.exec(work); if (m) take(m, type); return m; };

  // קניות / פתק לפי מילת פתיחה
  const shop = HP_SHOP.exec(work);
  if (shop) {
    take(shop, 'kind');
    const rest = work.trim();
    out.kind = 'shopping';
    out.items = rest.split(/\s*(?:,|،|\sו(?=\S))\s*/).map(s => s.trim()).filter(Boolean);
    out.title = rest;
    return out;
  }
  const note = HP_NOTE.exec(work);
  if (note) { take(note, 'kind'); out.kind = 'note'; out.title = work.trim(); return out; }

  // חזרה: "כל יום", "כל בוקר", "כל שבוע", "כל <יום>", "כל יום <יום>"
  let weeklyDow = null;
  let m = new RegExp(`(?:^|\\s)(כל\\s+(?:יום\\s+)?(${HP_DAYS.join('|')}))(?=\\s|$|[,.])`).exec(work);
  if (m) { weeklyDow = HP_DAYS.indexOf(m[2]); take({ index: m.index + m[0].indexOf(m[1]), 0: m[1] }, 'repeat'); out.repeat = 'weekly'; }
  else if ((m = /(?:^|\s)(כל\s+(?:יום|בוקר|ערב|לילה))(?=\s|$|[,.])/.exec(work))) { take({ index: m.index + m[0].indexOf(m[1]), 0: m[1] }, 'repeat'); out.repeat = 'daily'; }
  else if ((m = /(?:^|\s)(כל\s+שבוע)(?=\s|$|[,.])/.exec(work))) { take({ index: m.index + m[0].indexOf(m[1]), 0: m[1] }, 'repeat'); out.repeat = 'weekly'; }

  // תאריך
  const dateRules = [
    [/(?:^|\s)(מחרתיים)(?=\s|$|[,.])/, () => hpAdd(today, 2)],
    [/(?:^|\s)((?:ו|ל)?מחר)(?=\s|$|[,.])/, () => hpAdd(today, 1)],
    [/(?:^|\s)((?:ו|ל)?היום)(?=\s|$|[,.])/, () => today],
    [/(?:^|\s)(בעוד\s+(\d{1,2})\s+(ימים|יום))(?=\s|$|[,.])/, x => hpAdd(today, Number(x[2]))],
    [/(?:^|\s)(בעוד\s+(שבועיים|שבוע))(?=\s|$|[,.])/, x => hpAdd(today, x[2] === 'שבועיים' ? 14 : 7)],
    [/(?:^|\s)((?:ב)?שבוע הבא)(?=\s|$|[,.])/, () => hpAdd(hpNextDow(today, 0, false), 0)],
    [/(?:^|\s)((?:ב)?סוף ה?שבוע|(?:ב)?סופ"ש)(?=\s|$|[,.])/, () => hpNextDow(today, 5, true)],
    [/(?:^|\s)((?:ב|ל)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?)(?=\s|$|[,.])/, x => {
      const d = Number(x[2]), mo = Number(x[3]);
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
      let y = x[4] ? Number(x[4].length === 2 ? '20' + x[4] : x[4]) : hpParseIso(today).getFullYear();
      let iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!x[4] && iso < today) iso = `${y + 1}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; // תאריך בלי שנה = המופע הבא
      return iso;
    }],
    // יום בשבוע: "ביום שני", "יום שני", "בשני", "שני" בסוף, "ב'" כאות
    [new RegExp(`(?:^|\\s)((?:ב|ל)?יום\\s+(${HP_DAYS.join('|')}))(?=\\s|$|[,.])`), x => hpNextDow(today, HP_DAYS.indexOf(x[2]), true)],
    [new RegExp(`(?:^|\\s)([בל](${HP_DAYS.join('|')}))(?=\\s|$|[,.])`), x => hpNextDow(today, HP_DAYS.indexOf(x[2]), true)],
    [/(?:^|\s)((?:ביום\s+)?([אבגדהוש]'))(?=\s|$|[,.])/, x => hpNextDow(today, HP_DAY_LETTERS[x[2]], true)],
    // יום חשוף: שלישי-שבת בכל מקום; "שני"/"ראשון" (שגם מספרים) רק לפני שעה או בסוף
    [/(?:^|\s)(שלישי|רביעי|חמישי|שישי|שבת)(?=\s|$|[,.])/, x => hpNextDow(today, HP_DAYS.indexOf(x[1]), true)],
    [/(?:^|\s)(ראשון|שני)(?=\s+(?:ב-?)?\d|\s*$)/, x => hpNextDow(today, HP_DAYS.indexOf(x[1]), true)]
  ];
  if (out.repeat === 'weekly' && weeklyDow != null) out.date = hpNextDow(today, weeklyDow, true);
  for (const [re, fn] of dateRules) {
    if (out.date) break;
    const x = re.exec(work);
    if (!x) continue;
    const v = fn(x);
    if (!v) continue;
    out.date = v;
    take({ index: x.index + x[0].indexOf(x[1]), 0: x[1] }, 'date');
  }

  // שעה
  const setTime = (h, mi, part) => {
    let hh = h;
    if (part === 'pm' && hh < 12) hh += 12;
    else if (part === 'am' && hh === 12) hh = 0;
    else if (!part) { if (hh >= 1 && hh <= 7) { out.altTime = hpTime(hh, mi); hh += 12; } }
    out.time = hpTime(hh, mi);
  };
  const partOf = s => /בבוקר|בוקר/.test(s) ? 'am' : /(אחה"צ|אחר הצהריים|אחרי הצהריים|בערב|ערב|בלילה|לילה)/.test(s) ? 'pm' : /בצהריים/.test(s) ? 'noon' : null;
  let t;
  if ((t = /(?:^|\s)((?:ב-?|בשעה\s+|עד\s+|מ-?)?([01]?\d|2[0-3]):([0-5]\d)(?:\s*-\s*([01]?\d|2[0-3]):([0-5]\d))?)(?=\s|$|[,.])/.exec(work))) {
    out.time = hpTime(Number(t[2]), Number(t[3]));
    take({ index: t.index + t[0].indexOf(t[1]), 0: t[1] }, 'time');
  } else if ((t = /(?:^|\s)((?:ב-?|בשעה\s+)(\d{1,2})(\s+וחצי|\s+ורבע)?(\s+(?:בבוקר|בערב|בלילה|אחה"צ|אחר הצהריים|בצהריים))?)(?=\s|$|[,.])/.exec(work))
    // מספר בלי "ב" כשאחריו חלק יום: "7 בבוקר", "8 וחצי בערב" (אותו סדר קבוצות)
    || (t = /(?:^|\s)((\d{1,2})(\s+וחצי|\s+ורבע)?(\s+(?:בבוקר|בערב|בלילה|אחה"צ|אחר הצהריים|בצהריים)))(?=\s|$|[,.])/.exec(work))) {
    const h = Number(t[2]);
    if (h >= 0 && h <= 23) {
      const mi = t[3] ? (t[3].includes('וחצי') ? 30 : 15) : 0;
      const part = t[4] ? partOf(t[4]) : null;
      setTime(h, mi, part === 'noon' ? (h < 12 ? 'pm' : null) : part);
      take({ index: t.index + t[0].indexOf(t[1]), 0: t[1] }, 'time');
    }
  }
  if (!out.time) {
    const p = /(?:^|\s)(בבוקר|בצהריים|אחה"צ|אחר הצהריים|בערב|בלילה)(?=\s|$|[,.])/.exec(work);
    if (p) {
      out.time = { 'בבוקר': '09:00', 'בצהריים': '13:00', 'אחה"צ': '16:00', 'אחר הצהריים': '16:00', 'בערב': '19:00', 'בלילה': '21:00' }[p[1]];
      take({ index: p.index + p[0].indexOf(p[1]), 0: p[1] }, 'time');
    }
  }
  // נשארו ספרות שנראות כמו זמן ולא זוהו
  if (/\d/.test(work) && !out.time && /(\d{1,2}[:.]\d{2}|ב-?\d)/.test(work)) out.unknownTime = true;

  // אנשים: שמות מבני המשפחה, עם קידומת אפשרית (לנועה, ונועה, של נועה)
  const members = [...(ctx.members || [])].sort((a, b) => b.name.length - a.name.length);
  for (const mem of members) {
    if (!mem.name || mem.name.length < 2) continue;
    const re = new RegExp(`(?:^|\\s)((?:של\\s+)?${HP_PREFIX}${mem.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=\\s|$|[,.])`);
    const x = re.exec(work);
    if (x) { out.people.push(mem.id); take({ index: x.index + x[0].indexOf(x[1]), 0: x[1] }, 'person'); }
  }

  // סוג (חוג / פגישה / דייט). לא מוחקים מהכותרת: "כדורגל" הוא גם הכותרת
  for (const [tag, re] of HP_TAGS) { if (re.test(work)) { out.tag = tag; break; } }

  // פריט זמן או לעשות: שעה, או חוג/פגישה/דייט = פריט זמן
  out.kind = out.time || out.tag ? 'event' : 'task';
  const explicitDate = spans.some(s => s.type === 'date');
  if (out.kind === 'event' && !out.date) out.date = today;
  // חוג של ילד בלי תאריך מפורש ("נועה כדורגל 16:30") הוא בדרך כלל חוג שבועי
  const hasKid = out.people.some(id => (ctx.members || []).some(mm => mm.id === id && mm.kind === 'child'));
  if (out.tag === 'class' && out.repeat === 'none' && !explicitDate && hasKid) out.repeat = 'weekly';
  out.title = work.replace(/\s+/g, ' ').replace(/^[\s,.:-]+|[\s,.:-]+$/g, '').trim() || raw.trim();
  return out;
}

if (typeof module !== 'undefined') module.exports = { hpParse, HP_DAYS };
