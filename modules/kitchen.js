/* Homey — "קניות ומטבח": בנק מתכונים, תפריט שבועי שמייצר רשימת קניות, ו"נגמר לכם?" לפי היסטוריית הקניות.
 * משתמש ב-useShopping של modules/shopping.js (הוספת פריטים לרשימה) ובפונקציות התאריך של modules/tasks.js.
 * טבלאות: recipes, meal_plan, shopping_purchases (supabase/kitchen.sql). */

// מתכונים להתחלה: ארוחות משפחתיות נפוצות, עם מצרכים לפי מחלקות בסופר
const KITCHEN_STARTERS = [
  ['🍳', 'שקשוקה', 25, [['ביצים', '8'], ['עגבניות', '6'], ['בצל', '1'], ['פלפל אדום', '1'], ['שום', '1 ראש'], ['פיתות', '8']]],
  ['🍝', 'פסטה ברוטב עגבניות', 20, [['פסטה', '2 חבילות'], ['רסק עגבניות', '1'], ['בצל', '1'], ['שום', '1 ראש'], ['גבינה צהובה מגורדת', '1']]],
  ['🍗', 'עוף בתנור עם אורז', 75, [['כרעיים עוף', '1.5 ק"ג'], ['אורז', '1 ק"ג'], ['בצל', '2'], ['תפוחי אדמה', '1 ק"ג']]],
  ['🥩', 'שניצל ופירה', 45, [['חזה עוף', '1 ק"ג'], ['פירורי לחם', '1'], ['ביצים', '3'], ['תפוחי אדמה', '1.5 ק"ג'], ['מלפפונים', '4']]],
  ['🍲', 'מרק עדשים', 50, [['עדשים כתומות', '500 גרם'], ['גזר', '3'], ['בצל', '2'], ['סלרי', '1'], ['לחם', '1']]],
  ['🧆', 'קציצות ברוטב', 60, [['בשר טחון', '1 ק"ג'], ['רסק עגבניות', '1'], ['בצל', '2'], ['פטרוזיליה', '1'], ['אורז', '1 ק"ג']]],
  ['🍕', 'פיצה ביתית', 40, [['קמח', '1 ק"ג'], ['שמרים', '1'], ['רוטב עגבניות', '1'], ['מוצרלה', '2'], ['זיתים', '1']]],
  ['🥗', 'סלט טונה ותפוחי אדמה', 25, [['טונה', '4'], ['תפוחי אדמה', '1 ק"ג'], ['ביצים', '4'], ['מלפפונים חמוצים', '1'], ['מיונז', '1']]],
  ['🌮', 'טורטיות במילוי', 30, [['טורטיות', '2 חבילות'], ['חזה עוף', '700 גרם'], ['פלפלים', '3'], ['חסה', '1'], ['שמנת חמוצה', '1']]],
  ['🥞', 'פנקייק לארוחת ערב', 25, [['קמח', '1 ק"ג'], ['חלב', '1'], ['ביצים', '4'], ['דבש', '1'], ['תותים', '1']]]
];
const MEAL_SLOTS = [['lunch', 'צהריים'], ['dinner', 'ערב']];
const kNorm = s => String(s || '').trim().replace(/\s+/g, ' ');
const recipeFromRow = r => ({ id: r.id, title: r.title, icon: r.icon, ingredients: r.ingredients || [], prepMinutes: r.prep_minutes, notes: r.notes || '', favorite: !!r.favorite });

