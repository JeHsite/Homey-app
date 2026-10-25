/* Homey — מערך "קניות": רשימת קניות משותפת בזמן אמת, קניות לבית (משאלות עם מחיר ועדיפות) ובזבוזים.
 * נטען לפני הסקריפט הראשי (כמו modules/tasks.js) ומשתמש בגלובליים שלו רק בזמן רינדור.
 * טבלאות: shopping_lists, shopping_items (supabase/shopping.sql). בזבוזים = הוצאות בכלכלה עם tag='impulse'. */

// מחלקות בסופר, לפי סדר ההליכה הרגיל, עם מילות מפתח לשיוך אוטומטי
const SHOP_CATEGORIES = [
  ['ירקות ופירות', '#22c55e', /עגבני|מלפפ|בננ|תפוח|תפוז|גזר|בצל|שום|תפו"?א|תפוחי אדמה|פלפל|חסה|לימון|אבוקדו|ענב|אבטיח|מלון|תות|קישוא|חציל|כרוב|ברוקולי|פטרוזיליה|כוסברה|שמיר|נענע|פירות|ירקות|תמר|אפרסק|אגס|קלמנטינ|פטרי/],
  ['מוצרי חלב וביצים', '#60a5fa', /חלב|גבינ|יוגורט|ביצ|קוטג|שמנת|חמאה|לבנה|מעדן|דנונה|בולגרית|צפתית|מוצרלה|שוקו/],
  ['לחם ומאפים', '#f59e0b', /לחם|פית|לחמני|חלה|בגט|טורטיי|עוגה|עוגיות|מאפ|קרואסון|בורקס/],
  ['בשר, עוף ודגים', '#ef4444', /עוף|בשר|דג|שניצל|קבב|הודו|נקניק|סלמון|כבד|פרגית|חזה|כרעיים|טחון|המבורגר/],
  ['מזווה', '#a16207', /אורז|פסטה|ספגטי|קמח|סוכר|שמן|טונה|קפה|תה|דגני|קורנפלקס|שימורים|רוטב|תבלין|מלח|פלפל שחור|קטשופ|מיונז|חומוס|טחינה|דבש|ריבה|שוקולד|במבה|ביסלי|חטיף|אטריות|עדשים|שעועית|פתיתים|קוסקוס|גרנולה|אגוז|שקדים/],
  ['קפואים', '#22d3ee', /קפוא|גלידה|אפונה|שעועית ירוקה|פיצה קפואה|בורקס קפוא/],
  ['שתייה', '#8b5cf6', /מים|קולה|מיץ|בירה|יין|סודה|משקה|תפוזים|ספרייט|פריגת/],
  ['ניקיון', '#14b8a6', /סבון כלים|אקונומיקה|נוזל|ספוג|שקיות|נייר טואלט|מגבות נייר|מרכך כביסה|אבקת כביסה|ג'ל כביסה|מטהר|כלור|מגבונים לניקוי|נייר כסף|ניילון/],
  ['היגיינה וטיפוח', '#ec4899', /שמפו|משחת שיניים|מברשת שיניים|דאודורנט|סבון|מגבונים|קרם|תחבושות|גילוח|צמר גפן|מרכך שיער/],
  ['תינוקות וילדים', '#f97316', /טיטול|חיתול|מטרנה|סימילאק|מוצץ|בקבוק תינוק/],
  ['אחר', '#94a3b8', null]
];
const shopGuessCategory = name => {
  const hit = SHOP_CATEGORIES.find(([, , re]) => re && re.test(name));
  return hit ? hit[0] : 'אחר';
};
const shopColor = cat => (SHOP_CATEGORIES.find(c => c[0] === cat) || SHOP_CATEGORIES[SHOP_CATEGORIES.length - 1])[1];
// "2 חלב" / "חלב x2" / "חלב 3 יח'" -> { name, qty }
const shopParse = text => {
  let t = text.trim(), qty = '';
  let m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+(.+)$/);
  if (m) { qty = m[1]; t = m[2]; } else if ((m = t.match(/^(.+?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)$/))) { t = m[1]; qty = m[2]; }
  return { name: t.trim(), qty };
};
const shopItemFromRow = r => ({
  id: r.id, listId: r.list_id, name: r.name, qty: r.qty || '', category: r.category, note: r.note || '',
  estPrice: r.est_price == null ? null : Number(r.est_price), priority: r.priority, staple: !!r.staple,
  status: r.status, addedBy: r.added_by || '', boughtAt: r.bought_at, createdAt: r.created_at
});

function shopDemo() {
  const g = 'demo-list-g', hm = 'demo-list-h';
  const it = (id, o) => ({ id, listId: g, qty: '', note: '', estPrice: null, priority: 2, staple: false, status: 'open', addedBy: 'אמא', boughtAt: null, createdAt: new Date().toISOString(), ...o, category: o.category || shopGuessCategory(o.name) });
  return {
    lists: [{ id: g, name: 'סופר', kind: 'grocery' }, { id: hm, name: 'קניות לבית', kind: 'home' }],
    items: [
      it('ds1', { name: 'חלב', qty: '2', staple: true }),
      it('ds2', { name: 'לחם אחיד', staple: true, addedBy: 'אבא' }),
      it('ds3', { name: 'עגבניות', qty: '1 ק"ג' }),
      it('ds4', { name: 'גבינה צהובה' }),
      it('ds5', { name: 'נייר טואלט', addedBy: 'אבא' }),
      it('ds6', { name: 'במבה', addedBy: 'נועה' }),
      it('ds7', { name: 'ביצים', staple: true, status: 'bought', boughtAt: new Date().toISOString() }),
      it('dh1', { listId: hm, name: 'שואב אבק רובוטי', category: 'אחר', estPrice: 1400, priority: 1, note: 'לבדוק מבצעים' }),
      it('dh2', { listId: hm, name: 'מדף לחדר של איתי', category: 'אחר', estPrice: 250, priority: 2 }),
      it('dh3', { listId: hm, name: 'סט סירים', category: 'אחר', estPrice: 600, priority: 3 })
    ]
  };
}

/* ---- נתוני הקניות + עדכונים בזמן אמת מכל בני המשפחה ---- */
function useShopping({ familyId, isDemo, enabled, meName, showToast }) {
  const [state, setState] = useState({ ready: false, unavailable: false, lists: [], items: [] });
  useEffect(() => {
    if (!enabled || !familyId) return;
    if (isDemo) {
      const d = shopDemo();
      setState({ ready: true, unavailable: false, ...d });
      return;
    }
    let alive = true;
    let channel = null;
    (async () => {
      const [l, i] = await Promise.all([
        sb.from('shopping_lists').select('*').eq('family_id', familyId).order('created_at'),
        sb.from('shopping_items').select('*').eq('family_id', familyId)
      ]);
      if (!alive) return;
      if (l.error || i.error) return setState({ ready: true, unavailable: true, lists: [], items: [] });
      let lists = (l.data || []).map(r => ({ id: r.id, name: r.name, kind: r.kind }));
      // בפעם הראשונה: רשימת "סופר" ורשימת "קניות לבית"
      const need = [['סופר', 'grocery'], ['קניות לבית', 'home']].filter(([, k]) => !lists.some(x => x.kind === k));
      if (need.length) {
        const { data } = await sb.from('shopping_lists').insert(need.map(([name, kind]) => ({ family_id: familyId, name, kind }))).select();
        lists = [...lists, ...(data || []).map(r => ({ id: r.id, name: r.name, kind: r.kind }))];
      }
      if (!alive) return;
      setState({ ready: true, unavailable: false, lists, items: (i.data || []).map(shopItemFromRow) });
      channel = sb.channel('shop-' + familyId).on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: `family_id=eq.${familyId}` }, p => {
        setState(s => {
          if (p.eventType === 'DELETE') return { ...s, items: s.items.filter(x => x.id !== p.old.id) };
          const row = shopItemFromRow(p.new);
          const exists = s.items.some(x => x.id === row.id);
          return { ...s, items: exists ? s.items.map(x => x.id === row.id ? row : x) : [...s.items, row] };
        });
      }).subscribe();
    })();
    return () => {
      alive = false;
      if (channel) sb.removeChannel(channel);
    };
  }, [enabled, familyId, isDemo]);

  const patch = fn => setState(s => ({ ...s, ...fn(s) }));
  const tmpId = () => 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);

  const addItem = async (listId, o) => {
    const row = { listId, name: o.name.trim(), qty: o.qty || '', category: o.category || shopGuessCategory(o.name), note: o.note || '',
      estPrice: o.estPrice == null || o.estPrice === '' ? null : Number(o.estPrice), priority: o.priority || 2, staple: !!o.staple,
      status: 'open', addedBy: meName || '', boughtAt: null, createdAt: new Date().toISOString() };
    if (!row.name) return null;
    let id = tmpId();
    if (!isDemo) {
      const { data, error } = await sb.from('shopping_items').insert({ list_id: listId, family_id: familyId, name: row.name, qty: row.qty || null,
        category: row.category, note: row.note || null, est_price: row.estPrice, priority: row.priority, staple: row.staple, added_by: row.addedBy || null }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return null; }
      id = data.id;
    }
    const saved = { ...row, id };
    patch(s => ({ items: s.items.some(x => x.id === id) ? s.items : [...s.items, saved] }));
    return saved;
  };
  const updateItem = async (item, changes) => {
    patch(s => ({ items: s.items.map(x => x.id === item.id ? { ...x, ...changes } : x) }));
    if (isDemo) return;
    const map = { status: 'status', boughtAt: 'bought_at', staple: 'staple', qty: 'qty', category: 'category', estPrice: 'est_price', priority: 'priority', note: 'note', name: 'name' };
    const db = {};
    Object.entries(changes).forEach(([k, v]) => { if (map[k]) db[map[k]] = v; });
    await sb.from('shopping_items').update(db).eq('id', item.id);
  };
  const toggleBought = item => updateItem(item, item.status === 'bought' ? { status: 'open', boughtAt: null } : { status: 'bought', boughtAt: new Date().toISOString() });
  const removeItems = async ids => {
    if (!ids.length) return;
    patch(s => ({ items: s.items.filter(x => !ids.includes(x.id)) }));
    if (!isDemo) await sb.from('shopping_items').delete().in('id', ids);
  };
  // סיום קנייה: מה שבעגלה יוצא מהרשימה. פריט קבוע נשאר במצב 'bought' בלי bought_at (= מחכה לפעם הבאה),
  // ובעגלה נמצאים רק פריטים עם bought_at. "החזרת הקבועים" מחזירה אותם לרשימה.
  const finishShopping = async listId => {
    const bought = state.items.filter(x => x.listId === listId && x.status === 'bought' && x.boughtAt);
    await removeItems(bought.filter(x => !x.staple).map(x => x.id));
    const staples = bought.filter(x => x.staple);
    patch(s => ({ items: s.items.map(x => staples.some(y => y.id === x.id) ? { ...x, boughtAt: null } : x) }));
    if (!isDemo && staples.length) await sb.from('shopping_items').update({ bought_at: null }).in('id', staples.map(x => x.id));
    return bought.length;
  };
  const restoreStaples = async listId => {
    const st = state.items.filter(x => x.listId === listId && x.staple && x.status === 'bought' && !x.boughtAt);
    patch(s => ({ items: s.items.map(x => st.some(y => y.id === x.id) ? { ...x, status: 'open', boughtAt: null } : x) }));
    if (!isDemo && st.length) await sb.from('shopping_items').update({ status: 'open', bought_at: null }).in('id', st.map(x => x.id));
    return st.length;
  };
  const addList = async (name, kind) => {
    let id = tmpId();
    if (!isDemo) {
      const { data, error } = await sb.from('shopping_lists').insert({ family_id: familyId, name: name.trim(), kind }).select().single();
      if (error) { showToast('שגיאה בשמירה'); return null; }
      id = data.id;
    }
    const l = { id, name: name.trim(), kind };
    patch(s => ({ lists: [...s.lists, l] }));
    return l;
  };
  const deleteList = async list => {
    patch(s => ({ lists: s.lists.filter(x => x.id !== list.id), items: s.items.filter(x => x.listId !== list.id) }));
    if (!isDemo) await sb.from('shopping_lists').delete().eq('id', list.id);
  };
  return { ...state, addItem, updateItem, toggleBought, removeItems, finishShopping, restoreStaples, addList, deleteList };
}

