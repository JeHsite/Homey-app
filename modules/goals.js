/* Homey — מערך "יעדים אישיים" כאפליקציה: יעדים עם מדד התקדמות (אבני דרך / מספר / קופת חיסכון),
 * הרגלים עם רצף ימים, וצ'ק-אין שבועי. כל הורה רואה את שלו, ויכול לעבור לילדים. ילד רואה את שלו.
 * טבלאות: personal_goals (מורחבת), habits, habit_logs, goal_checkins (supabase/goals-app.sql).
 * נטען לפני הסקריפט הראשי ומשתמש בגלובליים שלו ובפונקציות התאריך של modules/tasks.js בזמן רינדור. */

const HABIT_ICONS = ['✨', '🏃', '📚', '💧', '🧘', '🥗', '🚫🍬', '💪', '😴', '📝', '🎸', '🙏', '🚶', '📵', '🦷'];
const areaIcon = a => (PERSONAL_AREAS.find(x => x[0] === a) || ['', '🎯'])[1];
const goalFromRow = r => ({ id: r.id, title: r.title, area: r.area || 'אחר', deadline: r.deadline ? String(r.deadline).slice(0, 10) : null, steps: r.steps || [],
  done: !!r.done, doneAt: r.done_at || null, progressKind: r.progress_kind || 'steps', target: r.target == null ? null : Number(r.target),
  current: Number(r.current || 0), unit: r.unit || '', potId: r.pot_id || null, why: r.why || '' });

// התקדמות 0..1 של יעד, לפי סוג המדד
function goalProgress(g, pots) {
  if (g.done) return 1;
  if (g.progressKind === 'number') return g.target > 0 ? Math.min(1, g.current / g.target) : 0;
  if (g.progressKind === 'savings') { const p = (pots || []).find(x => x.id === g.potId); return p && p.target > 0 ? Math.min(1, p.current / p.target) : 0; }
  return g.steps.length ? g.steps.filter(s => s.done).length / g.steps.length : 0;
}
// רצף של הרגל: יומי = ימים רצופים (היום נספר אם כבר בוצע, אחרת מתחילים מאתמול). שבועי = שבועות רצופים שעמדו ביעד
function habitStreak(h, logs) {
  const days = new Set(logs.filter(l => l.habitId === h.id).map(l => l.date));
  const today = plToday();
  if (h.perWeek >= 7) {
    let d = days.has(today) ? today : plAddDays(today, -1), n = 0;
    while (days.has(d)) { n++; d = plAddDays(d, -1); }
    return { n, unit: n === 1 ? 'יום' : 'ימים' };
  }
  const weekCount = ws => Array.from({ length: 7 }, (_, i) => plAddDays(ws, i)).filter(x => days.has(x)).length;
  let ws = plWeekStart(today), n = 0;
  if (weekCount(ws) < h.perWeek) ws = plAddDays(ws, -7);
  while (weekCount(ws) >= h.perWeek) { n++; ws = plAddDays(ws, -7); }
  return { n, unit: n === 1 ? 'שבוע' : 'שבועות' };
}
const habitDoneOn = (h, logs, d) => logs.some(l => l.habitId === h.id && l.date === d);
const daysLeftTo = d => d ? Math.round((plParse(d) - plParse(plToday())) / 86400000) : null;

