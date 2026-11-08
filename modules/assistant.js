/* Homey — עוזר AI משפחתי: כפתור צף ומסך שיחה. השרת: supabase/functions/assistant (Claude Haiku 5.5 עם כלים).
 * ההורה יכול לשאול על הנתונים ולהוסיף קניות, משימות, אירועים ופתקים. הוצאה/הכנסה חוזרת כהצעה עם כפתור "רישום".
 * ילד במצב מוגבל: המשימות והלו"ז שלו, הנקודות שלו ורשימת הקניות.
 * דיבור: SpeechRecognition של הדפדפן (בעברית), בלי עלות נוספת. */

const ASSIST_SUGGEST_PARENT = ['מה יש לנו היום ומחר?', 'תוסיף חלב, ביצים ולחם לרשימת הקניות', 'כמה הוצאנו על מסעדות החודש?', 'תזכיר לי מחר ב-9 להתקשר לרופא', 'מה הילדים צריכים לעשות היום?'];
const ASSIST_SUGGEST_KID = ['מה יש לי היום?', 'כמה נקודות יש לי?', 'תוסיף במבה לרשימת הקניות', 'תזכיר לי לקרוא ספר מחר'];
const ASSIST_ERRORS = {
  daily_limit: 'הגעתם לתקרת ההודעות של היום. העוזר יחזור מחר בבוקר.',
  premium_required: 'העוזר הוא תכונת פרימיום.',
  not_configured: 'העוזר עוד לא הופעל בשרת.',
  busy: 'העוזר עמוס כרגע. נסו שוב בעוד רגע.',
  unauthorized: 'צריך להתחבר מחדש כדי להשתמש בעוזר.'
};
const assistSpeech = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