function kitchenDemo() {
  const recipes = KITCHEN_STARTERS.map(([icon, title, prep, ing], i) => ({ id: 'dk' + i, icon, title, prepMinutes: prep, notes: '', favorite: i < 3,
    ingredients: ing.map(([name, qty]) => ({ name, qty, category: shopGuessCategory(name) })) }));
  const t = plToday(), ws = plWeekStart(t);
  const plan = [[0, 'dinner', 0], [1, 'dinner', 2], [2, 'dinner', 4], [3, 'dinner', 1], [4, 'dinner', 6], [5, 'lunch', 3]]
    .map(([d, slot, ri]) => ({ id: `dm${d}${slot}`, date: plAddDays(ws, d), slot, recipeId: recipes[ri].id, title: recipes[ri].title }));
  // היסטוריה: חלב כל ~5 ימים, לחם כל ~4, ביצים כל ~8, נייר טואלט כל ~20
  const purchases = [];
  const hist = [['חלב', 5, 'מוצרי חלב וביצים'], ['לחם אחיד', 4, 'לחם ומאפים'], ['ביצים', 8, 'מוצרי חלב וביצים'], ['נייר טואלט', 20, 'ניקיון'], ['קוטג\'', 7, 'מוצרי חלב וביצים'], ['בננות', 6, 'ירקות ופירות']];
  hist.forEach(([name, every, category], hi) => { for (let k = 1; k <= 5; k++) purchases.push({ name, category, boughtAt: new Date(Date.now() - (k * every + hi % 3) * 86400000).toISOString() }); });
  return { recipes, plan, purchases };
}

/* ---- נתוני המטבח ---- */
function useKitchen({ familyId, isDemo, enabled, showToast }) {
  const [state, setState] = useState({ ready: false, unavailable: false, recipes: [], plan: [], purchases: [] });
  useEffect(() => {
    if (!enabled || !familyId) return;
    if (isDemo) { setState({ ready: true, unavailable: false, ...kitchenDemo() }); return; }
    let alive = true;
    (async () => {
      const t = plToday();
      const [r, p, h] = await Promise.all([
        sb.from('recipes').select('*').eq('family_id', familyId).order('created_at'),
        sb.from('meal_plan').select('*').eq('family_id', familyId).gte('date', plAddDays(plWeekStart(t), -7)).lte('date', plAddDays(t, 28)),
        sb.from('shopping_purchases').select('name, category, bought_at').eq('family_id', familyId).gte('bought_at', new Date(Date.now() - 150 * 86400000).toISOString())
      ]);
      if (!alive) return;
      if (r.error || p.error || h.error) return setState(s => ({ ...s, ready: true, unavailable: true }));
      setState({ ready: true, unavailable: false, recipes: (r.data || []).map(recipeFromRow),
        plan: (p.data || []).map(x => ({ id: x.id, date: String(x.date).slice(0, 10), slot: x.slot, recipeId: x.recipe_id, title: x.title })),
        purchases: (h.data || []).map(x => ({ name: x.name, category: x.category, boughtAt: x.bought_at })) });
    })();
    return () => { alive = false; };
  }, [enabled, familyId, isDemo]);
  const patch = fn => setState(s => ({ ...s, ...fn(s) }));
  const tmp = () => 'local-' + Date.now() + Math.random().toString(36).slice(2, 6);
  const saveRecipe = async (rec, existing) => {
    if (!kNorm(rec.title)) { showToast('נא לכתוב שם למתכון'); return null; }
    const row = { title: kNorm(rec.title), icon: rec.icon || '🍽️', ingredients: (rec.ingredients || []).filter(i => kNorm(i.name)).map(i => ({ name: kNorm(i.name), qty: kNorm(i.qty), category: i.category || shopGuessCategory(i.name) })),
      prepMinutes: Number(rec.prepMinutes) || null, notes: rec.notes || '', favorite: !!rec.favorite };
    const db = { title: row.title, icon: row.icon, ingredients: row.ingredients, prep_minutes: row.prepMinutes, notes: row.notes || null, favorite: row.favorite };
    if (existing) {
      patch(s => ({ recipes: s.recipes.map(x => x.id === existing.id ? { ...x, ...row } : x) }));
      if (!isDemo) await sb.from('recipes').update(db).eq('id', existing.id);
      return true;
    }
    let id = tmp();
    if (!isDemo) {
      const { data, error } = await sb.from('recipes').insert({ family_id: familyId, ...db }).select().single();
      if (error) { showToast(/premium_required/.test(error.message) ? 'המטבח הוא תכונת פרימיום' : 'שגיאה בשמירה'); return null; }
      id = data.id;
    }
    patch(s => ({ recipes: [...s.recipes, { ...row, id }] }));
    return true;
  };
  const seedStarters = async () => {
    const rows = KITCHEN_STARTERS.map(([icon, title, prep, ing]) => ({ title, icon, prepMinutes: prep, notes: '', favorite: false, ingredients: ing.map(([name, qty]) => ({ name, qty, category: shopGuessCategory(name) })) }));
    if (isDemo) { patch(s => ({ recipes: [...s.recipes, ...rows.map(r => ({ ...r, id: tmp() }))] })); return; }
    const { data, error } = await sb.from('recipes').insert(rows.map(r => ({ family_id: familyId, title: r.title, icon: r.icon, ingredients: r.ingredients, prep_minutes: r.prepMinutes }))).select();
    if (error) return showToast('שגיאה בשמירה');
    patch(s => ({ recipes: [...s.recipes, ...(data || []).map(recipeFromRow)] }));
    showToast(`${rows.length} מתכונים נוספו`);
  };
  const deleteRecipe = async rec => {
    patch(s => ({ recipes: s.recipes.filter(x => x.id !== rec.id), plan: s.plan.map(p => p.recipeId === rec.id ? { ...p, recipeId: null } : p) }));
    if (!isDemo) await sb.from('recipes').delete().eq('id', rec.id);
  };
  const setMeal = async (date, slot, { recipeId, title }) => {
    const t = kNorm(title);
    if (!t) return;
    const prev = state.plan.find(p => p.date === date && p.slot === slot);
    let id = prev ? prev.id : tmp();
    if (!isDemo) {
      const { data, error } = await sb.from('meal_plan').upsert({ family_id: familyId, date, slot, recipe_id: recipeId || null, title: t }, { onConflict: 'family_id,date,slot' }).select().single();
      if (error) return showToast('שגיאה בשמירה');
      id = data.id;
    }
    patch(s => ({ plan: [...s.plan.filter(p => !(p.date === date && p.slot === slot)), { id, date, slot, recipeId: recipeId || null, title: t }] }));
  };
  const clearMeal = async m => {
    patch(s => ({ plan: s.plan.filter(p => p.id !== m.id) }));
    if (!isDemo) await sb.from('meal_plan').delete().eq('id', m.id);
  };
  // נקרא מ"סיום קנייה" ברשימת הקניות
  const logPurchases = async items => {
    const rows = items.map(i => ({ name: kNorm(i.name), category: i.category || null, boughtAt: new Date().toISOString() })).filter(i => i.name);
    if (!rows.length) return;
    patch(s => ({ purchases: [...rows, ...s.purchases] }));
    if (!isDemo) await sb.from('shopping_purchases').insert(rows.map(r => ({ family_id: familyId, name: r.name, category: r.category })));
  };
  return { ...state, saveRecipe, seedStarters, deleteRecipe, setMeal, clearMeal, logPurchases };
}

