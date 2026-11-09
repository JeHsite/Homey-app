/* Homey — מערך "משימות ולו"ז": משימות לשבוע עם מעקב עמידה בזמנים, ולו"ז שבועי אישי/זוגי/משפחתי.
 * נטען כסקריפט רגיל לפני הסקריפט הראשי של index.html. הפונקציות כאן משתמשות בגלובליים של הסקריפט הראשי
 * (React hooks, sb, אייקונים, DateField, PremiumLock, EmptyState, InitialAvatar) רק בזמן רינדור, אחרי שהכול נטען.
 * טבלאות: tasks, family_events (supabase/tasks-schedule.sql). family_events תשמש גם את מערך הפגישות/דייטים/חוגים. */

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
  const ev = (id, o) => ({ id, kind: 'general', notes: '', location: '', scope: 'family', personKind: null, personId: null, startTime: null, endTime: null, repeat: 'none', repeatUntil: null, cost: null, withWhom: '', plannerId: null, rating: null, billId: null, driveTo: null, driveFrom: null, ...o });
  const kid2 = FAMILY_PROFILES.filter(p => p.role === 'child')[1];
  const events = [
    ev('de1', { title: 'ארוחת ערב משפחתית', startDate: plAddDays(ws, 5), startTime: '19:30', repeat: 'weekly' }),
    ev('de2', { title: 'חוג כדורגל', startDate: plAddDays(ws, 1), startTime: '16:30', endTime: '17:30', scope: 'personal', personKind: 'child', personId: kid ? kid.id : 'p3', repeat: 'weekly', kind: 'class', cost: 180, location: 'מגרש השכונה', driveTo: 'p1', driveFrom: 'p2' }),
    ev('de7', { title: 'שחייה', startDate: plAddDays(ws, 3), startTime: '17:00', endTime: '17:45', scope: 'personal', personKind: 'child', personId: kid2 ? kid2.id : 'p4', repeat: 'weekly', kind: 'class', cost: 260, location: 'הבריכה העירונית' }),
    ev('de3', { title: 'פגישה עם רואה החשבון', startDate: plAddDays(ws, 2), startTime: '10:00', endTime: '11:00', scope: 'personal', personKind: me.kind, personId: me.id, location: 'תל אביב', kind: 'meeting', withWhom: 'רו"ח כהן' }),
    ev('de8', { title: 'שיחה עם יועץ המשכנתאות', startDate: plAddDays(ws, 10), startTime: '17:15', endTime: '18:00', scope: 'personal', personKind: me.kind, personId: me.id, kind: 'meeting' }),
    ev('de6', { title: 'אסיפת הורים', startDate: plAddDays(ws, 9), startTime: '19:00', endTime: '20:00', scope: 'couple', kind: 'meeting', location: 'בית הספר', withWhom: 'המחנכת' }),
    ev('de4', { title: 'דייט במסעדה', startDate: plAddDays(ws, 4), startTime: '20:30', scope: 'couple', kind: 'date', plannerId: 'p2', cost: 400, location: 'מסעדה איטלקית' }),
    ev('de5', { title: 'סרט בקולנוע', startDate: plAddDays(t, -16), startTime: '21:00', scope: 'couple', kind: 'date', plannerId: 'p1', cost: 120 })
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
  endTime: r.end_time, repeat: r.repeat, repeatUntil: r.repeat_until, cost: r.cost == null ? null : Number(r.cost),
  // שדות של מערך פגישות/דייטים/חוגים (events.sql)
  withWhom: r.with_whom || '', plannerId: r.planner_id || null, rating: r.rating || null, billId: r.bill_id || null,
  // הסעות לחוג (plan.sql): מי מסיע ומי מחזיר
  driveTo: r.drive_to || null, driveFrom: r.drive_from || null
});

