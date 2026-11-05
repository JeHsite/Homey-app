/* Homey — מערך "משימות ולו"ז" כאפליקציה מלאה: סקירה (לוח הבקרה של הבית), שגרות בוקר/ערב לילדים,
 * ישיבת שבוע זוגית והסעות לחוגים. משתמש בנתונים של modules/tasks.js (useFamilyPlanner) ו-modules/chores.js (useChores).
 * טבלאות: routines, routine_checks, couple_syncs, family_events.drive_to/drive_from (supabase/plan.sql). */

const ROUTINE_TEMPLATES = {
  morning: [['🛏️', 'לסדר את המיטה'], ['🦷', 'לצחצח שיניים'], ['👕', 'להתלבש'], ['🥣', 'ארוחת בוקר'], ['🎒', 'לבדוק שהתיק מוכן']],
  evening: [['🛁', 'מקלחת'], ['🦷', 'לצחצח שיניים'], ['🎒', 'לארגן תיק למחר'], ['📚', 'לקרוא 10 דקות'], ['😴', 'לכבות אור בזמן']]
};
const ROUTINE_LABEL = { morning: 'שגרת בוקר', evening: 'שגרת ערב' };
const ROUTINE_ICONS = ['🛏️', '🦷', '👕', '🥣', '🎒', '🛁', '📚', '😴', '🧴', '🥤', '👟', '🧸', '🙏', '💊', '⭐'];
// השגרה שרלוונטית עכשיו: בוקר עד 14:00, ערב אחר כך
const routineNow = () => new Date().getHours() < 14 ? 'morning' : 'evening';
// השבוע שמתכננים בישיבה: בשישי-שבת = השבוע הבא, אחרת = השבוע הנוכחי
const syncWeekStart = () => { const t = plToday(), dow = plParse(t).getDay(); return dow >= 5 ? plAddDays(plWeekStart(t), 7) : plWeekStart(t); };
const rid = () => Math.random().toString(36).slice(2, 9);

function planDemo(kids) {
  const mk = (child, kind, pts) => ({ id: `drt-${child}-${kind}`, childId: child, kind, points: pts, active: true, items: ROUTINE_TEMPLATES[kind].map(([icon, text], i) => ({ id: `i${i}`, icon, text })) });
  const routines = kids.flatMap(k => [mk(k, 'morning', 3), mk(k, 'evening', 3)]);
  const t = plToday();
  const checks = routines.length ? [{ id: 'dck1', routineId: routines[0].id, date: t, doneItems: ['i0', 'i1'], completedAt: null, awarded: false }] : [];
  for (let d = 1; d <= 6; d++) routines.slice(0, 2).forEach(r => checks.push({ id: `dck-${r.id}-${d}`, routineId: r.id, date: plAddDays(t, -d), doneItems: r.items.map(i => i.id), completedAt: new Date().toISOString(), awarded: true }));
  const syncs = [{ id: 'dsy1', weekStart: plAddDays(plWeekStart(t), -7), notes: 'לסגור תור לרופא שיניים לשני הילדים. אבא מסיע לכדורגל בימי שני.', mood: 4, completedAt: new Date(Date.now() - 6 * 86400000).toISOString() }];
  return { routines, checks, syncs };
}

