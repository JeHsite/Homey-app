/* Homey — כלכלה: מסך "החודש" ומסך "עוד".
 * לפי הדוח "סידור הכלכלה Homey": משפט אחד ומספר אחד עונים על "איך החודש", ורק אחר כך פירוט.
 * החישוב נשען על forecast שכבר קיים בסקריפט הראשי (הכנסה צפויה, קבועים, שוטף), ומוסיף: תקציב לשוטף,
 * יחס קצב מול "איפה הייתם אמורים להיות היום", תחזית לסוף החודש, והשוואה לאותו יום בחודש שעבר.
 * משתמש בגלובליים של הסקריפט הראשי (React, Money, EmptyState, אייקונים, monthKey) רק בזמן רינדור. */

// כל הספים במקום אחד, כדי לכוונן אחרי שימוש אמיתי (לא מצאנו להם מחקר; ראו הדוח)
const FIN = { earlyDays: 6, amberBand: 1.10, roundForecast: 100, topCats: 6, upcomingDays: 7 };

// כמו monthKey של הסקריפט הראשי (שם הוא פנימי ל-App): "YYYY-MM" או null
const finMonthKey = d => { if (!d) return null; const dt = new Date(d); return isNaN(dt) ? null : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; };
const finRound = (v, step) => Math.round(v / step) * step;
const finMoney = (v, cur) => `${v < 0 ? '-' : ''}${cur}${Math.round(Math.abs(v)).toLocaleString('he-IL')}`;
const finPrevMonthKey = (y, m) => (m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`);

/* ---- המודל: כל המספרים והמשפטים של המסך, מחושבים פעם אחת ---- */
function finMonthModel({ forecast: f, transactions, bills, categoryBudgets, savingsSetAside, currency: cur }) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const thisKey = `${y}-${String(m + 1).padStart(2, '0')}`;
  const prevKey = finPrevMonthKey(y, m);
  const S = Math.max(0, Number(savingsSetAside) || 0);
  const I = f.expectedIncome;
  const F = f.fixedTotal;
  const V = f.spentSoFar + f.openTripSpend; // שוטף בלבד: בלי הוראות קבע מקושרות
  const B = I - F - S; // תקציב לשוטף החודש
  const L = B - V; // נשאר להוציא
  const D = f.daysLeft + 1; // כולל היום
  const perDay = D > 0 ? L / D : L;
  const dow = now.getDay();
  const weekDaysLeft = Math.min(7 - dow, D); // היום עד שבת, בתוך החודש
  const perWeek = perDay * weekDaysLeft;
  const t = f.today / f.daysInMonth;
  const r = B > 0 ? (V / B) / t : null;
  const projEnd = finRound(B - V * f.daysInMonth / f.today, FIN.roundForecast);
  // אותו יום בחודש שעבר: הוצאה שוטפת בימים 1..היום
  const varExp = tx => tx.type === 'expense' && !tx.billId;
  const prevSameDay = transactions.filter(tx => varExp(tx) && finMonthKey(tx.date) === prevKey && Number(String(tx.date).slice(8, 10)) <= f.today).reduce((s, tx) => s + tx.amount, 0);
  const hasPrev = transactions.some(tx => finMonthKey(tx.date) === prevKey);
  const diffPrev = V - prevSameDay;

  // מצב
  let state;
  if (I <= 0) state = 'noIncome';
  else if (B <= 0) state = 'negBudget';
  else if (f.today <= FIN.earlyDays) state = 'early';
  else if (L < 0 || r > FIN.amberBand) state = 'red';
  else if (r > 1) state = 'amber';
  else state = 'green';

  // קטגוריות החודש (שוטף בלבד), עם תקציב אם הוגדר
  const byCat = {}, prevByCat = {};
  transactions.forEach(tx => {
    if (!varExp(tx)) return;
    const k = finMonthKey(tx.date);
    if (k === thisKey) byCat[tx.category] = (byCat[tx.category] || 0) + tx.amount;
    else if (k === prevKey && Number(String(tx.date).slice(8, 10)) <= f.today) prevByCat[tx.category] = (prevByCat[tx.category] || 0) + tx.amount;
  });
  let cats = Object.entries(byCat).map(([name, spent]) => ({ name, spent, budget: categoryBudgets[name] || 0, prev: prevByCat[name] || 0 })).sort((a, b) => b.spent - a.spent);
  if (cats.length > FIN.topCats + 1) {
    const rest = cats.slice(FIN.topCats);
    cats = [...cats.slice(0, FIN.topCats), { name: 'אחר', spent: rest.reduce((s, c) => s + c.spent, 0), budget: 0, prev: rest.reduce((s, c) => s + c.prev, 0), merged: true }];
  }
  const maxSpent = cats.reduce((mx, c) => Math.max(mx, c.spent, c.budget), 0) || 1;
  cats.forEach(c => {
    c.state = !c.budget ? null : c.spent > c.budget ? 'red' : f.today > FIN.earlyDays && c.spent / t > c.budget ? 'amber' : 'green';
  });
  const grew = cats.filter(c => !c.merged && c.spent - c.prev > 50).sort((a, b) => (b.spent - b.prev) - (a.spent - a.prev));

  // משפטים (לשון רבים: שני ההורים קוראים אותו מסך)
  const pctB = B > 0 ? Math.round(V / B * 100) : 0, pctT = Math.round(t * 100);
  const daysWord = D === 1 ? 'יום אחד' : `${D} ימים`;
  const sentences = {
    // המספר הגדול וה"ליום" מופיעים מיד מתחת, אז המשפט לא חוזר עליהם
    early: ['מוקדם להעריך את החודש. הקבועים כבר בחשבון.', ''],
    green: [`החודש בסדר. אתם בתוך הקצב, ונשארו ${daysWord}.`, projEnd >= 0 ? `בקצב הזה תסיימו בערך ב-${finMoney(projEnd, cur)} פלוס.` : ''],
    amber: [`קצת מעל הקצב. הוצאתם ${pctB}% מהשוטף, ועברו ${pctT}% מהחודש.`, L > 0 ? `כדי לסיים בפלוס: עד ${finMoney(perDay, cur)} ליום.` : ''],
    red: [projEnd < 0 ? `בקצב הזה החודש ייגמר במינוס של כ-${finMoney(-projEnd, cur)}.` : `החודש בחריגה: נשארו ${finMoney(L, cur)}.`,
      `${L >= 0 ? `נשארו ${finMoney(L, cur)} ל-${daysWord}.` : `חרגתם ב-${finMoney(-L, cur)}.`}${grew.length ? ` הכי גדלו: ${grew.slice(0, 2).map(c => c.name).join(', ')}.` : ''}`],
    negBudget: ['הקבועים לבד גדולים מההכנסה הצפויה החודש.', `קבועים ${finMoney(F + S, cur)}, הכנסה צפויה ${finMoney(I, cur)}.`],
    noIncome: ['עוד לא ידוע כמה נשאר: חסרה הכנסה חודשית.', `הוצאתם ${finMoney(V, cur)}${hasPrev ? `, ${finMoney(Math.abs(diffPrev), cur)} ${diffPrev <= 0 ? 'פחות' : 'יותר'} מאותו יום בחודש שעבר` : ''}.`]
  }[state];
  const chip = { early: ['•', 'תחילת חודש'], green: ['✓', 'בקצב'], amber: ['!', 'מעל הקצב'], red: ['!', 'בחריגה'], negBudget: ['!', 'בחריגה'], noIncome: ['?', 'חסרה הכנסה'] }[state];

  // בקרוב: הוראות קבע שלא שולמו ב-7 הימים הקרובים, ומה שעבר מועדו
  const lastDay = f.daysInMonth;
  const upcoming = bills.filter(b => !b.isPaid).map(b => ({ ...b, day: Math.min(b.dueDay || 1, lastDay) }))
    .filter(b => b.day <= f.today + FIN.upcomingDays).sort((a, b) => a.day - b.day);

  // גרף הקצב: מצטבר יומי של השוטף (כולל טיול פתוח כנקודת התחלה אחידה לא נדרשת: מוסיפים אותו לסוף)
  const daily = Array(f.daysInMonth + 1).fill(0);
  transactions.forEach(tx => { if (varExp(tx) && finMonthKey(tx.date) === thisKey) { const d = Number(String(tx.date).slice(8, 10)); if (d >= 1 && d <= f.daysInMonth) daily[d] += tx.amount; } });
  const cum = [0];
  for (let d = 1; d <= f.today; d++) cum[d] = cum[d - 1] + daily[d];
  if (f.openTripSpend) cum[f.today] += f.openTripSpend;

  return { I, F, S, V, B, L, perDay, perWeek, t, r, projEnd, prevSameDay, hasPrev, diffPrev, state, chip, sentences, cats, maxSpent, upcoming, cum,
    fixedPaid: Math.max(0, F - f.fixedUnpaid), incomeIsEstimate: f.incomeIsEstimate, incomeMissing: Math.max(0, I - f.incomeSoFar), today: f.today, daysInMonth: f.daysInMonth };
}

const FIN_TONE = { green: 'var(--pos)', amber: '#f59e0b', red: 'var(--neg)', negBudget: 'var(--neg)', early: 'var(--text-muted)', noIncome: 'var(--text-muted)' };

/* ---- גרף הקצב: מצטבר בפועל מול קו מקווקו מתוכנן, המשך מנוקד = הערכה ---- */
function FinPaceChart({ model: md, currency }) {
  const W = 320, H = 130, P = 8;
  const days = md.daysInMonth;
  const top = Math.max(md.B, md.cum[md.today] || 0, md.V * days / Math.max(1, md.today)) * 1.08 || 1;
  const x = d => P + (W - 2 * P) * (d / days);
  const yv = v => H - P - (H - 2 * P) * (Math.max(0, v) / top);
  const actual = md.cum.map((v, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)},${yv(v).toFixed(1)}`).join(' ');
  const lastV = md.cum[md.today] || 0;
  const projV = md.today ? lastV * days / md.today : lastV;
  const showProj = md.state !== 'early' && md.today < days;
  const label = `${md.sentences[0]} היום: ${finMoney(lastV, currency)} שוטף מתוך ${finMoney(Math.max(0, md.B), currency)}.`;
  return React.createElement('figure', { className: 'fin-pace' },
    React.createElement('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, dir: 'ltr' },
      md.B > 0 && React.createElement('line', { x1: x(0), y1: yv(md.B), x2: x(days), y2: yv(md.B), className: 'fin-pace-budget' }),
      md.B > 0 && React.createElement('line', { x1: x(0), y1: yv(0), x2: x(days), y2: yv(md.B), className: 'fin-pace-plan' }),
      React.createElement('path', { d: `${actual} L${x(md.today).toFixed(1)},${yv(0)} L${x(0)},${yv(0)} Z`, className: 'fin-pace-area' }),
      React.createElement('path', { d: actual, className: 'fin-pace-line', pathLength: 1 }),
      showProj && React.createElement('line', { x1: x(md.today), y1: yv(lastV), x2: x(days), y2: yv(projV), className: 'fin-pace-proj' }),
      React.createElement('circle', { cx: x(md.today), cy: yv(lastV), r: 3.5, className: 'fin-pace-dot' })),
    React.createElement('figcaption', { className: 'fin-pace-legend' },
      React.createElement('span', null, React.createElement('i', { className: 'lg-actual' }), 'בפועל'),
      md.B > 0 && React.createElement('span', null, React.createElement('i', { className: 'lg-plan' }), 'קצב מתוכנן'),
      showProj && React.createElement('span', null, React.createElement('i', { className: 'lg-proj' }), 'הערכה'),
      React.createElement('b', null, `היום: ${finMoney(lastV, currency)}`)));
}

