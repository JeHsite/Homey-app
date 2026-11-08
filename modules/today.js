/* Homey — "היום | שבוע": המסך האחד של משימות ולו"ז, ושורת ההוספה המהירה.
 * לפי הדוח "ייעול משימות ולוז Homey": במקום 10 לשוניות יש 4 מקומות (היום|שבוע, ילדים, בלי תאריך, ישיבה זוגית),
 * ושורת הוספה אחת שמבינה עברית חופשית (modules/heparse.js) ומנתבת לבד: משימה / אירוע / קניות / פתק.
 * אין שדה "אישי/זוגי/משפחתי": ההיקף נגזר מהאנשים שבמשפט, ואפשר לתקן בהקשה על הצ'יפ.
 * אין חלונות "בטוח?": כל פעולה נעשית מיד ויש "ביטול" ל-6 שניות.
 * הטבלאות לא השתנו (tasks, family_events, chore_runs, routines). משתמש בגלובליים של tasks.js, plan.js, chores.js והסקריפט הראשי בזמן רינדור. */

// לשוניות ישנות -> המקום החדש שלהן (קישורים, התראות, היסטוריית ניווט)
const TAB_ALIASES = { plan: 'today', tasks: 'today', schedule: 'today', meetings: 'today', chores: 'kids', routines: 'kids', classes: 'kids', notes: 'inbox', dates: 'sync' };
const TD_COLORS = ['var(--cyan)', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c'];
const TD_KIND = {
  task: { icon: '✅', label: 'משימה' },
  event: { icon: '📅', label: 'אירוע' },
  shopping: { icon: '🛒', label: 'קניות' },
  note: { icon: '📝', label: 'פתק' }
};
const TD_TAG = { general: { icon: '📅', label: 'כללי' }, class: { icon: '⚽', label: 'חוג' }, meeting: { icon: '💼', label: 'פגישה' }, date: { icon: '❤️', label: 'דייט' } };
const TD_SCOPE = { personal: '🔒 רק שלו/ה', couple: '💑 זוגי', family: '🏠 משפחתי' };
const TD_EXAMPLES = ['נועה כדורגל כל שני 16:30', 'לקנות חלב ולחם', 'לשלם ארנונה מחר', 'רופא שיניים לאיתי ביום שלישי ב-5', 'דייט בחמישי בערב', 'פתק: הקוד של השער 4521'];

const tdColorOf = (members, id) => {
  const i = members.findIndex(m => m.id === id);
  return i < 0 ? 'var(--bronze)' : TD_COLORS[i % TD_COLORS.length];
};
const tdItemColor = (members, it) => it.personId ? tdColorOf(members, it.personId) : it.scope === 'couple' ? '#f472b6' : 'var(--bronze)';
const tdNameOf = (members, id) => (members.find(m => m.id === id) || {}).name || '';
const tdFirst = s => String(s || '').trim().split(/\s+/)[0];
const tdDayLabel = d => {
  const t = plToday();
  if (d === t) return 'היום';
  if (d === plAddDays(t, 1)) return 'מחר';
  return `${PL_DAYS[plParse(d).getDay()]} ${plParse(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`;
};

// ההיקף נגזר מהאנשים: רק אני = אישי, ילד אחד = של הילד, דייט = זוגי, הורה אחר = משפחתי והוא אחראי, כמה אנשים = משפחתי
// pref: ההעדפה של המשתמש עצמו למשימה בלי שמות ('personal' / 'family'). אין ברירת מחדל של האפליקציה:
// כל עוד המשתמש לא בחר, מוחזר needsPref והשורה שואלת אותו פעם אחת
function tdDeriveOwner(d, me, members, isChild, pref) {
  const ppl = d.people.filter((x, i, a) => a.indexOf(x) === i);
  const mem = id => members.find(m => m.id === id);
  let o;
  if (isChild) o = { scope: 'personal', personId: me.id, personKind: 'child' };
  else if (d.tag === 'date') o = { scope: 'couple', personId: null, personKind: null };
  else if (!ppl.length && d.kind === 'task') {
    o = pref === 'family' ? { scope: 'family', personId: null, personKind: null } : { scope: 'personal', personId: me.id, personKind: me.kind };
    if (!pref && !d.scopeOv) o.needsPref = true;
  }
  else if (!ppl.length) o = { scope: 'family', personId: null, personKind: null };
  else if (ppl.length === 1 && ppl[0] === me.id) o = { scope: 'personal', personId: me.id, personKind: me.kind };
  else if (ppl.length === 1 && mem(ppl[0]) && mem(ppl[0]).kind === 'child') o = { scope: 'personal', personId: ppl[0], personKind: 'child' };
  else {
    const lead = ppl.map(mem).filter(Boolean).find(m => m.kind === 'child') || mem(ppl[0]);
    o = { scope: 'family', personId: lead ? lead.id : null, personKind: lead ? lead.kind : null };
  }
  if (!d.scopeOv || d.scopeOv === o.scope) return o;
  // תיקון ידני של ההיקף בצ'יפ
  if (d.scopeOv === 'personal') return o.scope === 'personal' ? o : { scope: 'personal', personId: isChild || !o.personId || mem(o.personId)?.kind === 'parent' ? me.id : o.personId, personKind: isChild ? 'child' : o.personId && mem(o.personId)?.kind === 'child' ? 'child' : me.kind };
  if (d.scopeOv === 'couple') return { scope: 'couple', personId: o.personId && mem(o.personId)?.kind === 'parent' ? o.personId : null, personKind: o.personId && mem(o.personId)?.kind === 'parent' ? 'parent' : null };
  return { scope: 'family', personId: o.personId, personKind: o.personKind };
}

/* ---- התראות לעמוד הראשי (הורים): חוג היום/מחר בלי מסיע, ושני אירועים חופפים שכל אחד צריך הורה ---- */
function tdRideAlerts(planner, me) {
  if (!planner.ready || planner.unavailable) return [];
  const today = plToday(), out = [];
  [today, plAddDays(today, 1)].forEach(day => {
    planner.events.filter(e => e.kind === 'class' && plVisible(e, me, false) && plEventOn(e, day) && (!e.driveTo || !e.driveFrom)).forEach(e => {
      const kid = e.personId ? tdNameOf(planner.members, e.personId) : '';
      const miss = !e.driveTo && !e.driveFrom ? 'אין מי שמסיע' : !e.driveTo ? 'אין מי שמסיע הלוך' : 'אין מי שמחזיר';
      out.push({ id: `ride-${e.id}-${day}`, level: day === today ? 'danger' : 'warn', tab: 'today',
        text: `🚗 ${e.title}${kid ? ` של ${kid}` : ''} ${day === today ? 'היום' : 'מחר'}${e.startTime ? ` ב-${plTime(e.startTime)}` : ''}: ${miss}` });
    });
  });
  planConflicts(planner, me, 2).forEach(c => out.push({ id: `clash-${c.a.id}-${c.b.id}-${c.day}`, level: 'warn', tab: 'today',
    text: `⚠️ ${c.day === today ? 'היום' : 'מחר'} ב-${plTime(c.a.startTime)}: ${c.a.title} וגם ${c.b.title} באותה שעה` }));
  return out;
}

// אירוע דומה שכבר קיים באותו יום (למשל כותבים שוב "נועה כדורגל" כשהחוג כבר בלו"ז)
function tdSimilarEvent(planner, d) {
  if (!d || d.kind !== 'event' || !d.date) return null;
  const norm = s => String(s || '').replace(/^(חוג|שיעור)\s+/, '').trim();
  const t = norm(d.title);
  if (t.length < 2) return null;
  return planner.events.find(e => plEventOn(e, d.date) && (norm(e.title).includes(t) || t.includes(norm(e.title)))
    && (!d.people.length || !e.personId || d.people.includes(e.personId))) || null;
}

/* ---- העדפה אישית: למי שייכת משימה בלי שמות. נשמרת לכל פרופיל בנפרד (במכשיר) ---- */
const tdPrefKey = id => 'homey_task_default_' + id;
const tdGetPref = id => { try { return localStorage.getItem(tdPrefKey(id)); } catch (_e) { return null; } };
const tdSetPref = (id, v) => { try { localStorage.setItem(tdPrefKey(id), v); } catch (_e) {} window.dispatchEvent(new CustomEvent('homey-task-pref')); };
function useTdPref(id) {
  const [p, setP] = useState(() => tdGetPref(id));
  useEffect(() => {
    setP(tdGetPref(id));
    const f = () => setP(tdGetPref(id));
    window.addEventListener('homey-task-pref', f);
    return () => window.removeEventListener('homey-task-pref', f);
  }, [id]);
  return p;
}
const TD_PREF_OPTS = [['personal', '🔒 רק אני רואה'], ['family', '🏠 כל המשפחה רואה']];
// להגדרות ("כלליות"): שינוי ההעדפה בכל רגע
function TaskScopeSetting({ meId }) {
  const pref = useTdPref(meId);
  return React.createElement('div', null,
    React.createElement('p', { className: 'text-sm', style: { color: 'var(--text)' } }, 'משימה חדשה בלי שם של אף אחד'),
    React.createElement('p', { className: 'text-xs mb-2', style: { color: 'var(--text-dim)' } }, 'מי יראה אותה כשכותבים בשורת ההוספה המהירה. ההגדרה שלך בלבד, בכל משימה אפשר לשנות בהקשה על הצ\'יפ.'),
    React.createElement('div', { className: 'flex gap-2' }, TD_PREF_OPTS.map(([k, l]) => React.createElement('button', { key: k, type: 'button', 'aria-pressed': pref === k, onClick: () => tdSetPref(meId, k),
      className: 'ent-pill-btn px-4 py-2 text-sm flex-1', style: { background: pref === k ? 'var(--bronze)' : 'var(--navy-panel-2)', color: pref === k ? 'var(--on-accent)' : 'var(--text-2)', border: '1px solid var(--line)' } }, l))));
}

/* ---- "ביטול" אחרי כל פעולה: פס קטן בתחתית המסך ל-6 שניות ---- */
function useTdUndo() {
  const [u, setU] = useState(null);
  const timer = useRef(null);
  const push = (text, undo) => {
    clearTimeout(timer.current);
    setU({ text, undo, k: Date.now() });
    timer.current = setTimeout(() => setU(null), 6000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = u && React.createElement('div', { key: u.k, className: 'td-snack', role: 'status' },
    React.createElement('span', { className: 'flex-1 min-w-0 truncate' }, u.text),
    u.undo && React.createElement('button', { type: 'button', className: 'td-snack-undo', onClick: () => { clearTimeout(timer.current); setU(null); u.undo(); } }, 'ביטול'));
  return [node, push];
}

/* ======================= שורת ההוספה המהירה ======================= */
// defaultDate: לאן נכנסת משימה בלי תאריך (במסך "היום" = היום, ב"בלי תאריך" = בלי)
function QuickAdd({ planner, shop, me, isChild, notesApi, defaultDate, pushUndo, autoFocus }) {
  const [text, setText] = useState('');
  const [ov, setOv] = useState({});
  const [busy, setBusy] = useState(false);
  const [ex, setEx] = useState(0);
  const [askPulse, setAskPulse] = useState(0);
  const pref = useTdPref(me.id);
  const inputRef = useRef(null);
  useEffect(() => { const t = setInterval(() => setEx(i => (i + 1) % TD_EXAMPLES.length), 4000); return () => clearInterval(t); }, []);
  const today = plToday();
  const members = planner.members;
  // שם מלא וגם שם פרטי ("איתמר הורביץ" / "איתמר"), כדי שהמפרש יזהה את שניהם
  const ctxMembers = members.flatMap(m => tdFirst(m.name) && tdFirst(m.name) !== m.name ? [m, { ...m, name: tdFirst(m.name) }] : [m]);
  const p = text.trim() ? hpParse(text, { today, meId: me.id, members: ctxMembers }) : null;

  const d = p && (() => {
    const kind = ov.kind || p.kind;
    const people = (ov.people || p.people).filter((x, i, a) => a.indexOf(x) === i);
    const tag = ov.tag !== undefined ? ov.tag : p.tag;
    const time = ov.time !== undefined ? ov.time : p.time;
    let date = ov.date !== undefined ? ov.date : p.date;
    if (ov.date === undefined && !p.date) date = kind === 'event' ? today : kind === 'task' ? defaultDate : null;
    if (kind === 'event' && !date) date = today;
    const repeat = ov.repeat || p.repeat;
    const base = { kind, people, tag, time, date, repeat, title: p.title || text.trim(), items: p.items, altTime: ov.time !== undefined ? null : p.altTime, scopeOv: ov.scope };
    return { ...base, owner: tdDeriveOwner(base, me, members, isChild, pref) };
  })();

  const set = (k, v) => setOv(o => ({ ...o, [k]: v }));
  const reset = () => { setText(''); setOv({}); };
  const cycle = (k, list, cur) => set(k, list[(list.indexOf(cur) + 1) % list.length]);

  const save = async () => {
    if (!d || busy) return;
    // עוד לא בחר למי שייכת משימה בלי שמות: לא שומרים בשבילו, מבקשים לבחור (פעם אחת)
    if (d.kind === 'task' && d.owner.needsPref) { setAskPulse(n => n + 1); return; }
    if (!d.title && d.kind !== 'shopping') return;
    setBusy(true);
    try {
      if (d.kind === 'shopping') {
        if (!shop || !shop.ready || shop.unavailable) { pushUndo('רשימת הקניות עוד לא זמינה'); return; }
        const list = shop.lists.find(l => l.kind === 'grocery') || shop.lists[0];
        if (!list) { pushUndo('אין עדיין רשימת קניות. פתחו אחת ב"קניות ומטבח"'); return; }
        const names = d.items && d.items.length ? d.items : [d.title];
        const saved = [];
        for (const name of names) { const s = await shop.addItem(list.id, { name }); if (s) saved.push(s.id); }
        if (saved.length) pushUndo(`🛒 נוסף לרשימת הקניות: ${names.join(', ')}`, () => shop.removeItems(saved));
      } else if (d.kind === 'note') {
        const id = await notesApi.add(d.title);
        if (id) pushUndo('📝 נשמר בפתקים ("בלי תאריך")', () => notesApi.remove(id, true));
      } else {
        // אירוע לא חוזר כל יום (אין לזה עמודה): "כל יום" עם שעה נשמר כמשימה יומית עם שעה
        const asTask = d.kind === 'task' || d.repeat === 'daily';
        const o = d.owner;
        if (asTask) {
          const s = await planner.addTask({ title: d.title, scope: o.scope, personId: o.personId, personKind: o.personKind, dueDate: d.date, dueTime: d.time, repeat: d.repeat });
          if (s) pushUndo(`✅ ${d.title} · ${d.date ? tdDayLabel(d.date) : 'בלי תאריך'}`, () => planner.deleteTask(s, true));
        } else {
          const s = await planner.addEvent({ title: d.title, kind: d.tag || 'general', scope: o.scope, personId: o.personId, personKind: o.personKind, startDate: d.date, startTime: d.time, repeat: d.repeat === 'weekly' ? 'weekly' : 'none' });
          if (s) pushUndo(`📅 ${d.title} · ${tdDayLabel(d.date)}${d.time ? ' ' + d.time : ''}${d.repeat === 'weekly' ? ' · כל שבוע' : ''}`, () => planner.deleteEvent(s, true));
        }
      }
      reset();
      if (inputRef.current) inputRef.current.focus();
    } finally { setBusy(false); }
  };
  const toAssistant = () => {
    window.dispatchEvent(new CustomEvent('homey-assistant', { detail: { text: text.trim() } }));
    reset();
  };

  const chip = (key, content, onClick, extra) => React.createElement('button', { key, type: 'button', className: 'td-chip' + (extra && extra.dim ? ' dim' : ''), onClick, title: extra && extra.title, style: extra && extra.color ? { '--chip': extra.color } : null }, content);
  const dateChip = d && (d.kind === 'task' || d.kind === 'event') && React.createElement('label', { key: 'date', className: 'td-chip' + (d.date ? '' : ' dim') },
    '📆 ', d.date ? tdDayLabel(d.date) : 'בלי תאריך',
    React.createElement('input', { type: 'date', className: 'td-chip-input', value: d.date || '', 'aria-label': 'תאריך', onChange: e => set('date', e.target.value || null) }));
  const timeChip = d && (d.kind === 'event' || d.time) && React.createElement('label', { key: 'time', className: 'td-chip' + (d.time ? '' : ' dim') },
    '🕐 ', d.time || 'שעה?',
    React.createElement('input', { type: 'time', className: 'td-chip-input', value: d.time || '', 'aria-label': 'שעה', onChange: e => set('time', e.target.value || null) }));
  const parents = members.filter(m => m.kind === 'parent');
  const addable = members.filter(m => !d || !d.people.includes(m.id));

  return React.createElement('div', { className: 'td-quick ent-card' },
    React.createElement('div', { className: 'flex items-center gap-2' },
      React.createElement('span', { className: 'td-quick-plus', 'aria-hidden': 'true' }, React.createElement(IPlus, { size: 18 })),
      React.createElement('input', { ref: inputRef, className: 'td-quick-input', value: text, autoFocus, 'aria-label': 'הוספה מהירה: משימה, אירוע, קניות או פתק',
        placeholder: `למשל: ${TD_EXAMPLES[ex]}`, onChange: e => { setText(e.target.value); if (!e.target.value.trim()) setOv({}); },
        onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') reset(); } }),
      d && React.createElement('button', { type: 'button', className: 'ent-pill-btn solid-bronze px-4 py-2 text-sm', disabled: busy, onClick: save }, busy ? '...' : 'הוספה')),
    d && React.createElement('div', { className: 'td-chips', 'aria-label': 'מה הבנתי. הקשה על צ\'יפ משנה אותו' },
      chip('kind', `${TD_KIND[d.kind].icon} ${TD_KIND[d.kind].label}`, () => cycle('kind', ['task', 'event', 'shopping', 'note'], d.kind), { title: 'הקשה מחליפה סוג' }),
      d.kind === 'shopping' && (d.items && d.items.length ? d.items : [d.title]).map((n, i) => React.createElement('span', { key: 'it' + i, className: 'td-chip static' }, n)),
      dateChip, timeChip,
      d.altTime && chip('alt', `או ${d.altTime}?`, () => set('time', d.altTime), { dim: true, title: 'החלפה לשעה בבוקר' }),
      d.kind === 'event' && chip('tag', `${TD_TAG[d.tag || 'general'].icon} ${TD_TAG[d.tag || 'general'].label}`, () => cycle('tag', [null, 'class', 'meeting', 'date'], d.tag || null), { dim: !d.tag }),
      (d.kind === 'task' || d.kind === 'event') && chip('rep', d.repeat === 'weekly' ? '↻ כל שבוע' : d.repeat === 'daily' ? '↻ כל יום' : '↻ פעם אחת', () => cycle('repeat', ['none', 'weekly', 'daily'], d.repeat), { dim: d.repeat === 'none' }),
      (d.kind === 'task' || d.kind === 'event') && !isChild && d.people.map(id => chip('p' + id, React.createElement(React.Fragment, null, React.createElement(InitialAvatar, { name: tdNameOf(members, id), size: 16 }), ' ', tdNameOf(members, id), ' ×'),
        () => set('people', d.people.filter(x => x !== id)), { color: tdColorOf(members, id), title: 'הסרה' })),
      (d.kind === 'task' || d.kind === 'event') && !isChild && addable.length > 0 && React.createElement('label', { key: 'addp', className: 'td-chip dim' }, '+ מי?',
        React.createElement('select', { className: 'td-chip-input', value: '', 'aria-label': 'להוסיף אדם', onChange: e => e.target.value && set('people', [...d.people, e.target.value]) },
          React.createElement('option', { value: '' }, 'מי?'), addable.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name)))),
      (d.kind === 'task' || d.kind === 'event') && !isChild && !d.owner.needsPref && chip('scope',d.owner.scope === 'personal' ? (d.owner.personId === me.id ? '🔒 רק לי' : `🔒 של ${tdNameOf(members, d.owner.personId)}`) : TD_SCOPE[d.owner.scope],
        () => cycle('scope', parents.length > 1 ? ['personal', 'family', 'couple'] : ['personal', 'family'], d.owner.scope), { title: 'מי רואה את זה' }),
      React.createElement('button', { key: 'ai', type: 'button', className: 'td-chip ai', onClick: toAssistant, title: 'לשלוח את המשפט לעוזר החכם' }, '✨ לעוזר')),
    d && (() => {
      const dup = tdSimilarEvent(planner, d);
      return dup && React.createElement('p', { key: 'dup', className: 'text-xs mt-2', style: { color: 'var(--neg-soft)' } },
        `כבר יש בלו"ז: ${dup.title}${dup.personId ? ` (${tdNameOf(members, dup.personId)})` : ''} ${tdDayLabel(d.date)}${dup.startTime ? ' ' + plTime(dup.startTime) : ''}${dup.repeat === 'weekly' ? ', כל שבוע' : ''}. להוסיף בכל זאת?`);
    })(),
    // שאלה חד-פעמית לכל משתמש: למי שייכת משימה בלי שמות. התשובה נשמרת כהעדפה שלו (אפשר לשנות בהגדרות)
    d && d.kind === 'task' && d.owner.needsPref && React.createElement('div', { key: 'ask' + askPulse, className: 'td-ask' + (askPulse ? ' pulse' : ''), role: 'group', 'aria-label': 'למי שייכת משימה בלי שמות' },
      React.createElement('p', { className: 'text-sm font-semibold' }, 'משימה בלי שם של אף אחד: מי יראה אותה?'),
      React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, 'בוחרים פעם אחת וזו תהיה ההגדרה שלך. אפשר לשנות בהגדרות, ובכל משימה בהקשה על הצ\'יפ.'),
      React.createElement('div', { className: 'flex gap-2 mt-2' }, TD_PREF_OPTS.map(([k, l]) => React.createElement('button', { key: k, type: 'button', className: 'ent-pill-btn ghost px-4 py-2 text-sm flex-1',
        onClick: () => { tdSetPref(me.id, k); if (inputRef.current) inputRef.current.focus(); } }, l)))));
}

/* ---- שורת ההוספה בעמוד הראשי: "+" אחד מכל מקום, עם ביטול משלה ---- */
function HubQuickAdd({ planner, shop, me, isChild, notesApi }) {
  const [undoNode, pushUndo] = useTdUndo();
  return React.createElement(React.Fragment, null,
    React.createElement(QuickAdd, { planner, shop, me, isChild, notesApi, defaultDate: plToday(), pushUndo }),
    undoNode);
}

/* ---- שורה של פריט (אירוע / משימה) ---- */
function TdItem({ it, planner, me, isChild, open, onToggle, pushUndo, conflict, compact, draggable }) {
  const members = planner.members;
  const today = plToday();
  const color = tdItemColor(members, it.src);
  const who = it.src.personId && it.src.personId !== me.id ? tdNameOf(members, it.src.personId) : it.src.scope === 'couple' ? 'שניכם' : null;
  const isTask = it.type === 'task';
  const done = isTask && it.src.status === 'done';
  const late = isTask && !done && it.src.dueDate && it.src.dueDate < today;
  const kindIcon = isTask ? '' : (TD_TAG[it.src.kind] || TD_TAG.general).icon + ' ';
  const del = () => {
    if (isTask) { planner.deleteTask(it.src, true); pushUndo(`נמחק: ${it.src.title}`, () => planner.addTask(it.src)); }
    else { planner.deleteEvent(it.src, true); pushUndo(`נמחק מהלו"ז: ${it.src.title}`, () => planner.addEvent(it.src)); }
  };
  const move = (date, label) => { const prev = it.src.dueDate; planner.updateTask(it.src, { dueDate: date }); pushUndo(`הועבר ל${label}: ${it.src.title}`, () => planner.updateTask(it.src, { dueDate: prev })); };
  const toggle = () => { planner.toggleTask(it.src); };
  return React.createElement('div', { className: 'td-item' + (done ? ' is-done' : '') + (compact ? ' compact' : ''), style: { '--who': color },
    draggable: !!draggable && isTask, onDragStart: e => { e.dataTransfer.setData('text/homey-task', it.src.id); e.dataTransfer.effectAllowed = 'move'; } },
    React.createElement('div', { className: 'td-item-main' },
      !compact && React.createElement('span', { className: 'td-time' }, it.time ? plTime(it.time) : ''),
      React.createElement('span', { className: 'td-bar', 'aria-hidden': 'true' }),
      React.createElement('button', { type: 'button', className: 'td-item-body', 'aria-expanded': open, onClick: onToggle },
        React.createElement('span', { className: 'td-item-title pl-task-title' }, compact && it.time ? plTime(it.time) + ' ' : '', kindIcon, it.src.title),
        React.createElement('span', { className: 'td-item-meta' },
          who && React.createElement('span', { style: { color } }, who),
          !isTask && it.src.endTime && React.createElement('span', null, `עד ${plTime(it.src.endTime)}`),
          (it.src.repeat === 'weekly' || it.src.repeat === 'daily') && React.createElement('span', null, it.src.repeat === 'daily' ? '↻ כל יום' : '↻ כל שבוע'),
          late && React.createElement('span', { style: { color: 'var(--neg)' } }, `באיחור · ${plDueLabel(it.src.dueDate)}`),
          !isTask && it.src.kind === 'class' && !isChild && (!it.src.driveTo || !it.src.driveFrom) && React.createElement('span', { style: { color: 'var(--neg-soft)' } }, '🚗 חסר מסיע'),
          conflict && React.createElement('span', { style: { color: 'var(--neg-soft)' } }, `⚠️ חופף ל${conflict}`))),
      isTask && React.createElement(PlCheck, { done, onClick: toggle, label: done ? `לבטל סימון: ${it.src.title}` : `סימון כבוצע: ${it.src.title}` })),
    open && React.createElement('div', { className: 'td-item-more' },
      !isTask && it.src.location && React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, '📍 ', it.src.location),
      !isTask && it.src.kind === 'class' && !isChild && React.createElement(React.Fragment, null,
        React.createElement(RideSelect, { planner, ev: it.src, field: 'driveTo', label: 'הלוך' }),
        React.createElement(RideSelect, { planner, ev: it.src, field: 'driveFrom', label: 'חזור' })),
      isTask && !done && it.src.dueDate !== today && React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', onClick: () => move(today, 'היום') }, 'להיום'),
      isTask && !done && React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', onClick: () => move(plAddDays(it.src.dueDate && it.src.dueDate > today ? it.src.dueDate : today, 1), 'מחר') }, 'יום אחד קדימה'),
      isTask && !done && it.src.dueDate && React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', onClick: () => move(null, '"בלי תאריך"') }, 'בלי תאריך'),
      !isTask && React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', onClick: () => plDownloadIcs(it.src) }, 'ליומן בטלפון'),
      React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', style: { color: 'var(--neg)' }, onClick: del }, !isTask && it.src.repeat === 'weekly' ? 'מחיקה (כל השבועות)' : 'מחיקה')));
}

/* ======================= המסך "היום | שבוע" ======================= */
function TodayPage({ planner, ch, extras, shop, me, isChild, isPremium, onUpgrade, onNavigate, notesApi }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem('homey_today_view') || 'today'; } catch (_e) { return 'today'; } });
  const [person, setPerson] = useState('all');
  const [openKey, setOpenKey] = useState(null);
  const [offset, setOffset] = useState(0);
  const [dragDay, setDragDay] = useState(null);
  const [undoNode, pushUndo] = useTdUndo();
  const pickView = v => { setView(v); try { localStorage.setItem('homey_today_view', v); } catch (_e) {} };

  if (!isPremium) return React.createElement(PremiumLock, { title: 'משימות ולו"ז הם תכונת פרימיום', desc: 'מסך אחד לכל הבית: מה יש היום, מי מסיע, מה באיחור, ושורת הוספה שמבינה עברית.', onUpgrade });
  if (!planner.ready) return React.createElement('div', { className: 'ent-card p-6' }, 'טוען...');
  if (planner.unavailable) return React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המערך עוד לא הופעל בשרת. יש להריץ את tasks-schedule.sql ב-Supabase.');

  const today = plToday();
  const members = planner.members;
  const kids = members.filter(m => m.kind === 'child');
  const pm = members.find(m => m.id === person);
  const forPerson = x => person === 'all' || x.personId === person || x.driveTo === person || x.driveFrom === person
    || (!x.personId && x.scope === 'family') || (x.scope === 'couple' && pm && pm.kind === 'parent');
  const pass = x => plVisible(x, me, isChild) && forPerson(x);
  // ילד רואה רק משימות שלו (משימה משפחתית של ההורים, כמו "לחדש ביטוח רכב", היא רעש בשבילו). אירועים משפחתיים כן מוצגים
  const tasks = planner.tasks.filter(t => pass(t) && (!isChild || t.personId === me.id));
  const events = planner.events.filter(pass);
  const itemsOn = (day, withDone) => [
    ...events.filter(e => plEventOn(e, day)).map(e => ({ key: 'e' + e.id + day, type: 'event', time: e.startTime, src: e })),
    ...tasks.filter(t => t.dueDate === day && (withDone || t.status !== 'done' || (t.doneAt && plIso(new Date(t.doneAt)) === today))).map(t => ({ key: 't' + t.id, type: 'task', time: t.dueTime, src: t }))
  ].sort((a, b) => (toMinutes(a.time) ?? 9999) - (toMinutes(b.time) ?? 9999));
  // התנגשויות: רק להורים, ורק לאירועים שצריכים הורה
  const conflicts = isChild ? [] : planConflicts(planner, me, offset === 0 ? 7 : 7 + offset * 7);
  const conflictOf = (e, day) => {
    const c = conflicts.find(x => x.day === day && (x.a.id === e.id || x.b.id === e.id));
    return c ? (c.a.id === e.id ? c.b.title : c.a.title) : null;
  };
  const row = (it, day, extra) => React.createElement(TdItem, { key: it.key, it, planner, me, isChild, pushUndo, open: openKey === it.key, onToggle: () => setOpenKey(openKey === it.key ? null : it.key),
    conflict: it.type === 'event' ? conflictOf(it.src, day) : null, ...extra });

  // ---- סינון לפי אדם (הורים) ----
  const personBar = !isChild && members.length > 1 && React.createElement('div', { className: 'td-people', role: 'group', 'aria-label': 'להציג את הלו"ז של' },
    [{ id: 'all', name: 'כולם' }, ...members].map(m => React.createElement('button', { key: m.id, type: 'button', 'aria-pressed': person === m.id, onClick: () => setPerson(m.id),
      className: 'td-person' + (person === m.id ? ' on' : ''), style: { '--who': m.id === 'all' ? 'var(--bronze)' : tdColorOf(members, m.id) } },
      m.id !== 'all' && React.createElement('span', { className: 'td-person-dot', 'aria-hidden': 'true' }), m.id === me.id ? 'אני' : tdFirst(m.name))));

  const header = React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-3' },
    React.createElement('div', null,
      React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-muted)' } }, plParse(today).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })),
      React.createElement('h2', { className: 'ent-heading text-2xl font-bold' }, view === 'today' ? (isChild ? 'היום שלי' : 'היום בבית') : 'השבוע')),
    React.createElement('div', { className: 'td-seg', role: 'tablist', 'aria-label': 'תצוגה' }, [['today', 'היום'], ['week', 'שבוע']].map(([k, l]) =>
      React.createElement('button', { key: k, type: 'button', role: 'tab', 'aria-selected': view === k, className: view === k ? 'on' : '', onClick: () => pickView(k) }, l))));

  const quick = React.createElement(QuickAdd, { planner, shop, me, isChild, notesApi, defaultDate: today, pushUndo });
  const section = (key, title, body, extra) => React.createElement('section', { key, className: 'ent-card p-4 sm:p-5 td-section', 'aria-label': typeof title === 'string' ? title : undefined },
    React.createElement('div', { className: 'flex items-center justify-between gap-2 mb-2' }, React.createElement('h3', { className: 'td-h' }, title), extra || null), body);

  /* ---------- היום ---------- */
  if (view === 'today') {
    const overdue = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const all = itemsOn(today);
    const timed = all.filter(it => it.time || it.type === 'event');
    const todo = all.filter(it => !it.time && it.type === 'task');
    const chOk = ch && ch.ready && !ch.unavailable;
    const runs = chOk ? ch.runs.filter(r => r.date === today && (isChild ? r.childId === me.id : person === 'all' || r.childId === person)) : [];
    const exOk = extras && extras.ready && !extras.unavailable;
    const rk = routineNow();
    const routines = exOk ? extras.routines.filter(r => r.active && r.items.length && r.kind === rk && (isChild ? r.childId === me.id : person === 'all' || r.childId === person)) : [];
    const tomorrow = itemsOn(plAddDays(today, 1));
    const sw = syncWeekStart();
    const syncDone = exOk && (extras.syncs.find(s => s.weekStart === sw) || {}).completedAt;
    const showSync = !isChild && exOk && new Date().getDay() >= 5 && !syncDone;
    const moveAll = () => {
      const t1 = plAddDays(today, 1);
      const prev = overdue.map(t => ({ t, d: t.dueDate }));
      planner.updateTask(overdue, { dueDate: t1 });
      pushUndo(`${overdue.length === 1 ? 'משימה אחת הועברה' : `${overdue.length} משימות הועברו`} למחר`, () => prev.forEach(p => planner.updateTask(p.t, { dueDate: p.d })));
    };
    const choreRow = r => {
      const c = ch.chores.find(x => x.id === r.choreId) || { title: 'מטלה', icon: '⭐' };
      const kidN = tdNameOf(members, r.childId);
      return React.createElement('div', { key: 'r' + r.id, className: 'td-item' + (r.status === 'approved' ? ' is-done' : ''), style: { '--who': tdColorOf(members, r.childId) } },
        React.createElement('div', { className: 'td-item-main' },
          React.createElement('span', { className: 'td-time' }, ''),
          React.createElement('span', { className: 'td-bar', 'aria-hidden': 'true' }),
          React.createElement('div', { className: 'td-item-body' },
            React.createElement('span', { className: 'td-item-title pl-task-title' }, c.icon, ' ', c.title),
            React.createElement('span', { className: 'td-item-meta' }, !isChild && React.createElement('span', { style: { color: tdColorOf(members, r.childId) } }, kidN), React.createElement('span', { style: { color: '#fbbf24' } }, `+${r.points} ⭐`),
              r.status === 'done' && React.createElement('span', null, isChild ? 'מחכה לאישור' : 'סיים/ה, מחכה לאישור שלכם'))),
          isChild ? (r.status === 'todo' ? React.createElement('button', { className: 'ent-pill-btn solid-bronze px-3 py-1.5 text-xs', onClick: async () => { await ch.markDone(r); celebrate(); } }, 'סיימתי!')
              : r.status === 'done' ? React.createElement('button', { className: 'text-xs underline', style: { color: 'var(--text-dim)' }, onClick: () => ch.unmark(r) }, 'עוד לא') : React.createElement('span', { style: { color: 'var(--pos)' } }, '✓'))
            : r.status === 'done' ? React.createElement('button', { className: 'ent-pill-btn solid-bronze px-3 py-1.5 text-xs', onClick: () => ch.approve(r) }, 'לאשר')
            : r.status === 'approved' ? React.createElement('span', { style: { color: 'var(--pos)' }, 'aria-label': 'אושר' }, '✓') : React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, 'עוד לא')));
    };
    const empty = !overdue.length && !timed.length && !todo.length && !runs.length && !routines.length;
    return React.createElement('div', { className: 'space-y-4 td-page' },
      header, quick, personBar,
      overdue.length > 0 && section('overdue', React.createElement('span', { style: { color: 'var(--neg)' } }, `באיחור (${overdue.length})`),
        overdue.map(t => row({ key: 't' + t.id, type: 'task', time: t.dueTime, src: t }, t.dueDate)),
        React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: moveAll }, 'להעביר הכול למחר')),
      timed.length > 0 && section('timeline', 'ציר הזמן', React.createElement('div', { className: 'td-list' }, timed.map(it => row(it, today)))),
      (todo.length > 0 || runs.length > 0) && section('todo', 'לעשות היום', React.createElement('div', { className: 'td-list' }, todo.map(it => row(it, today)), runs.map(choreRow)),
        !isChild && runs.length > 0 ? React.createElement('button', { className: 'text-xs underline', style: { color: 'var(--text-muted)' }, onClick: () => onNavigate('kids') }, 'ניהול מטלות') : null),
      routines.length > 0 && section('routines', rk === 'morning' ? '☀️ שגרת בוקר' : '🌙 שגרת ערב', React.createElement('div', { className: 'td-list' }, routines.map(r => {
        const c = extras.checkOf(r.id, today);
        const n = c ? r.items.filter(i => c.doneItems.includes(i.id)).length : 0;
        return React.createElement('button', { key: r.id, type: 'button', className: 'td-routine', style: { '--who': tdColorOf(members, r.childId) }, onClick: () => onNavigate('kids') },
          React.createElement('span', { className: 'flex-1 text-right font-semibold text-sm' }, isChild ? `${n} מתוך ${r.items.length} סומנו` : tdNameOf(members, r.childId)),
          React.createElement('span', { className: 'td-routine-bar', 'aria-hidden': 'true' }, React.createElement('span', { style: { width: `${Math.round(n / r.items.length * 100)}%` } })),
          React.createElement('span', { className: 'text-xs font-bold', style: { color: n === r.items.length ? 'var(--pos)' : 'var(--text-muted)' } }, n === r.items.length ? '✓' : `${n}/${r.items.length}`));
      }))),
      showSync && React.createElement('button', { className: 'ent-card w-full p-4 text-right flex items-center justify-between gap-3 plan-sync-cta', onClick: () => onNavigate('sync') },
        React.createElement('div', null,
          React.createElement('p', { className: 'font-bold' }, '💑 ישיבת השבוע שלכם'),
          React.createElement('p', { className: 'text-sm mt-0.5', style: { color: 'var(--text-muted)' } }, '10 דקות ביחד לתכנן את השבוע הבא')),
        React.createElement('span', { className: 'text-sm font-bold', style: { color: 'var(--bronze)' } }, 'להתחיל ←')),
      empty && React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: 'אין כלום להיום. יום רגוע', hint: 'כתבו למעלה מה צריך לקרות, ואני כבר אסדר לאן זה שייך' })),
      tomorrow.length > 0 && React.createElement('button', { type: 'button', className: 'td-peek', onClick: () => pickView('week') },
        React.createElement('b', null, 'מחר: '),
        tomorrow.slice(0, 3).map(it => `${it.time ? plTime(it.time) + ' ' : ''}${it.src.title}`).join(' · '),
        tomorrow.length > 3 ? ` ועוד ${tomorrow.length - 3}` : '', ' ←'),
      undoNode);
  }

  /* ---------- שבוע ---------- */
  const ws = plAddDays(plWeekStart(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => plAddDays(ws, i));
  const label = offset === 0 ? 'השבוע' : offset === 1 ? 'שבוע הבא' : offset === -1 ? 'שבוע שעבר' : `${plParse(ws).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} - ${plParse(days[6]).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}`;
  const tray = tasks.filter(t => t.status !== 'done' && (!t.dueDate || t.dueDate < today));
  const dropTo = day => e => {
    e.preventDefault();
    setDragDay(null);
    const id = e.dataTransfer.getData('text/homey-task');
    const t = planner.tasks.find(x => x.id === id);
    if (!t || t.dueDate === day) return;
    const prev = t.dueDate;
    planner.updateTask(t, { dueDate: day });
    pushUndo(`הועבר ל${tdDayLabel(day)}: ${t.title}`, () => planner.updateTask(t, { dueDate: prev }));
  };
  return React.createElement('div', { className: 'space-y-4 td-page' },
    header, quick,
    React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
      personBar || React.createElement('span'),
      React.createElement('div', { className: 'flex items-center gap-1.5' },
        React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', 'aria-label': 'שבוע קודם', onClick: () => setOffset(offset - 1) }, '→'),
        React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => setOffset(0), 'aria-label': 'חזרה לשבוע הנוכחי' }, label),
        React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', 'aria-label': 'שבוע הבא', onClick: () => setOffset(offset + 1) }, '←'))),
    React.createElement('div', { className: 'td-week-wrap' },
      React.createElement('div', { className: 'td-week' }, days.map(day => {
        const list = itemsOn(day, true);
        const isToday = day === today;
        return React.createElement('div', { key: day, className: 'td-day ent-card' + (isToday ? ' today' : '') + (dragDay === day ? ' drop' : '') + (!list.length ? ' empty' : ''),
          onDragOver: e => { e.preventDefault(); if (dragDay !== day) setDragDay(day); }, onDragLeave: () => setDragDay(d => d === day ? null : d), onDrop: dropTo(day) },
          React.createElement('div', { className: 'td-day-head' },
            React.createElement('b', null, PL_DAYS[plParse(day).getDay()]),
            React.createElement('span', { style: { color: isToday ? 'var(--bronze)' : 'var(--text-dim)' } }, isToday ? 'היום' : plParse(day).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }))),
          !list.length ? React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, 'פנוי') :
            list.map(it => row(it, day, { compact: true, draggable: true })));
      })),
      tray.length > 0 && React.createElement('aside', { className: 'td-tray ent-card', 'aria-label': 'לשבץ בשבוע' },
        React.createElement('h3', { className: 'td-h mb-1' }, 'לשבץ'),
        React.createElement('p', { className: 'text-xs mb-2', style: { color: 'var(--text-muted)' } }, 'באיחור או בלי תאריך. במחשב אפשר לגרור ליום.'),
        React.createElement('div', { className: 'td-list' }, tray.map(t => row({ key: 'tray' + t.id, type: 'task', time: null, src: t }, today, { compact: true, draggable: true }))))),
    undoNode);
}

