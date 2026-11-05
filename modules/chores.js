/* Homey — תורנויות ונקודות לילדים (חלק ממערך "משימות ולו"ז").
 * הילד מסמן "סיימתי", ההורה מאשר, הנקודות נכנסות. נקודות מממשים בפרס או ממירים לדמי כיס ב"הכסף שלי" (kid_entries).
 * טבלאות: chores, chore_runs, kid_points, chore_rewards, families.points_rate (supabase/chores.sql).
 * נטען לפני הסקריפט הראשי ומשתמש בגלובליים שלו (ובפונקציות התאריך של modules/tasks.js) רק בזמן רינדור. */

const CHORE_ICONS = ['🛏️', '🍽️', '🗑️', '🧺', '🐶', '🪴', '🧹', '🚿', '📚', '🦷', '👟', '🧸', '🛒', '🚗', '⭐'];
// מספר יום/שבוע מאז 2020 — בסיס לסבב, כך שכל מכשיר מחשב את אותו ילד לאותו יום
const choreDayNo = iso => Math.floor((plParse(iso) - new Date(2020, 0, 5)) / 86400000);
const choreWeekNo = iso => Math.floor(choreDayNo(iso) / 7);
const choreAppliesOn = (c, iso) => {
  if (!c.active || !c.assignees.length) return false;
  const dow = plParse(iso).getDay();
  if (c.repeat === 'weekly') return (c.weekdays[0] ?? 0) === dow;
  return c.weekdays.includes(dow);
};
// מי עושה את המטלה ביום הזה: קבועה = כל הילדים שנבחרו, סבב = ילד אחד בתורו
const choreKidsOn = (c, iso) => {
  if (!choreAppliesOn(c, iso)) return [];
  if (c.assignMode !== 'rotate') return c.assignees;
  const idx = c.repeat === 'weekly' ? choreWeekNo(iso) : choreDayNo(iso);
  return [c.assignees[((idx % c.assignees.length) + c.assignees.length) % c.assignees.length]];
};
const choreFromRow = r => ({ id: r.id, title: r.title, icon: r.icon, points: r.points, assignMode: r.assign_mode, assignees: r.assignees || [],
  repeat: r.repeat, weekdays: (r.weekdays || []).map(Number), active: r.active });
const runFromRow = r => ({ id: r.id, choreId: r.chore_id, childId: r.child_id, date: String(r.date).slice(0, 10), status: r.status, points: r.points, doneAt: r.done_at, approvedAt: r.approved_at });

function choresDemo() {
  const kids = FAMILY_PROFILES.filter(p => p.role === 'child').map(p => p.id);
  const t = plToday();
  const ch = (id, title, icon, points, o = {}) => ({ id, title, icon, points, assignMode: 'fixed', assignees: kids, repeat: 'daily', weekdays: [0, 1, 2, 3, 4, 5, 6], active: true, ...o });
  const chores = [
    ch('dc1', 'לסדר את החדר', '🛏️', 5),
    ch('dc2', 'לפנות כלים אחרי ארוחת ערב', '🍽️', 3, { assignMode: 'rotate' }),
    ch('dc3', 'להוציא את הזבל', '🗑️', 4, { assignMode: 'rotate', weekdays: [0, 2, 4] }),
    ch('dc4', 'לקפל כביסה', '🧺', 8, { repeat: 'weekly', weekdays: [5], assignees: [kids[0]] })
  ];
  const points = [
    { id: 'dp1', childId: kids[0], delta: 40, reason: 'מטלות השבוע שעבר', createdAt: new Date(Date.now() - 6 * 86400000).toISOString() },
    { id: 'dp2', childId: kids[0], delta: 5, reason: 'לסדר את החדר', createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: 'dp3', childId: kids[1], delta: 22, reason: 'מטלות השבוע שעבר', createdAt: new Date(Date.now() - 5 * 86400000).toISOString() },
    { id: 'dp4', childId: kids[1], delta: -15, reason: 'פרס: שעת מסך נוספת', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() }
  ];
  const rewards = [
    { id: 'dr1', title: 'שעת מסך נוספת', icon: '🎮', cost: 15 },
    { id: 'dr2', title: 'גלידה', icon: '🍦', cost: 20 },
    { id: 'dr3', title: 'ערב סרט שאני בוחר/ת', icon: '🍿', cost: 35 },
    { id: 'dr4', title: 'יציאה לפארק שעשועים', icon: '🎢', cost: 120 }
  ];
  // מופעים להיום: אחד כבר סומן ומחכה לאישור
  const runs = [];
  chores.forEach(c => choreKidsOn(c, t).forEach(k => runs.push({ id: `dr-${c.id}-${k}`, choreId: c.id, childId: k, date: t, status: 'todo', points: c.points, doneAt: null, approvedAt: null })));
  if (runs[0]) Object.assign(runs[0], { status: 'done', doneAt: new Date().toISOString() });
  return { chores, runs, points, rewards, rate: 0.5 };
}