function goalsDemo(ownerId, isKid) {
  const t = plToday();
  if (isKid) {
    return {
      goals: [{ id: 'kg1', title: 'לקרוא 10 ספרים', area: 'לימודים', deadline: plAddDays(t, 120), steps: [], done: false, progressKind: 'number', target: 10, current: 4, unit: 'ספרים', potId: null, why: 'כדי לזכות בתחרות הקריאה של הכיתה' },
        { id: 'kg2', title: 'ללמוד לרכוב על אופניים בלי גלגלי עזר', area: 'כושר ובריאות', deadline: null, steps: [{ text: 'לשמור על שיווי משקל', done: true }, { text: 'לרכוב 10 מטר לבד', done: false }, { text: 'לרכוב סביב הבניין', done: false }], done: false, progressKind: 'steps', target: null, current: 0, unit: '', potId: null, why: '' }],
      habits: [{ id: 'kh1', title: 'לקרוא 15 דקות', icon: '📚', perWeek: 7, goalId: 'kg1', active: true }, { id: 'kh2', title: 'לצחצח שיניים בערב', icon: '🦷', perWeek: 7, goalId: null, active: true }],
      logs: [1, 2, 3, 4, 6, 7].map(d => ({ id: 'kl' + d, habitId: 'kh1', date: plAddDays(t, -d) })).concat([0, 1, 2, 3].map(d => ({ id: 'kl2' + d, habitId: 'kh2', date: plAddDays(t, -d) }))),
      checkins: []
    };
  }
  const goals = [
    { id: 'pg1', title: 'לרוץ 10 ק"מ ברצף', area: 'כושר ובריאות', deadline: plAddDays(t, 75), steps: [], done: false, progressKind: 'number', target: 10, current: 6, unit: 'ק"מ', potId: null, why: 'להרגיש חזק ובריא, ולרוץ עם הילדים בלי להתנשף' },
    { id: 'pg2', title: 'לקרוא 12 ספרים השנה', area: 'תחביב', deadline: `${new Date().getFullYear()}-12-31`, steps: [], done: false, progressKind: 'number', target: 12, current: 9, unit: 'ספרים', potId: null, why: '' },
    { id: 'pg3', title: 'קרן חירום מלאה', area: 'משפחה וזוגיות', deadline: plAddDays(t, 240), steps: [], done: false, progressKind: 'savings', target: null, current: 0, unit: '', potId: 1, why: 'שקט נפשי. שאף חודש לא יפיל אותנו' },
    { id: 'pg4', title: 'ללמוד פייתון', area: 'קריירה ועבודה', deadline: plAddDays(t, 150), steps: [{ text: 'קורס מבוא', done: true }, { text: 'פרויקט ראשון', done: true }, { text: 'אוטומציה בעבודה', done: false }, { text: 'פרויקט עם נתונים', done: false }], done: false, progressKind: 'steps', target: null, current: 0, unit: '', potId: null, why: '' }
  ];
  const habits = [{ id: 'ph1', title: 'ריצה', icon: '🏃', perWeek: 3, goalId: 'pg1', active: true }, { id: 'ph2', title: 'לקרוא 20 דקות', icon: '📚', perWeek: 7, goalId: 'pg2', active: true }, { id: 'ph3', title: 'בלי מתוקים', icon: '🚫🍬', perWeek: 7, goalId: null, active: true }];
  const logs = [];
  for (let d = 1; d <= 34; d++) {
    if ([1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26, 29, 31].includes(d)) logs.push({ id: 'l1' + d, habitId: 'ph1', date: plAddDays(t, -d) });
    if (d <= 11 || (d > 13 && d % 3)) logs.push({ id: 'l2' + d, habitId: 'ph2', date: plAddDays(t, -d) });
    if (d <= 4 || (d > 6 && d < 14)) logs.push({ id: 'l3' + d, habitId: 'ph3', date: plAddDays(t, -d) });
  }
  const lw = plAddDays(plWeekStart(t), -7);
  const checkins = [3, 2, 1].flatMap(w => [{ id: 'c1' + w, goalId: 'pg1', weekStart: plAddDays(lw, -7 * (w - 1)), score: [3, 4, 4][3 - w], note: '' }, { id: 'c4' + w, goalId: 'pg4', weekStart: plAddDays(lw, -7 * (w - 1)), score: [2, 3, 4][3 - w], note: '' }]);
  return { goals, habits, logs, checkins };
}