/* ---- המסך "החודש" ---- */
function FinanceMonth({ forecast, transactions, bills, categoryBudgets, savingsSetAside, currency, onNavigate, weekly, bankTotal, hasBankAccounts }) {
  if (!forecast.hasData) return React.createElement('div', { className: 'ent-card p-6' }, React.createElement(EmptyState, { text: 'עוד אין נתונים לחודש הזה', hint: 'הוסיפו הוצאה או הכנסה ראשונה בכפתור +' }));
  const md = finMonthModel({ forecast, transactions, bills, categoryBudgets, savingsSetAside, currency });
  const tone = FIN_TONE[md.state];
  const monthName = new Date().toLocaleDateString('he-IL', { month: 'long' });
  const pacePct = md.B > 0 ? Math.min(100, md.V / md.B * 100) : 100;
  const card = (key, children, extra) => React.createElement('section', { key, className: 'ent-card p-4 sm:p-5 fin-card', ...extra }, children);

  return React.createElement('div', { className: 'space-y-4 fin-month' },
    // 1. גיבור: סטטוס, משפט, מספר, ליום ולשבוע
    card('hero', React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'flex items-center justify-between gap-2' },
        React.createElement('span', { className: 'fin-chip', style: { '--tone': tone } }, React.createElement('span', { 'aria-hidden': 'true' }, md.chip[0]), md.chip[1]),
        React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, `${monthName} · יום ${md.today} מתוך ${md.daysInMonth}`)),
      React.createElement('h2', { className: 'fin-sentence' }, md.sentences[0]),
      md.state !== 'noIncome' && React.createElement('div', { className: 'fin-hero-row' },
        React.createElement('div', null,
          React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, md.L >= 0 ? 'נשאר להוציא החודש' : 'חריגה החודש'),
          React.createElement('p', { className: 'fin-hero-num', style: { color: md.L < 0 ? 'var(--neg)' : 'var(--text)' } }, React.createElement(Money, { v: Math.abs(md.L), currency }))),
        md.L > 0 && React.createElement('p', { className: 'fin-hero-side' }, `${finMoney(md.perDay, currency)} ליום · ${finMoney(md.perWeek, currency)} השבוע`)),
      md.sentences[1] && React.createElement('p', { className: 'text-sm mt-1', style: { color: 'var(--text-2)' } }, md.sentences[1]),
      md.incomeIsEstimate && md.incomeMissing > 0 && React.createElement('p', { className: 'text-xs mt-1', style: { color: 'var(--text-dim)' } }, `כולל הכנסה צפויה של ${finMoney(md.incomeMissing, currency)} שעוד לא נרשמה החודש.`),
      // 2. פס הקצב: מסלול = התקציב לשוטף, מילוי = מה שהוצא, קו = איפה הייתם אמורים להיות היום
      md.B > 0 && React.createElement('div', { className: 'fin-bar-wrap', role: 'img', 'aria-label': `הוצאתם ${finMoney(md.V, currency)} מתוך ${finMoney(md.B, currency)} לשוטף; עברו ${Math.round(md.t * 100)}% מהחודש` },
        React.createElement('div', { className: 'fin-bar' },
          React.createElement('span', { className: 'fin-bar-fill', style: { width: `${pacePct}%`, background: tone } }),
          React.createElement('span', { className: 'fin-bar-today', style: { insetInlineStart: `${Math.min(100, md.t * 100)}%` }, title: 'איפה הייתם אמורים להיות היום' })),
        React.createElement('div', { className: 'fin-bar-labels' },
          React.createElement('span', { className: 'fin-bar-today-label', style: { insetInlineStart: `${Math.min(96, Math.max(4, md.t * 100))}%` } }, '▲ היום'),
          React.createElement('span', null, `הוצאתם ${finMoney(md.V, currency)} מתוך ${finMoney(md.B, currency)} לשוטף`))))),
    // 3. שלושה מספרים
    React.createElement('div', { className: 'fin-three' },
      React.createElement('button', { type: 'button', className: 'ent-card fin-mini', onClick: () => onNavigate('expenses') },
        React.createElement('span', { className: 'fin-mini-label' }, md.incomeIsEstimate ? 'הכנסה צפויה' : 'הכנסה החודש'),
        React.createElement('b', null, finMoney(md.I, currency))),
      React.createElement('button', { type: 'button', className: 'ent-card fin-mini', onClick: () => onNavigate('bills') },
        React.createElement('span', { className: 'fin-mini-label' }, 'קבועים והלוואות'),
        React.createElement('b', null, finMoney(md.F, currency)),
        React.createElement('span', { className: 'fin-mini-sub' }, `ירדו ${finMoney(md.fixedPaid, currency)}`)),
      React.createElement('button', { type: 'button', className: 'ent-card fin-mini', onClick: () => onNavigate('expenses') },
        React.createElement('span', { className: 'fin-mini-label' }, 'שוטף עד היום'),
        React.createElement('b', null, finMoney(md.V, currency)),
        md.hasPrev && React.createElement('span', { className: 'fin-mini-sub', style: { color: md.diffPrev > 0 ? 'var(--neg-soft)' : 'var(--pos)' } },
          md.diffPrev === 0 ? 'כמו בחודש שעבר' : `${finMoney(Math.abs(md.diffPrev), currency)} ${md.diffPrev < 0 ? 'פחות' : 'יותר'} מאותו יום בחודש שעבר`))),
    md.S > 0 && React.createElement('p', { className: 'text-xs', style: { color: 'var(--text-dim)' } }, `הפרשה לחיסכון החודש: ${finMoney(md.S, currency)} (כבר הופחתה מהתקציב לשוטף).`),
    // 4. בקרוב
    md.upcoming.length > 0 && card('upcoming', React.createElement(React.Fragment, null,
      React.createElement('h3', { className: 'fin-h' }, 'יורד בשבוע הקרוב'),
      React.createElement('ul', { className: 'fin-list' }, md.upcoming.slice(0, 4).map(b => React.createElement('li', { key: b.id },
        React.createElement('span', null, b.title),
        React.createElement('span', { style: { color: b.day < md.today ? 'var(--neg)' : 'var(--text-muted)' } }, b.day < md.today ? `עבר מועד (${b.day} לחודש)` : b.day === md.today ? 'היום' : `ב-${b.day} לחודש`),
        React.createElement('b', null, finMoney(b.amount, currency))))),
      React.createElement('button', { type: 'button', className: 'text-xs underline mt-1', style: { color: 'var(--text-muted)' }, onClick: () => onNavigate('bills') }, 'כל הקבועים'))),
    // 5. קטגוריות: פסים ממוינים במקום עוגה
    md.cats.length > 0 && card('cats', React.createElement(React.Fragment, null,
      React.createElement('h3', { className: 'fin-h' }, `על מה הלך הכסף ב${monthName}`),
      React.createElement('div', { className: 'fin-cats' }, md.cats.map(c => {
        const w = c.spent / md.maxSpent * 100;
        const tw = c.budget ? c.budget / md.maxSpent * 100 : 0;
        const ctone = c.state ? FIN_TONE[c.state] : 'var(--bronze)';
        return React.createElement('button', { key: c.name, type: 'button', className: 'fin-cat', disabled: c.merged, onClick: () => onNavigate('expenses'),
          'aria-label': `${c.name}: ${finMoney(c.spent, currency)}${c.budget ? ` מתוך ${finMoney(c.budget, currency)}` : ''}` },
          React.createElement('span', { className: 'fin-cat-head' },
            React.createElement('span', null, c.name),
            React.createElement('span', null, finMoney(c.spent, currency), c.budget ? React.createElement('small', null, ` / ${finMoney(c.budget, currency)}`) : null)),
          React.createElement('span', { className: 'fin-cat-track' },
            c.budget ? React.createElement('span', { className: 'fin-cat-budget', style: { width: `${tw}%` } }) : null,
            React.createElement('span', { className: 'fin-cat-fill', style: { width: `${w}%`, background: ctone } }),
            c.budget && md.state !== 'early' ? React.createElement('span', { className: 'fin-cat-today', style: { insetInlineStart: `${tw * md.t}%` } }) : null));
      })),
      md.cats.some(c => !c.merged && c.spent - c.prev > 50) && React.createElement('p', { className: 'text-xs mt-2', style: { color: 'var(--text-muted)' } },
        (() => { const g = md.cats.filter(c => !c.merged).sort((a, b) => (b.spent - b.prev) - (a.spent - a.prev))[0]; return `הכי גדל: ${g.name}, ${finMoney(g.spent - g.prev, currency)} יותר מאותו יום בחודש שעבר`; })()))),
    // 6. גרף הקצב
    md.B > 0 && card('pace', React.createElement(React.Fragment, null,
      React.createElement('h3', { className: 'fin-h' }, 'איך הגענו לכאן'),
      React.createElement(FinPaceChart, { model: md, currency }))),
    // 7. סקירה שבועית + עו"ש
    weekly,
    hasBankAccounts && React.createElement('button', { type: 'button', className: 'ent-card w-full p-4 flex items-center justify-between gap-3 text-right', onClick: () => onNavigate('savings') },
      React.createElement('span', { className: 'text-sm' }, 'בעו"ש'),
      React.createElement('b', null, finMoney(bankTotal, currency))));
}

