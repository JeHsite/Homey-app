/* Homey — חופשות וטיולים כאפליקציה: ספירה לאחור, רשימת ציוד לכל בן משפחה, תוכנית יומית ומסמכי נסיעה.
 * טבלאות: trip_packing, trip_plan, travel_docs (supabase/trips-app.sql). הוצאות הטיול נשארות ב-TripExpensesPanel הקיים.
 * מסמכים: בכוונה בלי מספרי מסמכים, רק סוג ותאריך תוקף. משתמש בגלובליים של הסקריפט הראשי (React, sb, EmptyState, אייקונים) בזמן רינדור. */

const TRIP_PACK_TEMPLATES = {
  abroad: { label: 'חו"ל', shared: ['מטען לטלפון ומתאם חשמל', 'סוללה ניידת', 'ערכת עזרה ראשונה', 'קרם הגנה', 'כסף מקומי / כרטיס אשראי', 'מסכה ואטמי אוזניים לטיסה'],
    before: ['לבדוק תוקף דרכונים', 'להזמין ביטוח נסיעות', "צ'ק אין אונליין", 'להזמין הסעה לשדה', 'להודיע לבנק על נסיעה', 'לסדר מי משקה עציצים / מטפל בחיות'] },
  local: { label: 'בארץ', shared: ['מטען לטלפון', 'ערכת עזרה ראשונה', 'קרם הגנה', 'צידנית ושתייה', 'שקיות זבל'],
    before: ['לתדלק', 'לבדוק לחץ אוויר בצמיגים', 'לאשר הזמנת לינה'] },
  camping: { label: 'קמפינג', shared: ['אוהל', 'שקי שינה', 'מזרנים', 'פנס ראש וסוללות', 'גזייה וגז', 'כלי בישול', 'צידנית', 'שקיות זבל', 'ערכת עזרה ראשונה', 'קרם הגנה ודוחה יתושים'],
    before: ['לבדוק תחזית', 'לתדלק', 'לקנות מים וקרח'] }
};
const TRIP_PACK_PERSON = ['בגדים לכל יום', "פיג'מה", 'מברשת שיניים', 'בגד ים', 'כובע', 'נעליים נוחות', 'תרופות קבועות'];
const TRIP_PACK_KID = ['משחק / ספר לדרך', 'בובה לשינה', 'חטיפים לדרך'];
const TRIP_DOC_TYPES = { passport: 'דרכון', visa: 'ויזה', insurance: 'ביטוח נסיעות', license: 'רישיון בינלאומי', other: 'אחר' };
const TRIP_BEFORE = 'לפני היציאה';

const tripIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tripAddDays = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + n); return tripIso(d); };
const tripDaysBetween = (a, b) => Math.round((new Date(String(b).slice(0, 10) + 'T00:00:00') - new Date(String(a).slice(0, 10) + 'T00:00:00')) / 86400000);
const tripDayLabel = iso => new Date(iso + 'T00:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });

/* ---- נתונים ---- */
function useTripsApp({ familyId, isDemo, enabled, showToast }) {
  const [st, setSt] = useState({ ready: false, unavailable: false, packing: [], plan: [], docs: [] });
  useEffect(() => {
    if (!enabled || !familyId) return;
    if (isDemo) { setSt({ ready: true, unavailable: false, packing: [], plan: [], docs: [] }); return; }
    let alive = true;
    (async () => {
      const [p, l, d] = await Promise.all([
        sb.from('trip_packing').select('*').eq('family_id', familyId).order('sort'),
        sb.from('trip_plan').select('*').eq('family_id', familyId).order('day').order('sort'),
        sb.from('travel_docs').select('*').eq('family_id', familyId).order('expires_on')
      ]);
      if (!alive) return;
      if (p.error || l.error || d.error) return setSt(s => ({ ...s, ready: true, unavailable: true }));
      setSt({
        ready: true, unavailable: false,
        packing: (p.data || []).map(r => ({ id: r.id, tripId: r.trip_id, personId: r.person_id, text: r.text, category: r.category, checked: r.checked, sort: r.sort })),
        plan: (l.data || []).map(r => ({ id: r.id, tripId: r.trip_id, day: String(r.day).slice(0, 10), time: r.time_text || '', title: r.title, note: r.note || '', sort: r.sort })),
        docs: (d.data || []).map(r => ({ id: r.id, personId: r.person_id, personName: r.person_name, type: r.doc_type, expires: String(r.expires_on).slice(0, 10), note: r.note || '' }))
      });
    })();
    return () => { alive = false; };
  }, [enabled, familyId, isDemo]);
  const patch = fn => setSt(s => ({ ...s, ...fn(s) }));
  const lid = () => 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);

  const addPacking = async (tripId, rows) => {
    const base = st.packing.filter(x => x.tripId === tripId).length;
    let saved = rows.map((r, i) => ({ id: lid(), tripId, personId: r.personId || null, text: r.text, category: r.category || null, checked: false, sort: base + i }));
    if (!isDemo) {
      const { data, error } = await sb.from('trip_packing').insert(saved.map(r => ({ trip_id: tripId, person_id: r.personId, text: r.text, category: r.category, sort: r.sort }))).select();
      if (error) { showToast('שגיאה בשמירה'); return; }
      saved = (data || []).map(r => ({ id: r.id, tripId: r.trip_id, personId: r.person_id, text: r.text, category: r.category, checked: r.checked, sort: r.sort }));
    }
    patch(s => ({ packing: [...s.packing, ...saved] }));
  };
  const togglePacking = async item => {
    patch(s => ({ packing: s.packing.map(x => x.id === item.id ? { ...x, checked: !x.checked } : x) }));
    if (!isDemo) await sb.from('trip_packing').update({ checked: !item.checked }).eq('id', item.id);
  };
  const deletePacking = async item => {
    patch(s => ({ packing: s.packing.filter(x => x.id !== item.id) }));
    if (!isDemo) await sb.from('trip_packing').delete().eq('id', item.id);
  };
  const addPlan = async row => {
    if (!row.title || !row.title.trim()) return showToast('מה מתוכנן?');
    let saved = { id: lid(), tripId: row.tripId, day: row.day, time: (row.time || '').trim(), title: row.title.trim(), note: row.note || '', sort: st.plan.filter(x => x.tripId === row.tripId && x.day === row.day).length };
    if (!isDemo) {
      const { data, error } = await sb.from('trip_plan').insert({ trip_id: saved.tripId, day: saved.day, time_text: saved.time || null, title: saved.title, note: saved.note || null, sort: saved.sort }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return; }
      saved = { ...saved, id: data.id };
    }
    patch(s => ({ plan: [...s.plan, saved] }));
  };
  const deletePlan = async row => {
    patch(s => ({ plan: s.plan.filter(x => x.id !== row.id) }));
    if (!isDemo) await sb.from('trip_plan').delete().eq('id', row.id);
  };
  const addDoc = async doc => {
    if (!doc.personName || !doc.expires) return showToast('נא לבחור מי ותאריך תוקף');
    let saved = { id: lid(), ...doc };
    if (!isDemo) {
      const { data, error } = await sb.from('travel_docs').insert({ person_id: doc.personId || null, person_name: doc.personName, doc_type: doc.type, expires_on: doc.expires, note: doc.note || null }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return; }
      saved = { ...saved, id: data.id };
    }
    patch(s => ({ docs: [...s.docs, saved].sort((a, b) => a.expires.localeCompare(b.expires)) }));
  };
  const deleteDoc = async doc => {
    patch(s => ({ docs: s.docs.filter(x => x.id !== doc.id) }));
    if (!isDemo) await sb.from('travel_docs').delete().eq('id', doc.id);
  };
  return { ...st, addPacking, togglePacking, deletePacking, addPlan, deletePlan, addDoc, deleteDoc };
}

// מצב מסמך מול הטיול הבא: פג / יפוג פחות מ-6 חודשים אחרי סוף הטיול (דרישה נפוצה לדרכון בחו"ל) / תקין
function tripDocState(doc, nextTrip) {
  const today = tripIso(new Date());
  if (doc.expires < today) return { level: 'red', text: 'פג תוקף' };
  const end = nextTrip ? (nextTrip.endDate || nextTrip.startDate) : null;
  if (end && doc.type === 'passport' && doc.expires < tripAddDays(end, 182)) return { level: 'amber', text: `פחות מחצי שנה אחרי "${nextTrip.title}". בהרבה מדינות צריך לחדש` };
  if (tripDaysBetween(today, doc.expires) < 90) return { level: 'amber', text: `פג בעוד ${tripDaysBetween(today, doc.expires)} ימים` };
  return { level: 'ok', text: 'בתוקף' };
}
const TRIP_LEVEL = { red: 'var(--neg)', amber: '#f59e0b', ok: 'var(--pos)' };