/* ---- נתוני היעדים של בעלים אחד (אני או ילד) ---- */
function useGoalsApp({ familyId, isDemo, enabled, owner, showToast }) {
  const [state, setState] = useState({ ready: false, unavailable: false, goals: [], habits: [], logs: [], checkins: [] });
  const ownerKey = owner ? owner.kind + owner.id : '';
  useEffect(() => {
    if (!enabled || !familyId || !owner) return;
    if (isDemo) { setState({ ready: true, unavailable: false, ...goalsDemo(owner.id, owner.kind === 'child') }); return; }
    let alive = true;
    setState(s => ({ ...s, ready: false }));
    (async () => {
      const since = plAddDays(plToday(), -70);
      const [g, h, l, c] = await Promise.all([
        sb.from('personal_goals').select('*').eq('owner_id', owner.id).order('created_at'),
        sb.from('habits').select('*').eq('owner_id', owner.id).order('created_at'),
        sb.from('habit_logs').select('*').eq('owner_id', owner.id).gte('date', since),
        sb.from('goal_checkins').select('*').eq('owner_id', owner.id).order('week_start')
      ]);
      if (!alive) return;
      if (g.error || h.error || l.error || c.error) return setState(s => ({ ...s, ready: true, unavailable: true }));
      setState({
        ready: true, unavailable: false,
        goals: (g.data || []).map(goalFromRow),
        habits: (h.data || []).map(r => ({ id: r.id, title: r.title, icon: r.icon, perWeek: r.per_week, goalId: r.goal_id, active: r.active })),
        logs: (l.data || []).map(r => ({ id: r.id, habitId: r.habit_id, date: String(r.date).slice(0, 10) })),
        checkins: (c.data || []).map(r => ({ id: r.id, goalId: r.goal_id, weekStart: String(r.week_start).slice(0, 10), score: r.score, note: r.note || '' }))
      });
    })();
    return () => { alive = false; };
  }, [enabled, familyId, isDemo, ownerKey]);
  const patch = fn => setState(s => ({ ...s, ...fn(s) }));
  const tmp = () => 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);
  const own = () => ({ family_id: familyId, owner_id: owner.id, owner_kind: owner.kind });
  const dbGoal = c => {
    const map = { title: 'title', area: 'area', deadline: 'deadline', steps: 'steps', done: 'done', doneAt: 'done_at', progressKind: 'progress_kind', target: 'target', current: 'current', unit: 'unit', potId: 'pot_id', why: 'why' };
    const o = {};
    Object.entries(c).forEach(([k, v]) => { if (map[k]) o[map[k]] = v; });
    return o;
  };
  const addGoal = async g => {
    if (!g.title.trim()) { showToast('כתבו מה היעד'); return null; }
    const row = { title: g.title.trim(), area: g.area || 'אחר', deadline: g.deadline || null, steps: [], done: false, doneAt: null, progressKind: g.progressKind || 'steps',
      target: g.target === '' || g.target == null ? null : Number(g.target), current: Number(g.current) || 0, unit: g.unit || '', potId: g.potId || null, why: g.why || '' };
    let id = tmp();
    if (!isDemo) {
      const { data, error } = await sb.from('personal_goals').insert({ ...own(), ...dbGoal(row) }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return null; }
      id = data.id;
    }
    patch(s => ({ goals: [...s.goals, { ...row, id }] }));
    return true;
  };
  const updateGoal = async (g, changes) => {
    patch(s => ({ goals: s.goals.map(x => x.id === g.id ? { ...x, ...changes } : x) }));
    if (!isDemo) await sb.from('personal_goals').update(dbGoal(changes)).eq('id', g.id);
  };
  const completeGoal = async g => {
    await updateGoal(g, { done: !g.done, doneAt: g.done ? null : new Date().toISOString() });
    if (!g.done) { celebrate(); showToast(`🏆 השגת את "${g.title}"!`); }
  };
  const deleteGoal = async g => {
    patch(s => ({ goals: s.goals.filter(x => x.id !== g.id), habits: s.habits.map(h => h.goalId === g.id ? { ...h, goalId: null } : h) }));
    if (!isDemo) await sb.from('personal_goals').delete().eq('id', g.id);
  };
  const addHabit = async h => {
    if (!h.title.trim()) { showToast('כתבו מה ההרגל'); return null; }
    const row = { title: h.title.trim(), icon: h.icon || '✨', perWeek: Number(h.perWeek) || 7, goalId: h.goalId || null, active: true };
    let id = tmp();
    if (!isDemo) {
      const { data, error } = await sb.from('habits').insert({ ...own(), title: row.title, icon: row.icon, per_week: row.perWeek, goal_id: row.goalId }).select().single();
      if (error) { showToast(/premium_required/.test(error.message) ? 'הרגלים הם תכונת פרימיום' : 'שגיאה בשמירה'); return null; }
      id = data.id;
    }
    patch(s => ({ habits: [...s.habits, { ...row, id }] }));
    return true;
  };
  const deleteHabit = async h => {
    patch(s => ({ habits: s.habits.filter(x => x.id !== h.id), logs: s.logs.filter(l => l.habitId !== h.id) }));
    if (!isDemo) await sb.from('habits').delete().eq('id', h.id);
  };
  // סימון/ביטול של הרגל ביום מסוים (ברירת מחדל: היום). כשסוגרים רצף חדש של 7 — חגיגה קטנה
  const toggleHabit = async (h, date) => {
    const d = date || plToday();
    const existing = state.logs.find(l => l.habitId === h.id && l.date === d);
    if (existing) {
      patch(s => ({ logs: s.logs.filter(l => l.id !== existing.id) }));
      if (!isDemo) await sb.from('habit_logs').delete().eq('habit_id', h.id).eq('date', d);
      return;
    }
    let id = tmp();
    if (!isDemo) {
      const { data, error } = await sb.from('habit_logs').upsert({ ...own(), habit_id: h.id, date: d }, { onConflict: 'habit_id,date' }).select().single();
      if (error) return showToast('שגיאה בשמירה');
      id = data.id;
    }
    const logs = [...state.logs, { id, habitId: h.id, date: d }];
    patch(() => ({ logs }));
    const st = habitStreak(h, logs);
    if (d === plToday() && h.perWeek >= 7 && st.n > 0 && st.n % 7 === 0) { celebrate(); showToast(`🔥 ${st.n} ימים ברצף! מדהים`); }
  };
  const saveCheckin = async (goal, score, note) => {
    const ws = plWeekStart(plToday());
    const prev = state.checkins.find(c => c.goalId === goal.id && c.weekStart === ws);
    const row = { id: prev ? prev.id : tmp(), goalId: goal.id, weekStart: ws, score, note: note || '' };
    patch(s => ({ checkins: [...s.checkins.filter(c => !(c.goalId === goal.id && c.weekStart === ws)), row] }));
    if (!isDemo) await sb.from('goal_checkins').upsert({ ...own(), goal_id: goal.id, week_start: ws, score, note: note || null }, { onConflict: 'goal_id,week_start' });
  };
  return { ...state, addGoal, updateGoal, completeGoal, deleteGoal, addHabit, deleteHabit, toggleHabit, saveCheckin };
}

