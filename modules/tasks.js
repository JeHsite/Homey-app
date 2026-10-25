/* Homey — מערך "משימות ולו"ז": משימות לשבוע עם מעקב עמידה בזמנים, ולו"ז שבועי אישי/זוגי/משפחתי.
 * נטען כסקריפט רגיל לפני הסקריפט הראשי של index.html. הפונקציות כאן משתמשות בגלובליים של הסקריפט הראשי
 * (React hooks, sb, אייקונים, DateField, PremiumLock, EmptyState, InitialAvatar) רק בזמן רינדור, אחרי שהכול נטען.
 * טבלאות: tasks, family_events (supabase/tasks-schedule.sql). family_events תשמש גם את מערך הפגישות/דייטים/חוגים. */

const PL_SCOPES = {
  personal: { label: 'אישי', color: 'var(--cyan)' },
  couple: { label: 'זוגי', color: '#f472b6' },
  family: { label: 'משפחתי', color: 'var(--bronze)' }
};
const PL_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const plIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plParse = s => new Date(String(s).slice(0, 10) + 'T00:00:00');
const plAddDays = (s, n) => {
  const d = plParse(s);
  d.setDate(d.getDate() + n);
  return plIso(d);
};
const plToday = () => plIso(new Date());
// ראשון של השבוע שבו נמצא התאריך (השבוע הישראלי מתחיל בראשון)
const plWeekStart = s => plAddDays(s, -plParse(s).getDay());
const plTime = t => t ? String(t).slice(0, 5) : '';

// האם אירוע מתרחש ביום מסוים (חד-פעמי, או שבועי מאותו יום בשבוע ועד repeat_until)
const plEventOn = (ev, day) => {
  if (ev.repeat !== 'weekly') return ev.startDate === day;
  if (day < ev.startDate || ev.repeatUntil && day > ev.repeatUntil) return false;
  return plParse(day).getDay() === plParse(ev.startDate).getDay();
};

// מה מוצג למי: ילד רואה רק את האישי שלו ואת המשפחתי. הורה רואה הכול (אישי של הורה אחר כבר מסונן בשרת)
const plVisible = (item, me, isChild) => {
  if (!isChild) return !(item.scope === 'personal' && item.personKind === 'parent' && item.personId !== me.id);
  if (item.scope === 'couple') return false;
  if (item.scope === 'personal') return item.personId === me.id;
  return true;
};
const plIsMine = (item, me) => item.personId === me.id;

function plDemoData(me) {
  const t = plToday();
  const kid = FAMILY_PROFILES.find(p => p.role === 'child');
  const mk = (id, o) => ({ id, notes: '', dueTime: null, repeat: 'none', status: 'todo', doneAt: null, personKind: null, personId: null, ...o });
  const tasks = [
    mk('dt1', { title: 'לשלם ועד בית', scope: 'family', dueDate: plAddDays(t, -1), personKind: 'parent', personId: 'p1' }),
    mk('dt2', { title: 'להזמין תור לרופא שיניים', scope: 'personal', dueDate: t, personKind: me.kind, personId: me.id }),
    mk('dt3', { title: 'קניות לשבת', scope: 'family', dueDate: plAddDays(t, 1), personKind: 'parent', personId: 'p2', repeat: 'weekly' }),
    mk('dt4', { title: 'לתכנן ערב זוגי', scope: 'couple', dueDate: plAddDays(t, 3) }),
    mk('dt5', { title: 'לסדר את החדר', scope: 'personal', dueDate: t, personKind: 'child', personId: kid ? kid.id : 'p3' }),
    mk('dt6', { title: 'להחזיר ספר לספרייה', scope: 'family', dueDate: plAddDays(t, -2), status: 'done', doneAt: new Date(Date.now() - 3 * 86400000).toISOString() }),
    mk('dt7', { title: 'לחדש ביטוח רכב', scope: 'family', dueDate: null })
  ];
  const ws = plWeekStart(t);
  const ev = (id, o) => ({ id, kind: 'general', notes: '', location: '', scope: 'family', personKind: null, personId: null, startTime: null, endTime: null, repeat: 'none', repeatUntil: null, cost: null, ...o });
  const events = [
    ev('de1', { title: 'ארוחת ערב משפחתית', startDate: plAddDays(ws, 5), startTime: '19:30', repeat: 'weekly' }),
    ev('de2', { title: 'חוג כדורגל', startDate: plAddDays(ws, 1), startTime: '16:30', endTime: '17:30', scope: 'personal', personKind: 'child', personId: kid ? kid.id : 'p3', repeat: 'weekly', kind: 'class' }),
    ev('de3', { title: 'פגישה עם רואה החשבון', startDate: plAddDays(ws, 2), startTime: '10:00', endTime: '11:00', scope: 'personal', personKind: me.kind, personId: me.id, location: 'תל אביב', kind: 'meeting' }),
    ev('de4', { title: 'דייט במסעדה', startDate: plAddDays(ws, 4), startTime: '20:30', scope: 'couple', kind: 'date' })
  ];
  return { tasks, events };
}