function AssistantPanel({ isDemo, isPremium, isChild, kidId, kidName, currency, onActions, onConfirmTransaction, onUpgrade }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]); // { role, text, actions?, pending? }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [listening, setListening] = useState(false);
  const listRef = useRef(null);
  const recRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs, busy]);
  useEffect(() => { if (open && inputRef.current) setTimeout(() => inputRef.current && inputRef.current.focus(), 50); }, [open]);
  useEscapeClose(() => setOpen(false));
  // שיחה נפרדת לכל פרופיל
  useEffect(() => { setMsgs([]); setRemaining(null); }, [isChild, kidId]);

  const send = async raw => {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setText('');
    const history = msgs.filter(m => m.text).map(m => ({ role: m.role, text: m.text }));
    setMsgs(prev => [...prev, { role: 'user', text: message }]);
    if (isDemo) {
      setMsgs(prev => [...prev, { role: 'assistant', text: 'במצב דמו העוזר לא מחובר לנתונים. בחשבון פרימיום אפשר לשאול אותי על ההוצאות, הלו"ז והמשימות, ולבקש להוסיף דברים לרשימת הקניות, משימות ואירועים, בכתיבה או בדיבור.' }]);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await sb.functions.invoke('assistant', { body: { message, history, mode: isChild ? 'kid' : 'parent', kid_id: isChild ? kidId : undefined } });
      if (error) {
        let code = null;
        try { code = (await error.context.json()).error; } catch (_e) {}
        setMsgs(prev => [...prev, { role: 'assistant', text: ASSIST_ERRORS[code] || 'משהו השתבש. נסו שוב בעוד רגע.', error: true }]);
      } else if (!data || typeof data.reply !== 'string') {
        // הפונקציה בשרת לא מחזירה תשובה של העוזר (למשל עדיין קוד ברירת המחדל של סופאבייס)
        setMsgs(prev => [...prev, { role: 'assistant', text: ASSIST_ERRORS.not_configured, error: true }]);
      } else {
        setMsgs(prev => [...prev, { role: 'assistant', text: data.reply, actions: data.actions || [], pending: (data.pending || []).map(p => ({ ...p, state: 'open' })) }]);
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
        if (data.actions && data.actions.length && onActions) onActions(data.actions);
      }
    } catch (_e) {
      setMsgs(prev => [...prev, { role: 'assistant', text: 'אין חיבור כרגע. נסו שוב.', error: true }]);
    }
    setBusy(false);
  };
  const setPending = (mi, pi, state) => setMsgs(prev => prev.map((m, i) => i !== mi ? m : { ...m, pending: m.pending.map((p, j) => j === pi ? { ...p, state } : p) }));
  const confirm = async (mi, pi, p) => {
    setPending(mi, pi, 'saving');
    const ok = await onConfirmTransaction(p);
    setPending(mi, pi, ok ? 'done' : 'open');
  };
  const toggleMic = () => {
    const SR = assistSpeech();
    if (!SR) return;
    if (listening && recRef.current) { recRef.current.stop(); return; }
    const rec = new SR();
    rec.lang = 'he-IL';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      setText((finalText + interim).trim());
    };
    rec.onend = () => { setListening(false); recRef.current = null; if (finalText.trim()) send(finalText.trim()); };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  const money = v => `${currency}${Math.round(v).toLocaleString('he-IL')}`;
  const suggestions = isChild ? ASSIST_SUGGEST_KID : ASSIST_SUGGEST_PARENT;
  const h = React.createElement;

  return h(React.Fragment, null,
    !open && h('button', { type: 'button', className: 'assist-fab', 'aria-label': 'העוזר של Homey', onClick: () => setOpen(true) },
      h('svg', { viewBox: '0 0 24 24', width: 26, height: 26, 'aria-hidden': 'true' },
        h('path', { d: 'M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1L5 9.5l5.1-1.9z', fill: '#fff' }),
        h('path', { d: 'M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z', fill: 'rgba(255,255,255,.75)' }))),
    open && h('div', { className: 'assist-backdrop', onClick: () => setOpen(false) }),
    open && h('div', { className: 'assist-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'העוזר של Homey', dir: 'rtl' },
      h('div', { className: 'assist-head' },
        h('div', null,
          h('p', { className: 'font-bold' }, '✨ העוזר של Homey'),
          h('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, remaining != null ? `נשארו היום ${remaining} הודעות` : isChild ? `שלום ${kidName || ''}, במה לעזור?` : 'שואלים, מבקשים, וזה קורה')),
        h('button', { className: 'ent-icon-btn', 'aria-label': 'סגירה', onClick: () => setOpen(false) }, h(IX, { size: 18 }))),
      !isPremium ? h('div', { className: 'p-4' }, h(PremiumLock, { title: 'העוזר המשפחתי הוא תכונת פרימיום', desc: 'שאלות על הכסף, הלו"ז והמשימות, והוספה מהירה של קניות, משימות ואירועים, בכתיבה או בדיבור.', onUpgrade: () => { setOpen(false); onUpgrade(); } })) :
      h(React.Fragment, null,
        h('div', { className: 'assist-list', ref: listRef, 'aria-live': 'polite' },
          !msgs.length && h('div', { className: 'assist-empty' },
            h('p', { className: 'text-sm mb-3', style: { color: 'var(--text-2)' } }, isChild ? 'אפשר לשאול מה יש לך היום, כמה נקודות יש לך, או לבקש להוסיף משהו לרשימת הקניות.' : 'אפשר לשאול על הכסף, הלו"ז והמשימות, או לבקש להוסיף דברים. למשל:'),
            h('div', { className: 'flex flex-wrap gap-1.5' }, suggestions.map(s => h('button', { key: s, type: 'button', className: 'assist-chip', onClick: () => send(s) }, s)))),
          msgs.map((m, mi) => h('div', { key: mi, className: `assist-msg ${m.role}${m.error ? ' error' : ''}` },
            m.text && h('p', { className: 'assist-bubble' }, m.text),
            (m.actions || []).map((a, ai) => h('p', { key: ai, className: 'assist-action' }, '✓ ', a.label)),
            (m.pending || []).map((p, pi) => h('div', { key: pi, className: 'assist-pending' },
              h('p', { className: 'text-sm font-semibold' }, `${p.type === 'income' ? 'הכנסה' : 'הוצאה'}: ${money(p.amount)} · ${p.category}${p.sub ? ` · ${p.sub}` : ''}`),
              (p.description || p.date) && h('p', { className: 'text-xs', style: { color: 'var(--text-muted)' } }, [p.description, p.date && p.date !== kidToday() ? fmtDateHe(p.date) : null].filter(Boolean).join(' · ')),
              p.state === 'done' ? h('p', { className: 'text-xs font-bold mt-1', style: { color: 'var(--pos)' } }, '✓ נרשם') :
                p.state === 'cancelled' ? h('p', { className: 'text-xs mt-1', style: { color: 'var(--text-dim)' } }, 'בוטל') :
                h('div', { className: 'flex gap-2 mt-2' },
                  h('button', { className: 'ent-pill-btn solid-bronze px-4 py-1.5 text-xs', disabled: p.state === 'saving', onClick: () => confirm(mi, pi, p) }, p.state === 'saving' ? 'רגע...' : 'רישום'),
                  h('button', { className: 'ent-pill-btn ghost px-4 py-1.5 text-xs', onClick: () => setPending(mi, pi, 'cancelled') }, 'ביטול'))))))),
          busy && h('div', { className: 'assist-msg assistant' }, h('p', { className: 'assist-bubble assist-typing', 'aria-label': 'העוזר חושב' }, h('span'), h('span'), h('span')))),
        h('div', { className: 'assist-input' },
          assistSpeech() && h('button', { type: 'button', className: 'assist-mic' + (listening ? ' on' : ''), 'aria-pressed': listening, 'aria-label': listening ? 'עצירת ההקלטה' : 'דיבור', onClick: toggleMic },
            h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': 'true' },
              h('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }), h('path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v3' }))),
          h('input', { ref: inputRef, className: 'ent-input flex-1 px-4 py-2.5 rounded-full text-sm outline-none', placeholder: listening ? 'מקשיב...' : 'כתבו או דברו...', value: text, maxLength: 1000,
            onChange: e => setText(e.target.value), onKeyDown: e => { if (e.key === 'Enter') send(); }, 'aria-label': 'הודעה לעוזר' }),
          h('button', { type: 'button', className: 'assist-send', disabled: busy || !text.trim(), 'aria-label': 'שליחה', onClick: () => send() },
            h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, h('path', { d: 'M20 4L3 11l7 2 2 7z', fill: 'currentColor' }))))));
}