/* ---- הנתונים של המערך: נטען פעם אחת כשנכנסים לאפליקציה, משותף לעמוד הראשי ולשתי הלשוניות ---- */
function useFamilyPlanner({ familyId, isDemo, enabled, me, showToast, reloadKey }) {
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
  }, [enabled, familyId, isDemo, meId, reloadKey]);

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

  const deleteTask = async (task, quiet) => {
    patch(s => ({ tasks: s.tasks.filter(x => x.id !== task.id) }));
    if (!isDemo) await sb.from('tasks').delete().eq('id', task.id);
    if (!quiet) showToast('המשימה נמחקה');
  };

  const addEvent = async ev => {
    const row = { kind: ev.kind || 'general', title: ev.title.trim(), notes: ev.notes || '', location: ev.location || '', scope: ev.scope,
      personKind: ev.personKind || null, personId: ev.personId || null, startDate: ev.startDate, startTime: ev.startTime || null,
      endTime: ev.endTime || null, repeat: ev.repeat || 'none', repeatUntil: ev.repeatUntil || null, cost: ev.cost == null || ev.cost === '' ? null : Number(ev.cost),
      withWhom: ev.withWhom || '', plannerId: ev.plannerId || null, rating: null, billId: ev.billId || null };
    if (!row.title) return fail('נא לכתוב שם לאירוע');
    if (!row.startDate) return fail('נא לבחור תאריך');
    if (row.startTime && row.endTime && row.endTime <= row.startTime) return fail('שעת הסיום צריכה להיות אחרי שעת ההתחלה');
    let id = 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);
    if (!isDemo) {
      const ins = { family_id: familyId, kind: row.kind, title: row.title, notes: row.notes || null,
        location: row.location || null, scope: row.scope, person_kind: row.personKind, person_id: row.personId, start_date: row.startDate,
        start_time: row.startTime, end_time: row.endTime, repeat: row.repeat, repeat_until: row.repeatUntil, cost: row.cost };
      // העמודות האלה קיימות רק אחרי events.sql: שולחים אותן רק כשיש בהן ערך, כדי שהלו"ז ימשיך לעבוד גם לפני
      if (row.withWhom) ins.with_whom = row.withWhom;
      if (row.plannerId) ins.planner_id = row.plannerId;
      if (row.billId) ins.bill_id = row.billId;
      const { data, error } = await sb.from('family_events').insert(ins).select().single();
      if (error) return fail(/premium_required/.test(error.message) ? 'משימות ולו"ז הם תכונת פרימיום' : 'שגיאה בשמירה');
      id = data.id;
    }
    const saved = { ...row, id };
    patch(s => ({ events: [...s.events, saved] }));
    return saved;
  };

  const deleteEvent = async (ev, quiet) => {
    patch(s => ({ events: s.events.filter(x => x.id !== ev.id) }));
    if (!isDemo) await sb.from('family_events').delete().eq('id', ev.id);
    if (!quiet) showToast('האירוע נמחק מהלו"ז');
  };

  // עדכון שדות של אירוע קיים (דירוג דייט, קישור חוג להוראת קבע וכו')
  const updateEvent = async (ev, changes) => {
    patch(s => ({ events: s.events.map(x => x.id === ev.id ? { ...x, ...changes } : x) }));
    if (isDemo) return;
    const map = { rating: 'rating', billId: 'bill_id', plannerId: 'planner_id', withWhom: 'with_whom', driveTo: 'drive_to', driveFrom: 'drive_from', title: 'title', location: 'location', cost: 'cost', notes: 'notes' };
    const db = {};
    Object.entries(changes).forEach(([k, v]) => { if (map[k]) db[map[k]] = v; });
    await sb.from('family_events').update(db).eq('id', ev.id);
  };

  // עדכון משימה קיימת (העברה למחר, שינוי מועד/כותרת). רשימה = כמה משימות בבת אחת ("העבר הכול למחר")
  const updateTask = async (taskOrList, changes) => {
    const list = Array.isArray(taskOrList) ? taskOrList : [taskOrList];
    const ids = list.map(t => t.id);
    patch(s => ({ tasks: s.tasks.map(x => ids.includes(x.id) ? { ...x, ...changes } : x) }));
    if (isDemo) return;
    const map = { title: 'title', dueDate: 'due_date', dueTime: 'due_time', notes: 'notes', scope: 'scope', personId: 'person_id', personKind: 'person_kind', repeat: 'repeat' };
    const db = {};
    Object.entries(changes).forEach(([k, v]) => { if (map[k]) db[map[k]] = v; });
    const realIds = ids.filter(id => !String(id).startsWith('local-'));
    if (!realIds.length) return;
    const { error } = await sb.from('tasks').update(db).in('id', realIds);
    if (error) showToast('שגיאה בעדכון');
  };

  return { ...state, addTask, toggleTask, deleteTask, addEvent, deleteEvent, updateEvent, updateTask };
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