const plTaskFromRow = r => ({
  id: r.id, title: r.title, notes: r.notes || '', scope: r.scope, personKind: r.person_kind, personId: r.person_id,
  dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null, dueTime: r.due_time, repeat: r.repeat,
  status: r.status, doneAt: r.done_at
});
const plEventFromRow = r => ({
  id: r.id, kind: r.kind, title: r.title, notes: r.notes || '', location: r.location || '', scope: r.scope,
  personKind: r.person_kind, personId: r.person_id, startDate: String(r.start_date).slice(0, 10), startTime: r.start_time,
  endTime: r.end_time, repeat: r.repeat, repeatUntil: r.repeat_until, cost: r.cost == null ? null : Number(r.cost)
});

/* ---- הנתונים של המערך: נטען פעם אחת כשנכנסים לאפליקציה, משותף לעמוד הראשי ולשתי הלשוניות ---- */
function useFamilyPlanner({ familyId, isDemo, enabled, me, showToast }) {
  const [state, setState] = useState({ ready: false, unavailable: false, tasks: [], events: [], members: [] });
  const meId = me ? me.id : null;
  useEffect(() => {
    if (!enabled || !familyId || !me) return;
    if (isDemo) {
      const d = plDemoData(me);
      setState({ ready: true, unavailable: false, tasks: d.tasks, events: d.events, members: FAMILY_PROFILES.map(p => ({ kind: p.role, id: p.id, name: p.name })) });
      return;
    }
    let alive = true;
    (async () => {
      const [t, e, pr, ch] = await Promise.all([
        sb.from('tasks').select('*').eq('family_id', familyId),
        sb.from('family_events').select('*').eq('family_id', familyId),
        sb.from('profiles').select('id, full_name').eq('family_id', familyId),
        sb.from('children').select('id, name').eq('family_id', familyId)
      ]);
      if (!alive) return;
      setState({
        ready: true,
        // לפני הרצת tasks-schedule.sql הטבלאות לא קיימות
        unavailable: !!(t.error || e.error),
        tasks: (t.data || []).map(plTaskFromRow),
        events: (e.data || []).map(plEventFromRow),
        members: [...(pr.data || []).map(p => ({ kind: 'parent', id: p.id, name: p.full_name || 'הורה' })), ...(ch.data || []).map(k => ({ kind: 'child', id: k.id, name: k.name }))]
      });
    })();
    return () => { alive = false; };
  }, [enabled, familyId, isDemo, meId]);

  const patch = fn => setState(s => ({ ...s, ...fn(s) }));
  const fail = msg => { showToast(msg); return null; };

  const addTask = async t => {
    const row = { title: t.title.trim(), notes: t.notes || '', scope: t.scope, personKind: t.personKind || null, personId: t.personId || null,
      dueDate: t.dueDate || null, dueTime: t.dueTime || null, repeat: t.repeat || 'none', status: 'todo', doneAt: null };
    if (!row.title) return fail('נא לכתוב מה צריך לעשות');
    let id = 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);
    if (!isDemo) {
      const { data, error } = await sb.from('tasks').insert({ family_id: familyId, title: row.title, notes: row.notes || null, scope: row.scope,
        person_kind: row.personKind, person_id: row.personId, due_date: row.dueDate, due_time: row.dueTime, repeat: row.repeat }).select().single();
      if (error) return fail(/premium_required/.test(error.message) ? 'משימות ולו"ז הם תכונת פרימיום' : 'שגיאה בשמירה');
      id = data.id;
    }
    const saved = { ...row, id };
    patch(s => ({ tasks: [...s.tasks, saved] }));
    return saved;
  };

  const toggleTask = async task => {
    const done = task.status !== 'done';
    const doneAt = done ? new Date().toISOString() : null;
    patch(s => ({ tasks: s.tasks.map(x => x.id === task.id ? { ...x, status: done ? 'done' : 'todo', doneAt } : x) }));
    if (!isDemo) await sb.from('tasks').update({ status: done ? 'done' : 'todo', done_at: doneAt }).eq('id', task.id);
    // משימה חוזרת: כשמסמנים "בוצע" נוצרת המשימה הבאה (מחר / בעוד שבוע מהמועד, או מהיום אם אין מועד)
    if (done && task.repeat !== 'none') {
      const base = task.dueDate && task.dueDate >= plToday() ? task.dueDate : plToday();
      const next = plAddDays(base, task.repeat === 'daily' ? 1 : 7);
      const exists = state.tasks.some(x => x.id !== task.id && x.title === task.title && x.dueDate === next && x.status === 'todo');
      if (!exists) await addTask({ ...task, dueDate: next });
    }
    if (done) showToast(task.repeat !== 'none' ? 'בוצע. המשימה הבאה כבר ברשימה' : 'בוצע');
  };

  const deleteTask = async task => {
    patch(s => ({ tasks: s.tasks.filter(x => x.id !== task.id) }));
    if (!isDemo) await sb.from('tasks').delete().eq('id', task.id);
    showToast('המשימה נמחקה');
  };

  const addEvent = async ev => {
    const row = { kind: ev.kind || 'general', title: ev.title.trim(), notes: ev.notes || '', location: ev.location || '', scope: ev.scope,
      personKind: ev.personKind || null, personId: ev.personId || null, startDate: ev.startDate, startTime: ev.startTime || null,
      endTime: ev.endTime || null, repeat: ev.repeat || 'none', repeatUntil: ev.repeatUntil || null, cost: ev.cost == null || ev.cost === '' ? null : Number(ev.cost) };
    if (!row.title) return fail('נא לכתוב שם לאירוע');
    if (!row.startDate) return fail('נא לבחור תאריך');
    if (row.startTime && row.endTime && row.endTime <= row.startTime) return fail('שעת הסיום צריכה להיות אחרי שעת ההתחלה');
    let id = 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);
    if (!isDemo) {
      const { data, error } = await sb.from('family_events').insert({ family_id: familyId, kind: row.kind, title: row.title, notes: row.notes || null,
        location: row.location || null, scope: row.scope, person_kind: row.personKind, person_id: row.personId, start_date: row.startDate,
        start_time: row.startTime, end_time: row.endTime, repeat: row.repeat, repeat_until: row.repeatUntil, cost: row.cost }).select().single();
      if (error) return fail(/premium_required/.test(error.message) ? 'משימות ולו"ז הם תכונת פרימיום' : 'שגיאה בשמירה');
      id = data.id;
    }
    const saved = { ...row, id };
    patch(s => ({ events: [...s.events, saved] }));
    return saved;
  };

  const deleteEvent = async ev => {
    patch(s => ({ events: s.events.filter(x => x.id !== ev.id) }));
    if (!isDemo) await sb.from('family_events').delete().eq('id', ev.id);
    showToast('האירוע נמחק מהלו"ז');
  };

  return { ...state, addTask, toggleTask, deleteTask, addEvent, deleteEvent };
}