/* ---- נתוני התורנויות + יצירת המופעים של היום ---- */
function useChores({ familyId, isDemo, enabled, showToast }) {
  const [state, setState] = useState({ ready: false, unavailable: false, chores: [], runs: [], points: [], rewards: [], rate: null });
  const patch = fn => setState(s => ({ ...s, ...fn(s) }));
  useEffect(() => {
    if (!enabled || !familyId) return;
    if (isDemo) {
      setState({ ready: true, unavailable: false, ...choresDemo() });
      return;
    }
    let alive = true;
    (async () => {
      const since = plAddDays(plToday(), -14);
      const [c, r, p, w, f] = await Promise.all([
        sb.from('chores').select('*').eq('family_id', familyId).order('created_at'),
        sb.from('chore_runs').select('*').eq('family_id', familyId).gte('date', since),
        sb.from('kid_points').select('*').eq('family_id', familyId).order('created_at', { ascending: false }),
        sb.from('chore_rewards').select('*').eq('family_id', familyId).order('cost'),
        sb.from('families').select('points_rate').eq('id', familyId).maybeSingle()
      ]);
      if (!alive) return;
      if (c.error || r.error || p.error) return setState(s => ({ ...s, ready: true, unavailable: true }));
      const chores = (c.data || []).map(choreFromRow);
      let runs = (r.data || []).map(runFromRow);
      // המופעים של היום: נוצרים בפעם הראשונה שמישהו במשפחה פותח את האפליקציה היום (upsert, בלי כפילויות)
      const today = plToday();
      const missing = [];
      chores.forEach(ch => choreKidsOn(ch, today).forEach(k => {
        if (!runs.some(x => x.choreId === ch.id && x.childId === k && x.date === today)) missing.push({ family_id: familyId, chore_id: ch.id, child_id: k, date: today, points: ch.points });
      }));
      if (missing.length) {
        await sb.from('chore_runs').upsert(missing, { onConflict: 'chore_id,date,child_id', ignoreDuplicates: true });
        const { data } = await sb.from('chore_runs').select('*').eq('family_id', familyId).eq('date', today);
        runs = [...runs.filter(x => x.date !== today), ...(data || []).map(runFromRow)];
      }
      if (!alive) return;
      setState({
        ready: true, unavailable: false, chores, runs,
        points: (p.data || []).map(x => ({ id: x.id, childId: x.child_id, delta: x.delta, reason: x.reason || '', createdAt: x.created_at })),
        rewards: (w.data || []).map(x => ({ id: x.id, title: x.title, icon: x.icon, cost: x.cost })),
        rate: f.data && f.data.points_rate != null ? Number(f.data.points_rate) : null
      });
    })();
    return () => { alive = false; };
  }, [enabled, familyId, isDemo]);

  const tmp = () => 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);
  const balance = childId => state.points.filter(x => x.childId === childId).reduce((s, x) => s + x.delta, 0);
  const addPoints = async (childId, delta, reason, runId) => {
    let id = tmp();
    if (!isDemo) {
      const ins = { family_id: familyId, child_id: childId, delta, reason };
      if (runId) ins.run_id = runId;
      const { data, error } = await sb.from('kid_points').insert(ins).select().single();
      if (error) { if (!/duplicate/.test(error.message)) showToast('שגיאה בעדכון הנקודות'); return false; }
      id = data.id;
    }
    patch(s => ({ points: [{ id, childId, delta, reason, createdAt: new Date().toISOString() }, ...s.points] }));
    return true;
  };
  const setRun = async (run, changes, db) => {
    patch(s => ({ runs: s.runs.map(x => x.id === run.id ? { ...x, ...changes } : x) }));
    if (!isDemo) await sb.from('chore_runs').update(db).eq('id', run.id);
  };
  const markDone = run => setRun(run, { status: 'done', doneAt: new Date().toISOString() }, { status: 'done', done_at: new Date().toISOString() });
  const unmark = run => setRun(run, { status: 'todo', doneAt: null }, { status: 'todo', done_at: null });
  const approve = async run => {
    const chore = state.chores.find(c => c.id === run.choreId);
    await setRun(run, { status: 'approved', approvedAt: new Date().toISOString() }, { status: 'approved', approved_at: new Date().toISOString() });
    await addPoints(run.childId, run.points, chore ? chore.title : 'מטלה', isDemo ? null : run.id);
  };
  const reject = run => setRun(run, { status: 'todo', doneAt: null }, { status: 'todo', done_at: null });
  const addChore = async c => {
    if (!c.title.trim() || !c.assignees.length) { showToast(!c.title.trim() ? 'נא לכתוב מה המטלה' : 'נא לבחור לפחות ילד אחד'); return null; }
    const row = { title: c.title.trim(), icon: c.icon, points: Number(c.points) || 5, assignMode: c.assignMode, assignees: c.assignees, repeat: c.repeat, weekdays: c.weekdays, active: true };
    let id = tmp();
    if (!isDemo) {
      const { data, error } = await sb.from('chores').insert({ family_id: familyId, title: row.title, icon: row.icon, points: row.points, assign_mode: row.assignMode,
        assignees: row.assignees, repeat: row.repeat, weekdays: row.weekdays }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return null; }
      id = data.id;
    }
    const saved = { ...row, id };
    // אם המטלה חלה היום: יוצרים מיד את המופעים של היום
    const today = plToday();
    const kids = choreKidsOn(saved, today);
    let newRuns = kids.map(k => ({ id: tmp(), choreId: id, childId: k, date: today, status: 'todo', points: saved.points, doneAt: null, approvedAt: null }));
    if (!isDemo && kids.length) {
      const { data } = await sb.from('chore_runs').upsert(kids.map(k => ({ family_id: familyId, chore_id: id, child_id: k, date: today, points: saved.points })), { onConflict: 'chore_id,date,child_id' }).select();
      newRuns = (data || []).map(runFromRow);
    }
    patch(s => ({ chores: [...s.chores, saved], runs: [...s.runs, ...newRuns] }));
    return saved;
  };
  const toggleChore = async c => {
    patch(s => ({ chores: s.chores.map(x => x.id === c.id ? { ...x, active: !x.active } : x) }));
    if (!isDemo) await sb.from('chores').update({ active: !c.active }).eq('id', c.id);
  };
  const deleteChore = async c => {
    patch(s => ({ chores: s.chores.filter(x => x.id !== c.id), runs: s.runs.filter(x => x.choreId !== c.id) }));
    if (!isDemo) await sb.from('chores').delete().eq('id', c.id);
  };
  const addReward = async (title, icon, cost) => {
    if (!title.trim() || !(Number(cost) > 0)) return;
    let id = tmp();
    if (!isDemo) {
      const { data, error } = await sb.from('chore_rewards').insert({ family_id: familyId, title: title.trim(), icon, cost: Number(cost) }).select().single();
      if (error) return showToast('שגיאה בשמירה');
      id = data.id;
    }
    patch(s => ({ rewards: [...s.rewards, { id, title: title.trim(), icon, cost: Number(cost) }].sort((a, b) => a.cost - b.cost) }));
  };
  const deleteReward = async r => {
    patch(s => ({ rewards: s.rewards.filter(x => x.id !== r.id) }));
    if (!isDemo) await sb.from('chore_rewards').delete().eq('id', r.id);
  };
  const redeem = async (childId, reward) => {
    if (balance(childId) < reward.cost) return showToast('אין מספיק נקודות לפרס הזה');
    if (await addPoints(childId, -reward.cost, `פרס: ${reward.title}`)) { celebrate(); showToast(`מומש: ${reward.title}`); }
  };
  // המרת נקודות לכסף אמיתי בארנק של הילד ("הכסף שלי")
  const convert = async (childId, pts) => {
    pts = Math.floor(Number(pts));
    if (!state.rate || !(pts > 0)) return showToast('נא לקבוע שווי לנקודה ולבחור כמה נקודות');
    if (pts > balance(childId)) return showToast('אין מספיק נקודות');
    const amount = Math.round(pts * state.rate * 100) / 100;
    if (!isDemo) {
      const { error } = await sb.from('kid_entries').insert({ family_id: familyId, child_id: childId, type: 'income', category: 'דמי כיס', amount, note: `המרת ${pts} נקודות`, date: plToday() });
      if (error) return showToast('ההמרה לא הצליחה');
    }
    await addPoints(childId, -pts, `המרה לדמי כיס: ₪${amount}`);
    showToast(`₪${amount} נכנסו ל"הכסף שלי"`);
  };
  const setRate = async rate => {
    patch(() => ({ rate }));
    if (!isDemo) await sb.from('families').update({ points_rate: rate }).eq('id', familyId);
  };
  return { ...state, balance, markDone, unmark, approve, reject, addChore, toggleChore, deleteChore, addReward, deleteReward, redeem, convert, setRate };
}