function goalsHubSummary(g) {
  if (!g.ready || g.unavailable) return null;
  const active = g.goals.filter(x => !x.done);
  const habits = g.habits.filter(h => h.active);
  if (!active.length && !habits.length) return null;
  const best = habits.reduce((m, h) => Math.max(m, habitStreak(h, g.logs).n), 0);
  const today = plToday();
  const dailyHabits = habits.filter(h => h.perWeek >= 7);
  const doneToday = habits.filter(h => habitDoneOn(h, g.logs, today)).length;
  return {
    big: best > 1 ? `🔥 ${best} ברצף` : active.length === 1 ? 'יעד פעיל אחד' : `${active.length} יעדים פעילים`,
    tone: best > 1 ? '#f97316' : 'var(--text)',
    line: [habits.length ? `היום: ${doneToday} מתוך ${habits.length} הרגלים` : null, best > 1 && active.length ? `${active.length} יעדים` : null].filter(Boolean).join(' · ') || (dailyHabits.length ? '' : 'יעדים ואבני דרך')
  };
}

const goalsGate = (g, isPremium, onUpgrade) => !isPremium ? React.createElement(PremiumLock, { title: 'יעדים אישיים הם תכונת פרימיום', desc: 'יעדים עם מדד התקדמות, הרגלים יומיים עם רצף ימים, וצ\'ק-אין שבועי.', onUpgrade })
  : !g.ready ? React.createElement('div', { className: 'ent-card p-6' }, 'טוען...')
  : g.unavailable ? React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המערך עוד לא הופעל בשרת. יש להריץ את goals-app.sql ב-Supabase.') : null;

// בורר "של מי" להורים: היעדים שלי או של אחד הילדים
function GoalsOwnerPicker({ owners, ownerId, onChange }) {
  if (!owners || owners.length < 2) return null;
  return React.createElement('div', { className: 'flex flex-wrap gap-1.5', role: 'radiogroup', 'aria-label': 'של מי היעדים' }, owners.map(o =>
    React.createElement('button', { key: o.id, type: 'button', role: 'radio', 'aria-checked': o.id === ownerId, onClick: () => onChange(o.id), className: 'ent-pill-btn flex items-center gap-1.5 px-3 py-1 text-xs',
      style: { background: o.id === ownerId ? 'var(--bronze)' : 'var(--navy-panel-2)', color: o.id === ownerId ? 'var(--on-accent)' : 'var(--text-2)' } }, o.label)));
}

// טבעת התקדמות קטנה
function GoalRing({ value, size = 56, color = 'var(--pos)', label }) {
  const pct = Math.round(value * 100);
  return React.createElement('div', { className: 'goal-ring', style: { '--p': pct, '--c': color, width: size, height: size }, role: 'img', 'aria-label': label || `${pct}%` },
    React.createElement('span', { style: { fontSize: size > 60 ? 16 : 13 } }, `${pct}%`));
}

/* ---- שורת הרגל עם 7 ימים אחרונים ורצף ---- */
function HabitRow({ g, h, compact }) {
  const today = plToday();
  const st = habitStreak(h, g.logs);
  const week = Array.from({ length: 7 }, (_, i) => plAddDays(today, i - 6));
  const doneToday = habitDoneOn(h, g.logs, today);
  return React.createElement('div', { className: 'habit-row' + (doneToday ? ' done' : '') },
    React.createElement('button', { type: 'button', className: 'habit-main', 'aria-pressed': doneToday, 'aria-label': doneToday ? `לבטל: ${h.title} היום` : `סימון: ${h.title} היום`, onClick: () => g.toggleHabit(h) },
      React.createElement('span', { className: 'habit-icon', 'aria-hidden': 'true' }, h.icon),
      React.createElement('span', { className: 'flex-1 min-w-0 text-right' },
        React.createElement('span', { className: 'block text-sm font-semibold' }, h.title),
        React.createElement('span', { className: 'block text-xs', style: { color: 'var(--text-muted)' } }, h.perWeek >= 7 ? 'כל יום' : `${h.perWeek} פעמים בשבוע`)),
      st.n > 0 && React.createElement('span', { className: 'habit-streak' }, `🔥 ${st.n} ${st.unit}`),
      React.createElement('span', { className: 'habit-tick', 'aria-hidden': 'true' }, doneToday ? '✓' : '')),
    !compact && React.createElement('div', { className: 'habit-week' }, week.map(d => React.createElement('button', { key: d, type: 'button', className: 'habit-dot' + (habitDoneOn(h, g.logs, d) ? ' on' : '') + (d === today ? ' today' : ''),
      'aria-label': `${PL_DAYS[plParse(d).getDay()]}${habitDoneOn(h, g.logs, d) ? ': בוצע' : ''}`, onClick: () => g.toggleHabit(h, d) }, PL_DAYS[plParse(d).getDay()].slice(0, 1)))));
}