/* ---- הכרטיס העליון: הטיול הבא + מסמכי נסיעה ---- */
function TripsTop({ trips, api, members, isChild, tripStatus }) {
  const [docForm, setDocForm] = useState(null);
  const upcoming = trips.filter(t => ['active', 'upcoming'].includes(tripStatus(t))).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const next = upcoming[0] || null;
  if (!api.ready) return null;
  if (api.unavailable) return React.createElement('div', { className: 'ent-card p-4 text-sm', style: { color: 'var(--text-muted)' } }, 'רשימות הציוד, התוכנית והמסמכים עוד לא הופעלו בשרת: יש להריץ את trips-app.sql ב-Supabase.');
  const today = tripIso(new Date());
  const pack = next ? api.packing.filter(p => p.tripId === next.id && (!isChild || !p.personId || members.some(m => m.id === p.personId && m.kind === 'child'))) : [];
  const done = pack.filter(p => p.checked).length;
  const active = next && tripStatus(next) === 'active';
  const todayPlan = active ? api.plan.filter(p => p.tripId === next.id && p.day === today).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.sort - b.sort) : [];
  const days = next && next.startDate ? tripDaysBetween(today, next.startDate) : null;
  const docIssues = api.docs.map(d => ({ d, s: tripDocState(d, next) })).filter(x => x.s.level !== 'ok');
  return React.createElement('div', { className: 'space-y-4' },
    next && React.createElement('section', { className: 'ent-card p-5 trip-hero' },
      React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, active ? 'עכשיו בטיול' : 'הטיול הבא'),
      React.createElement('h2', { className: 'ent-heading text-2xl font-bold' }, next.title),
      React.createElement('p', { className: 'trip-count' }, active ? (todayPlan.length ? `היום: ${todayPlan.slice(0, 3).map(p => `${p.time ? p.time + ' ' : ''}${p.title}`).join(' · ')}` : 'אין תוכנית להיום. תהנו!') :
        days === 0 ? 'יוצאים היום!' : days === 1 ? 'יוצאים מחר' : `עוד ${days} ימים`),
      pack.length > 0 && React.createElement('div', { className: 'mt-3' },
        React.createElement('div', { className: 'flex justify-between text-xs mb-1', style: { color: 'var(--text-muted)' } }, React.createElement('span', null, 'ציוד והכנות'), React.createElement('span', null, `${done} מתוך ${pack.length}`)),
        React.createElement('div', { className: 'fin-bar' }, React.createElement('span', { className: 'fin-bar-fill', style: { width: `${Math.round(done / pack.length * 100)}%`, background: 'var(--cyan)' } }))),
      docIssues.length > 0 && !isChild && React.createElement('p', { className: 'text-sm mt-3', style: { color: TRIP_LEVEL[docIssues[0].s.level] } }, `⚠️ ${docIssues[0].d.personName}: ${TRIP_DOC_TYPES[docIssues[0].d.type]} ${docIssues[0].s.text}${docIssues.length > 1 ? ` (ועוד ${docIssues.length - 1})` : ''}`)),
    !isChild && React.createElement('section', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex items-center justify-between gap-2' },
        React.createElement('h3', { className: 'ent-heading font-bold' }, '🛂 מסמכי נסיעה'),
        React.createElement('button', { type: 'button', className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => setDocForm(docForm ? null : { personId: members[0] ? members[0].id : '', type: 'passport', expires: '' }) }, docForm ? 'סגירה' : '+ מסמך')),
      React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, 'רק סוג ותאריך תוקף, בלי מספרי מסמכים. נבדק מול הטיול הבא: דרכון שפג פחות מחצי שנה אחרי הטיול מסומן.'),
      docForm && React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' } },
        React.createElement('select', { className: 'ent-input px-3 py-2 rounded-xl text-sm outline-none', 'aria-label': 'של מי', value: docForm.personId, onChange: e => setDocForm({ ...docForm, personId: e.target.value }) },
          members.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name))),
        React.createElement('select', { className: 'ent-input px-3 py-2 rounded-xl text-sm outline-none', 'aria-label': 'סוג מסמך', value: docForm.type, onChange: e => setDocForm({ ...docForm, type: e.target.value }) },
          Object.entries(TRIP_DOC_TYPES).map(([k, l]) => React.createElement('option', { key: k, value: k }, l))),
        React.createElement('input', { type: 'date', className: 'ent-input px-3 py-2 rounded-xl text-sm outline-none', 'aria-label': 'בתוקף עד', value: docForm.expires, onChange: e => setDocForm({ ...docForm, expires: e.target.value }) }),
        React.createElement('button', { type: 'button', className: 'ent-pill-btn solid-bronze px-4 py-2 text-sm', onClick: async () => {
          const m = members.find(x => x.id === docForm.personId);
          await api.addDoc({ personId: docForm.personId || null, personName: m ? m.name : '', type: docForm.type, expires: docForm.expires });
          setDocForm(null);
        } }, 'שמירה')),
      !api.docs.length ? React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-dim)' } }, 'עוד לא הוזנו מסמכים.') :
        React.createElement('div', null, api.docs.map(d => {
          const s = tripDocState(d, next);
          return React.createElement('div', { key: d.id, className: 'fin-review-row' },
            React.createElement('div', { className: 'min-w-0' },
              React.createElement('p', { className: 'text-sm font-semibold' }, d.personName, ' · ', TRIP_DOC_TYPES[d.type] || d.type),
              React.createElement('p', { className: 'text-xs', style: { color: TRIP_LEVEL[s.level] } }, `עד ${new Date(d.expires + 'T00:00:00').toLocaleDateString('he-IL')} · ${s.text}`)),
            React.createElement('button', { type: 'button', className: 'ent-icon-btn', 'aria-label': `מחיקת ${TRIP_DOC_TYPES[d.type]} של ${d.personName}`, onClick: () => api.deleteDoc(d) }, React.createElement(ITrash, { size: 15 })));
        }))));
}