/* ---- נתונים: שגרות, סימונים וישיבות ---- */
function usePlanExtras({ familyId, isDemo, enabled, kids, showToast }) {
  const [state, setState] = useState({ ready: false, unavailable: false, routines: [], checks: [], syncs: [] });
  const kidKey = (kids || []).map(k => k.id).join(',');
  useEffect(() => {
    if (!enabled || !familyId) return;
    if (isDemo) {
      if (!kids || !kids.length) return;
      setState({ ready: true, unavailable: false, ...planDemo(kids.map(k => k.id)) });
      return;
    }
    let alive = true;
    (async () => {
      const since = plAddDays(plToday(), -7);
      const [r, c, s] = await Promise.all([
        sb.from('routines').select('*').eq('family_id', familyId),
        sb.from('routine_checks').select('*').eq('family_id', familyId).gte('date', since),
        sb.from('couple_syncs').select('*').eq('family_id', familyId).order('week_start', { ascending: false }).limit(12)
      ]);
      if (!alive) return;
      if (r.error || c.error || s.error) return setState(x => ({ ...x, ready: true, unavailable: true }));
      setState({
        ready: true, unavailable: false,
        routines: (r.data || []).map(x => ({ id: x.id, childId: x.child_id, kind: x.kind, items: x.items || [], points: x.points, active: x.active })),
        checks: (c.data || []).map(x => ({ id: x.id, routineId: x.routine_id, date: String(x.date).slice(0, 10), doneItems: x.done_items || [], completedAt: x.completed_at, awarded: x.awarded })),
        syncs: (s.data || []).map(x => ({ id: x.id, weekStart: String(x.week_start).slice(0, 10), notes: x.notes || '', mood: x.mood, completedAt: x.completed_at }))
      });
    })();
    return () => { alive = false; };
  }, [enabled, familyId, isDemo, kidKey]);
  const patch = fn => setState(s => ({ ...s, ...fn(s) }));

  const saveRoutine = async (childId, kind, items, points) => {
    const existing = state.routines.find(r => r.childId === childId && r.kind === kind);
    let id = existing ? existing.id : 'local-' + rid();
    if (!isDemo) {
      const { data, error } = await sb.from('routines').upsert({ family_id: familyId, child_id: childId, kind, items, points, active: true }, { onConflict: 'child_id,kind' }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return; }
      id = data.id;
    }
    patch(s => ({ routines: [...s.routines.filter(r => !(r.childId === childId && r.kind === kind)), { id, childId, kind, items, points, active: true }] }));
  };
  const checkOf = (routineId, date) => state.checks.find(c => c.routineId === routineId && c.date === date);
  // מסמן/מבטל פריט בשגרה של היום. כשכל הפריטים סומנו בפעם הראשונה: חגיגה ונקודות (פעם אחת ביום)
  const toggleItem = async (routine, itemId, award) => {
    const today = plToday();
    const cur = checkOf(routine.id, today) || { id: 'local-' + rid(), routineId: routine.id, date: today, doneItems: [], completedAt: null, awarded: false };
    const doneItems = cur.doneItems.includes(itemId) ? cur.doneItems.filter(x => x !== itemId) : [...cur.doneItems, itemId];
    const complete = routine.items.length > 0 && routine.items.every(i => doneItems.includes(i.id));
    const giveNow = complete && !cur.awarded;
    const next = { ...cur, doneItems, completedAt: complete ? cur.completedAt || new Date().toISOString() : null, awarded: cur.awarded || (giveNow && routine.points > 0) };
    patch(s => ({ checks: [...s.checks.filter(c => !(c.routineId === routine.id && c.date === today)), next] }));
    if (!isDemo) {
      const { data } = await sb.from('routine_checks').upsert({ family_id: familyId, routine_id: routine.id, date: today, done_items: doneItems, completed_at: next.completedAt, awarded: next.awarded }, { onConflict: 'routine_id,date' }).select().single();
      if (data) patch(s => ({ checks: s.checks.map(c => c.routineId === routine.id && c.date === today ? { ...c, id: data.id } : c) }));
    }
    if (giveNow) {
      celebrate();
      if (routine.points > 0 && award) await award(routine.childId, routine.points, `${ROUTINE_LABEL[routine.kind]} הושלמה`);
      showToast(routine.points > 0 ? `כל הכבוד! +${routine.points} ⭐` : 'כל הכבוד! השגרה הושלמה');
    }
  };
  const saveSync = async (weekStart, fields) => {
    const existing = state.syncs.find(s => s.weekStart === weekStart);
    const row = { ...(existing || { id: 'local-' + rid(), weekStart, notes: '', mood: null, completedAt: null }), ...fields };
    patch(s => ({ syncs: [row, ...s.syncs.filter(x => x.weekStart !== weekStart)].sort((a, b) => b.weekStart.localeCompare(a.weekStart)) }));
    if (!isDemo) {
      const { error } = await sb.from('couple_syncs').upsert({ family_id: familyId, week_start: weekStart, notes: row.notes || null, mood: row.mood, completed_at: row.completedAt }, { onConflict: 'family_id,week_start' });
      if (error) showToast('שגיאה בשמירה');
    }
  };
  return { ...state, saveRoutine, toggleItem, checkOf, saveSync };
}

/* ---- התנגשויות בלו"ז: שני אירועים חופפים שכל אחד מהם צריך הורה (חוג = הסעה, פגישה, דייט) ---- */
function planConflicts(planner, me, days) {
  const out = [];
  const t = plToday();
  const span = e => { const s = toMinutes(e.startTime); return s == null ? null : [s, toMinutes(e.endTime) ?? s + 60]; };
  const needs = e => ['class', 'meeting', 'date'].includes(e.kind) && e.startTime;
  for (let d = 0; d < days; d++) {
    const day = plAddDays(t, d);
    const evs = planner.events.filter(e => needs(e) && plVisible(e, me, false) && plEventOn(e, day));
    for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) {
      const a = span(evs[i]), b = span(evs[j]);
      if (!a || !b || a[1] <= b[0] || b[1] <= a[0]) continue;
      // שני אירועים של אותו אדם (או שניהם זוגיים) הם בחירה, לא התנגשות של הסעות
      if (evs[i].personId && evs[i].personId === evs[j].personId) continue;
      out.push({ day, a: evs[i], b: evs[j] });
    }
  }
  return out;
}
const toMinutes = t => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const planWho = (planner, e) => e.personId ? (planner.members.find(m => m.id === e.personId) || {}).name : e.scope === 'couple' ? 'שניכם' : null;