/* ---- חישובי עמידה בזמנים לשבוע הנוכחי ---- */
function plWeekStats(tasks) {
  const today = plToday();
  const ws = plWeekStart(today), we = plAddDays(ws, 6);
  const inWeek = tasks.filter(t => t.dueDate && t.dueDate >= ws && t.dueDate <= we);
  const doneOnTime = inWeek.filter(t => t.status === 'done' && t.doneAt && plIso(new Date(t.doneAt)) <= t.dueDate).length;
  const doneLate = inWeek.filter(t => t.status === 'done' && !(t.doneAt && plIso(new Date(t.doneAt)) <= t.dueDate)).length;
  const overdue = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today).length;
  const dueToday = tasks.filter(t => t.status !== 'done' && t.dueDate === today).length;
  const closed = doneOnTime + doneLate + inWeek.filter(t => t.status !== 'done' && t.dueDate < today).length;
  return { total: inWeek.length, doneOnTime, doneLate, overdue, dueToday, onTimePct: closed ? Math.round(doneOnTime / closed * 100) : null };
}

// לכרטיס בעמוד הראשי
function plHubSummary(planner, me, isChild) {
  if (!planner.ready || planner.unavailable || !me) return null;
  const mine = planner.tasks.filter(t => plVisible(t, me, isChild));
  const s = plWeekStats(mine);
  const today = plToday();
  const todayEvents = planner.events.filter(e => plVisible(e, me, isChild) && plEventOn(e, today)).length;
  if (!mine.length && !todayEvents) return null;
  const parts = [];
  if (s.dueToday) parts.push(`${s.dueToday} להיום`);
  if (s.overdue) parts.push(`${s.overdue} באיחור`);
  if (todayEvents) parts.push(todayEvents === 1 ? 'אירוע אחד היום' : `${todayEvents} אירועים היום`);
  const open = mine.filter(t => t.status !== 'done').length;
  return {
    big: open === 1 ? 'משימה פתוחה אחת' : `${open} משימות פתוחות`,
    tone: s.overdue ? 'var(--neg)' : 'var(--text)',
    line: parts.join(' · ') || 'הכול מתוקתק להיום'
  };
}