function shopHubSummary(shop, isChild, splurgeMonth, currency) {
  if (!shop.ready || shop.unavailable) return null;
  const groceryIds = shop.lists.filter(l => l.kind === 'grocery').map(l => l.id);
  const open = shop.items.filter(x => groceryIds.includes(x.listId) && x.status === 'open').length;
  const parts = [];
  if (!isChild && splurgeMonth > 0) parts.push(`בזבוזים החודש ${currency}${Math.round(splurgeMonth).toLocaleString('he-IL')}`);
  return {
    big: open === 0 ? 'הרשימה ריקה' : open === 1 ? 'פריט אחד ברשימה' : `${open} פריטים ברשימה`,
    line: parts.join(' · ') || (open ? 'מוכנים לסופר' : 'אפשר להוסיף פריטים')
  };
}

const shopLocked = (isPremium, onUpgrade) => !isPremium && React.createElement(PremiumLock, { title: 'מערך הקניות הוא תכונת פרימיום', desc: 'רשימת קניות משותפת שמתעדכנת אצל כולם בזמן אמת, קניות לבית ומעקב בזבוזים.', onUpgrade });
const shopNotReady = shop => !shop.ready ? React.createElement('div', { className: 'ent-card p-6' }, 'טוען...')
  : shop.unavailable ? React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המערך עוד לא הופעל בשרת. יש להריץ את shopping.sql ב-Supabase.') : null;