const choreGate = (ch, isPremium, onUpgrade) => !isPremium ? React.createElement(PremiumLock, { title: 'תורנויות ונקודות הן תכונת פרימיום', desc: 'מטלות בית לילדים בסבב, נקודות על כל מטלה, פרסים והמרה לדמי כיס.', onUpgrade })
  : !ch.ready ? React.createElement('div', { className: 'ent-card p-6' }, 'טוען...')
  : ch.unavailable ? React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'התורנויות עוד לא הופעלו בשרת. יש להריץ את chores.sql ב-Supabase.') : null;
const choreWeekPts = (ch, childId) => ch.points.filter(p => p.childId === childId && p.delta > 0 && p.createdAt >= new Date(Date.now() - 7 * 86400000).toISOString()).reduce((s, p) => s + p.delta, 0);

// לעמוד הראשי: לילד = הנקודות והמטלות שלו היום. להורה = כמה מחכים לאישור
function choresHubForKid(ch, kidId) {
  if (!ch.ready || ch.unavailable) return null;
  const mine = ch.runs.filter(r => r.childId === kidId && r.date === plToday());
  if (!mine.length && !ch.points.some(p => p.childId === kidId)) return null;
  const left = mine.filter(r => r.status === 'todo').length;
  return { big: `⭐ ${ch.balance(kidId)} נקודות`, tone: '#fbbf24', line: left ? `${left === 1 ? 'מטלה אחת' : `${left} מטלות`} להיום` : mine.length ? 'כל המטלות של היום בוצעו' : 'אין מטלות היום' };
}
function choresPendingForParents(ch, members) {
  if (!ch.ready || ch.unavailable) return [];
  return ch.runs.filter(r => r.status === 'done').map(r => {
    const c = ch.chores.find(x => x.id === r.choreId);
    const k = members.find(m => m.id === r.childId);
    return { id: 'chore-' + r.id, level: 'warn', tab: 'chores', text: `${k ? k.name : 'ילד'} סיים/ה "${c ? c.title : 'מטלה'}" ומחכה לאישור (+${r.points} ⭐)` };
  });
}

