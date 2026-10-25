/* Homey — מערך "פגישות, דייטים וחוגים". נטען אחרי modules/tasks.js ומשתמש בנתוני הלו"ז שלו (useFamilyPlanner):
 * כל פגישה, דייט וחוג הם שורה ב-family_events עם kind, ולכן מופיעים אוטומטית גם בלו"ז השבועי.
 * בנק רעיונות לדייטים: טבלה date_ideas (supabase/events.sql). */

// המופע הבא של אירוע מתאריך מסוים והלאה (לאירוע שבועי: אותו יום בשבוע), או null אם כבר לא יחזור
const evNextOn = (ev, from) => {
  if (ev.repeat !== 'weekly') return ev.startDate >= from ? ev.startDate : null;
  let d = ev.startDate >= from ? ev.startDate : plAddDays(from, (plParse(ev.startDate).getDay() - plParse(from).getDay() + 7) % 7);
  if (ev.repeatUntil && d > ev.repeatUntil) return null;
  return d;
};
const evWhen = (date, ev) => `${plDueLabel(date)}${ev.startTime ? ` · ${plTime(ev.startTime)}${ev.endTime ? `-${plTime(ev.endTime)}` : ''}` : ''}`;
const evInput = 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none';
const evGate = (planner, isPremium, onUpgrade) => !isPremium ? React.createElement(PremiumLock, { title: 'פגישות, דייטים וחוגים הם תכונת פרימיום', desc: 'תכנון פגישות, דייטים בין ההורים עם בנק רעיונות, וחוגי הילדים עם העלות החודשית.', onUpgrade })
  : !planner.ready ? React.createElement('div', { className: 'ent-card p-6' }, 'טוען...')
  : planner.unavailable ? React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המערך עוד לא הופעל בשרת. יש להריץ את tasks-schedule.sql ו-events.sql ב-Supabase.') : null;
const evTimeField = (value, onChange, label) => React.createElement('label', { className: 'text-xs flex flex-col gap-1', style: { color: 'var(--text-muted)' } }, label,
  React.createElement('input', { type: 'time', className: evInput, value, onChange: e => onChange(e.target.value) }));
// תאריך המופע הקרוב של יום בשבוע (0=ראשון), מהיום והלאה
const evNextWeekday = dow => plAddDays(plToday(), (dow - plParse(plToday()).getDay() + 7) % 7);

function evHubSummary(planner, me, isChild) {
  if (!planner.ready || planner.unavailable || !me) return null;
  const today = plToday();
  const kinds = isChild ? ['class'] : ['meeting', 'date', 'class'];
  const upcoming = planner.events.filter(e => kinds.includes(e.kind) && plVisible(e, me, isChild))
    .map(e => ({ e, d: evNextOn(e, today) })).filter(x => x.d && x.d <= plAddDays(today, 30))
    .sort((a, b) => a.d.localeCompare(b.d) || plTime(a.e.startTime || '99').localeCompare(plTime(b.e.startTime || '99')));
  if (!upcoming.length) return null;
  const n = upcoming[0];
  const kindLabel = { meeting: 'פגישה', date: 'דייט', class: 'חוג' }[n.e.kind] || '';
  return { big: n.e.title, tone: n.e.kind === 'date' ? '#f472b6' : 'var(--text)', line: `${kindLabel} · ${evWhen(n.d, n.e)}` };
}