/* ---- בורר הסעה: מי מסיע ומי מחזיר ---- */
function RideSelect({ planner, ev, field, label }) {
  const parents = planner.members.filter(m => m.kind === 'parent');
  const v = ev[field];
  return React.createElement('label', { className: 'ride-select' + (v ? '' : ' empty') },
    React.createElement('span', null, label),
    React.createElement('select', { value: v || '', 'aria-label': `${label}: ${ev.title}`, onChange: e => planner.updateEvent(ev, { [field]: e.target.value || null }) },
      React.createElement('option', { value: '' }, 'מי?'), parents.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))));
}

/* ======================= לשונית "סקירה" (לוח הבקרה של הבית) ======================= */
function PlanOverview({ planner, ch, extras, me, onNavigate, financeWeek }) {
  if (!planner.ready) return React.createElement('div', { className: 'ent-card p-6' }, 'טוען...');
  if (planner.unavailable) return React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המערך עוד לא הופעל בשרת. יש להריץ את tasks-schedule.sql ב-Supabase.');
  const today = plToday();
  const kids = planner.members.filter(m => m.kind === 'child');
  const evToday = planner.events.filter(e => plVisible(e, me, false) && plEventOn(e, today));
  const tasksToday = planner.tasks.filter(t => t.status !== 'done' && t.dueDate === today && plVisible(t, me, false));
  const overdue = planner.tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today && plVisible(t, me, false));
  // ציר הזמן של היום: אירועים ומשימות עם שעה לפי הסדר, ומה שבלי שעה למעלה
  const items = [
    ...evToday.map(e => ({ key: 'e' + e.id, time: e.startTime, title: e.title, who: planWho(planner, e), kind: e.kind, scope: e.scope })),
    ...tasksToday.map(t => ({ key: 't' + t.id, time: t.dueTime, title: t.title, who: t.personId && t.personId !== me.id ? (planner.members.find(m => m.id === t.personId) || {}).name : null, kind: 'task', scope: t.scope, task: t }))
  ].sort((a, b) => (toMinutes(a.time) ?? -1) - (toMinutes(b.time) ?? -1));
  const classesToday = evToday.filter(e => e.kind === 'class').sort((a, b) => (toMinutes(a.startTime) ?? 0) - (toMinutes(b.startTime) ?? 0));
  const conflicts = planConflicts(planner, me, 7);
  const stats = plWeekStats(planner.tasks.filter(t => plVisible(t, me, false)));
  const weekPts = ch && ch.ready && !ch.unavailable ? ch.points.filter(p => p.delta > 0 && p.createdAt >= new Date(Date.now() - 7 * 86400000).toISOString()).reduce((s, p) => s + p.delta, 0) : null;
  const pendingChores = ch && ch.ready && !ch.unavailable ? ch.runs.filter(r => r.status === 'done').length : 0;
  const routineDays = extras.ready && !extras.unavailable ? (() => {
    const act = extras.routines.filter(r => r.active && r.items.length);
    if (!act.length) return null;
    let total = 0, done = 0;
    for (let d = 1; d <= 7; d++) { const day = plAddDays(today, -d); act.forEach(r => { total++; if ((extras.checkOf(r.id, day) || {}).completedAt) done++; }); }
    return Math.round(done / total * 100);
  })() : null;
  const sw = syncWeekStart();
  const sync = extras.ready && !extras.unavailable ? extras.syncs.find(s => s.weekStart === sw) : null;
  const kindIcon = { class: '⚽', meeting: '💼', date: '❤️', general: '📅', task: '✅' };
  const money = v => `${financeWeek.currency}${Math.round(v).toLocaleString('he-IL')}`;

  return React.createElement('div', { className: 'space-y-6' },
    // היום
    React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('div', { className: 'flex flex-wrap items-baseline justify-between gap-2 mb-3' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'היום בבית'),
        React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-muted)' } }, plParse(today).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }))),
      overdue.length > 0 && React.createElement('button', { className: 'w-full text-right text-sm p-2.5 rounded-xl mb-3', style: { background: 'color-mix(in srgb, var(--neg) 10%, var(--navy-panel-2))', color: 'var(--neg-soft)' }, onClick: () => onNavigate('tasks') },
        `${overdue.length === 1 ? 'משימה אחת' : `${overdue.length} משימות`} באיחור: ${overdue.slice(0, 2).map(t => t.title).join(', ')}${overdue.length > 2 ? '...' : ''}`),
      !items.length ? React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-dim)' } }, 'אין כלום בלו"ז היום. יום רגוע.') :
      React.createElement('div', { className: 'plan-timeline' }, items.map(it => React.createElement('div', { key: it.key, className: 'plan-tl-item' },
        React.createElement('span', { className: 'plan-tl-time' }, it.time ? plTime(it.time) : 'היום'),
        React.createElement('span', { className: 'plan-tl-dot', style: { background: (PL_SCOPES[it.scope] || PL_SCOPES.family).color } }),
        React.createElement('div', { className: 'flex-1 min-w-0' },
          React.createElement('p', { className: 'text-sm font-semibold' }, kindIcon[it.kind] || '📅', ' ', it.title),
          it.who && React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, it.who)),
        it.task && React.createElement(PlCheck, { done: false, onClick: () => planner.toggleTask(it.task), label: `סימון כבוצע: ${it.title}` })))),
      pendingChores > 0 && React.createElement('button', { className: 'w-full text-right text-sm p-2.5 rounded-xl mt-3', style: { background: 'color-mix(in srgb, #fbbf24 10%, var(--navy-panel-2))' }, onClick: () => onNavigate('chores') },
        `⭐ ${pendingChores === 1 ? 'מטלה אחת מחכה' : `${pendingChores} מטלות מחכות`} לאישור שלכם`)),
    // הסעות היום
    classesToday.length > 0 && React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('h3', { className: 'ent-heading font-bold mb-2' }, 'מי מסיע היום'),
      classesToday.map(e => React.createElement('div', { key: e.id, className: 'ent-row py-2.5 flex flex-wrap items-center gap-3' },
        React.createElement('div', { className: 'flex-1 min-w-[140px]' },
          React.createElement('p', { className: 'text-sm font-semibold' }, `${plTime(e.startTime)} ${e.title}`),
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, [planWho(planner, e), e.location].filter(Boolean).join(' · '))),
        React.createElement(RideSelect, { planner, ev: e, field: 'driveTo', label: 'הלוך' }),
        React.createElement(RideSelect, { planner, ev: e, field: 'driveFrom', label: 'חזור' })))),
    // התנגשויות
    conflicts.length > 0 && React.createElement('div', { className: 'ent-card p-5', style: { borderColor: 'color-mix(in srgb, var(--neg) 40%, var(--line))' } },
      React.createElement('h3', { className: 'ent-heading font-bold mb-2' }, `⚠️ ${conflicts.length === 1 ? 'התנגשות אחת' : `${conflicts.length} התנגשויות`} בשבוע הקרוב`),
      conflicts.slice(0, 5).map((c, i) => React.createElement('p', { key: i, className: 'text-sm py-1', style: { color: 'var(--text-2)' } },
        React.createElement('b', null, `${plDueLabel(c.day)} ${plTime(c.a.startTime)}: `),
        `${c.a.title}${planWho(planner, c.a) ? ` (${planWho(planner, c.a)})` : ''} וגם ${c.b.title}${planWho(planner, c.b) ? ` (${planWho(planner, c.b)})` : ''}`))),
    // השבוע במספרים
    React.createElement('div', { className: 'plan-stats' },
      React.createElement('button', { className: 'ent-card plan-stat', onClick: () => onNavigate('tasks') },
        React.createElement('p', { className: 'plan-stat-num', style: { color: 'var(--pos)' } }, stats.onTimePct == null ? '—' : `${stats.onTimePct}%`),
        React.createElement('p', { className: 'plan-stat-label' }, 'משימות בזמן השבוע')),
      weekPts != null && kids.length > 0 && React.createElement('button', { className: 'ent-card plan-stat', onClick: () => onNavigate('chores') },
        React.createElement('p', { className: 'plan-stat-num', style: { color: '#fbbf24' } }, `⭐ ${weekPts}`),
        React.createElement('p', { className: 'plan-stat-label' }, 'נקודות שהילדים צברו השבוע')),
      routineDays != null && React.createElement('button', { className: 'ent-card plan-stat', onClick: () => onNavigate('routines') },
        React.createElement('p', { className: 'plan-stat-num', style: { color: 'var(--cyan)' } }, `${routineDays}%`),
        React.createElement('p', { className: 'plan-stat-label' }, 'שגרות שהושלמו ב-7 ימים')),
      financeWeek.weeklyBudget > 0 && React.createElement('div', { className: 'ent-card plan-stat' },
        React.createElement('p', { className: 'plan-stat-num', style: { color: financeWeek.weekSpent > financeWeek.weeklyBudget ? 'var(--neg)' : 'var(--text)' } }, money(financeWeek.weekSpent)),
        React.createElement('p', { className: 'plan-stat-label' }, `הוצאות השבוע מתוך ${money(financeWeek.weeklyBudget)}`))),
    // ישיבת השבוע
    !extras.unavailable && React.createElement('button', { className: 'ent-card w-full p-5 text-right flex items-center justify-between gap-3 plan-sync-cta', onClick: () => onNavigate('sync') },
      React.createElement('div', null,
        React.createElement('p', { className: 'font-bold' }, '💑 ישיבת השבוע שלכם'),
        React.createElement('p', { className: 'text-sm mt-0.5', style: { color: 'var(--text-muted)' } }, sync && sync.completedAt ? 'בוצעה השבוע. כל הכבוד לכם' : '10 דקות ביחד: מה היה, מה מתוכנן, ומה מחליטים')),
      React.createElement('span', { className: 'text-sm font-bold', style: { color: sync && sync.completedAt ? 'var(--pos)' : 'var(--bronze)' } }, sync && sync.completedAt ? '✓' : 'להתחיל ←')));
}