/* ---- בתוך כרטיס טיול: ציוד | תוכנית ---- */
function TripPlanner({ trip, api, members, me, isChild }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('pack');
  const [text, setText] = useState('');
  const [who, setWho] = useState('');
  const [planDraft, setPlanDraft] = useState({});
  if (!api.ready || api.unavailable) return null;
  const kids = members.filter(m => m.kind === 'child');
  const myIds = isChild ? [me.id] : null;
  const items = api.packing.filter(p => p.tripId === trip.id && (!myIds || !p.personId || myIds.includes(p.personId)));
  const plan = api.plan.filter(p => p.tripId === trip.id);
  const done = items.filter(p => p.checked).length;
  const days = (() => {
    if (!trip.startDate) return [];
    const n = Math.min(21, Math.max(0, tripDaysBetween(trip.startDate, trip.endDate || trip.startDate)));
    return Array.from({ length: n + 1 }, (_, i) => tripAddDays(trip.startDate, i));
  })();
  const fromTemplate = k => {
    const t = TRIP_PACK_TEMPLATES[k];
    const rows = [
      ...t.before.map(x => ({ text: x, category: TRIP_BEFORE })),
      ...t.shared.map(x => ({ text: x })),
      ...members.flatMap(m => [...TRIP_PACK_PERSON, ...(m.kind === 'child' ? TRIP_PACK_KID : [])].filter(x => k !== 'camping' || x !== 'בגד ים').map(x => ({ text: x, personId: m.id })))
    ];
    api.addPacking(trip.id, rows);
  };
  const groups = [
    [TRIP_BEFORE, items.filter(p => p.category === TRIP_BEFORE)],
    ['משותף', items.filter(p => !p.personId && p.category !== TRIP_BEFORE)],
    ...members.filter(m => !myIds || myIds.includes(m.id)).map(m => [m.name, items.filter(p => p.personId === m.id && p.category !== TRIP_BEFORE)])
  ].filter(([, l]) => l.length);
  const addItem = () => {
    if (!text.trim()) return;
    api.addPacking(trip.id, [{ text: text.trim(), personId: isChild ? me.id : who || null, category: who === TRIP_BEFORE ? TRIP_BEFORE : null }].map(r => r.category ? { ...r, personId: null } : r));
    setText('');
  };
  return React.createElement('div', { className: 'w-full trip-planner' },
    React.createElement('button', { type: 'button', className: 'text-sm font-semibold flex items-center gap-2', 'aria-expanded': open, onClick: () => setOpen(!open) },
      '🧳 ', open ? 'סגירת ההכנות' : 'הכנות לטיול',
      React.createElement('span', { className: 'text-xs font-normal', style: { color: 'var(--text-muted)' } }, items.length ? ` · ציוד ${done}/${items.length}` : '', plan.length ? ` · ${plan.length} בתוכנית` : '')),
    open && React.createElement('div', { className: 'mt-3 space-y-3' },
      React.createElement('div', { className: 'td-seg', role: 'tablist' }, [['pack', 'ציוד והכנות'], ['plan', 'תוכנית יומית']].map(([k, l]) =>
        React.createElement('button', { key: k, type: 'button', role: 'tab', 'aria-selected': tab === k, className: tab === k ? 'on' : '', onClick: () => setTab(k) }, l))),
      tab === 'pack' && React.createElement('div', { className: 'space-y-3' },
        !items.length && !isChild && React.createElement('div', { className: 'space-y-2' },
          React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-2)' } }, 'להתחיל מרשימה מוכנה (ציוד לכל בן משפחה + מה לעשות לפני היציאה):'),
          React.createElement('div', { className: 'flex flex-wrap gap-2' }, Object.entries(TRIP_PACK_TEMPLATES).map(([k, t]) =>
            React.createElement('button', { key: k, type: 'button', className: 'ent-pill-btn ghost px-4 py-1.5 text-sm', onClick: () => fromTemplate(k) }, t.label)))),
        groups.map(([name, list]) => {
          const d = list.filter(x => x.checked).length;
          return React.createElement('div', { key: name },
            React.createElement('p', { className: 'text-xs font-semibold mb-1 flex justify-between', style: { color: 'var(--text-muted)' } }, React.createElement('span', null, name), React.createElement('span', null, `${d}/${list.length}`)),
            React.createElement('div', { className: 'trip-pack-grid' }, list.map(p => React.createElement('label', { key: p.id, className: 'trip-pack-item' + (p.checked ? ' on' : '') },
              React.createElement('input', { type: 'checkbox', checked: p.checked, onChange: () => api.togglePacking(p) }),
              React.createElement('span', { className: 'flex-1' }, p.text),
              !isChild && React.createElement('button', { type: 'button', className: 'trip-pack-x', 'aria-label': `הסרת ${p.text}`, onClick: e => { e.preventDefault(); api.deletePacking(p); } }, '×')))));
        }),
        React.createElement('div', { className: 'flex gap-2' },
          !isChild && React.createElement('select', { className: 'ent-input px-2 py-2 rounded-xl text-sm outline-none', 'aria-label': 'של מי', value: who, onChange: e => setWho(e.target.value) },
            React.createElement('option', { value: '' }, 'משותף'), React.createElement('option', { value: TRIP_BEFORE }, TRIP_BEFORE), members.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name))),
          React.createElement('input', { className: 'ent-input flex-1 px-3 py-2 rounded-xl text-sm outline-none', placeholder: 'עוד משהו לקחת או לעשות', value: text, onChange: e => setText(e.target.value), onKeyDown: e => { if (e.key === 'Enter') addItem(); } }),
          React.createElement('button', { type: 'button', className: 'ent-pill-btn ghost px-3 text-sm', onClick: addItem, 'aria-label': 'הוספה' }, '+'))),
      tab === 'plan' && React.createElement('div', { className: 'space-y-3' },
        !days.length ? React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-dim)' } }, 'כדי לבנות תוכנית יומית צריך תאריכים לטיול.') :
        days.map(day => {
          const list = plan.filter(p => p.day === day).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.sort - b.sort);
          const dr = planDraft[day] || { time: '', title: '' };
          const setDr = v => setPlanDraft(s => ({ ...s, [day]: { ...dr, ...v } }));
          return React.createElement('div', { key: day, className: 'trip-day' },
            React.createElement('p', { className: 'text-sm font-bold' }, tripDayLabel(day)),
            list.map(p => React.createElement('div', { key: p.id, className: 'flex items-center gap-2 text-sm py-1' },
              React.createElement('span', { className: 'trip-time' }, p.time || '·'),
              React.createElement('span', { className: 'flex-1' }, p.title),
              !isChild && React.createElement('button', { type: 'button', className: 'trip-pack-x', 'aria-label': `מחיקת ${p.title}`, onClick: () => api.deletePlan(p) }, '×'))),
            !isChild && React.createElement('div', { className: 'flex gap-2 mt-1' },
              React.createElement('input', { className: 'ent-input px-2 py-1.5 rounded-lg text-sm outline-none', style: { width: 76 }, placeholder: 'שעה', value: dr.time, onChange: e => setDr({ time: e.target.value }) }),
              React.createElement('input', { className: 'ent-input flex-1 px-2 py-1.5 rounded-lg text-sm outline-none', placeholder: 'מה עושים?', value: dr.title,
                onChange: e => setDr({ title: e.target.value }),
                onKeyDown: async e => { if (e.key === 'Enter' && dr.title.trim()) { await api.addPlan({ tripId: trip.id, day, time: dr.time, title: dr.title }); setPlanDraft(s => ({ ...s, [day]: { time: '', title: '' } })); } } })));
        }))));
}

if (typeof module !== 'undefined') module.exports = { tripDocState, TRIP_PACK_TEMPLATES };