/* ======================= לשונית "סקירה" ======================= */
function GoalsOverview({ g, pots, isPremium, onUpgrade, onNavigate, picker }) {
  const [ci, setCi] = useState({});
  const gate = goalsGate(g, isPremium, onUpgrade);
  if (gate) return gate;
  const today = plToday();
  const ws = plWeekStart(today);
  const active = g.goals.filter(x => !x.done);
  const habits = g.habits.filter(h => h.active);
  const best = habits.reduce((m, h) => { const s = habitStreak(h, g.logs); return s.n > m.n ? { ...s, title: h.title } : m; }, { n: 0, unit: 'ימים', title: '' });
  const doneToday = habits.filter(h => habitDoneOn(h, g.logs, today)).length;
  const last30 = Array.from({ length: 30 }, (_, i) => plAddDays(today, -i));
  const dailyHabits = habits.filter(h => h.perWeek >= 7);
  const consistency = dailyHabits.length ? Math.round(last30.reduce((s, d) => s + dailyHabits.filter(h => habitDoneOn(h, g.logs, d)).length, 0) / (30 * dailyHabits.length) * 100) : null;
  const needCheckin = active.filter(x => !g.checkins.some(c => c.goalId === x.id && c.weekStart === ws));
  const achieved = g.goals.filter(x => x.done).length;
  return React.createElement('div', { className: 'space-y-6' },
    picker,
    React.createElement('div', { className: 'ent-card goals-hero p-6' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-4' },
        React.createElement('div', null,
          React.createElement('p', { className: 'text-xs font-semibold', style: { color: '#f97316' } }, 'הרצף הכי ארוך עכשיו'),
          React.createElement('p', { className: 'goals-streak' }, best.n > 0 ? `🔥 ${best.n}` : '🌱'),
          React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-2)' } }, best.n > 0 ? `${best.unit} ברצף · ${best.title}` : 'כל רצף מתחיל ביום אחד. מסמנים הרגל היום')),
        React.createElement('div', { className: 'goals-hero-stats' },
          React.createElement('div', null, React.createElement('b', null, `${doneToday}/${habits.length}`), React.createElement('span', null, 'הרגלים היום')),
          React.createElement('div', null, React.createElement('b', null, active.length), React.createElement('span', null, 'יעדים פעילים')),
          consistency != null && React.createElement('div', null, React.createElement('b', null, `${consistency}%`), React.createElement('span', null, 'עקביות ב-30 יום')),
          React.createElement('div', null, React.createElement('b', null, `🏆 ${achieved}`), React.createElement('span', null, 'יעדים שהושגו'))))),
    React.createElement('div', { className: 'ent-card p-5 space-y-2' },
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('h3', { className: 'ent-heading font-bold' }, 'היום'),
        React.createElement('button', { className: 'text-xs underline', style: { color: 'var(--text-muted)' }, onClick: () => onNavigate('habits') }, 'כל ההרגלים')),
      !habits.length ? React.createElement('button', { className: 'ent-pill-btn ghost px-4 py-2 text-sm', onClick: () => onNavigate('habits') }, '+ הרגל ראשון') :
        habits.map(h => React.createElement(HabitRow, { key: h.id, g, h, compact: true }))),
    React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('div', { className: 'flex items-center justify-between mb-3' },
        React.createElement('h3', { className: 'ent-heading font-bold' }, 'היעדים'),
        React.createElement('button', { className: 'text-xs underline', style: { color: 'var(--text-muted)' }, onClick: () => onNavigate('mygoals') }, 'לכל היעדים')),
      !active.length ? React.createElement('button', { className: 'ent-pill-btn ghost px-4 py-2 text-sm', onClick: () => onNavigate('mygoals') }, '+ יעד ראשון') :
      React.createElement('div', { className: 'goals-mini' }, active.map(x => {
        const p = goalProgress(x, pots);
        const left = daysLeftTo(x.deadline);
        return React.createElement('button', { key: x.id, className: 'goals-mini-card', onClick: () => onNavigate('mygoals') },
          React.createElement(GoalRing, { value: p, label: `${x.title}: ${Math.round(p * 100)}%` }),
          React.createElement('div', { className: 'min-w-0 text-right' },
            React.createElement('p', { className: 'text-sm font-semibold' }, areaIcon(x.area), ' ', x.title),
            React.createElement('p', { className: 'text-xs', style: { color: left != null && left < 0 ? 'var(--neg)' : 'var(--text-muted)' } }, left == null ? 'בלי תאריך יעד' : left < 0 ? 'התאריך עבר' : left === 0 ? 'היום!' : `עוד ${left} ימים`)));
      }))),
    needCheckin.length > 0 && React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('h3', { className: 'ent-heading font-bold' }, 'צ\'ק-אין שבועי'),
      React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-muted)' } }, 'איך התקדמת השבוע בכל יעד? ציון מ-1 עד 5. לוקח חצי דקה.'),
      needCheckin.map(x => React.createElement('div', { key: x.id, className: 'flex flex-wrap items-center gap-2' },
        React.createElement('span', { className: 'text-sm flex-1 min-w-[140px]' }, areaIcon(x.area), ' ', x.title),
        [1, 2, 3, 4, 5].map(n => React.createElement('button', { key: n, type: 'button', className: 'checkin-btn' + (ci[x.id] === n ? ' on' : ''), 'aria-label': `${x.title}: ${n} מתוך 5`,
          onClick: () => { setCi({ ...ci, [x.id]: n }); g.saveCheckin(x, n); } }, n))))));
}