/* ---- בנק רעיונות לדייטים ---- */
const DATE_PLACES = { home: 'בבית', out: 'בחוץ', experience: 'חוויה' };
function useDateIdeas({ familyId, isDemo, enabled, showToast }) {
  const [ideas, setIdeas] = useState(null);
  useEffect(() => {
    if (!enabled || !familyId) return;
    if (isDemo) {
      const mk = (id, title, place, cost) => ({ id, title, place, costLevel: cost, usedCount: 0 });
      setIdeas([mk('di1', 'ערב סרט עם פופקורן ושמיכה', 'home', 1), mk('di2', 'ארוחת שף בבית בבישול משותף', 'home', 2), mk('di3', 'פיקניק בשקיעה בפארק', 'out', 1),
        mk('di4', 'מסעדה שעוד לא ניסינו', 'out', 3), mk('di5', 'סדנת קדרות זוגית', 'experience', 3), mk('di6', 'טיול לילה עם תרמוס קפה', 'out', 1), mk('di7', 'ערב משחקי קופסה רק לשנינו', 'home', 1)]);
      return;
    }
    sb.from('date_ideas').select('*').eq('family_id', familyId).order('created_at').then(({ data, error }) => {
      setIdeas(error ? 'unavailable' : (data || []).map(r => ({ id: r.id, title: r.title, place: r.place, costLevel: r.cost_level, usedCount: r.used_count })));
    });
  }, [enabled, familyId, isDemo]);
  const add = async (title, place, costLevel) => {
    if (!title.trim()) return;
    let id = 'local-' + Date.now();
    if (!isDemo) {
      const { data, error } = await sb.from('date_ideas').insert({ family_id: familyId, title: title.trim(), place, cost_level: costLevel }).select().single();
      if (error) return showToast('שגיאה בשמירה');
      id = data.id;
    }
    setIdeas(prev => [...(Array.isArray(prev) ? prev : []), { id, title: title.trim(), place, costLevel, usedCount: 0 }]);
  };
  const remove = async idea => {
    setIdeas(prev => prev.filter(x => x.id !== idea.id));
    if (!isDemo) await sb.from('date_ideas').delete().eq('id', idea.id);
  };
  const markUsed = async idea => {
    setIdeas(prev => prev.map(x => x.id === idea.id ? { ...x, usedCount: x.usedCount + 1 } : x));
    if (!isDemo) await sb.from('date_ideas').update({ used_count: idea.usedCount + 1 }).eq('id', idea.id);
  };
  return { ideas, add, remove, markUsed };
}