/* ======================= "בלי תאריך": משימות למתישהו + פתקים ======================= */
function InboxPage({ planner, shop, me, isChild, isPremium, onUpgrade, notesApi, children }) {
  const [undoNode, pushUndo] = useTdUndo();
  const [openKey, setOpenKey] = useState(null);
  if (!isPremium) return React.createElement(PremiumLock, { title: 'משימות ולו"ז הם תכונת פרימיום', desc: 'מקום אחד לכל מה שצריך לעשות מתישהו, ולפתקים של הבית.', onUpgrade });
  if (!planner.ready) return React.createElement('div', { className: 'ent-card p-6' }, 'טוען...');
  const list = planner.tasks.filter(t => plVisible(t, me, isChild) && t.status !== 'done' && !t.dueDate);
  return React.createElement('div', { className: 'space-y-4 td-page' },
    React.createElement('div', null,
      React.createElement('h2', { className: 'ent-heading text-2xl font-bold' }, 'בלי תאריך'),
      React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, 'מה שצריך לעשות מתישהו, ופתקים לזכור. כשמחליטים מתי, מעבירים להיום או גוררים בתצוגת השבוע.')),
    React.createElement(QuickAdd, { planner, shop, me, isChild, notesApi, defaultDate: null, pushUndo }),
    React.createElement('section', { className: 'ent-card p-4 sm:p-5' },
      React.createElement('h3', { className: 'td-h mb-2' }, `משימות למתישהו (${list.length})`),
      !list.length ? React.createElement(EmptyState, { text: 'אין משימות בלי תאריך', hint: 'כתבו למעלה, למשל "לחדש דרכון"' }) :
        React.createElement('div', { className: 'td-list' }, list.map(t => React.createElement(TdItem, { key: t.id, it: { key: t.id, type: 'task', time: null, src: t }, planner, me, isChild, pushUndo, compact: true,
          open: openKey === t.id, onToggle: () => setOpenKey(openKey === t.id ? null : t.id) })))),
    children,
    undoNode);
}

/* ======================= "ילדים": מטלות | שגרות | חוגים ======================= */
function KidsPage({ segments, isChild }) {
  const [seg, setSeg] = useState(() => { try { return localStorage.getItem('homey_kids_seg') || segments[0].id; } catch (_e) { return segments[0].id; } });
  const cur = segments.find(s => s.id === seg) || segments[0];
  const pick = id => { setSeg(id); try { localStorage.setItem('homey_kids_seg', id); } catch (_e) {} };
  return React.createElement('div', { className: 'space-y-4' },
    React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-3' },
      React.createElement('h2', { className: 'ent-heading text-2xl font-bold' }, isChild ? 'המטלות שלי' : 'ילדים'),
      React.createElement('div', { className: 'td-seg', role: 'tablist', 'aria-label': 'נושא' }, segments.map(s =>
        React.createElement('button', { key: s.id, type: 'button', role: 'tab', 'aria-selected': cur.id === s.id, className: cur.id === s.id ? 'on' : '', onClick: () => pick(s.id) }, s.label)))),
    cur.el);
}

if (typeof module !== 'undefined') module.exports = { tdDeriveOwner, TAB_ALIASES };