/* ======================= מסך הילד: "המטלות שלי" ======================= */
function KidChoresView({ ch, kidId, kidName }) {
  const today = plToday();
  const mine = ch.runs.filter(r => r.childId === kidId && r.date === today);
  const bal = ch.balance(kidId);
  const next = ch.rewards.find(r => r.cost > bal);
  const history = ch.points.filter(p => p.childId === kidId).slice(0, 8);
  const done = async r => { await ch.markDone(r); celebrate(); };
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card chore-hero p-6 text-center' },
      React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-muted)' } }, kidName ? `הנקודות של ${kidName}` : 'הנקודות שלי'),
      React.createElement('p', { className: 'chore-balance' }, '⭐ ', bal),
      next && React.createElement('div', { className: 'mt-3 max-w-xs mx-auto' },
        React.createElement('p', { className: 'text-xs mb-1', style: { color: 'var(--text-2)' } }, `עוד ${next.cost - bal} נקודות ל${next.icon} ${next.title}`),
        React.createElement('div', { className: 'h-2.5 rounded-full overflow-hidden', style: { background: 'var(--line)' } },
          React.createElement('div', { className: 'h-full rounded-full chore-bar', style: { width: `${Math.min(100, bal / next.cost * 100)}%` } })))),
    React.createElement('div', null,
      React.createElement('h2', { className: 'ent-heading text-xl font-bold mb-3' }, 'המטלות שלי היום'),
      !mine.length ? React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: 'אין מטלות היום', hint: 'יום חופש! 🎉' })) :
      React.createElement('div', { className: 'chore-grid' }, mine.map(r => {
        const c = ch.chores.find(x => x.id === r.choreId) || { title: 'מטלה', icon: '⭐' };
        return React.createElement('div', { key: r.id, className: `chore-card ent-card status-${r.status}` },
          React.createElement('span', { className: 'chore-icon', 'aria-hidden': 'true' }, c.icon),
          React.createElement('p', { className: 'font-bold mt-2' }, c.title),
          React.createElement('p', { className: 'text-sm', style: { color: '#fbbf24' } }, `+${r.points} ⭐`),
          r.status === 'todo' ? React.createElement('button', { className: 'ent-pill-btn solid-bronze w-full py-2.5 text-sm mt-3', onClick: () => done(r) }, 'סיימתי!')
            : r.status === 'done' ? React.createElement('div', { className: 'mt-3' },
              React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-2)' } }, 'מחכה לאישור של ההורים'),
              React.createElement('button', { className: 'text-xs underline mt-1', style: { color: 'var(--text-dim)' }, onClick: () => ch.unmark(r) }, 'עוד לא סיימתי'))
            : React.createElement('p', { className: 'text-sm font-bold mt-3', style: { color: 'var(--pos)' } }, '✓ אושר'));
      }))),
    ch.rewards.length > 0 && React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('h3', { className: 'ent-heading font-bold mb-3' }, 'פרסים'),
      React.createElement('div', { className: 'space-y-3' }, ch.rewards.map(w => React.createElement('div', { key: w.id },
        React.createElement('div', { className: 'flex justify-between text-sm mb-1' },
          React.createElement('span', null, w.icon, ' ', w.title),
          React.createElement('span', { style: { color: bal >= w.cost ? 'var(--pos)' : 'var(--text-muted)' } }, bal >= w.cost ? 'אפשר לממש! בקשו מההורים' : `${w.cost} ⭐`)),
        React.createElement('div', { className: 'h-1.5 rounded-full overflow-hidden', style: { background: 'var(--line)' } },
          React.createElement('div', { className: 'h-full rounded-full chore-bar', style: { width: `${Math.min(100, bal / w.cost * 100)}%` } })))))),
    history.length > 0 && React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('h3', { className: 'ent-heading font-bold mb-2' }, 'מה היה לאחרונה'),
      history.map(p => React.createElement('div', { key: p.id, className: 'flex justify-between text-sm py-1' },
        React.createElement('span', { style: { color: 'var(--text-2)' } }, p.reason),
        React.createElement('b', { style: { color: p.delta > 0 ? 'var(--pos)' : 'var(--neg)' } }, p.delta > 0 ? `+${p.delta}` : p.delta)))));
}