/* ======================= לשונית "שגרות" ======================= */
function KidRoutineView({ extras, ch, kidId }) {
  const [kind, setKind] = useState(routineNow);
  const r = extras.routines.find(x => x.childId === kidId && x.kind === kind && x.active);
  const check = r ? extras.checkOf(r.id, plToday()) : null;
  const done = check ? check.doneItems : [];
  const pct = r && r.items.length ? Math.round(r.items.filter(i => done.includes(i.id)).length / r.items.length * 100) : 0;
  return React.createElement('div', { className: 'space-y-5' },
    React.createElement('div', { className: 'flex gap-2' }, ['morning', 'evening'].map(k => React.createElement('button', { key: k, type: 'button', 'aria-pressed': kind === k, onClick: () => setKind(k), className: 'ent-pill-btn px-4 py-2 text-sm',
      style: { background: kind === k ? 'var(--bronze)' : 'var(--navy-panel-2)', color: kind === k ? 'var(--on-accent)' : 'var(--text-2)' } }, k === 'morning' ? '☀️ בוקר' : '🌙 ערב'))),
    !r ? React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: `עוד אין ${ROUTINE_LABEL[kind]}`, hint: 'אפשר לבקש מההורים להכין אחת' })) :
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, ROUTINE_LABEL[kind]),
        r.points > 0 && React.createElement('span', { className: 'text-sm font-bold', style: { color: '#fbbf24' } }, `+${r.points} ⭐ בסוף`)),
      React.createElement('div', { className: 'h-3 rounded-full overflow-hidden', style: { background: 'var(--line)' } },
        React.createElement('div', { className: 'h-full rounded-full chore-bar', style: { width: `${pct}%` } })),
      React.createElement('div', { className: 'space-y-2' }, r.items.map(i => {
        const on = done.includes(i.id);
        return React.createElement('button', { key: i.id, type: 'button', 'aria-pressed': on, className: 'routine-item' + (on ? ' on' : ''), onClick: () => extras.toggleItem(r, i.id, ch && ch.award) },
          React.createElement('span', { className: 'routine-icon', 'aria-hidden': 'true' }, i.icon),
          React.createElement('span', { className: 'flex-1 text-right font-semibold' }, i.text),
          React.createElement('span', { className: 'routine-tick', 'aria-hidden': 'true' }, on ? '✓' : ''));
      })),
      check && check.completedAt && React.createElement('p', { className: 'text-center font-bold', style: { color: 'var(--pos)' } }, '🎉 סיימת את כל השגרה!')));
}