/* ======================= לשונית "היעדים שלי" ======================= */
function GoalsListPage({ g, pots, currency, isPremium, onUpgrade, picker }) {
  const empty = () => ({ title: '', area: 'אחר', why: '', deadline: '', progressKind: 'steps', target: '', unit: '', potId: '' });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(empty);
  const [stepDraft, setStepDraft] = useState({});
  const [showDone, setShowDone] = useState(false);
  const gate = goalsGate(g, isPremium, onUpgrade);
  if (gate) return gate;
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const inp = 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none';
  const active = g.goals.filter(x => !x.done);
  const done = g.goals.filter(x => x.done);
  const money = v => `${currency}${Math.round(v).toLocaleString('he-IL')}`;
  const submit = async () => {
    const ok = await g.addGoal({ ...f, potId: f.progressKind === 'savings' ? f.potId || null : null });
    if (ok) { setF(empty()); setAdding(false); }
  };
  const chip = (on, label, onClick, key) => React.createElement('button', { key: key || label, type: 'button', 'aria-pressed': on, onClick, className: 'ent-pill-btn px-3 py-1 text-xs',
    style: { background: on ? 'var(--bronze)' : 'var(--navy-panel-2)', color: on ? 'var(--on-accent)' : 'var(--text-2)' } }, label);
  const card = x => {
    const p = goalProgress(x, pots);
    const left = daysLeftTo(x.deadline);
    const pot = x.progressKind === 'savings' ? (pots || []).find(pp => pp.id === x.potId) : null;
    const habits = g.habits.filter(h => h.goalId === x.id);
    const scores = g.checkins.filter(c => c.goalId === x.id).sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-8);
    return React.createElement('div', { key: x.id, className: 'ent-card goal-card p-5 space-y-3' + (x.done ? ' is-done' : '') },
      React.createElement('div', { className: 'flex items-start gap-3' },
        React.createElement(GoalRing, { value: p, size: 64, color: x.done ? 'var(--pos)' : 'var(--cyan)' }),
        React.createElement('div', { className: 'flex-1 min-w-0' },
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, areaIcon(x.area), ' ', x.area),
          React.createElement('h3', { className: 'ent-heading font-bold text-lg' }, x.title),
          x.why && React.createElement('p', { className: 'text-sm italic mt-0.5', style: { color: 'var(--text-2)' } }, `"${x.why}"`),
          React.createElement('p', { className: 'text-xs mt-1', style: { color: left != null && left < 0 && !x.done ? 'var(--neg)' : 'var(--text-muted)' } },
            x.done ? `🏆 הושג${x.doneAt ? ` ב-${plParse(plIso(new Date(x.doneAt))).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}` : ''}` : left == null ? 'בלי תאריך יעד' : left < 0 ? `התאריך עבר לפני ${-left} ימים` : `עוד ${left} ימים · ${plParse(x.deadline).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}`))),
      // מדד ההתקדמות
      x.progressKind === 'number' && React.createElement('div', { className: 'flex flex-wrap items-center gap-2' },
        React.createElement('button', { className: 'goal-step-btn', 'aria-label': 'פחות', disabled: x.done, onClick: () => g.updateGoal(x, { current: Math.max(0, x.current - 1) }) }, '−'),
        React.createElement('span', { className: 'text-xl font-bold' }, `${x.current % 1 ? x.current.toFixed(1) : x.current}`, React.createElement('span', { className: 'text-sm font-normal', style: { color: 'var(--text-muted)' } }, ` מתוך ${x.target ?? '?'} ${x.unit}`)),
        React.createElement('button', { className: 'goal-step-btn', 'aria-label': 'עוד', disabled: x.done, onClick: () => { const next = x.current + 1; g.updateGoal(x, { current: next }); if (x.target && next >= x.target && x.current < x.target) celebrate(); } }, '+')),
      x.progressKind === 'savings' && React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-2)' } }, pot ? `💰 ${pot.name}: ${money(pot.current)} מתוך ${money(pot.target)} (מתעדכן מהחיסכון בכלכלה)` : 'קופת החיסכון לא נמצאה'),
      x.progressKind === 'steps' && React.createElement('div', { className: 'space-y-1' },
        x.steps.map((s, i) => React.createElement('button', { key: i, type: 'button', className: 'goal-step' + (s.done ? ' on' : ''), 'aria-pressed': s.done, onClick: () => {
          const steps = x.steps.map((y, j) => j === i ? { ...y, done: !y.done } : y);
          g.updateGoal(x, { steps });
          if (steps.length && steps.every(y => y.done) && !x.steps.every(y => y.done)) celebrate();
        } }, React.createElement('span', { className: 'goal-step-box', 'aria-hidden': 'true' }, s.done ? '✓' : ''), React.createElement('span', { className: 'text-sm' }, s.text))),
        !x.done && React.createElement('div', { className: 'flex gap-2' },
          React.createElement('input', { className: 'ent-input flex-1 px-3 py-1.5 rounded-lg text-sm outline-none', placeholder: 'אבן דרך חדשה', value: stepDraft[x.id] || '', onChange: e => setStepDraft({ ...stepDraft, [x.id]: e.target.value }),
            onKeyDown: e => { if (e.key === 'Enter' && (stepDraft[x.id] || '').trim()) { g.updateGoal(x, { steps: [...x.steps, { text: stepDraft[x.id].trim(), done: false }] }); setStepDraft({ ...stepDraft, [x.id]: '' }); } } }))),
      habits.length > 0 && React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, habits.map(h => { const st = habitStreak(h, g.logs); return React.createElement('span', { key: h.id, className: 'chore-chip', style: { borderColor: 'var(--line)', color: 'var(--text-2)' } }, h.icon, ' ', h.title, st.n ? ` 🔥${st.n}` : ''); })),
      scores.length > 1 && React.createElement('div', { className: 'flex items-end gap-1', 'aria-label': 'צ\'ק-אין בשבועות האחרונים' },
        React.createElement('span', { className: 'text-xs ml-2', style: { color: 'var(--text-muted)' } }, 'צ\'ק-אין:'),
        scores.map(c => React.createElement('span', { key: c.id, className: 'goal-score-bar', title: `${c.score}/5`, style: { height: 4 + c.score * 5 } }))),
      React.createElement('div', { className: 'flex gap-2' },
        React.createElement('button', { className: 'ent-pill-btn px-4 py-1.5 text-xs', style: { background: x.done ? 'var(--navy-panel-2)' : 'var(--pos)', color: x.done ? 'var(--text-2)' : '#fff' }, onClick: () => g.completeGoal(x) }, x.done ? 'להחזיר לפעיל' : '🏆 השגתי!'),
        React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${x.title}`, onClick: () => g.deleteGoal(x) }, React.createElement(ITrash, { size: 15 }))));
  };
  return React.createElement('div', { className: 'space-y-6' },
    picker,
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'היעדים שלי'),
        React.createElement('button', { onClick: () => setAdding(!adding), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' יעד')),
      adding && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('input', { className: inp, placeholder: 'מה היעד? (למשל לרוץ 10 ק"מ)', autoFocus: true, value: f.title, onChange: e => set('title', e.target.value) }),
        React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, PERSONAL_AREAS.map(([a, ic]) => chip(f.area === a, `${ic} ${a}`, () => set('area', a), a))),
        React.createElement('input', { className: inp, placeholder: 'למה זה חשוב לי? (לא חובה, אבל עוזר בימים קשים)', value: f.why, onChange: e => set('why', e.target.value) }),
        React.createElement('div', null, React.createElement('p', { className: 'text-xs mb-1', style: { color: 'var(--text-muted)' } }, 'איך מודדים התקדמות?'),
          React.createElement('div', { className: 'flex flex-wrap gap-1.5' },
            chip(f.progressKind === 'steps', '🪜 אבני דרך', () => set('progressKind', 'steps')),
            chip(f.progressKind === 'number', '🔢 מספר (ק"מ, ספרים, ק"ג)', () => set('progressKind', 'number')),
            (pots || []).length > 0 && chip(f.progressKind === 'savings', '💰 קופת חיסכון', () => set('progressKind', 'savings')))),
        f.progressKind === 'number' && React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: '1fr 1fr' } },
          React.createElement('input', { className: inp, type: 'number', inputMode: 'decimal', placeholder: 'היעד (למשל 10)', value: f.target, onChange: e => set('target', e.target.value) }),
          React.createElement('input', { className: inp, placeholder: 'יחידה (ק"מ, ספרים...)', value: f.unit, onChange: e => set('unit', e.target.value) })),
        f.progressKind === 'savings' && React.createElement('select', { className: inp, 'aria-label': 'איזו קופה', value: f.potId, onChange: e => set('potId', e.target.value) },
          React.createElement('option', { value: '' }, 'בחרו קופה'), (pots || []).map(pp => React.createElement('option', { key: pp.id, value: pp.id }, pp.name))),
        React.createElement(DateField, { label: 'עד מתי (לא חובה)', value: f.deadline, onChange: v => set('deadline', v) }),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, 'שמירה'),
          React.createElement('button', { onClick: () => setAdding(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול')))),
    !active.length && !adding ? React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: 'עוד אין יעדים', hint: 'יעד אחד ברור עדיף על עשרה מעורפלים' })) :
      React.createElement('div', { className: 'goals-grid' }, active.map(card)),
    done.length > 0 && React.createElement('div', null,
      React.createElement('button', { type: 'button', className: 'text-sm font-semibold flex items-center gap-1 mb-3', style: { color: 'var(--text-muted)' }, 'aria-expanded': showDone, onClick: () => setShowDone(!showDone) },
        `🏆 יעדים שהושגו (${done.length})`, React.createElement(IChevronDown, { size: 13, style: { transform: showDone ? 'rotate(180deg)' : 'none' } })),
      showDone && React.createElement('div', { className: 'goals-grid' }, done.map(card))));
}

/* ======================= לשונית "הרגלים" ======================= */
function HabitsPage({ g, isPremium, onUpgrade, picker }) {
  const [f, setF] = useState({ title: '', icon: '✨', perWeek: 7, goalId: '' });
  const [adding, setAdding] = useState(false);
  const gate = goalsGate(g, isPremium, onUpgrade);
  if (gate) return gate;
  const inp = 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none';
  const habits = g.habits.filter(h => h.active);
  const today = plToday();
  // מפת חום: 35 ימים אחרונים, כמה הרגלים בוצעו בכל יום
  const heat = Array.from({ length: 35 }, (_, i) => plAddDays(today, i - 34)).map(d => ({ d, n: habits.filter(h => habitDoneOn(h, g.logs, d)).length }));
  const submit = async () => { const ok = await g.addHabit(f); if (ok) { setF({ title: '', icon: '✨', perWeek: 7, goalId: '' }); setAdding(false); } };
  return React.createElement('div', { className: 'space-y-6' },
    picker,
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('div', null,
          React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'הרגלים'),
          React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, 'דברים קטנים שעושים שוב ושוב. לוחצים על הכרטיס כשעשיתם היום, ועל האותיות כדי לתקן ימים קודמים.')),
        React.createElement('button', { onClick: () => setAdding(!adding), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' הרגל')),
      adding && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('div', { className: 'flex flex-wrap gap-1' }, HABIT_ICONS.map(ic => React.createElement('button', { key: ic, type: 'button', 'aria-pressed': f.icon === ic, 'aria-label': `אייקון ${ic}`, onClick: () => setF({ ...f, icon: ic }), className: 'chore-icon-pick' + (f.icon === ic ? ' on' : '') }, ic))),
        React.createElement('input', { className: inp, placeholder: 'מה ההרגל? (למשל לשתות 8 כוסות מים)', autoFocus: true, value: f.title, onChange: e => setF({ ...f, title: e.target.value }) }),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: '1fr 1fr' } },
          React.createElement('select', { className: inp, 'aria-label': 'כמה פעמים בשבוע', value: f.perWeek, onChange: e => setF({ ...f, perWeek: Number(e.target.value) }) },
            [7, 6, 5, 4, 3, 2, 1].map(n => React.createElement('option', { key: n, value: n }, n === 7 ? 'כל יום' : `${n} פעמים בשבוע`))),
          React.createElement('select', { className: inp, 'aria-label': 'שייך ליעד', value: f.goalId, onChange: e => setF({ ...f, goalId: e.target.value }) },
            React.createElement('option', { value: '' }, 'בלי יעד'), g.goals.filter(x => !x.done).map(x => React.createElement('option', { key: x.id, value: x.id }, x.title)))),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, 'שמירה'),
          React.createElement('button', { onClick: () => setAdding(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול'))),
      !habits.length ? React.createElement(EmptyState, { text: 'עוד אין הרגלים', hint: 'מתחילים קטן: הרגל אחד, כל יום' }) :
        React.createElement('div', { className: 'space-y-3' }, habits.map(h => React.createElement('div', { key: h.id, className: 'flex items-start gap-2' },
          React.createElement('div', { className: 'flex-1' }, React.createElement(HabitRow, { g, h })),
          React.createElement('button', { className: 'ent-icon-btn mt-3', 'aria-label': `מחיקת ${h.title}`, onClick: () => g.deleteHabit(h) }, React.createElement(ITrash, { size: 15 })))))),
    habits.length > 0 && React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('h3', { className: 'ent-heading font-bold mb-3' }, '5 השבועות האחרונים'),
      React.createElement('div', { className: 'habit-heat', role: 'img', 'aria-label': 'מפת חום של הרגלים ב-35 הימים האחרונים' }, heat.map(c => React.createElement('span', { key: c.d, title: `${plParse(c.d).toLocaleDateString('he-IL')}: ${c.n} מתוך ${habits.length}`,
        className: 'habit-heat-cell' + (c.d === today ? ' today' : ''), style: { opacity: c.n ? 0.25 + 0.75 * c.n / habits.length : 1, background: c.n ? '#f97316' : 'var(--line)' } }))),
      React.createElement('p', { className: 'text-xs mt-2', style: { color: 'var(--text-dim)' } }, 'כל ריבוע הוא יום. ככל שהוא כתום יותר, יותר הרגלים בוצעו בו.')));
}
