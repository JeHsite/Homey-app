/* Homey — ימים קבועים של המשפחה המורחבת: ימי הולדת, ימי נישואין, אזכרות. חוזרים כל שנה, לפי הלוח הלועזי או העברי.
 * מוצגים בלוח החודשי ובמסך "היום" (modules/today.js), ובתדריך הבוקר/הערב (daily-brief). מנוהלים בדף "מתנות ואירועים".
 * טבלה: family_dates (supabase/family-dates.sql). התאריך העברי (heb_month/heb_day) מחושב בדפדפן בשמירה.
 * נטען לפני הסקריפט הראשי ומשתמש בגלובליים שלו ושל modules/tasks.js ו-modules/today.js (tdHeb, TD_HEB_MONTH, TD_GEM) רק בזמן רינדור. */

const FD_KINDS = {
  birthday: { icon: '🎂', label: 'יום הולדת' },
  anniversary: { icon: '💍', label: 'יום נישואין' },
  memorial: { icon: '🕯️', label: 'אזכרה' },
  other: { icon: '📌', label: 'אחר' }
};
const FD_HEB_YEAR = (() => { try { return new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric' }); } catch (_e) { return null; } })();
const fdHebYear = iso => { if (!FD_HEB_YEAR) return null; const p = FD_HEB_YEAR.formatToParts(plParse(iso)).find(x => x.type === 'year'); return p ? Number(p.value) : null; };
const fdFromRow = r => ({ id: r.id, name: r.name, kind: r.kind, date: String(r.date).slice(0, 10), hebrew: !!r.hebrew, hebMonth: r.heb_month || null, hebDay: r.heb_day || null, note: r.note || '' });

// האם התאריך הקבוע נופל ביום הזה, ובאיזו שנה (מספר שנים מאז התאריך המקורי)
function fdOccursOn(fd, day) {
  if (day < fd.date) return null;
  if (!fd.hebrew || !fd.hebMonth) {
    const y = Number(day.slice(0, 4));
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const md = fd.date.slice(5) === '02-29' && !leap ? '02-28' : fd.date.slice(5);
    return md === day.slice(5) ? { years: y - Number(fd.date.slice(0, 4)) } : null;
  }
  const h = tdHeb(day);
  if (!h) return null;
  // אדר: בשנה מעוברת חוגגים באדר ב׳; מי שנולד באדר א׳/ב׳ חוגג בשנה רגילה באדר
  const want = fd.hebMonth;
  const monthOk = h.m === want || (want === 'Adar' && h.m === 'Adar II') || ((want === 'Adar I' || want === 'Adar II') && h.m === 'Adar');
  if (!monthOk) return null;
  // ל׳ בחודש שיש בו השנה רק 29 יום: ביום כ״ט
  const dayOk = h.d === fd.hebDay || (fd.hebDay === 30 && h.d === 29 && tdHeb(plAddDays(day, 1)).d === 1);
  if (!dayOk) return null;
  const y0 = fdHebYear(fd.date), y1 = fdHebYear(day);
  return { years: y0 && y1 ? y1 - y0 : Number(day.slice(0, 4)) - Number(fd.date.slice(0, 4)) };
}
const fdTitle = (fd, years) => {
  if (fd.kind === 'birthday') return `יום הולדת${years > 0 ? ' ' + years : ''} ל${fd.name}`;
  if (fd.kind === 'anniversary') return `יום נישואין${years > 0 ? ' ' + years : ''}: ${fd.name}`;
  if (fd.kind === 'memorial') return `אזכרה: ${fd.name}`;
  return fd.name;
};
// לשימוש בלוח ובמסך היום: [{ key, kind:'fdate', icon, title }]
function fdOn(list, day) {
  return (list || []).map(fd => {
    const o = fdOccursOn(fd, day);
    return o && (o.years > 0 || fd.kind === 'other') ? { key: 'fd' + fd.id + day, kind: 'fdate', fdKind: fd.kind, icon: (FD_KINDS[fd.kind] || FD_KINDS.other).icon, title: fdTitle(fd, o.years), fd } : null;
  }).filter(Boolean);
}
// המופע הבא (עד שנה וחודש קדימה)
function fdNext(fd, fromIso) {
  for (let i = 0; i < 400; i++) {
    const d = plAddDays(fromIso, i);
    const o = fdOccursOn(fd, d);
    if (o && (o.years > 0 || fd.kind === 'other')) return { date: d, inDays: i, years: o.years };
  }
  return null;
}

function useFamilyDates({ familyId, isDemo, enabled, showToast }) {
  const [state, setState] = useState({ ready: false, unavailable: false, list: [] });
  useEffect(() => {
    if (!enabled || !familyId) return;
    if (isDemo) {
      const t = plToday();
      setState({ ready: true, unavailable: false, list: [
        { id: 'fd1', name: 'סבתא רחל', kind: 'birthday', date: '1950' + plAddDays(t, 5).slice(4), hebrew: false, hebMonth: null, hebDay: null, note: '' },
        { id: 'fd2', name: 'דוד ושירה', kind: 'anniversary', date: '2012' + plAddDays(t, 18).slice(4), hebrew: false, hebMonth: null, hebDay: null, note: '' },
        { id: 'fd3', name: 'סבא משה', kind: 'memorial', date: '2015-01-20', hebrew: true, hebMonth: 'Shevat', hebDay: 29, note: '' }
      ] });
      return;
    }
    let alive = true;
    sb.from('family_dates').select('*').eq('family_id', familyId).order('date').then(({ data, error }) => {
      if (!alive) return;
      setState({ ready: true, unavailable: !!error, list: (data || []).map(fdFromRow) });
    });
    return () => { alive = false; };
  }, [enabled, familyId, isDemo]);
  const add = async f => {
    const name = (f.name || '').trim();
    if (!name || !f.date) { showToast(!name ? 'נא לכתוב שם' : 'נא לבחור תאריך'); return false; }
    const h = f.hebrew ? tdHeb(f.date) : null;
    // אחרי שקיעה התאריך העברי כבר של היום הבא: מי שבחר "אחרי השקיעה" מקבל את התאריך העברי של מחרת
    const hh = f.hebrew && f.afterSunset ? tdHeb(plAddDays(f.date, 1)) : h;
    const row = { name: name.slice(0, 60), kind: f.kind, date: f.date, hebrew: !!f.hebrew, hebMonth: hh ? hh.m : null, hebDay: hh ? hh.d : null, note: '' };
    let id = 'local-' + Date.now();
    if (!isDemo) {
      const { data, error } = await sb.from('family_dates').insert({ family_id: familyId, name: row.name, kind: row.kind, date: row.date, hebrew: row.hebrew, heb_month: row.hebMonth, heb_day: row.hebDay }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return false; }
      id = data.id;
    }
    setState(s => ({ ...s, list: [...s.list, { ...row, id }] }));
    return true;
  };
  const remove = async fd => {
    setState(s => ({ ...s, list: s.list.filter(x => x.id !== fd.id) }));
    if (!isDemo) await sb.from('family_dates').delete().eq('id', fd.id);
  };
  return { ...state, add, remove };
}

// הכרטיס בדף "מתנות ואירועים"
function FamilyDatesCard({ api, onGift }) {
  const [adding, setAdding] = useState(false);
  const empty = { name: '', kind: 'birthday', date: '', hebrew: false, afterSunset: false };
  const [f, setF] = useState(empty);
  const today = plToday();
  if (!api.ready) return null;
  if (api.unavailable) return React.createElement('div', { className: 'ent-card p-5 text-sm', style: { color: 'var(--text-muted)' } }, 'ימים קבועים במשפחה: יש להריץ את family-dates.sql ב-Supabase.');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const rows = api.list.map(fd => ({ fd, next: fdNext(fd, today) })).sort((a, b) => (a.next ? a.next.inDays : 9999) - (b.next ? b.next.inDays : 9999));
  const hebPreview = f.date && f.hebrew ? tdHebLabel(f.afterSunset ? plAddDays(f.date, 1) : f.date) : '';
  const inp = 'ent-input w-full px-3 py-2 rounded-xl text-sm outline-none';
  return React.createElement('div', { className: 'ent-card p-5 space-y-3' },
    React.createElement('div', { className: 'flex items-center justify-between gap-2' },
      React.createElement('div', null,
        React.createElement('h3', { className: 'ent-heading font-bold' }, 'ימים קבועים במשפחה'),
        React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, 'סבים, דודים, חברים: חוזרים כל שנה בלוח, ותזכורת שבוע לפני')),
      React.createElement('button', { type: 'button', className: 'ent-pill-btn solid-bronze px-4 py-1.5 text-sm', onClick: () => { setF(empty); setAdding(!adding); }, 'aria-expanded': adding }, adding ? 'סגירה' : '+ הוספה')),
    adding && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
      React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, Object.entries(FD_KINDS).map(([k, v]) =>
        React.createElement('button', { key: k, type: 'button', 'aria-pressed': f.kind === k, className: 'ent-pill-btn px-3 py-1 text-xs ' + (f.kind === k ? 'solid-bronze' : 'ghost'), onClick: () => set('kind', k) }, v.icon, ' ', v.label))),
      React.createElement('div', { className: 'grid gap-2 sm:grid-cols-2' },
        React.createElement('input', { className: inp, placeholder: f.kind === 'anniversary' ? 'של מי? (למשל דוד ושירה)' : f.kind === 'other' ? 'מה? (למשל יום העלייה של סבא)' : 'של מי? (למשל סבתא רחל)', value: f.name, maxLength: 60, onChange: e => set('name', e.target.value), 'aria-label': 'שם' }),
        React.createElement('input', { className: inp, type: 'date', value: f.date, max: today, onChange: e => set('date', e.target.value), 'aria-label': f.kind === 'birthday' ? 'תאריך לידה' : 'התאריך המקורי' })),
      React.createElement('label', { className: 'flex items-center gap-2 text-sm' },
        React.createElement('input', { type: 'checkbox', checked: f.hebrew, onChange: e => set('hebrew', e.target.checked) }),
        'לפי הלוח העברי (חוזר כל שנה באותו תאריך עברי)'),
      f.hebrew && React.createElement('label', { className: 'flex items-center gap-2 text-sm', style: { color: 'var(--text-muted)' } },
        React.createElement('input', { type: 'checkbox', checked: f.afterSunset, onChange: e => set('afterSunset', e.target.checked) }),
        'קרה אחרי השקיעה'),
      hebPreview && React.createElement('p', { className: 'text-xs', style: { color: 'var(--bronze)' } }, `התאריך העברי: ${hebPreview}`),
      React.createElement('div', { className: 'flex gap-2' },
        React.createElement('button', { type: 'button', className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm', onClick: async () => { if (await api.add(f)) { setAdding(false); setF(empty); } } }, 'שמירה'),
        React.createElement('button', { type: 'button', className: 'ent-pill-btn ghost px-5 py-2 text-sm', onClick: () => setAdding(false) }, 'ביטול'))),
    !rows.length && !adding ? React.createElement(EmptyState, { text: 'עוד אין ימים קבועים', hint: 'מוסיפים פעם אחת, וזה מופיע בלוח כל שנה' }) :
      React.createElement('div', null, rows.map(({ fd, next }) => {
        const k = FD_KINDS[fd.kind] || FD_KINDS.other;
        return React.createElement('div', { key: fd.id, className: 'ent-row py-2.5 flex items-center gap-3' },
          React.createElement('span', { className: 'text-xl', 'aria-hidden': 'true' }, k.icon),
          React.createElement('div', { className: 'flex-1 min-w-0' },
            React.createElement('p', { className: 'text-sm font-semibold' }, next ? fdTitle(fd, next.years) : fd.name),
            React.createElement('p', { className: 'text-xs', style: { color: next && next.inDays <= 7 ? 'var(--bronze)' : 'var(--text-muted)' } },
              [next ? (next.inDays === 0 ? 'היום' : next.inDays === 1 ? 'מחר' : `בעוד ${next.inDays} ימים`) : null,
                next ? plParse(next.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' }) : null,
                fd.hebrew && fd.hebMonth ? `${TD_GEM[fd.hebDay] || fd.hebDay} ${TD_HEB_MONTH[fd.hebMonth] || fd.hebMonth}` : null].filter(Boolean).join(' · '))),
          fd.kind !== 'memorial' && next && onGift && React.createElement('button', { type: 'button', className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => onGift(fdTitle(fd, next.years), next.date) }, '🎁 מתנה'),
          React.createElement('button', { type: 'button', className: 'ent-icon-btn', 'aria-label': `מחיקת ${fd.name}`, onClick: () => api.remove(fd) }, React.createElement(ITrash, { size: 15 })));
      })));
}