/* ======================= לשונית "פגישות" ======================= */
function MeetingsPage({ planner, me, isChild, isPremium, onUpgrade }) {
  const emptyForm = () => ({ title: '', withWhom: '', startDate: plToday(), startTime: '', endTime: '', location: '', scope: 'personal', notes: '' });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(emptyForm);
  const [showPast, setShowPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const gate = evGate(planner, isPremium, onUpgrade);
  if (gate) return gate;
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const today = plToday();
  const all = planner.events.filter(e => e.kind === 'meeting' && plVisible(e, me, isChild));
  const upcoming = all.map(e => ({ e, d: evNextOn(e, today) })).filter(x => x.d).sort((a, b) => a.d.localeCompare(b.d) || plTime(a.e.startTime || '99').localeCompare(plTime(b.e.startTime || '99')));
  const past = all.filter(e => e.repeat !== 'weekly' && e.startDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const submit = async () => {
    setBusy(true);
    const ok = await planner.addEvent({ ...f, kind: 'meeting', personKind: f.scope === 'personal' ? me.kind : null, personId: f.scope === 'personal' ? me.id : null });
    setBusy(false);
    if (ok) { setF(emptyForm()); setAdding(false); }
  };
  const card = (e, d) => React.createElement('div', { key: e.id + (d || ''), className: 'ent-row py-3 flex items-start gap-3' },
    React.createElement('div', { className: 'ev-datechip' },
      React.createElement('span', { className: 'ev-datechip-day' }, plParse(d || e.startDate).getDate()),
      React.createElement('span', { className: 'ev-datechip-mon' }, plParse(d || e.startDate).toLocaleDateString('he-IL', { month: 'short' }))),
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('p', { className: 'text-sm font-semibold' }, e.title),
      React.createElement('p', { className: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } }, [evWhen(d || e.startDate, e), e.withWhom && `עם ${e.withWhom}`, e.location && `📍 ${e.location}`].filter(Boolean).join(' · ')),
      React.createElement('div', { className: 'mt-1' }, React.createElement(PlScopeBadge, { scope: e.scope }))),
    React.createElement('button', { className: 'ent-pill-btn ghost px-2.5 py-1 text-xs', onClick: () => plDownloadIcs(e) }, 'ליומן'),
    React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${e.title}`, onClick: () => planner.deleteEvent(e) }, React.createElement(ITrash, { size: 15 })));
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
        React.createElement('div', null,
          React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'פגישות'),
          React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, upcoming.length ? `${upcoming.length} פגישות קרובות` : 'רופאים, אסיפות הורים, בנק, בעלי מקצוע')),
        React.createElement('button', { onClick: () => setAdding(!adding), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' פגישה')),
      adding && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' } },
          React.createElement('input', { className: evInput, placeholder: 'על מה הפגישה?', autoFocus: true, value: f.title, onChange: e => set('title', e.target.value) }),
          React.createElement('input', { className: evInput, placeholder: 'עם מי? (לא חובה)', value: f.withWhom, onChange: e => set('withWhom', e.target.value) })),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' } },
          React.createElement(DateField, { label: 'תאריך', value: f.startDate, onChange: v => set('startDate', v) }),
          evTimeField(f.startTime, v => set('startTime', v), 'משעה'), evTimeField(f.endTime, v => set('endTime', v), 'עד שעה')),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' } },
          React.createElement('input', { className: evInput, placeholder: 'איפה? (לא חובה)', value: f.location, onChange: e => set('location', e.target.value) }),
          React.createElement(PlScopePicker, { value: f.scope, onChange: v => set('scope', v), isChild })),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { disabled: busy, onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, busy ? 'רגע...' : 'שמירה'),
          React.createElement('button', { onClick: () => setAdding(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול')))),
    React.createElement('div', { className: 'ent-card p-5' },
      !upcoming.length ? React.createElement(EmptyState, { text: 'אין פגישות קרובות', hint: 'כל פגישה מופיעה גם בלו"ז השבועי' }) : upcoming.map(x => card(x.e, x.d)),
      past.length > 0 && React.createElement('div', { className: 'mt-3' },
        React.createElement('button', { type: 'button', className: 'text-xs font-semibold flex items-center gap-1', style: { color: 'var(--text-muted)' }, 'aria-expanded': showPast, onClick: () => setShowPast(!showPast) },
          `פגישות שעברו (${past.length})`, React.createElement(IChevronDown, { size: 12, style: { transform: showPast ? 'rotate(180deg)' : 'none' } })),
        showPast && React.createElement('div', { style: { opacity: 0.7 } }, past.slice(0, 15).map(e => card(e, e.startDate))))));
}

/* ======================= לשונית "דייטים" (הורים) ======================= */
// ברירת מחדל לדייט חדש: חמישי הקרוב בערב
function DatesPage({ planner, me, isPremium, onUpgrade, currency, ideasApi }) {
  const emptyForm = () => ({ title: '', startDate: evNextWeekday(4), startTime: '20:30', location: '', cost: '', plannerId: '', ideaId: null });
  const [planning, setPlanning] = useState(false);
  const [f, setF] = useState(emptyForm);
  const [idea, setIdea] = useState({ title: '', place: 'out', costLevel: 2 });
  const [placeFilter, setPlaceFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const gate = evGate(planner, isPremium, onUpgrade);
  if (gate) return gate;
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const today = plToday();
  const money = v => `${currency}${Math.round(v).toLocaleString('he-IL')}`;
  const parents = planner.members.filter(m => m.kind === 'parent');
  const nameOf = id => (planner.members.find(m => m.id === id) || {}).name || '';
  const dates = planner.events.filter(e => e.kind === 'date');
  const upcoming = dates.filter(e => e.startDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = dates.filter(e => e.startDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const sinceLast = past.length ? Math.round((plParse(today) - plParse(past[0].startDate)) / 86400000) : null;
  const last90 = past.filter(e => e.startDate >= plAddDays(today, -90)).length;
  const rated = past.filter(e => e.rating);
  const avg = rated.length ? Math.round(rated.reduce((s, e) => s + e.rating, 0) / rated.length * 10) / 10 : null;
  // התור לתכנן: ההורה שתכנן הכי מזמן (או שעוד לא תכנן בכלל)
  const lastPlanned = id => (past.find(e => e.plannerId === id) || {}).startDate || '0000';
  const turn = parents.length > 1 ? [...parents].sort((a, b) => lastPlanned(a.id).localeCompare(lastPlanned(b.id)))[0] : null;
  const ideas = Array.isArray(ideasApi.ideas) ? ideasApi.ideas : [];
  const shownIdeas = ideas.filter(i => placeFilter === 'all' || i.place === placeFilter);
  const startPlan = fromIdea => {
    setF({ ...emptyForm(), title: fromIdea ? fromIdea.title : '', plannerId: turn ? turn.id : me.id, ideaId: fromIdea ? fromIdea.id : null });
    setPlanning(true);
  };
  const surprise = () => {
    const pool = shownIdeas.length ? shownIdeas : ideas;
    if (!pool.length) return;
    // מעדיפים רעיונות שעוד לא נוסו
    const fresh = pool.filter(i => !i.usedCount);
    const list = fresh.length ? fresh : pool;
    startPlan(list[Math.floor(Math.random() * list.length)]);
  };
  const submit = async () => {
    setBusy(true);
    const ok = await planner.addEvent({ kind: 'date', scope: 'couple', title: f.title, startDate: f.startDate, startTime: f.startTime, location: f.location, cost: f.cost, plannerId: f.plannerId || null });
    if (ok && f.ideaId) {
      const i = ideas.find(x => x.id === f.ideaId);
      if (i) await ideasApi.markUsed(i);
    }
    setBusy(false);
    if (ok) { setPlanning(false); setF(emptyForm()); }
  };
  const stars = e => React.createElement('div', { className: 'flex gap-0.5', role: 'radiogroup', 'aria-label': `דירוג ${e.title}` }, [1, 2, 3, 4, 5].map(n =>
    React.createElement('button', { key: n, type: 'button', role: 'radio', 'aria-checked': e.rating === n, 'aria-label': `${n} כוכבים`, className: 'ev-star' + (e.rating >= n ? ' on' : ''), onClick: () => planner.updateEvent(e, { rating: n }) }, '★')));
  const next = upcoming[0];
  return React.createElement('div', { className: 'space-y-6' },
    // הדייט הבא
    React.createElement('div', { className: 'ent-card ev-date-hero p-6' },
      React.createElement('p', { className: 'text-xs font-semibold', style: { color: '#f472b6' } }, 'הדייט הבא'),
      next ? React.createElement(React.Fragment, null,
        React.createElement('h2', { className: 'ent-heading text-2xl font-bold mt-1' }, next.title),
        React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-2)' } }, [evWhen(next.startDate, next), next.location && `📍 ${next.location}`, next.cost && `תקציב ${money(next.cost)}`].filter(Boolean).join(' · ')),
        next.plannerId && React.createElement('p', { className: 'text-xs mt-1', style: { color: 'var(--text-muted)' } }, `${nameOf(next.plannerId)} מתכנן/ת`),
        React.createElement('div', { className: 'flex gap-2 mt-3' },
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => plDownloadIcs(next) }, 'הוספה ליומן'),
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', style: { color: 'var(--neg)' }, onClick: () => planner.deleteEvent(next) }, 'ביטול הדייט')))
        : React.createElement(React.Fragment, null,
          React.createElement('h2', { className: 'ent-heading text-2xl font-bold mt-1' }, sinceLast == null ? 'עוד לא תכננתם דייט' : `עברו ${sinceLast} ימים מהדייט האחרון`),
          React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-2)' } }, turn ? `התור של ${turn.name} לתכנן` : 'זמן לתכנן משהו רק לשניכם')),
      React.createElement('div', { className: 'flex flex-wrap gap-2 mt-4' },
        React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 py-2 text-sm', onClick: () => startPlan(null) }, 'תכנון דייט'),
        ideas.length > 0 && React.createElement('button', { className: 'ent-pill-btn ghost px-4 py-2 text-sm', onClick: surprise }, '🎲 רעיון אקראי')),
      React.createElement('div', { className: 'flex flex-wrap gap-4 mt-4 text-xs', style: { color: 'var(--text-muted)' } },
        React.createElement('span', null, last90 === 0 ? 'אין דייטים ב-3 החודשים האחרונים' : last90 === 1 ? 'דייט אחד ב-3 החודשים האחרונים' : `${last90} דייטים ב-3 החודשים האחרונים`),
        avg != null && React.createElement('span', null, `דירוג ממוצע ${avg} ★`))),
    planning && React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('p', { className: 'text-sm font-semibold' }, 'תכנון דייט'),
      React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
        React.createElement('input', { className: evInput, placeholder: 'מה עושים?', autoFocus: !f.title, value: f.title, onChange: e => set('title', e.target.value) }),
        React.createElement('input', { className: evInput, placeholder: 'איפה? (לא חובה)', value: f.location, onChange: e => set('location', e.target.value) })),
      React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' } },
        React.createElement(DateField, { label: 'תאריך', value: f.startDate, onChange: v => set('startDate', v) }),
        evTimeField(f.startTime, v => set('startTime', v), 'שעה'),
        React.createElement('label', { className: 'text-xs flex flex-col gap-1', style: { color: 'var(--text-muted)' } }, 'תקציב',
          React.createElement('input', { className: evInput, type: 'number', inputMode: 'decimal', placeholder: currency, value: f.cost, onChange: e => set('cost', e.target.value) })),
        parents.length > 1 && React.createElement('label', { className: 'text-xs flex flex-col gap-1', style: { color: 'var(--text-muted)' } }, 'מי מתכנן',
          React.createElement('select', { className: evInput, value: f.plannerId, onChange: e => set('plannerId', e.target.value) }, parents.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))))),
      React.createElement('div', { className: 'flex gap-2' },
        React.createElement('button', { disabled: busy, onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, busy ? 'רגע...' : 'שמירה'),
        React.createElement('button', { onClick: () => setPlanning(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול'))),
    // בנק רעיונות
    ideasApi.ideas !== 'unavailable' && React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
        React.createElement('h3', { className: 'ent-heading font-bold' }, 'בנק רעיונות'),
        React.createElement('div', { className: 'flex gap-1.5' }, [['all', 'הכול'], ...Object.entries(DATE_PLACES)].map(([k, l]) =>
          React.createElement('button', { key: k, type: 'button', 'aria-pressed': placeFilter === k, onClick: () => setPlaceFilter(k), className: 'ent-pill-btn px-3 py-1 text-xs',
            style: { background: placeFilter === k ? '#f472b6' : 'var(--navy-panel-2)', color: placeFilter === k ? '#fff' : 'var(--text-2)' } }, l)))),
      React.createElement('div', { className: 'ev-ideas' }, shownIdeas.map(i => React.createElement('div', { key: i.id, className: 'ev-idea' },
        React.createElement('button', { type: 'button', className: 'text-right flex-1', onClick: () => startPlan(i), 'aria-label': `לתכנן: ${i.title}` },
          React.createElement('p', { className: 'text-sm font-semibold' }, i.title),
          React.createElement('p', { className: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } }, `${DATE_PLACES[i.place]} · ${'₪'.repeat(i.costLevel)}${i.usedCount ? ` · עשינו ${i.usedCount === 1 ? 'פעם אחת' : `${i.usedCount} פעמים`}` : ''}`)),
        React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת הרעיון ${i.title}`, onClick: () => ideasApi.remove(i) }, React.createElement(IX, { size: 13 }))))),
      React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: '2fr 1fr 1fr auto' } },
        React.createElement('input', { className: evInput, placeholder: 'רעיון חדש', value: idea.title, onChange: e => setIdea({ ...idea, title: e.target.value }),
          onKeyDown: e => { if (e.key === 'Enter') { ideasApi.add(idea.title, idea.place, idea.costLevel); setIdea({ ...idea, title: '' }); } } }),
        React.createElement('select', { className: evInput, 'aria-label': 'איפה', value: idea.place, onChange: e => setIdea({ ...idea, place: e.target.value }) }, Object.entries(DATE_PLACES).map(([k, l]) => React.createElement('option', { key: k, value: k }, l))),
        React.createElement('select', { className: evInput, 'aria-label': 'עלות', value: idea.costLevel, onChange: e => setIdea({ ...idea, costLevel: Number(e.target.value) }) }, [1, 2, 3].map(c => React.createElement('option', { key: c, value: c }, '₪'.repeat(c)))),
        React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 text-sm', onClick: () => { ideasApi.add(idea.title, idea.place, idea.costLevel); setIdea({ ...idea, title: '' }); } }, 'הוספה'))),
    // דייטים שהיו
    past.length > 0 && React.createElement('div', { className: 'ent-card p-5' },
      React.createElement('h3', { className: 'ent-heading font-bold mb-2' }, 'דייטים שהיו'),
      past.slice(0, 12).map(e => React.createElement('div', { key: e.id, className: 'ent-row py-2.5 flex items-center justify-between gap-3' },
        React.createElement('div', { className: 'min-w-0' },
          React.createElement('p', { className: 'text-sm font-semibold' }, e.title),
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, [plParse(e.startDate).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' }), e.plannerId && `תכנן/ה: ${nameOf(e.plannerId)}`].filter(Boolean).join(' · '))),
        stars(e)))));
}