function RoutineEditor({ extras, kid }) {
  const [kind, setKind] = useState('morning');
  const r = extras.routines.find(x => x.childId === kid.id && x.kind === kind);
  const [items, setItems] = useState(null);
  const [points, setPoints] = useState(null);
  const [text, setText] = useState('');
  const [icon, setIcon] = useState('⭐');
  const list = items || (r ? r.items : []);
  const pts = points != null ? points : r ? r.points : 3;
  const dirty = items != null || points != null;
  const check = r ? extras.checkOf(r.id, plToday()) : null;
  const doneN = r && check ? r.items.filter(i => check.doneItems.includes(i.id)).length : 0;
  const switchKind = k => { setKind(k); setItems(null); setPoints(null); };
  const save = async () => { await extras.saveRoutine(kid.id, kind, list, Number(pts) || 0); setItems(null); setPoints(null); };
  const add = () => { if (!text.trim()) return; setItems([...list, { id: rid(), icon, text: text.trim() }]); setText(''); };
  return React.createElement('div', { className: 'ent-card p-5 space-y-3' },
    React.createElement('div', { className: 'flex items-center justify-between gap-2' },
      React.createElement('div', { className: 'flex items-center gap-2' }, React.createElement(InitialAvatar, { name: kid.name, size: 28 }), React.createElement('h3', { className: 'ent-heading font-bold' }, kid.name)),
      React.createElement('div', { className: 'flex gap-1' }, ['morning', 'evening'].map(k => React.createElement('button', { key: k, type: 'button', 'aria-pressed': kind === k, onClick: () => switchKind(k), className: 'ent-pill-btn px-3 py-1 text-xs',
        style: { background: kind === k ? 'var(--bronze)' : 'var(--navy-panel-2)', color: kind === k ? 'var(--on-accent)' : 'var(--text-2)' } }, k === 'morning' ? '☀️ בוקר' : '🌙 ערב')))),
    r && r.items.length > 0 && !dirty && React.createElement('p', { className: 'text-xs', style: { color: doneN === r.items.length ? 'var(--pos)' : 'var(--text-muted)' } },
      doneN === r.items.length ? '✓ הושלמה היום' : `היום: ${doneN} מתוך ${r.items.length}`),
    !list.length && React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => setItems(ROUTINE_TEMPLATES[kind].map(([ic, t]) => ({ id: rid(), icon: ic, text: t }))) }, `✨ להתחיל מתבנית מוכנה של ${ROUTINE_LABEL[kind]}`),
    list.map((i, idx) => React.createElement('div', { key: i.id, className: 'flex items-center gap-2 text-sm py-1' },
      React.createElement('span', { 'aria-hidden': 'true' }, i.icon), React.createElement('span', { className: 'flex-1' }, i.text),
      idx > 0 && React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `להזיז למעלה: ${i.text}`, onClick: () => { const n = [...list]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; setItems(n); } }, '↑'),
      React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `הסרה: ${i.text}`, onClick: () => setItems(list.filter(x => x.id !== i.id)) }, React.createElement(IX, { size: 13 })))),
    React.createElement('div', { className: 'flex gap-2' },
      React.createElement('select', { className: 'ent-input px-2 py-2 rounded-xl text-sm outline-none', 'aria-label': 'אייקון', value: icon, onChange: e => setIcon(e.target.value) }, ROUTINE_ICONS.map(ic => React.createElement('option', { key: ic, value: ic }, ic))),
      React.createElement('input', { className: 'ent-input flex-1 px-3 py-2 rounded-xl text-sm outline-none', placeholder: 'פריט חדש', value: text, onChange: e => setText(e.target.value), onKeyDown: e => { if (e.key === 'Enter') add(); } }),
      React.createElement('button', { className: 'ent-pill-btn ghost px-3 text-sm', onClick: add, 'aria-label': 'הוספת פריט' }, React.createElement(IPlus, { size: 15 }))),
    React.createElement('div', { className: 'flex items-center gap-2 text-sm' },
      React.createElement('span', { style: { color: 'var(--text-muted)' } }, 'נקודות על השלמת השגרה:'),
      React.createElement('input', { className: 'ent-input px-2 py-1.5 rounded-lg text-sm outline-none', style: { width: 64 }, type: 'number', min: 0, max: 100, value: pts, onChange: e => setPoints(e.target.value), 'aria-label': 'נקודות על השלמת השגרה' })),
    dirty && React.createElement('button', { className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm', onClick: save }, 'שמירת השגרה'));
}

function RoutinesPage({ extras, ch, planner, me, isChild, isPremium, onUpgrade }) {
  if (!isPremium) return React.createElement(PremiumLock, { title: 'שגרות הן תכונת פרימיום', desc: 'שגרת בוקר וערב לכל ילד, עם צ\'קליסט ונקודות.', onUpgrade });
  if (!extras.ready) return React.createElement('div', { className: 'ent-card p-6' }, 'טוען...');
  if (extras.unavailable) return React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'השגרות עוד לא הופעלו בשרת. יש להריץ את plan.sql ב-Supabase.');
  if (isChild) return React.createElement(KidRoutineView, { extras, ch, kidId: me.id });
  const kids = planner.members.filter(m => m.kind === 'child');
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'שגרות'),
      React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, 'צ\'קליסט קבוע לבוקר ולערב. הילד מסמן בעצמו ב"שגרות", ובסוף מקבל נקודות.')),
    !kids.length ? React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: 'עוד אין פרופילים של ילדים' })) :
    React.createElement('div', { className: 'ev-kids' }, kids.map(k => React.createElement(RoutineEditor, { key: k.id, extras, kid: k }))));
}