// "נגמר לכם?": פריטים שקונים בקביעות (3 פעמים ומעלה), שעבר מהקנייה האחרונה כמעט הזמן הרגיל בין קניות, ושלא ברשימה עכשיו
function kitchenSuggestions(purchases, openNames) {
  const open = new Set(openNames.map(kNorm));
  const byName = {};
  purchases.forEach(p => { const n = kNorm(p.name); (byName[n] = byName[n] || { name: n, category: p.category, days: new Set() }).days.add(plIso(new Date(p.boughtAt))); });
  const today = plToday();
  const out = [];
  Object.values(byName).forEach(x => {
    if (open.has(x.name)) return;
    const days = [...x.days].sort();
    if (days.length < 3) return;
    const gaps = days.slice(1).map((d, i) => Math.round((plParse(d) - plParse(days[i])) / 86400000)).filter(g => g > 0).sort((a, b) => a - b);
    if (!gaps.length) return;
    const every = gaps[Math.floor(gaps.length / 2)];
    const since = Math.round((plParse(today) - plParse(days[days.length - 1])) / 86400000);
    if (every >= 1 && since >= every * 0.85) out.push({ name: x.name, category: x.category, every, since, ratio: since / every });
  });
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 6);
}

const kitchenGate = (k, isPremium, onUpgrade) => !isPremium ? React.createElement(PremiumLock, { title: 'המטבח הוא תכונת פרימיום', desc: 'תפריט שבועי, בנק מתכונים ורשימת קניות שנבנית מהתפריט בלחיצה.', onUpgrade })
  : !k.ready ? React.createElement('div', { className: 'ent-card p-6' }, 'טוען...')
  : k.unavailable ? React.createElement('div', { className: 'ent-card p-6 text-sm', style: { color: 'var(--text-muted)' } }, 'המטבח עוד לא הופעל בשרת. יש להריץ את kitchen.sql ב-Supabase.') : null;