const shopInput = 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none';

/* ======================= לשונית "רשימת קניות" ======================= */
function GroceryPage({ shop, isChild, isPremium, onUpgrade, currency, onRecordExpense, showToast }) {
  const [listId, setListId] = useState(null);
  const [text, setText] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [paid, setPaid] = useState('');
  const [newList, setNewList] = useState(null);
  const [busy, setBusy] = useState(false);
  const locked = shopLocked(isPremium, onUpgrade);
  if (locked) return locked;
  const wait = shopNotReady(shop);
  if (wait) return wait;

  const lists = shop.lists.filter(l => l.kind === 'grocery');
  const list = lists.find(l => l.id === listId) || lists[0];
  if (!list) return React.createElement(EmptyState, { text: 'אין רשימות' });
  const items = shop.items.filter(x => x.listId === list.id);
  const open = items.filter(x => x.status === 'open');
  const cart = items.filter(x => x.status === 'bought' && x.boughtAt);
  const hiddenStaples = items.filter(x => x.staple && x.status === 'bought' && !x.boughtAt);
  const known = [...new Set(shop.items.filter(x => shop.lists.find(l => l.id === x.listId && l.kind === 'grocery')).map(x => x.name))];

  const add = async () => {
    const { name, qty } = shopParse(text);
    if (!name) return;
    const dup = open.find(x => x.name === name);
    if (dup) { setText(''); return; }
    setText('');
    await shop.addItem(list.id, { name, qty });
  };
  const finish = async () => {
    setBusy(true);
    const amount = Number(paid);
    if (amount > 0 && onRecordExpense) await onRecordExpense({ category: 'מזון', sub: 'סופר', amount, description: `קנייה ב${list.name} (${cart.length} פריטים)` });
    await shop.finishShopping(list.id);
    setBusy(false);
    setCheckout(false);
    setPaid('');
  };

  const byCat = SHOP_CATEGORIES.map(([cat, color]) => [cat, color, open.filter(x => x.category === cat)]).filter(g => g[2].length);
  const itemRow = x => React.createElement('div', { key: x.id, className: 'shop-item flex items-center gap-3 py-2' + (x.status === 'bought' ? ' is-done' : '') },
    React.createElement(PlCheck, { done: x.status === 'bought', onClick: () => shop.toggleBought(x), label: x.status === 'bought' ? `להחזיר לרשימה: ${x.name}` : `נכנס לעגלה: ${x.name}` }),
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('p', { className: 'pl-task-title text-sm font-semibold' }, x.name, x.qty ? React.createElement('span', { className: 'shop-qty' }, ` ${x.qty}`) : null),
      x.addedBy && React.createElement('p', { style: { color: 'var(--text-dim)', fontSize: 11 } }, `הוסיף/ה: ${x.addedBy}`)),
    !isChild && React.createElement('button', { type: 'button', className: 'shop-staple' + (x.staple ? ' on' : ''), 'aria-pressed': x.staple, 'aria-label': x.staple ? `לבטל פריט קבוע: ${x.name}` : `לסמן כפריט קבוע: ${x.name}`, title: 'פריט קבוע', onClick: () => shop.updateItem(x, { staple: !x.staple }) }, '★'),
    !isChild && React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${x.name}`, onClick: () => shop.removeItems([x.id]) }, React.createElement(IX, { size: 14 })));

  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'רשימת קניות'),
        React.createElement('div', { className: 'flex flex-wrap gap-1.5 items-center' },
          lists.length > 1 && lists.map(l => React.createElement('button', { key: l.id, type: 'button', onClick: () => setListId(l.id), 'aria-pressed': l.id === list.id, className: 'ent-pill-btn px-3 py-1 text-xs',
            style: { background: l.id === list.id ? 'var(--bronze)' : 'var(--navy-panel-2)', color: l.id === list.id ? 'var(--on-accent)' : 'var(--text-2)' } }, l.name)),
          !isChild && (newList != null ? React.createElement('span', { className: 'flex gap-1' },
            React.createElement('input', { className: 'ent-input px-3 py-1 rounded-full text-xs outline-none', style: { width: 120 }, placeholder: 'שם הרשימה', autoFocus: true, value: newList, onChange: e => setNewList(e.target.value),
              onKeyDown: async e => { if (e.key === 'Enter' && newList.trim()) { const l = await shop.addList(newList, 'grocery'); if (l) setListId(l.id); setNewList(null); } if (e.key === 'Escape') setNewList(null); } }))
            : React.createElement('button', { type: 'button', className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => setNewList('') }, '+ רשימה')))),
      React.createElement('div', { className: 'flex gap-2' },
        React.createElement('input', { className: 'ent-input flex-1 px-4 py-3 rounded-xl text-sm outline-none', placeholder: 'מה להוסיף? (למשל "2 חלב")', value: text, list: 'shop-known',
          onChange: e => setText(e.target.value), onKeyDown: e => { if (e.key === 'Enter') add(); }, 'aria-label': 'פריט חדש' }),
        React.createElement('datalist', { id: 'shop-known' }, known.slice(0, 200).map(n => React.createElement('option', { key: n, value: n }))),
        React.createElement('button', { onClick: add, className: 'ent-pill-btn solid-bronze px-4 text-sm', 'aria-label': 'הוספה' }, React.createElement(IPlus, { size: 18 }))),
      text.trim() && React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, 'ייכנס ל: ', shopGuessCategory(shopParse(text).name)),
      hiddenStaples.length > 0 && !isChild && React.createElement('button', { type: 'button', className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: async () => { const n = await shop.restoreStaples(list.id); if (n) showToast(`${n} פריטים קבועים חזרו לרשימה`); } },
        `★ החזרת הקבועים לרשימה (${hiddenStaples.length})`)),
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      !open.length && !cart.length && React.createElement(EmptyState, { text: 'הרשימה ריקה', hint: 'כל מה שמוסיפים כאן מופיע מיד גם אצל שאר בני המשפחה' }),
      byCat.map(([cat, color, list2]) => React.createElement('div', { key: cat },
        React.createElement('p', { className: 'text-xs font-semibold mb-1 flex items-center gap-1.5', style: { color: 'var(--text-muted)' } },
          React.createElement('span', { className: 'w-2 h-2 rounded-full', style: { background: color } }), `${cat} (${list2.length})`),
        list2.map(itemRow))),
      cart.length > 0 && React.createElement('div', { className: 'pt-2', style: { borderTop: '1px dashed var(--line)' } },
        React.createElement('div', { className: 'flex items-center justify-between mb-1' },
          React.createElement('p', { className: 'text-xs font-semibold', style: { color: 'var(--pos)' } }, `בעגלה (${cart.length})`),
          !isChild && !checkout && React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 py-1.5 text-xs', onClick: () => setCheckout(true) }, 'סיום קנייה')),
        checkout && React.createElement('div', { className: 'p-3 rounded-xl space-y-2 mb-2', style: { background: 'var(--navy-panel-2)' } },
          React.createElement('p', { className: 'text-sm' }, 'כמה שילמתם? הסכום יירשם כהוצאה ב"מזון · סופר". אפשר גם לדלג.'),
          React.createElement('div', { className: 'flex gap-2' },
            React.createElement('input', { className: shopInput, type: 'number', inputMode: 'decimal', placeholder: `סכום ${currency}`, value: paid, autoFocus: true, onChange: e => setPaid(e.target.value) }),
            React.createElement('button', { disabled: busy, className: 'ent-pill-btn solid-bronze px-4 text-sm whitespace-nowrap', onClick: finish }, busy ? 'רגע...' : Number(paid) > 0 ? 'רישום וסיום' : 'סיום בלי רישום'),
            React.createElement('button', { className: 'ent-pill-btn ghost px-3 text-sm', onClick: () => setCheckout(false) }, 'ביטול'))),
        cart.map(itemRow))));
}

/* ======================= לשונית "קניות לבית" ======================= */
function HomeShopPage({ shop, isPremium, onUpgrade, currency, onRecordExpense }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', estPrice: '', priority: 2, note: '' });
  const [buyId, setBuyId] = useState(null);
  const [price, setPrice] = useState('');
  const locked = shopLocked(isPremium, onUpgrade);
  if (locked) return locked;
  const wait = shopNotReady(shop);
  if (wait) return wait;
  const list = shop.lists.find(l => l.kind === 'home');
  if (!list) return React.createElement(EmptyState, { text: 'אין רשימה' });
  const items = shop.items.filter(x => x.listId === list.id);
  const open = items.filter(x => x.status === 'open').sort((a, b) => a.priority - b.priority || (b.estPrice || 0) - (a.estPrice || 0));
  const bought = items.filter(x => x.status === 'bought').sort((a, b) => String(b.boughtAt).localeCompare(String(a.boughtAt)));
  const money = v => `${currency}${Math.round(v).toLocaleString('he-IL')}`;
  const total = open.reduce((s, x) => s + (x.estPrice || 0), 0);
  const PR = { 1: ['דחוף', 'var(--neg)'], 2: ['רגיל', 'var(--bronze)'], 3: ['כשיתאפשר', 'var(--text-dim)'] };
  const submit = async () => {
    if (!f.name.trim()) return;
    const ok = await shop.addItem(list.id, { name: f.name, estPrice: f.estPrice, priority: Number(f.priority), note: f.note, category: 'אחר' });
    if (ok) { setF({ name: '', estPrice: '', priority: 2, note: '' }); setAdding(false); }
  };
  const buy = async x => {
    const amount = Number(price) || x.estPrice || 0;
    if (amount > 0 && onRecordExpense) await onRecordExpense({ category: 'קניות', sub: 'בית ותחזוקה', amount, description: x.name });
    await shop.updateItem(x, { status: 'bought', boughtAt: new Date().toISOString(), estPrice: amount || x.estPrice });
    setBuyId(null);
    setPrice('');
  };
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-4' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
        React.createElement('div', null,
          React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'קניות לבית'),
          React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, open.length ? `${open.length} דברים שרוצים לקנות · בערך ${money(total)}` : 'מה הבית צריך? מוצרים גדולים, ריהוט, תיקונים')),
        React.createElement('button', { onClick: () => setAdding(!adding), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' פריט')),
      adding && React.createElement('div', { className: 'grid gap-2 p-3 rounded-xl', style: { background: 'var(--navy-panel-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
        React.createElement('input', { className: shopInput, placeholder: 'מה צריך?', autoFocus: true, value: f.name, onChange: e => setF({ ...f, name: e.target.value }) }),
        React.createElement('input', { className: shopInput, type: 'number', inputMode: 'decimal', placeholder: `מחיר משוער ${currency}`, value: f.estPrice, onChange: e => setF({ ...f, estPrice: e.target.value }) }),
        React.createElement('select', { className: shopInput, 'aria-label': 'עדיפות', value: f.priority, onChange: e => setF({ ...f, priority: e.target.value }) },
          [1, 2, 3].map(p => React.createElement('option', { key: p, value: p }, `עדיפות: ${PR[p][0]}`))),
        React.createElement('input', { className: shopInput, placeholder: 'הערה או קישור (לא חובה)', value: f.note, onChange: e => setF({ ...f, note: e.target.value }) }),
        React.createElement('div', { className: 'flex gap-2', style: { gridColumn: '1 / -1' } },
          React.createElement('button', { className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm', onClick: submit }, 'הוספה'),
          React.createElement('button', { className: 'ent-pill-btn ghost px-5 py-2 text-sm', onClick: () => setAdding(false) }, 'ביטול')))),
    React.createElement('div', { className: 'ent-card p-5' },
      !open.length && React.createElement(EmptyState, { text: 'אין כרגע דברים ברשימה' }),
      open.map(x => React.createElement('div', { key: x.id, className: 'ent-row py-3' },
        React.createElement('div', { className: 'flex items-center gap-3' },
          React.createElement('span', { className: 'pl-badge', style: { color: PR[x.priority][1], background: `color-mix(in srgb, ${PR[x.priority][1]} 14%, transparent)` } }, PR[x.priority][0]),
          React.createElement('div', { className: 'flex-1 min-w-0' },
            React.createElement('p', { className: 'text-sm font-semibold' }, x.name),
            x.note && (/^https?:\/\//.test(x.note) ? React.createElement('a', { href: x.note, target: '_blank', rel: 'noopener noreferrer', className: 'text-xs underline', style: { color: 'var(--cyan)' } }, 'קישור למוצר')
              : React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, x.note))),
          x.estPrice ? React.createElement('span', { className: 'text-sm font-bold' }, money(x.estPrice)) : null,
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => { setBuyId(buyId === x.id ? null : x.id); setPrice(x.estPrice ? String(x.estPrice) : ''); } }, 'נקנה'),
          React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${x.name}`, onClick: () => shop.removeItems([x.id]) }, React.createElement(ITrash, { size: 15 }))),
        buyId === x.id && React.createElement('div', { className: 'flex gap-2 mt-2' },
          React.createElement('input', { className: shopInput, type: 'number', inputMode: 'decimal', placeholder: `כמה עלה? ${currency}`, autoFocus: true, value: price, onChange: e => setPrice(e.target.value) }),
          React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 text-sm whitespace-nowrap', onClick: () => buy(x) }, 'נקנה ונרשם כהוצאה')))),
      bought.length > 0 && React.createElement('div', { className: 'mt-4 pt-3', style: { borderTop: '1px dashed var(--line)' } },
        React.createElement('p', { className: 'text-xs font-semibold mb-1', style: { color: 'var(--pos)' } }, `נקנו (${bought.length})`),
        bought.slice(0, 10).map(x => React.createElement('div', { key: x.id, className: 'flex justify-between text-sm py-1', style: { color: 'var(--text-muted)' } },
          React.createElement('span', null, '✓ ', x.name), React.createElement('span', null, x.estPrice ? money(x.estPrice) : ''))))));
}