/* ======================= לשונית "ישיבת שבוע" (הורים) ======================= */
function CoupleSyncPage({ planner, ch, extras, me, isPremium, onUpgrade, financeWeek, onNavigate }) {
  const sw = syncWeekStart();
  const current = extras.ready ? extras.syncs.find(s => s.weekStart === sw) : null;
  const [notes, setNotes] = useState(null);
  const [task, setTask] = useState({ title: '', personId: '' });
  if (!isPremium) return React.createElement(PremiumLock, { title: 'ישיבת שבוע זוגית היא תכונת פרימיום', desc: 'עשר דקות בשבוע לסנכרן את הבית: מה היה, מה מתוכנן ומה מחליטים.', onUpgrade });
  if (!extras.ready || !planner.ready) return React.createElement('div', { className: 'ent-card p-6' }, 'טוען...');
  if (extras.unavailable) return React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'ישיבת השבוע עוד לא הופעלה בשרת. יש להריץ את plan.sql ב-Supabase.');
  const today = plToday();
  const text = notes != null ? notes : current ? current.notes : '';
  const parents = planner.members.filter(m => m.kind === 'parent');
  const money = v => `${financeWeek.currency}${Math.round(v).toLocaleString('he-IL')}`;
  // השבוע שהיה: 7 הימים האחרונים
  const from = plAddDays(today, -7);
  const vis = planner.tasks.filter(t => plVisible(t, me, false));
  const doneWeek = vis.filter(t => t.status === 'done' && t.doneAt && plIso(new Date(t.doneAt)) >= from).length;
  const openOver = vis.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today).length;
  const lastDate = planner.events.filter(e => e.kind === 'date' && e.startDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const weekPts = ch && ch.ready && !ch.unavailable ? ch.points.filter(p => p.delta > 0 && p.createdAt >= new Date(Date.now() - 7 * 86400000).toISOString()).reduce((s, p) => s + p.delta, 0) : null;
  // השבוע הבא
  const ahead = Array.from({ length: 7 }, (_, i) => plAddDays(sw > today ? sw : today, i));
  const upcoming = ahead.map(day => ({ day, evs: planner.events.filter(e => plVisible(e, me, false) && plEventOn(e, day)).sort((a, b) => (toMinutes(a.startTime) ?? 0) - (toMinutes(b.startTime) ?? 0)) })).filter(d => d.evs.length);
  const conflicts = planConflicts(planner, me, 8);
  const unassigned = planner.events.filter(e => e.kind === 'class' && plVisible(e, me, false) && (!e.driveTo || !e.driveFrom));
  const nextDate = planner.events.find(e => e.kind === 'date' && e.startDate >= today);
  const saveNotes = () => extras.saveSync(sw, { notes: text });
  const finish = async () => { await extras.saveSync(sw, { notes: text, completedAt: new Date().toISOString() }); celebrate(); };
  const addTask = async () => {
    if (!task.title.trim()) return;
    const person = parents.find(p => p.id === task.personId);
    const ok = await planner.addTask({ title: task.title, scope: 'couple', personId: person ? person.id : null, personKind: person ? 'parent' : null, dueDate: plAddDays(sw > today ? sw : today, 6), repeat: 'none' });
    if (ok) setTask({ title: '', personId: task.personId });
  };
  const step = (n, title, body) => React.createElement('div', { className: 'ent-card p-5 space-y-2' },
    React.createElement('div', { className: 'flex items-center gap-2' }, React.createElement('span', { className: 'sync-step' }, n), React.createElement('h3', { className: 'ent-heading font-bold' }, title)), body);
  const fact = (label, value, color) => React.createElement('div', { className: 'sync-fact' }, React.createElement('p', { className: 'font-bold', style: { color: color || 'var(--text)' } }, value), React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, label));

  return React.createElement('div', { className: 'space-y-5' },
    React.createElement('div', { className: 'ent-card sync-hero p-6' },
      React.createElement('p', { className: 'text-xs font-semibold', style: { color: '#f472b6' } }, `השבוע של ${plParse(sw).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}`),
      React.createElement('h2', { className: 'ent-heading text-2xl font-bold mt-1' }, '💑 ישיבת השבוע שלכם'),
      React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-2)' } }, current && current.completedAt ? '✓ סגרתם את השבוע. אפשר לחזור ולעדכן.' : 'עשר דקות ביחד, עם כוס קפה. ארבעה שלבים קצרים.')),
    step(1, 'השבוע שהיה', React.createElement('div', { className: 'sync-facts' },
      fact('משימות שבוצעו', doneWeek, 'var(--pos)'),
      fact('באיחור עכשיו', openOver, openOver ? 'var(--neg)' : 'var(--text)'),
      financeWeek.weeklyBudget > 0 && fact(`הוצאות מתוך ${money(financeWeek.weeklyBudget)}`, money(financeWeek.weekSpent), financeWeek.weekSpent > financeWeek.weeklyBudget ? 'var(--neg)' : 'var(--pos)'),
      weekPts != null && fact('נקודות של הילדים', `⭐ ${weekPts}`, '#fbbf24'),
      fact('הדייט האחרון', lastDate ? `${Math.round((plParse(today) - plParse(lastDate.startDate)) / 86400000)} ימים` : 'עוד לא היה', '#f472b6'))),
    step(2, 'השבוע שמתוכנן', React.createElement(React.Fragment, null,
      !upcoming.length ? React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-dim)' } }, 'הלו"ז ריק. זה הזמן להכניס מה שידוע.') :
        upcoming.map(d => React.createElement('div', { key: d.day, className: 'text-sm py-1' },
          React.createElement('b', null, `${PL_DAYS[plParse(d.day).getDay()]}: `),
          React.createElement('span', { style: { color: 'var(--text-2)' } }, d.evs.map(e => `${e.startTime ? plTime(e.startTime) + ' ' : ''}${e.title}${planWho(planner, e) ? ` (${planWho(planner, e)})` : ''}`).join(' · ')))),
      conflicts.length > 0 && React.createElement('p', { className: 'text-sm', style: { color: 'var(--neg-soft)' } }, `⚠️ ${conflicts.length === 1 ? 'התנגשות אחת' : `${conflicts.length} התנגשויות`}: ${conflicts.slice(0, 2).map(c => `${PL_DAYS[plParse(c.day).getDay()]} ${plTime(c.a.startTime)} ${c.a.title} / ${c.b.title}`).join(', ')}`),
      unassigned.length > 0 && React.createElement('button', { className: 'text-sm underline', style: { color: 'var(--bronze)' }, onClick: () => onNavigate('plan') }, `🚗 ${unassigned.length === 1 ? 'חוג אחד' : `${unassigned.length} חוגים`} בלי הסעה מוגדרת`),
      !nextDate && React.createElement('button', { className: 'text-sm underline block', style: { color: '#f472b6' }, onClick: () => onNavigate('dates') }, '❤️ עוד אין דייט מתוכנן. לתכנן?'))),
    step(3, 'החלטות ומשימות', React.createElement(React.Fragment, null,
      React.createElement('textarea', { className: 'ent-input w-full px-4 py-3 rounded-xl text-sm outline-none', rows: 4, placeholder: 'מה החלטנו? (למשל: אבא מסיע לכדורגל, לא קונים כלום גדול החודש...)', value: text, onChange: e => setNotes(e.target.value), onBlur: () => notes != null && saveNotes() }),
      React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: '2fr 1fr auto' } },
        React.createElement('input', { className: 'ent-input px-3 py-2.5 rounded-xl text-sm outline-none', placeholder: 'משימה שיצאה מהישיבה', value: task.title, onChange: e => setTask({ ...task, title: e.target.value }), onKeyDown: e => { if (e.key === 'Enter') addTask(); } }),
        React.createElement('select', { className: 'ent-input px-3 py-2.5 rounded-xl text-sm outline-none', 'aria-label': 'מי אחראי', value: task.personId, onChange: e => setTask({ ...task, personId: e.target.value }) },
          React.createElement('option', { value: '' }, 'שנינו'), parents.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))),
        React.createElement('button', { className: 'ent-pill-btn ghost px-3 text-sm', onClick: addTask }, 'הוספה')))),
    step(4, 'איך היה לנו השבוע?', React.createElement('div', { className: 'flex gap-2' }, [['😫', 1], ['😕', 2], ['🙂', 3], ['😊', 4], ['🥰', 5]].map(([f, v]) =>
      React.createElement('button', { key: v, type: 'button', 'aria-pressed': current && current.mood === v, 'aria-label': `מצב רוח ${v} מתוך 5`, className: 'sync-mood' + (current && current.mood === v ? ' on' : ''), onClick: () => extras.saveSync(sw, { mood: v, notes: text }) }, f)))),
    React.createElement('button', { className: 'ent-pill-btn solid-bronze w-full py-3 text-sm', onClick: finish }, current && current.completedAt ? 'עדכון הישיבה' : 'סגרנו את השבוע ✓'),
    extras.syncs.filter(s => s.weekStart !== sw && (s.notes || s.mood)).length > 0 && React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('h3', { className: 'ent-heading font-bold mb-2' }, 'ישיבות קודמות'),
      extras.syncs.filter(s => s.weekStart !== sw && (s.notes || s.mood)).slice(0, 6).map(s => React.createElement('div', { key: s.id, className: 'ent-row py-2 text-sm' },
        React.createElement('p', { className: 'font-semibold' }, `${plParse(s.weekStart).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}${s.mood ? ' ' + ['😫', '😕', '🙂', '😊', '🥰'][s.mood - 1] : ''}`),
        s.notes && React.createElement('p', { style: { color: 'var(--text-2)', whiteSpace: 'pre-wrap' } }, s.notes)))));
}