const plDueLabel = d => {
  if (!d) return '';
  const today = plToday();
  if (d === today) return 'היום';
  if (d === plAddDays(today, 1)) return 'מחר';
  if (d === plAddDays(today, -1)) return 'אתמול';
  const diff = Math.round((plParse(d) - plParse(today)) / 86400000);
  if (diff > 1 && diff < 7) return `יום ${PL_DAYS[plParse(d).getDay()]}`;
  return plParse(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
};

/* ---- כפתור אישור עגול עם אנימציית סימון ---- */
function PlCheck({ done, onClick, label }) {
  return React.createElement('button', { type: 'button', className: 'pl-check' + (done ? ' done' : ''), onClick, 'aria-pressed': done, 'aria-label': label },
    React.createElement('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
      React.createElement('path', { d: 'M5 12.5l4.2 4.2L19 7', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' })));
}

function PlScopeBadge({ scope }) {
  const s = PL_SCOPES[scope] || PL_SCOPES.family;
  return React.createElement('span', { className: 'pl-badge', style: { color: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` } }, s.label);
}

/* ---- טופס משותף: למי שייך (אישי/זוגי/משפחתי) ומי אחראי ---- */
function PlScopePicker({ value, onChange, isChild }) {
  const opts = isChild ? ['personal', 'family'] : ['personal', 'couple', 'family'];
  return React.createElement('div', { className: 'flex gap-1 p-1 rounded-full', style: { background: 'var(--navy-panel)' }, role: 'radiogroup', 'aria-label': 'של מי' },
    opts.map(k => React.createElement('button', {
      key: k, type: 'button', role: 'radio', 'aria-checked': value === k, onClick: () => onChange(k),
      className: 'ent-pill-btn px-3 py-1 text-xs flex-1',
      style: { background: value === k ? PL_SCOPES[k].color : 'transparent', color: value === k ? '#fff' : 'var(--text-2)' }
    }, PL_SCOPES[k].label)));
}

function PlMemberSelect({ members, value, onChange, scope, label }) {
  const list = scope === 'couple' ? members.filter(m => m.kind === 'parent') : members;
  return React.createElement('select', {
    className: 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none', 'aria-label': label, value: value || '',
    onChange: e => onChange(e.target.value)
  }, React.createElement('option', { value: '' }, scope === 'family' ? 'אחראי/ת: כולם' : 'בלי אחראי'), list.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name)));
}

/* ======================= לשונית "משימות השבוע" ======================= */
function TasksPage({ planner, me, isChild, isPremium, onUpgrade }) {
  const [filter, setFilter] = useState('all');
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const emptyForm = () => ({ title: '', when: 'today', date: '', scope: isChild ? 'personal' : 'family', personId: '', repeat: 'none' });
  const [f, setF] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  if (!isPremium) return React.createElement(PremiumLock, { title: 'משימות ולו"ז הם תכונת פרימיום', desc: 'משימות לשבוע עם מעקב עמידה בזמנים, ולו"ז אישי, זוגי ומשפחתי.', onUpgrade });
  if (!planner.ready) return React.createElement('div', { className: 'ent-card p-6' }, 'טוען...');
  if (planner.unavailable) return React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המערך עוד לא הופעל בשרת. יש להריץ את tasks-schedule.sql ב-Supabase.');

  const today = plToday();
  const visible = planner.tasks.filter(t => plVisible(t, me, isChild));
  const filtered = visible.filter(t => filter === 'all' ? true : filter === 'mine' ? plIsMine(t, me) : t.scope === filter);
  const stats = plWeekStats(visible.filter(t => isChild ? plIsMine(t, me) || t.scope === 'family' : true));
  const open = filtered.filter(t => t.status !== 'done');
  const groups = [
    ['overdue', 'באיחור', open.filter(t => t.dueDate && t.dueDate < today)],
    ['today', 'היום', open.filter(t => t.dueDate === today)],
    ['tomorrow', 'מחר', open.filter(t => t.dueDate === plAddDays(today, 1))],
    ['week', 'בהמשך השבוע', open.filter(t => t.dueDate > plAddDays(today, 1) && t.dueDate <= plAddDays(plWeekStart(today), 6))],
    ['later', 'אחר כך', open.filter(t => t.dueDate && t.dueDate > plAddDays(plWeekStart(today), 6))],
    ['nodate', 'בלי תאריך', open.filter(t => !t.dueDate)]
  ].filter(g => g[2].length);
  const done = filtered.filter(t => t.status === 'done').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  const nameOf = id => (planner.members.find(m => m.id === id) || {}).name;

  const submit = async () => {
    const dueDate = f.when === 'today' ? today : f.when === 'tomorrow' ? plAddDays(today, 1) : f.when === 'weekend' ? plAddDays(plWeekStart(today), 5) : f.when === 'date' ? f.date || null : null;
    const personId = f.scope === 'personal' ? me.id : f.personId || null;
    const person = personId ? planner.members.find(m => m.id === personId) : null;
    setBusy(true);
    const ok = await planner.addTask({ title: f.title, scope: f.scope, personId, personKind: f.scope === 'personal' ? me.kind : person ? person.kind : null, dueDate, repeat: f.repeat });
    setBusy(false);
    if (ok) { setF({ ...emptyForm(), scope: f.scope }); }
  };

  const ring = stats.onTimePct;
  const row = t => {
    const late = t.status !== 'done' && t.dueDate && t.dueDate < today;
    // אחראי במשימה משותפת, או בעל המשימה כשזו משימה אישית של מישהו אחר (למשל של ילד)
    const who = t.personId && (t.scope !== 'personal' || t.personId !== me.id) ? nameOf(t.personId) : null;
    return React.createElement('div', { key: t.id, className: 'pl-task ent-row py-2.5 flex items-center gap-3' + (t.status === 'done' ? ' is-done' : '') },
      React.createElement(PlCheck, { done: t.status === 'done', onClick: () => planner.toggleTask(t), label: t.status === 'done' ? `לבטל סימון: ${t.title}` : `סימון כבוצע: ${t.title}` }),
      React.createElement('div', { className: 'flex-1 min-w-0' },
        React.createElement('p', { className: 'pl-task-title text-sm font-semibold' }, t.title),
        React.createElement('div', { className: 'flex flex-wrap items-center gap-1.5 mt-0.5' },
          React.createElement(PlScopeBadge, { scope: t.scope }),
          t.dueDate && React.createElement('span', { className: 'text-xs', style: { color: late ? 'var(--neg)' : 'var(--text-muted)' } }, late ? `באיחור · ${plDueLabel(t.dueDate)}` : plDueLabel(t.dueDate)),
          t.repeat !== 'none' && React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, t.repeat === 'daily' ? '↻ כל יום' : '↻ כל שבוע'),
          who && React.createElement('span', { className: 'text-xs flex items-center gap-1', style: { color: 'var(--text-muted)' } }, React.createElement(InitialAvatar, { name: who, size: 16 }), who))),
      React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${t.title}`, onClick: () => planner.deleteTask(t) }, React.createElement(ITrash, { size: 15 })));
  };

  return React.createElement('div', { className: 'space-y-6' },
    // סיכום השבוע
    React.createElement('div', { className: 'ent-card p-5 flex items-center gap-5 flex-wrap' },
      React.createElement('div', { className: 'pl-ring', style: { '--p': ring == null ? 0 : ring }, role: 'img', 'aria-label': ring == null ? 'עוד אין משימות שהגיע מועדן השבוע' : `${ring}% מהמשימות השבוע בוצעו בזמן` },
        React.createElement('span', null, ring == null ? '—' : `${ring}%`)),
      React.createElement('div', { className: 'flex-1 min-w-[180px]' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'משימות השבוע'),
        React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } },
          ring == null ? 'כאן רואים כמה מהמשימות בוצעו בזמן' : `${stats.doneOnTime} בוצעו בזמן${stats.doneLate ? ` · ${stats.doneLate} באיחור` : ''} מתוך ${stats.total} השבוע`),
        React.createElement('div', { className: 'flex gap-3 mt-2 text-sm' },
          React.createElement('span', { style: { color: 'var(--text-2)' } }, `${stats.dueToday} להיום`),
          React.createElement('span', { style: { color: stats.overdue ? 'var(--neg)' : 'var(--text-dim)' } }, `${stats.overdue} באיחור`))),
      React.createElement('button', { onClick: () => setAdding(!adding), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' משימה')),
    // הוספה
    adding && React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('input', { className: 'ent-input w-full px-4 py-3 rounded-xl text-sm outline-none', placeholder: 'מה צריך לעשות?', autoFocus: true, value: f.title,
        onChange: e => set('title', e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !busy) submit(); } }),
      React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, [['today', 'היום'], ['tomorrow', 'מחר'], ['weekend', 'עד שישי'], ['date', 'תאריך...'], ['none', 'בלי תאריך']].map(([k, l]) =>
        React.createElement('button', { key: k, type: 'button', onClick: () => set('when', k), className: 'ent-pill-btn px-3 py-1 text-xs',
          style: { background: f.when === k ? 'var(--bronze)' : 'var(--navy-panel-2)', color: f.when === k ? 'var(--on-accent)' : 'var(--text-2)' } }, l))),
      f.when === 'date' && React.createElement(DateField, { label: 'עד מתי', value: f.date, onChange: v => set('date', v) }),
      React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
        React.createElement(PlScopePicker, { value: f.scope, onChange: v => set('scope', v), isChild }),
        f.scope !== 'personal' && !isChild && React.createElement(PlMemberSelect, { members: planner.members, value: f.personId, onChange: v => set('personId', v), scope: f.scope, label: 'מי אחראי' }),
        React.createElement('select', { className: 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none', 'aria-label': 'חזרה', value: f.repeat, onChange: e => set('repeat', e.target.value) },
          React.createElement('option', { value: 'none' }, 'לא חוזרת'), React.createElement('option', { value: 'daily' }, 'כל יום'), React.createElement('option', { value: 'weekly' }, 'כל שבוע'))),
      React.createElement('div', { className: 'flex gap-2' },
        React.createElement('button', { disabled: busy, onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, busy ? 'רגע...' : 'הוספה'),
        React.createElement('button', { onClick: () => setAdding(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'סגירה'))),
    // סינון + רשימה
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, (isChild ? [['all', 'הכול'], ['mine', 'שלי'], ['family', 'משפחתי']] : [['all', 'הכול'], ['mine', 'שלי'], ['couple', 'זוגי'], ['family', 'משפחתי']]).map(([k, l]) =>
        React.createElement('button', { key: k, type: 'button', onClick: () => setFilter(k), className: 'ent-pill-btn px-3 py-1 text-xs', 'aria-pressed': filter === k,
          style: { background: filter === k ? 'var(--bronze)' : 'var(--navy-panel-2)', color: filter === k ? 'var(--on-accent)' : 'var(--text-2)' } }, l))),
      !groups.length && !done.length ? React.createElement(EmptyState, { text: 'אין משימות כאן', hint: 'לחצו "משימה" כדי להוסיף את הראשונה' }) : null,
      !groups.length && done.length ? React.createElement('p', { className: 'text-sm', style: { color: 'var(--pos)' } }, 'כל המשימות בוצעו. כל הכבוד') : null,
      groups.map(([k, label, list]) => React.createElement('div', { key: k },
        React.createElement('p', { className: 'text-xs font-semibold mb-1', style: { color: k === 'overdue' ? 'var(--neg)' : 'var(--text-muted)' } }, `${label} (${list.length})`),
        list.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))).map(row))),
      done.length > 0 && React.createElement('div', null,
        React.createElement('button', { type: 'button', className: 'text-xs font-semibold flex items-center gap-1', style: { color: 'var(--text-muted)' }, 'aria-expanded': showDone, onClick: () => setShowDone(!showDone) },
          `בוצעו (${done.length})`, React.createElement(IChevronDown, { size: 12, style: { transform: showDone ? 'rotate(180deg)' : 'none' } })),
        showDone && done.slice(0, 30).map(row))));
}