/* ======================= מסך ההורים: "תורנויות" ======================= */
function ChoresPage({ ch, members, me, isChild, isPremium, onUpgrade, currency }) {
  const kids = members.filter(m => m.kind === 'child');
  const emptyChore = () => ({ title: '', icon: '🛏️', points: 5, assignMode: 'fixed', assignees: kids.map(k => k.id), repeat: 'daily', weekdays: [0, 1, 2, 3, 4, 5, 6] });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(emptyChore);
  const [reward, setReward] = useState({ title: '', icon: '🎁', cost: '' });
  const [convertFor, setConvertFor] = useState(null);
  const [convertPts, setConvertPts] = useState('');
  const [rateText, setRateText] = useState('');
  const gate = choreGate(ch, isPremium, onUpgrade);
  if (gate) return gate;
  if (isChild) return React.createElement(KidChoresView, { ch, kidId: me.id });
  if (!kids.length) return React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: 'עוד אין פרופילים של ילדים', hint: 'מוסיפים ילד במסך בחירת הפרופיל' }));
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const today = plToday();
  const nameOf = id => (members.find(m => m.id === id) || {}).name || '';
  const pending = ch.runs.filter(r => r.status === 'done');
  const money = v => `${currency}${Math.round(v * 100) / 100}`;
  const submit = async () => { const ok = await ch.addChore(f); if (ok) { setF(emptyChore()); setAdding(false); } };
  const toggleIn = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const chip = (on, label, onClick, key) => React.createElement('button', { key: key || label, type: 'button', 'aria-pressed': on, onClick, className: 'ent-pill-btn px-3 py-1 text-xs',
    style: { background: on ? 'var(--bronze)' : 'var(--navy-panel-2)', color: on ? 'var(--on-accent)' : 'var(--text-2)' } }, label);
  const inp = 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none';

  return React.createElement('div', { className: 'space-y-6' },
    // אישורים
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex items-center justify-between gap-2' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'תורנויות'),
        pending.length > 1 && React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 py-1.5 text-xs', onClick: async () => { for (const r of pending) await ch.approve(r); } }, `אישור הכול (${pending.length})`)),
      pending.length ? pending.map(r => {
        const c = ch.chores.find(x => x.id === r.choreId) || { title: 'מטלה', icon: '⭐' };
        return React.createElement('div', { key: r.id, className: 'chore-approve flex items-center gap-3 p-3 rounded-xl' },
          React.createElement('span', { className: 'text-2xl', 'aria-hidden': 'true' }, c.icon),
          React.createElement('div', { className: 'flex-1 min-w-0' },
            React.createElement('p', { className: 'text-sm font-semibold' }, `${nameOf(r.childId)}: ${c.title}`),
            React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, `${r.date === today ? 'היום' : plDueLabel(r.date)} · +${r.points} ⭐`)),
          React.createElement('button', { className: 'ent-pill-btn px-3 py-1.5 text-xs', style: { background: 'var(--pos)', color: '#fff' }, onClick: () => ch.approve(r) }, 'אישור'),
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => ch.reject(r) }, 'עוד לא'));
      }) : React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-muted)' } }, 'אין כרגע מטלות שמחכות לאישור')),
    // הילדים: היום, נקודות, מימוש והמרה
    React.createElement('div', { className: 'ev-kids' }, kids.map(k => {
      const runs = ch.runs.filter(r => r.childId === k.id && r.date === today);
      const bal = ch.balance(k.id);
      return React.createElement('div', { key: k.id, className: 'ent-card p-5 space-y-3' },
        React.createElement('div', { className: 'flex items-center justify-between' },
          React.createElement('div', { className: 'flex items-center gap-2' }, React.createElement(InitialAvatar, { name: k.name, size: 30 }), React.createElement('h3', { className: 'ent-heading font-bold' }, k.name)),
          React.createElement('div', { className: 'text-left' },
            React.createElement('p', { className: 'font-bold text-lg', style: { color: '#fbbf24' } }, `⭐ ${bal}`),
            React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, `+${choreWeekPts(ch, k.id)} השבוע`))),
        runs.length ? React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, runs.map(r => {
          const c = ch.chores.find(x => x.id === r.choreId) || { title: '', icon: '⭐' };
          const col = r.status === 'approved' ? 'var(--pos)' : r.status === 'done' ? '#fbbf24' : 'var(--text-dim)';
          return React.createElement('span', { key: r.id, className: 'chore-chip', style: { borderColor: col, color: r.status === 'todo' ? 'var(--text-2)' : col }, title: r.status === 'approved' ? 'אושר' : r.status === 'done' ? 'מחכה לאישור' : 'עוד לא בוצע' },
            c.icon, ' ', c.title, r.status === 'approved' ? ' ✓' : r.status === 'done' ? ' ⏳' : '');
        })) : React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, 'אין מטלות היום'),
        React.createElement('div', { className: 'flex flex-wrap gap-1.5' },
          ch.rewards.filter(w => w.cost <= bal).slice(0, 3).map(w => React.createElement('button', { key: w.id, className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => ch.redeem(k.id, w) }, `מימוש ${w.icon} ${w.title} (${w.cost})`)),
          ch.rate && bal > 0 && React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => { setConvertFor(convertFor === k.id ? null : k.id); setConvertPts(String(bal)); } }, 'המרה לדמי כיס')),
        convertFor === k.id && React.createElement('div', { className: 'flex items-center gap-2 text-sm' },
          React.createElement('input', { className: 'ent-input px-3 py-1.5 rounded-lg text-sm outline-none', style: { width: 80 }, type: 'number', min: 1, max: bal, value: convertPts, onChange: e => setConvertPts(e.target.value), 'aria-label': 'כמה נקודות להמיר' }),
          React.createElement('span', { style: { color: 'var(--text-muted)' } }, `נקודות = ${money((Number(convertPts) || 0) * ch.rate)}`),
          React.createElement('button', { className: 'ent-pill-btn solid-bronze px-3 py-1.5 text-xs', onClick: async () => { await ch.convert(k.id, convertPts); setConvertFor(null); } }, 'העברה לארנק')));
    })),
    // המטלות
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('h3', { className: 'ent-heading font-bold' }, 'המטלות בבית'),
        React.createElement('button', { onClick: () => { if (!adding) setF(emptyChore()); setAdding(!adding); }, className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-1.5 text-sm' }, React.createElement(IPlus, { size: 15 }), ' מטלה')),
      adding && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('div', { className: 'flex flex-wrap gap-1' }, CHORE_ICONS.map(ic => React.createElement('button', { key: ic, type: 'button', 'aria-pressed': f.icon === ic, 'aria-label': `אייקון ${ic}`, onClick: () => set('icon', ic),
          className: 'chore-icon-pick' + (f.icon === ic ? ' on' : '') }, ic))),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: '2fr 1fr' } },
          React.createElement('input', { className: inp, placeholder: 'מה המטלה? (למשל לסדר את החדר)', autoFocus: true, value: f.title, onChange: e => set('title', e.target.value) }),
          React.createElement('label', { className: 'text-xs flex flex-col gap-1', style: { color: 'var(--text-muted)' } }, 'נקודות',
            React.createElement('input', { className: inp, type: 'number', min: 1, value: f.points, onChange: e => set('points', e.target.value) }))),
        React.createElement('div', null, React.createElement('p', { className: 'text-xs mb-1', style: { color: 'var(--text-muted)' } }, 'מי עושה'),
          React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, kids.map(k => chip(f.assignees.includes(k.id), k.name, () => set('assignees', toggleIn(f.assignees, k.id)), k.id)))),
        f.assignees.length > 1 && React.createElement('div', { className: 'flex flex-wrap gap-1.5' },
          chip(f.assignMode === 'fixed', 'כולם, כל אחד בנפרד', () => set('assignMode', 'fixed')),
          chip(f.assignMode === 'rotate', 'בסבב, כל פעם מישהו אחר', () => set('assignMode', 'rotate'))),
        React.createElement('div', { className: 'flex flex-wrap gap-1.5 items-center' },
          chip(f.repeat === 'daily', 'בימים קבועים', () => set('repeat', 'daily')),
          chip(f.repeat === 'weekly', 'פעם בשבוע', () => { set('repeat', 'weekly'); set('weekdays', [f.weekdays[0] ?? 5]); })),
        React.createElement('div', { className: 'flex flex-wrap gap-1' }, PL_DAYS.map((d, i) => chip(f.repeat === 'weekly' ? f.weekdays[0] === i : f.weekdays.includes(i), d,
          () => set('weekdays', f.repeat === 'weekly' ? [i] : toggleIn(f.weekdays, i).sort()), 'd' + i))),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, 'שמירה'),
          React.createElement('button', { onClick: () => setAdding(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול'))),
      !ch.chores.length ? React.createElement(EmptyState, { text: 'עוד אין מטלות', hint: 'מוסיפים מטלה, והילדים רואים אותה ב"המטלות שלי"' }) :
      ch.chores.map(c => React.createElement('div', { key: c.id, className: 'ent-row py-2.5 flex items-center gap-3', style: { opacity: c.active ? 1 : 0.5 } },
        React.createElement('span', { className: 'text-2xl', 'aria-hidden': 'true' }, c.icon),
        React.createElement('div', { className: 'flex-1 min-w-0' },
          React.createElement('p', { className: 'text-sm font-semibold' }, c.title, React.createElement('span', { style: { color: '#fbbf24' } }, ` +${c.points}`)),
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } },
            [c.assignees.map(nameOf).filter(Boolean).join(', '), c.assignMode === 'rotate' && c.assignees.length > 1 ? 'בסבב' : null,
              c.repeat === 'weekly' ? `כל יום ${PL_DAYS[c.weekdays[0] ?? 0]}` : c.weekdays.length === 7 ? 'כל יום' : c.weekdays.map(i => PL_DAYS[i]).join(', '),
              c.assignMode === 'rotate' && choreKidsOn(c, today)[0] ? `היום: ${nameOf(choreKidsOn(c, today)[0])}` : null].filter(Boolean).join(' · '))),
        React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', onClick: () => ch.toggleChore(c) }, c.active ? 'השהיה' : 'הפעלה'),
        React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${c.title}`, onClick: () => ch.deleteChore(c) }, React.createElement(ITrash, { size: 15 }))))),
    // פרסים ושווי נקודה
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('h3', { className: 'ent-heading font-bold' }, 'פרסים ודמי כיס'),
      ch.rewards.map(w => React.createElement('div', { key: w.id, className: 'flex items-center justify-between text-sm py-1' },
        React.createElement('span', null, w.icon, ' ', w.title),
        React.createElement('span', { className: 'flex items-center gap-2' }, React.createElement('b', { style: { color: '#fbbf24' } }, `${w.cost} ⭐`),
          React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת הפרס ${w.title}`, onClick: () => ch.deleteReward(w) }, React.createElement(IX, { size: 13 }))))),
      React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'auto 2fr 1fr auto' } },
        React.createElement('select', { className: inp, 'aria-label': 'אייקון', value: reward.icon, onChange: e => setReward({ ...reward, icon: e.target.value }) }, ['🎁', '🎮', '🍦', '🍿', '🎢', '🍕', '📱', '🧸', '⚽', '🎨'].map(i => React.createElement('option', { key: i, value: i }, i))),
        React.createElement('input', { className: inp, placeholder: 'פרס חדש', value: reward.title, onChange: e => setReward({ ...reward, title: e.target.value }) }),
        React.createElement('input', { className: inp, type: 'number', min: 1, placeholder: '⭐', 'aria-label': 'כמה נקודות', value: reward.cost, onChange: e => setReward({ ...reward, cost: e.target.value }) }),
        React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 text-sm', onClick: () => { ch.addReward(reward.title, reward.icon, reward.cost); setReward({ title: '', icon: '🎁', cost: '' }); } }, 'הוספה')),
      React.createElement('div', { className: 'flex flex-wrap items-center gap-2 text-sm pt-2', style: { borderTop: '1px dashed var(--line)' } },
        React.createElement('span', null, ch.rate ? `נקודה אחת = ${money(ch.rate)}` : 'אפשר להמיר נקודות לכסף בארנק של הילד. כמה שווה נקודה?'),
        React.createElement('input', { className: 'ent-input px-3 py-1.5 rounded-lg text-sm outline-none', style: { width: 90 }, type: 'number', step: '0.1', min: 0, placeholder: currency, 'aria-label': 'שווי נקודה', value: rateText, onChange: e => setRateText(e.target.value) }),
        React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => { const r = Number(rateText); ch.setRate(r > 0 ? r : null); setRateText(''); } }, ch.rate ? 'עדכון' : 'שמירה'))));
}