/* ======================= לשונית "בזבוזים" ======================= */
function SplurgesPage({ transactions, isPremium, onUpgrade, currency, limit, onSetLimit, onRecordExpense, onDelete }) {
  const [f, setF] = useState({ amount: '', what: '' });
  const [editLimit, setEditLimit] = useState(false);
  const [limitText, setLimitText] = useState(limit ? String(limit) : '');
  const locked = shopLocked(isPremium, onUpgrade);
  if (locked) return locked;
  const money = v => `${currency}${Math.round(v).toLocaleString('he-IL')}`;
  const ym = d => String(d || '').slice(0, 7);
  const now = new Date();
  const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const all = transactions.filter(t => t.tag === 'impulse' && t.type === 'expense');
  const month = all.filter(t => ym(t.date) === thisKey).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const total = month.reduce((s, t) => s + t.amount, 0);
  const prevTotal = all.filter(t => ym(t.date) === prevKey).reduce((s, t) => s + t.amount, 0);
  const pct = limit > 0 ? Math.min(100, total / limit * 100) : 0;
  const over = limit > 0 && total > limit;
  const add = async () => {
    const amount = Number(f.amount);
    if (!(amount > 0)) return;
    const ok = await onRecordExpense({ category: 'קניות', sub: 'שונות', amount, description: f.what.trim() || 'בזבוז', tag: 'impulse' });
    if (ok) setF({ amount: '', what: '' });
  };
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex flex-wrap items-start justify-between gap-2' },
        React.createElement('div', null,
          React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'בזבוזים'),
          React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, 'קניות לא מתוכננות: קפה בדרך, עוד חולצה, משהו שראיתם בקופה')),
        React.createElement('div', { className: 'text-left' },
          React.createElement('p', { className: 'text-2xl font-bold', style: { color: over ? 'var(--neg)' : 'var(--text)' } }, money(total)),
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, limit > 0 ? `מתוך ${money(limit)} החודש` : 'החודש'))),
      limit > 0 && React.createElement('div', { className: 'h-2 rounded-full overflow-hidden', style: { background: 'var(--line)' } },
        React.createElement('div', { className: 'h-full rounded-full', style: { width: `${pct}%`, background: over ? 'var(--neg)' : pct > 80 ? 'var(--bronze)' : 'var(--pos)', transition: 'width .4s' } })),
      React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-2)' } },
        prevTotal > 0 ? (total <= prevTotal ? `בחודש שעבר: ${money(prevTotal)}. בינתיים אתם מתחת.` : `בחודש שעבר: ${money(prevTotal)}. כבר עברתם אותו ב-${money(total - prevTotal)}.`) : 'כל בזבוז נרשם גם כהוצאה רגילה בכלכלה (קניות · שונות).'),
      editLimit ? React.createElement('div', { className: 'flex gap-2' },
        React.createElement('input', { className: shopInput, type: 'number', inputMode: 'decimal', placeholder: `תקרה חודשית ${currency}`, autoFocus: true, value: limitText, onChange: e => setLimitText(e.target.value) }),
        React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 text-sm', onClick: () => { onSetLimit(Number(limitText) || null); setEditLimit(false); } }, 'שמירה'))
        : React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => setEditLimit(true) }, limit > 0 ? 'שינוי התקרה' : 'קביעת תקרה חודשית לבזבוזים')),
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('p', { className: 'text-sm font-semibold' }, 'בזבוז חדש'),
      React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: '1fr 2fr auto' } },
        React.createElement('input', { className: shopInput, type: 'number', inputMode: 'decimal', placeholder: currency, 'aria-label': 'סכום', value: f.amount, onChange: e => setF({ ...f, amount: e.target.value }) }),
        React.createElement('input', { className: shopInput, placeholder: 'על מה?', 'aria-label': 'על מה', value: f.what, onChange: e => setF({ ...f, what: e.target.value }), onKeyDown: e => { if (e.key === 'Enter') add(); } }),
        React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 text-sm', onClick: add }, 'הוספה')),
      !month.length ? React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-dim)' } }, 'אין בזבוזים החודש') : month.map(t => React.createElement('div', { key: t.id, className: 'ent-row py-2 flex items-center justify-between text-sm' },
        React.createElement('div', null, React.createElement('p', { className: 'font-semibold' }, t.description || 'בזבוז'), React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, fmtDateHe(t.date))),
        React.createElement('div', { className: 'flex items-center gap-2' }, React.createElement('b', { style: { color: 'var(--neg)' } }, money(t.amount)),
          React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${t.description || 'בזבוז'}`, onClick: () => onDelete(t.id) }, React.createElement(ITrash, { size: 15 })))))));
}