/* ---- קובץ .ics: "הוספה ליומן" של גוגל/אייפון לאירוע אחד ---- */
function plDownloadIcs(ev) {
  const dt = (d, t) => d.replace(/-/g, '') + (t ? 'T' + String(t).slice(0, 5).replace(':', '') + '00' : '');
  const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Homey//HE', 'BEGIN:VEVENT', `UID:${ev.id}@homey`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`];
  if (ev.startTime) {
    lines.push(`DTSTART:${dt(ev.startDate, ev.startTime)}`);
    lines.push(`DTEND:${dt(ev.startDate, ev.endTime || (() => { const [h, m] = String(ev.startTime).split(':').map(Number); return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; })())}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dt(ev.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${dt(plAddDays(ev.startDate, 1))}`);
  }
  if (ev.repeat === 'weekly') lines.push('RRULE:FREQ=WEEKLY' + (ev.repeatUntil ? `;UNTIL=${dt(ev.repeatUntil)}T235959` : ''));
  lines.push(`SUMMARY:${esc(ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  if (ev.notes) lines.push(`DESCRIPTION:${esc(ev.notes)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ev.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'homey'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ======================= לשונית "לו"ז שבועי" ======================= */
function SchedulePage({ planner, me, isChild, isPremium, onUpgrade }) {
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const emptyForm = () => ({ title: '', startDate: plToday(), startTime: '', endTime: '', scope: isChild ? 'personal' : 'family', personId: '', repeat: 'none', location: '' });
  const [f, setF] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  if (!isPremium) return React.createElement(PremiumLock, { title: 'משימות ולו"ז הם תכונת פרימיום', desc: 'לו"ז שבועי אישי, זוגי ומשפחתי, עם הוספה ליומן של הטלפון.', onUpgrade });
  if (!planner.ready) return React.createElement('div', { className: 'ent-card p-6' }, 'טוען...');
  if (planner.unavailable) return React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המערך עוד לא הופעל בשרת. יש להריץ את tasks-schedule.sql ב-Supabase.');

  const today = plToday();
  const ws = plAddDays(plWeekStart(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => plAddDays(ws, i));
  const pass = x => plVisible(x, me, isChild) && (filter === 'all' ? true : filter === 'mine' ? plIsMine(x, me) : x.scope === filter);
  const events = planner.events.filter(pass);
  const tasks = planner.tasks.filter(t => t.dueDate && pass(t));
  const label = offset === 0 ? 'השבוע' : offset === 1 ? 'שבוע הבא' : offset === -1 ? 'שבוע שעבר' : `${plParse(ws).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} - ${plParse(days[6]).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}`;

  const submit = async () => {
    const personId = f.scope === 'personal' ? me.id : f.personId || null;
    const person = personId ? planner.members.find(m => m.id === personId) : null;
    setBusy(true);
    const ok = await planner.addEvent({ ...f, personId, personKind: f.scope === 'personal' ? me.kind : person ? person.kind : null });
    setBusy(false);
    if (ok) { setF({ ...emptyForm(), scope: f.scope }); setAdding(false); }
  };
  const timeInput = (k, l) => React.createElement('label', { className: 'text-xs flex flex-col gap-1', style: { color: 'var(--text-muted)' } }, l,
    React.createElement('input', { type: 'time', className: 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none', value: f[k], onChange: e => set(k, e.target.value) }));

  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-3' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'לו"ז שבועי'),
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', 'aria-label': 'שבוע קודם', onClick: () => setOffset(offset - 1) }, '→'),
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => setOffset(0), 'aria-label': 'חזרה לשבוע הנוכחי' }, label),
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', 'aria-label': 'שבוע הבא', onClick: () => setOffset(offset + 1) }, '←'),
          React.createElement('button', { onClick: () => setAdding(!adding), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' אירוע'))),
      React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, (isChild ? [['all', 'הכול'], ['mine', 'שלי'], ['family', 'משפחתי']] : [['all', 'הכול'], ['mine', 'שלי'], ['couple', 'זוגי'], ['family', 'משפחתי']]).map(([k, l]) =>
        React.createElement('button', { key: k, type: 'button', onClick: () => setFilter(k), 'aria-pressed': filter === k, className: 'ent-pill-btn px-3 py-1 text-xs',
          style: { background: filter === k ? 'var(--bronze)' : 'var(--navy-panel-2)', color: filter === k ? 'var(--on-accent)' : 'var(--text-2)' } }, l))),
      adding && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('input', { className: 'ent-input w-full px-4 py-3 rounded-xl text-sm outline-none', placeholder: 'מה בלו"ז? (פגישה, חוג, ארוחה...)', autoFocus: true, value: f.title, onChange: e => set('title', e.target.value) }),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' } },
          React.createElement(DateField, { label: 'תאריך', value: f.startDate, onChange: v => set('startDate', v) }),
          timeInput('startTime', 'משעה'), timeInput('endTime', 'עד שעה')),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
          React.createElement(PlScopePicker, { value: f.scope, onChange: v => set('scope', v), isChild }),
          f.scope !== 'personal' && !isChild && React.createElement(PlMemberSelect, { members: planner.members, value: f.personId, onChange: v => set('personId', v), scope: f.scope, label: 'של מי' }),
          React.createElement('select', { className: 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none', 'aria-label': 'חזרה', value: f.repeat, onChange: e => set('repeat', e.target.value) },
            React.createElement('option', { value: 'none' }, 'פעם אחת'), React.createElement('option', { value: 'weekly' }, 'כל שבוע')),
          React.createElement('input', { className: 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none', placeholder: 'מקום (לא חובה)', value: f.location, onChange: e => set('location', e.target.value) })),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { disabled: busy, onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, busy ? 'רגע...' : 'הוספה ללו"ז'),
          React.createElement('button', { onClick: () => setAdding(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול')))),
    React.createElement('div', { className: 'pl-week' }, days.map(day => {
      const evs = events.filter(e => plEventOn(e, day)).sort((a, b) => plTime(a.startTime || '99').localeCompare(plTime(b.startTime || '99')));
      const ts = tasks.filter(t => t.dueDate === day);
      const isToday = day === today;
      return React.createElement('div', { key: day, className: 'pl-day ent-card p-3' + (isToday ? ' today' : '') },
        React.createElement('div', { className: 'flex items-baseline justify-between mb-2' },
          React.createElement('p', { className: 'text-sm font-bold' }, PL_DAYS[plParse(day).getDay()]),
          React.createElement('p', { className: 'text-xs', style: { color: isToday ? 'var(--bronze)' : 'var(--text-dim)' } }, isToday ? 'היום' : plParse(day).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }))),
        !evs.length && !ts.length && React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, 'פנוי'),
        evs.map(e => {
          const sc = PL_SCOPES[e.scope] || PL_SCOPES.family;
          const key = e.id + day;
          return React.createElement('div', { key, className: 'pl-event', style: { borderInlineStartColor: sc.color } },
            React.createElement('button', { type: 'button', className: 'w-full text-right', 'aria-expanded': openId === key, onClick: () => setOpenId(openId === key ? null : key) },
              React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, e.startTime ? plTime(e.startTime) + (e.endTime ? `-${plTime(e.endTime)}` : '') : 'כל היום', e.repeat === 'weekly' ? ' · ↻' : ''),
              React.createElement('p', { className: 'text-sm font-semibold' }, e.title)),
            openId === key && React.createElement('div', { className: 'mt-1.5 space-y-1.5' },
              React.createElement('div', { className: 'flex flex-wrap gap-1.5 items-center' }, React.createElement(PlScopeBadge, { scope: e.scope }),
                e.personId && e.scope !== 'personal' && React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, (planner.members.find(m => m.id === e.personId) || {}).name || ''),
                e.location && React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, '📍 ', e.location)),
              React.createElement('div', { className: 'flex gap-1.5' },
                React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', onClick: () => plDownloadIcs(e) }, 'הוספה ליומן'),
                React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', style: { color: 'var(--neg)' }, onClick: () => { setOpenId(null); planner.deleteEvent(e); } }, e.repeat === 'weekly' ? 'מחיקה (כל השבועות)' : 'מחיקה'))));
        }),
        ts.map(t => React.createElement('div', { key: t.id, className: 'pl-day-task flex items-center gap-2 mt-1' + (t.status === 'done' ? ' is-done' : '') },
          React.createElement(PlCheck, { done: t.status === 'done', onClick: () => planner.toggleTask(t), label: `משימה: ${t.title}` }),
          React.createElement('span', { className: 'pl-task-title text-xs' }, t.title))));
    })));
}