/* ======================= לשונית "תפריט שבועי" ======================= */
function MealsPage({ k, shop, isPremium, onUpgrade, showToast }) {
  const [offset, setOffset] = useState(0);
  const [picking, setPicking] = useState(null); // {date, slot}
  const [free, setFree] = useState('');
  const [busy, setBusy] = useState(false);
  const gate = kitchenGate(k, isPremium, onUpgrade);
  if (gate) return gate;
  const today = plToday();
  const ws = plAddDays(plWeekStart(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => plAddDays(ws, i));
  const mealOf = (d, slot) => k.plan.find(p => p.date === d && p.slot === slot);
  const sortedRecipes = [...k.recipes].sort((a, b) => (b.favorite - a.favorite) || a.title.localeCompare(b.title, 'he'));
  const recent = new Set(k.plan.filter(p => p.date >= plAddDays(today, -7) && p.date <= plAddDays(today, 7)).map(p => p.recipeId));
  // מצרכים לשבוע: מהיום (או מתחילת שבוע עתידי) ועד סוף השבוע המוצג, בלי מה שכבר ברשימה
  const groceryIds = shop.ready && !shop.unavailable ? shop.lists.filter(l => l.kind === 'grocery').map(l => l.id) : [];
  const openNames = new Set(shop.ready ? shop.items.filter(i => groceryIds.includes(i.listId) && i.status === 'open').map(i => kNorm(i.name)) : []);
  const neededMap = {};
  days.filter(d => d >= today).forEach(d => MEAL_SLOTS.forEach(([slot]) => {
    const m = mealOf(d, slot);
    const r = m && m.recipeId ? k.recipes.find(x => x.id === m.recipeId) : null;
    (r ? r.ingredients : []).forEach(i => { const n = kNorm(i.name); if (!openNames.has(n) && !neededMap[n]) neededMap[n] = i; });
  }));
  const needed = Object.values(neededMap);
  const addAll = async () => {
    if (!groceryIds.length) return showToast('רשימת הקניות עוד לא מוכנה');
    setBusy(true);
    for (const i of needed) await shop.addItem(groceryIds[0], { name: i.name, qty: i.qty, category: i.category });
    setBusy(false);
    celebrate();
    showToast(`${needed.length} מצרכים נוספו לרשימת הקניות`);
  };
  const pick = async (recipe) => {
    await k.setMeal(picking.date, picking.slot, recipe ? { recipeId: recipe.id, title: recipe.title } : { title: free });
    setPicking(null); setFree('');
  };
  const surprise = () => {
    const pool = k.recipes.filter(r => !recent.has(r.id));
    const list = pool.length ? pool : k.recipes;
    if (list.length) pick(list[Math.floor(Math.random() * list.length)]);
  };
  const label = offset === 0 ? 'השבוע' : offset === 1 ? 'שבוע הבא' : offset === -1 ? 'שבוע שעבר' : plParse(ws).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
        React.createElement('div', null,
          React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'תפריט שבועי'),
          React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-muted)' } }, 'מתכננים מה אוכלים, והמצרכים נכנסים לרשימת הקניות בלחיצה')),
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', 'aria-label': 'שבוע קודם', onClick: () => setOffset(offset - 1) }, '→'),
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: () => setOffset(0) }, label),
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', 'aria-label': 'שבוע הבא', onClick: () => setOffset(offset + 1) }, '←'))),
      needed.length > 0 && React.createElement('div', { className: 'meals-needed' },
        React.createElement('div', { className: 'flex-1 min-w-0' },
          React.createElement('p', { className: 'text-sm font-semibold' }, `🛒 חסרים ${needed.length} מצרכים לתפריט`),
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, needed.slice(0, 6).map(i => i.name).join(', ') + (needed.length > 6 ? '...' : ''))),
        React.createElement('button', { disabled: busy, className: 'ent-pill-btn solid-bronze px-4 py-2 text-sm whitespace-nowrap', onClick: addAll }, busy ? 'מוסיף...' : 'הוספה לרשימה')),
      !k.recipes.length && React.createElement('div', { className: 'p-3 rounded-xl text-sm flex flex-wrap items-center justify-between gap-2', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('span', null, 'עוד אין מתכונים. אפשר להתחיל מ-10 ארוחות משפחתיות מוכנות.'),
        React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 py-1.5 text-xs', onClick: k.seedStarters }, 'להוסיף מתכונים מוכנים'))),
    React.createElement('div', { className: 'meals-week' }, days.map(d => React.createElement('div', { key: d, className: 'ent-card meals-day' + (d === today ? ' today' : '') },
      React.createElement('div', { className: 'flex items-baseline justify-between mb-2' },
        React.createElement('p', { className: 'text-sm font-bold' }, PL_DAYS[plParse(d).getDay()]),
        React.createElement('p', { className: 'text-xs', style: { color: d === today ? 'var(--bronze)' : 'var(--text-dim)' } }, d === today ? 'היום' : plParse(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }))),
      MEAL_SLOTS.map(([slot, slotLabel]) => {
        const m = mealOf(d, slot);
        const r = m && m.recipeId ? k.recipes.find(x => x.id === m.recipeId) : null;
        return React.createElement('div', { key: slot, className: 'meal-slot' },
          React.createElement('p', { className: 'meal-slot-label' }, slotLabel),
          m ? React.createElement('div', { className: 'meal-chip' },
            React.createElement('span', { 'aria-hidden': 'true' }, r ? r.icon : '🍽️'),
            React.createElement('span', { className: 'flex-1 min-w-0 text-sm font-semibold' }, m.title),
            React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `הסרה: ${m.title}`, onClick: () => k.clearMeal(m) }, React.createElement(IX, { size: 12 })))
            : React.createElement('button', { className: 'meal-add', 'aria-label': `תכנון ${slotLabel} ביום ${PL_DAYS[plParse(d).getDay()]}`, onClick: () => { setPicking({ date: d, slot }); setFree(''); } }, '+'));
      })))),
    picking && React.createElement('div', { className: 'fixed inset-0 z-50 flex items-end sm:items-center justify-center', style: { background: 'rgba(0,0,0,.5)' }, onClick: () => setPicking(null) },
      React.createElement('div', { className: 'ent-card p-5 w-full max-w-md space-y-3', style: { maxHeight: '80vh', overflowY: 'auto' }, onClick: e => e.stopPropagation(), role: 'dialog', 'aria-modal': 'true', 'aria-label': 'בחירת ארוחה' },
        React.createElement('div', { className: 'flex items-center justify-between' },
          React.createElement('h3', { className: 'ent-heading font-bold' }, `${(MEAL_SLOTS.find(s => s[0] === picking.slot) || [])[1]}, יום ${PL_DAYS[plParse(picking.date).getDay()]}`),
          React.createElement('button', { className: 'ent-icon-btn', 'aria-label': 'סגירה', onClick: () => setPicking(null) }, React.createElement(IX, { size: 16 }))),
        k.recipes.length > 0 && React.createElement('button', { className: 'ent-pill-btn ghost w-full py-2 text-sm', onClick: surprise }, '🎲 תפתיעו אותי'),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('input', { className: 'ent-input flex-1 px-3 py-2.5 rounded-xl text-sm outline-none', placeholder: 'או לכתוב משהו (למשל "שאריות" או "יוצאים לאכול")', value: free, onChange: e => setFree(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && free.trim()) pick(null); } }),
          React.createElement('button', { className: 'ent-pill-btn solid-bronze px-4 text-sm', disabled: !free.trim(), onClick: () => pick(null) }, 'שמירה')),
        React.createElement('div', { className: 'space-y-1' }, sortedRecipes.map(r => React.createElement('button', { key: r.id, className: 'meal-pick', onClick: () => pick(r) },
          React.createElement('span', { className: 'text-xl', 'aria-hidden': 'true' }, r.icon),
          React.createElement('span', { className: 'flex-1 text-right text-sm font-semibold' }, r.title, r.favorite ? ' ★' : ''),
          React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, [r.prepMinutes ? `${r.prepMinutes} דק'` : null, recent.has(r.id) ? 'השבוע' : null].filter(Boolean).join(' · '))))))));
}