/* ======================= לשונית "חוגים" ======================= */
function ClassesPage({ planner, me, isChild, isPremium, onUpgrade, currency, onCreateBill, onDeleteBill }) {
  const kids = planner.members.filter(m => m.kind === 'child');
  const emptyForm = () => ({ personId: kids[0] ? kids[0].id : '', title: '', dow: 0, startTime: '16:00', endTime: '17:00', location: '', cost: '', addBill: true, dueDay: '1' });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(emptyForm);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const gate = evGate(planner, isPremium, onUpgrade);
  if (gate) return gate;
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const money = v => `${currency}${Math.round(v).toLocaleString('he-IL')}`;
  const classes = planner.events.filter(e => e.kind === 'class' && plVisible(e, me, isChild) && (!e.repeatUntil || e.repeatUntil >= plToday()));
  const owners = isChild ? [{ id: me.id, name: 'החוגים שלי' }] : [...kids, ...planner.members.filter(m => m.kind === 'parent' && classes.some(c => c.personId === m.id))];
  const total = classes.reduce((s, c) => s + (c.cost || 0), 0);
  const submit = async () => {
    if (!f.title.trim()) return;
    const person = planner.members.find(m => m.id === f.personId);
    setBusy(true);
    let billId = null;
    const cost = Number(f.cost) || 0;
    if (f.addBill && cost > 0 && onCreateBill) billId = await onCreateBill({ title: `חוג ${f.title.trim()}${person ? ` (${person.name})` : ''}`, amount: cost, dueDay: Number(f.dueDay) || 1 });
    const ok = await planner.addEvent({ kind: 'class', scope: 'personal', personKind: person ? person.kind : 'child', personId: f.personId || null, title: f.title, startDate: evNextWeekday(Number(f.dow)),
      startTime: f.startTime, endTime: f.endTime, location: f.location, repeat: 'weekly', cost: cost || null, billId });
    setBusy(false);
    if (ok) { setF({ ...emptyForm(), personId: f.personId }); setAdding(false); }
  };
  const remove = async c => {
    setConfirmId(null);
    await planner.deleteEvent(c, true);
    if (c.billId && onDeleteBill) await onDeleteBill(c.billId);
  };
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
        React.createElement('div', null,
          React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, isChild ? 'החוגים שלי' : 'חוגים'),
          !isChild && React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, classes.length ? `${classes.length} חוגים בשבוע · ${money(total)} בחודש` : 'החוגים של הילדים, עם יום, שעה ועלות חודשית')),
        !isChild && React.createElement('button', { onClick: () => setAdding(!adding), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' חוג')),
      adding && !isChild && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
          React.createElement('select', { className: evInput, 'aria-label': 'של מי', value: f.personId, onChange: e => set('personId', e.target.value) },
            planner.members.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name))),
          React.createElement('input', { className: evInput, placeholder: 'איזה חוג?', autoFocus: true, value: f.title, onChange: e => set('title', e.target.value) }),
          React.createElement('select', { className: evInput, 'aria-label': 'יום בשבוע', value: f.dow, onChange: e => set('dow', e.target.value) }, PL_DAYS.map((d, i) => React.createElement('option', { key: i, value: i }, `יום ${d}`)))),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' } },
          evTimeField(f.startTime, v => set('startTime', v), 'משעה'), evTimeField(f.endTime, v => set('endTime', v), 'עד שעה'),
          React.createElement('label', { className: 'text-xs flex flex-col gap-1', style: { color: 'var(--text-muted)' } }, 'עלות חודשית',
            React.createElement('input', { className: evInput, type: 'number', inputMode: 'decimal', placeholder: currency, value: f.cost, onChange: e => set('cost', e.target.value) })),
          React.createElement('label', { className: 'text-xs flex flex-col gap-1', style: { color: 'var(--text-muted)' } }, 'איפה',
            React.createElement('input', { className: evInput, placeholder: 'לא חובה', value: f.location, onChange: e => set('location', e.target.value) }))),
        Number(f.cost) > 0 && React.createElement('label', { className: 'flex items-center gap-2 text-sm' },
          React.createElement('input', { type: 'checkbox', checked: f.addBill, onChange: e => set('addBill', e.target.checked) }),
          'להוסיף כהוראת קבע בכלכלה, ב-',
          React.createElement('input', { className: 'ent-input px-2 py-1 rounded-lg text-sm outline-none', style: { width: 56 }, type: 'number', min: 1, max: 31, value: f.dueDay, onChange: e => set('dueDay', e.target.value), 'aria-label': 'יום החיוב בחודש' }),
          'לחודש'),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { disabled: busy, onClick: submit, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, busy ? 'רגע...' : 'שמירה'),
          React.createElement('button', { onClick: () => setAdding(false), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול')))),
    !classes.length ? React.createElement('div', { className: 'ent-card p-5' }, React.createElement(EmptyState, { text: isChild ? 'אין לך חוגים כרגע' : 'עוד לא נוספו חוגים', hint: isChild ? null : 'כל חוג מופיע אוטומטית בלו"ז השבועי' })) :
    React.createElement('div', { className: 'ev-kids' }, owners.map(o => {
      const list = classes.filter(c => isChild ? c.personId === me.id : c.personId === o.id).sort((a, b) => plParse(a.startDate).getDay() - plParse(b.startDate).getDay() || plTime(a.startTime).localeCompare(plTime(b.startTime)));
      if (!list.length) return null;
      const sum = list.reduce((s, c) => s + (c.cost || 0), 0);
      return React.createElement('div', { key: o.id, className: 'ent-card p-5' },
        // לילד יש רק כרטיס אחד (שלו), והכותרת כבר למעלה
        !isChild && React.createElement('div', { className: 'flex items-center justify-between mb-2' },
          React.createElement('div', { className: 'flex items-center gap-2' }, React.createElement(InitialAvatar, { name: o.name, size: 28 }), React.createElement('h3', { className: 'ent-heading font-bold' }, o.name)),
          !isChild && sum > 0 && React.createElement('span', { className: 'text-sm font-bold', style: { color: 'var(--bronze)' } }, `${money(sum)} בחודש`)),
        list.map(c => React.createElement('div', { key: c.id, className: 'ent-row py-2.5' },
          React.createElement('div', { className: 'flex items-center gap-3' },
            React.createElement('span', { className: 'ev-daypill' }, PL_DAYS[plParse(c.startDate).getDay()]),
            React.createElement('div', { className: 'flex-1 min-w-0' },
              React.createElement('p', { className: 'text-sm font-semibold' }, c.title),
              React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, [c.startTime && `${plTime(c.startTime)}${c.endTime ? `-${plTime(c.endTime)}` : ''}`, c.location && `📍 ${c.location}`, !isChild && c.billId && 'בהוראות קבע'].filter(Boolean).join(' · '))),
            !isChild && c.cost ? React.createElement('span', { className: 'text-sm' }, money(c.cost)) : null,
            !isChild && React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת חוג ${c.title}`, onClick: () => setConfirmId(confirmId === c.id ? null : c.id) }, React.createElement(ITrash, { size: 15 }))),
          confirmId === c.id && React.createElement('div', { className: 'flex items-center gap-2 mt-2 text-sm' },
            React.createElement('span', null, c.billId ? 'למחוק את החוג וגם את הוראת הקבע שלו?' : 'למחוק את החוג?'),
            React.createElement('button', { className: 'ent-pill-btn px-3 py-1 text-xs', style: { background: 'var(--neg)', color: '#fff' }, onClick: () => remove(c) }, 'מחיקה'),
            React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => setConfirmId(null) }, 'ביטול')))));
    })));
}