/* ---- "עוד": מה שיצא מהתפריט הראשי של הכלכלה ---- */
function FinMorePage({ onNavigate, news, newsState, newsAgo, tip }) {
  const links = [['gifts', '🎁', 'מתנות ואירועים', 'תקציב למתנות ולאירועים בשנה'], ['kidmoney', '🐷', 'הכסף של הילדים', 'הארנק, ההוצאות והיעדים של כל ילד'], ['reviews', '📰', 'סקירות שבועיות', 'כל הסקירות שנשלחו']];
  return React.createElement('div', { className: 'space-y-4' },
    React.createElement('h2', { className: 'ent-heading text-2xl font-bold' }, 'עוד בכלכלה'),
    React.createElement('div', { className: 'ent-card p-2' }, links.map(([id, ic, t, d]) => React.createElement('button', { key: id, type: 'button', className: 'fin-more-row', onClick: () => onNavigate(id) },
      React.createElement('span', { className: 'fin-more-ic', 'aria-hidden': 'true' }, ic),
      React.createElement('span', { className: 'flex-1 text-right' }, React.createElement('b', { className: 'block text-sm' }, t), React.createElement('span', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, d)),
      React.createElement('span', { 'aria-hidden': 'true', style: { color: 'var(--text-dim)' } }, '←')))),
    tip && React.createElement('div', { className: 'ent-card p-4' }, React.createElement('p', { className: 'text-xs mb-1', style: { color: 'var(--text-dim)' } }, 'טיפ להיום'), React.createElement('p', { className: 'text-sm' }, tip)),
    newsState === 'ok' && news && news.length > 0 && React.createElement('div', { className: 'ent-card p-4' },
      React.createElement('h3', { className: 'fin-h' }, 'כלכלה בעולם'),
      React.createElement('ul', { className: 'space-y-2' }, news.slice(0, 6).map((n, i) => React.createElement('li', { key: i },
        React.createElement('a', { href: n.url, target: '_blank', rel: 'noopener noreferrer', className: 'text-sm hover:underline' }, n.headline),
        React.createElement('span', { className: 'block text-xs', style: { color: 'var(--text-dim)' } }, n.source, newsAgo ? ` · ${newsAgo(n.datetime)}` : ''))))));
}

if (typeof module !== 'undefined') module.exports = { finMonthModel, FIN };