/* ======================= לשונית "מתכונים" ======================= */
const RECIPE_ICONS = ['🍽️', '🍳', '🍝', '🍗', '🥩', '🍲', '🧆', '🍕', '🥗', '🌮', '🥞', '🐟', '🍛', '🥘', '🍜', '🥪', '🍰'];
function RecipesPage({ k, isPremium, onUpgrade }) {
  const empty = () => ({ title: '', icon: '🍽️', prepMinutes: '', notes: '', ingredients: [{ name: '', qty: '' }] });
  const [editing, setEditing] = useState(null); // null | 'new' | recipe
  const [f, setF] = useState(empty);
  const [openId, setOpenId] = useState(null);
  const [q, setQ] = useState('');
  const gate = kitchenGate(k, isPremium, onUpgrade);
  if (gate) return gate;
  const inp = 'ent-input w-full px-3 py-2.5 rounded-xl text-sm outline-none';
  const start = r => { setEditing(r || 'new'); setF(r ? { title: r.title, icon: r.icon, prepMinutes: r.prepMinutes || '', notes: r.notes, ingredients: [...r.ingredients, { name: '', qty: '' }] } : empty()); };
  const setIng = (i, key, v) => setF(p => {
    const ingredients = p.ingredients.map((x, j) => j === i ? { ...x, [key]: v } : x);
    if (i === ingredients.length - 1 && key === 'name' && v.trim()) ingredients.push({ name: '', qty: '' });
    return { ...p, ingredients };
  });
  const save = async () => { const ok = await k.saveRecipe(f, editing === 'new' ? null : editing); if (ok) setEditing(null); };
  const list = k.recipes.filter(r => !q.trim() || r.title.includes(q.trim()) || r.ingredients.some(i => i.name.includes(q.trim()))).sort((a, b) => (b.favorite - a.favorite) || a.title.localeCompare(b.title, 'he'));
  return React.createElement('div', { className: 'space-y-6' },
    React.createElement('div', { className: 'ent-card p-5 space-y-3' },
      React.createElement('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
        React.createElement('h2', { className: 'ent-heading text-xl font-bold' }, 'מתכונים'),
        React.createElement('div', { className: 'flex gap-2' },
          !k.recipes.length && React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1.5 text-xs', onClick: k.seedStarters }, '✨ 10 מתכונים מוכנים'),
          React.createElement('button', { onClick: () => start(null), className: 'ent-pill-btn solid-bronze flex items-center gap-1.5 px-4 py-2 text-sm' }, React.createElement(IPlus, { size: 16 }), ' מתכון'))),
      k.recipes.length > 4 && React.createElement('input', { className: inp, placeholder: 'חיפוש לפי שם או מצרך', value: q, onChange: e => setQ(e.target.value) }),
      editing && React.createElement('div', { className: 'p-4 rounded-xl space-y-3', style: { background: 'var(--navy-panel-2)' } },
        React.createElement('div', { className: 'flex flex-wrap gap-1' }, RECIPE_ICONS.map(ic => React.createElement('button', { key: ic, type: 'button', 'aria-pressed': f.icon === ic, 'aria-label': `אייקון ${ic}`, className: 'chore-icon-pick' + (f.icon === ic ? ' on' : ''), onClick: () => setF({ ...f, icon: ic }) }, ic))),
        React.createElement('div', { className: 'grid gap-2', style: { gridTemplateColumns: '2fr 1fr' } },
          React.createElement('input', { className: inp, placeholder: 'שם המתכון', autoFocus: true, value: f.title, onChange: e => setF({ ...f, title: e.target.value }) }),
          React.createElement('input', { className: inp, type: 'number', min: 1, placeholder: 'דקות הכנה', value: f.prepMinutes, onChange: e => setF({ ...f, prepMinutes: e.target.value }) })),
        React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, 'מצרכים (כל שורה מצרך; המחלקה בסופר נקבעת לבד)'),
        f.ingredients.map((i, idx) => React.createElement('div', { key: idx, className: 'grid gap-2', style: { gridTemplateColumns: '2fr 1fr' } },
          React.createElement('input', { className: inp, placeholder: idx === 0 ? 'למשל: עגבניות' : 'מצרך', value: i.name, onChange: e => setIng(idx, 'name', e.target.value), 'aria-label': `מצרך ${idx + 1}` }),
          React.createElement('input', { className: inp, placeholder: 'כמות', value: i.qty, onChange: e => setIng(idx, 'qty', e.target.value), 'aria-label': `כמות למצרך ${idx + 1}` }))),
        React.createElement('textarea', { className: inp, rows: 3, placeholder: 'אופן הכנה או הערות (לא חובה)', value: f.notes, onChange: e => setF({ ...f, notes: e.target.value }) }),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { onClick: save, className: 'ent-pill-btn solid-bronze px-5 py-2 text-sm' }, 'שמירה'),
          React.createElement('button', { onClick: () => setEditing(null), className: 'ent-pill-btn ghost px-5 py-2 text-sm' }, 'ביטול')))),
    !list.length ? React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: q ? 'לא נמצא מתכון' : 'עוד אין מתכונים', hint: q ? null : 'מתכון עם מצרכים = רשימת קניות אוטומטית מהתפריט' })) :
    React.createElement('div', { className: 'recipes-grid' }, list.map(r => React.createElement('div', { key: r.id, className: 'ent-card recipe-card p-4' },
      React.createElement('div', { className: 'flex items-start gap-3' },
        React.createElement('span', { className: 'recipe-icon', 'aria-hidden': 'true' }, r.icon),
        React.createElement('button', { type: 'button', className: 'flex-1 min-w-0 text-right', 'aria-expanded': openId === r.id, onClick: () => setOpenId(openId === r.id ? null : r.id) },
          React.createElement('p', { className: 'font-bold' }, r.title),
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, [`${r.ingredients.length} מצרכים`, r.prepMinutes ? `${r.prepMinutes} דקות` : null].filter(Boolean).join(' · '))),
        React.createElement('button', { className: 'shop-staple' + (r.favorite ? ' on' : ''), 'aria-pressed': r.favorite, 'aria-label': r.favorite ? `הסרה מהמועדפים: ${r.title}` : `למועדפים: ${r.title}`, onClick: () => k.saveRecipe({ ...r, favorite: !r.favorite }, r) }, '★')),
      openId === r.id && React.createElement('div', { className: 'mt-3 space-y-2' },
        React.createElement('div', { className: 'flex flex-wrap gap-1.5' }, r.ingredients.map((i, idx) => React.createElement('span', { key: idx, className: 'chore-chip', style: { borderColor: shopColor(i.category), color: 'var(--text-2)' } }, i.name, i.qty ? ` · ${i.qty}` : ''))),
        r.notes && React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-2)', whiteSpace: 'pre-wrap' } }, r.notes),
        React.createElement('div', { className: 'flex gap-2' },
          React.createElement('button', { className: 'ent-pill-btn ghost px-3 py-1 text-xs', onClick: () => start(r) }, 'עריכה'),
          React.createElement('button', { className: 'ent-icon-btn', 'aria-label': `מחיקת ${r.title}`, onClick: () => k.deleteRecipe(r) }, React.createElement(ITrash, { size: 14 }))))))));
}
