// Articola frontend: vanilla JS, no build step. Hash router, one render function per view.
// All user-provided or model-written text is inserted with textContent (never innerHTML).
(function () {
  'use strict';

  /* ================= helpers ================= */

  const $app = document.getElementById('app');
  const S = { me: null, meta: null };
  let cleanups = [];
  let prevRoute = null, curRoute = null; // where the user came from, for "back" links
  const onLeave = (fn) => cleanups.push(fn);

  const ICONS = {
    today: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    path: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
    progress: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    guide: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5z"/><path d="M8 7h7M8 11h5"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    wave: '<path d="M4 12h2M8 8v8M12 5v14M16 9v6M20 12h0"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    google: '<path fill="#4285F4" stroke="none" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8z"/><path fill="#34A853" stroke="none" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" stroke="none" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" stroke="none" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/>',
    facebook: '<path fill="#1877F2" stroke="none" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/>',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || ''; // static, trusted markup
    return s;
  }

  // h('div.card#id', {attrs}, ...children). Children: strings (as text), nodes, arrays, null/false (skipped).
  function h(sel, attrs, ...kids) {
    const m = sel.match(/^([a-z0-9]+)((?:[.#][\w-]+)*)$/i);
    const n = document.createElement(m ? m[1] : 'div');
    if (m && m[2]) m[2].replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') n.classList.add(v); else n.id = v; });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className += (n.className ? ' ' : '') + v;
      else if (k === 'style') n.style.cssText = v;
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else n.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); };
    kids.forEach(add);
    return n;
  }

  async function api(method, path, body) {
    const opts = { method, headers: { 'x-articola': '1' }, credentials: 'same-origin' };
    if (body instanceof Blob) { opts.body = body; opts.headers['content-type'] = body.type || 'audio/webm'; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
    let r;
    try { r = await fetch(path, opts); } catch (e) { throw Object.assign(new Error('Connessione assente: riprova.'), { status: 0 }); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/api/me') { location.reload(); throw new Error('Sessione scaduta.'); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Qualcosa non ha funzionato.'), { status: r.status, code: j.code });
    return j;
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const fmtDate = (d, o) => new Date(d).toLocaleDateString('it-IT', o || { day: 'numeric', month: 'long' });
  const fmtNum = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const fmtTime = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('articola.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('articola.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem('articola.' + k); } catch (e) { /* ignore */ } },
  };
  const labelOf = (list, id) => ((list || []).find((x) => x.id === id) || {}).label || id;
  const KIND_LABEL = { baseline: 'Punto zero', weekly: 'Registrazione della settimana', practice: 'Pratica libera', final: 'Confronto finale' };

  function position(startDate, weeks) {
    if (!startDate) return { started: false, dayIndex: 0, week: 1, finished: false };
    const dayIndex = Math.max(0, daysBetween(startDate, todayKey()));
    const raw = Math.floor(dayIndex / 7) + 1;
    return { started: true, dayIndex, week: Math.min(raw, weeks), finished: raw > weeks };
  }

  // Like Element#append, but skips false/null/undefined (append would print them as text).
  function add(parent, ...kids) {
    kids.flat(Infinity).forEach((k) => { if (k != null && k !== false) parent.appendChild(k instanceof Node ? k : document.createTextNode(String(k))); });
    return parent;
  }

  function mount(...nodes) {
    $app.textContent = '';
    nodes.forEach((n) => n && $app.appendChild(n));
    $app.focus({ preventScroll: true });
  }

  function loading(text) {
    return h('div.empty', h('span.spinner'), text || 'Carico…');
  }

  // Audio player for a stored recording. MediaRecorder (Chrome/Firefox) writes WebM with no duration and no seek
  // index, so a plain <audio src> shows 0:00 and cannot seek. Load the file into memory, then make the browser scan
  // it once to learn the real duration; after that the seek bar works. Object URLs are freed on navigation.
  function audioPlayer(src) {
    const el = h('audio', { controls: true, preload: 'auto' });
    let url = null, gone = false;
    cleanups.push(() => { gone = true; el.pause(); if (url) URL.revokeObjectURL(url); });
    fetch(src, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then((blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        el.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(el.duration)) return;
          const done = () => { if (!Number.isFinite(el.duration)) return; el.removeEventListener('durationchange', done); el.currentTime = 0; };
          el.addEventListener('durationchange', done);
          el.currentTime = 1e7; // seek past the end: the browser reads to the end and sets the duration
        }, { once: true });
        el.src = url;
      })
      .catch(() => { if (!gone) el.src = src; }); // fall back to streaming
    return el;
  }

  function errorBox(e, retry) {
    return h('div.empty', h('p', e.message || String(e)), retry && h('button.btn', { onclick: retry }, 'Riprova'));
  }

  /* ---- small widgets ---- */

  function chipGroup(options, selected, max, onChange) {
    const wrap = h('div.chips', { role: 'group' });
    const sync = () => wrap.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(selected.includes(b.dataset.id))));
    options.forEach((o) => wrap.appendChild(h('button.chip', {
      type: 'button', 'data-id': o.id, 'aria-pressed': 'false',
      onclick: () => {
        const i = selected.indexOf(o.id);
        if (i >= 0) selected.splice(i, 1);
        else { if (max && selected.length >= max) { toast(`Puoi sceglierne al massimo ${max}.`); return; } selected.push(o.id); }
        sync(); onChange && onChange(selected);
      },
    }, o.label)));
    sync();
    return wrap;
  }

  function segmented(options, value, onChange, label) {
    const wrap = h('div.segmented', { role: 'group', 'aria-label': label || null });
    const sync = () => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(value))));
    options.forEach((o) => wrap.appendChild(h('button', { type: 'button', 'data-v': String(o.v), onclick: () => { value = o.v; sync(); onChange(o.v); } }, o.l)));
    sync();
    return wrap;
  }

  function dots5(value, onPick, label) {
    const wrap = h('div.dots5', { role: onPick ? 'radiogroup' : null, 'aria-label': label || null });
    for (let i = 1; i <= 5; i++) {
      wrap.appendChild(onPick
        ? h('button', { type: 'button', class: value === i ? 'on' : null, role: 'radio', 'aria-checked': String(value === i), 'aria-label': `${i} su 5`, onclick: () => onPick(i) }, String(i))
        : h('span', { class: value === i ? 'on' : null, 'aria-hidden': value === i ? null : 'true' }, String(i)));
    }
    if (!onPick && value == null) wrap.setAttribute('aria-label', 'non disponibile');
    return wrap;
  }

  function timer(minutes, label) {
    let left = Math.round(minutes * 60); let iv = null;
    const out = h('output', fmtTime(left));
    const btn = h('button.btn.small', { type: 'button' }, label || `Timer ${minutes} min`);
    const stop = () => { clearInterval(iv); iv = null; btn.textContent = 'Riprendi'; };
    btn.addEventListener('click', () => {
      if (iv) return stop();
      if (left <= 0) left = Math.round(minutes * 60);
      btn.textContent = 'Pausa';
      iv = setInterval(() => {
        left--; out.textContent = fmtTime(Math.max(0, left));
        if (left <= 0) { clearInterval(iv); iv = null; btn.textContent = 'Ricomincia'; if (navigator.vibrate) navigator.vibrate(200); toast('Tempo!'); }
      }, 1000);
    });
    onLeave(() => clearInterval(iv));
    return h('div.timer', btn, out);
  }

  function breathPacer(minutes) {
    const circle = h('div.breath-circle', 'Pronto');
    const btn = h('button.btn.small', { type: 'button' }, 'Avvia il respiro 4-2-6');
    let t = null; let running = false;
    const phases = [['Inspira', 4, 1], ['Trattieni', 2, 1], ['Espira', 6, 0.7]];
    function run(i, endAt) {
      if (!running) return;
      if (Date.now() > endAt) { running = false; circle.textContent = 'Fatto'; circle.style.transform = 'scale(0.7)'; btn.textContent = 'Ricomincia'; return; }
      const [name, sec, scale] = phases[i % 3];
      circle.textContent = name;
      circle.style.transitionDuration = sec + 's';
      circle.style.transform = `scale(${scale})`;
      t = setTimeout(() => run(i + 1, endAt), sec * 1000);
    }
    btn.addEventListener('click', () => {
      if (running) { running = false; clearTimeout(t); btn.textContent = 'Avvia il respiro 4-2-6'; circle.textContent = 'Pronto'; circle.style.transform = 'scale(0.7)'; return; }
      running = true; btn.textContent = 'Ferma'; run(0, Date.now() + minutes * 60000);
    });
    onLeave(() => { running = false; clearTimeout(t); });
    return h('div.breath', circle, btn);
  }

  /* ================= shell & router ================= */

  const NAV = [
    { route: 'today', href: '#/', label: 'Oggi', icon: 'today' },
    { route: 'path', href: '#/path', label: 'Percorso', icon: 'path' },
    { route: 'progress', href: '#/progress', label: 'Progressi', icon: 'progress' },
    { route: 'guide', href: '#/guide', label: 'Guida', icon: 'guide' },
  ];

  function renderShell(showNav) {
    const bar = document.getElementById('topbar');
    bar.hidden = !S.me || !S.me.user;
    const nav = document.getElementById('nav');
    nav.textContent = '';
    nav.hidden = !showNav;
    if (!S.me || !S.me.user) return;
    const av = document.getElementById('avatar');
    const u = S.me.user;
    av.textContent = '';
    if (u.avatarUrl) av.style.backgroundImage = `url("${encodeURI(u.avatarUrl)}")`;
    else av.textContent = (u.name || '?').trim().charAt(0).toUpperCase();
    if (showNav) NAV.forEach((n) => nav.appendChild(h('a', { href: n.href, 'data-route': n.route }, icon(n.icon), h('span', n.label))));
  }

  function setActive(route) {
    document.querySelectorAll('#nav a').forEach((a) => { if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [p, q] = raw.split('?');
    return { parts: p.split('/').filter(Boolean), q: new URLSearchParams(q || '') };
  }

  async function render() {
    cleanups.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    cleanups = [];
    $app.classList.remove('wide');
    window.scrollTo(0, 0);
    if (!S.me || !S.me.user) { renderShell(false); return viewLogin(); }
    const { parts, q } = parseHash();
    const route = parts[0] || 'today';
    if (route !== curRoute) { prevRoute = curRoute; curRoute = route; }
    const u = S.me.user;
    // Until the path is accepted the app is the onboarding flow.
    if (!u.onboarded && !['settings', 'onboarding', 'guide'].includes(route)) {
      renderShell(false);
      const p = S.me.path;
      if (p && p.status === 'generating') return viewGenerating();
      if (p && p.status === 'ready') return viewPlanPreview(p, true);
      return viewOnboarding({ failed: p && p.status === 'failed' ? p.error : null });
    }
    renderShell(u.onboarded);
    setActive(route);
    try {
      if (route === 'today') return await viewToday();
      if (route === 'path') return await viewPath();
      if (route === 'progress') return await viewProgress();
      if (route === 'guide') return viewGuide();
      if (route === 'settings') return viewSettings();
      if (route === 'onboarding') return viewOnboarding({ edit: true });
      if (route === 'record') return await viewRecord(q);
      if (route === 'rec' && parts[1]) return await viewRecording(parts[1], q);
      if (route === 'generating') return viewGenerating();
      location.hash = '#/';
    } catch (e) {
      mount(errorBox(e, render));
    }
  }

  async function refreshMe() { S.me = await api('GET', '/api/me'); }

  /* ================= login ================= */

  const AUTH_ERRORS = {
    denied: 'Accesso annullato.', state: 'La richiesta di accesso è scaduta: riprova.', failed: 'Accesso non riuscito: riprova.',
    not_configured: 'Questo metodo di accesso non è configurato.', already_linked: 'Quell\'account è già collegato a un altro profilo.', login_required: 'Accedi prima di collegare un account.',
  };

  function viewLogin() {
    const prov = S.me.providers || {};
    const err = new URLSearchParams(location.search).get('auth_error');
    const devName = h('input', { type: 'text', placeholder: 'Il tuo nome', 'aria-label': 'Nome', maxlength: '60' });
    const page = h('div.login', h('div.login-inner',
      h('span.mark', { 'aria-hidden': 'true' }),
      h('div.stack',
        h('h1', 'Parla con chiarezza.'),
        h('p.lead', 'Un percorso costruito sui tuoi obiettivi: dieci-quindici minuti al giorno, esercizi scritti per te dall\'AI, la tua voce registrata per vedere i progressi.')),
      h('div.pillars',
        h('div', h('b', 'Voce'), 'chiara e pulita'),
        h('div', h('b', 'Pensiero'), 'strutturato'),
        h('div', h('b', 'Presenza'), 'nelle interazioni')),
      err && h('div.notice.warn', AUTH_ERRORS[err] || 'Accesso non riuscito.'),
      h('div.providers',
        prov.google && h('a.btn.provider-btn', { href: '/auth/google' }, icon('google'), 'Continua con Google'),
        prov.facebook && h('a.btn.provider-btn', { href: '/auth/facebook' }, icon('facebook'), 'Continua con Facebook'),
        !prov.google && !prov.facebook && !prov.dev && h('p.muted', 'Nessun metodo di accesso configurato sul server.'),
        prov.dev && h('form.stack', {
          onsubmit: async (e) => {
            e.preventDefault();
            try { await api('POST', '/auth/dev', { name: devName.value }); await refreshMe(); history.replaceState(null, '', '/'); render(); }
            catch (er) { toast(er.message); }
          },
        }, h('p.small.muted', 'Accesso di sviluppo (solo locale)'), devName, h('button.btn.primary.block', { type: 'submit' }, 'Entra'))),
      h('p.small.muted', 'Accedendo, i tuoi dati e le tue registrazioni restano nel tuo account e puoi cancellarli quando vuoi.')));
    $app.textContent = '';
    $app.appendChild(page);
  }

  /* ================= onboarding ================= */

  const INTEREST_SUGGESTIONS = ['Tecnologia', 'Scienza', 'Economia', 'Viaggi', 'Sport', 'Cucina', 'Storia', 'Cinema', 'Musica', 'Natura', 'Design', 'Psicologia'];

  function viewOnboarding({ edit, failed } = {}) {
    const M = S.meta; const u = S.me.user;
    const base = u.hasPreferences ? JSON.parse(JSON.stringify(u.preferences)) : JSON.parse(JSON.stringify(u.preferences || {}));
    const d = edit ? base : Object.assign(base, store.get('onb', {}));
    d.goals = d.goals || []; d.situations = d.situations || []; d.interests = d.interests || []; d.selfRatings = d.selfRatings || {};
    let i = edit ? 1 : store.get('onbStep', 0);
    const save = () => { if (!edit) { store.set('onb', d); store.set('onbStep', i); } };

    const steps = [
      { // 0
        eyebrow: 'Benvenuto', title: `Ciao ${(u.name || '').split(' ')[0]}. Costruiamo il tuo percorso.`,
        lead: 'Ti faccio qualche domanda su obiettivi, contesto e tempo a disposizione. In base alle risposte l\'AI scrive un piano settimana per settimana, con esercizi quotidiani su misura.',
        body: () => h('div.stack',
          failed && h('div.notice.warn', 'L\'ultima generazione non è riuscita: ', failed),
          h('div.card.quiet.stack',
            h('div.row', h('span.pill', '1'), 'Obiettivi e contesto'),
            h('div.row', h('span.pill', '2'), 'Da dove parti'),
            h('div.row', h('span.pill', '3'), 'Tempo e preferenze'),
            h('div.row', h('span.pill', '4'), 'Il tuo percorso, generato per te'))),
        next: 'Iniziamo', valid: () => true,
      },
      { // 1
        eyebrow: 'Obiettivi', title: 'Cosa vuoi ottenere?', lead: 'Scegline fino a quattro. Il percorso darà più spazio a questi.',
        body: () => h('div.stack',
          chipGroup(M.goals, d.goals, 4),
          h('label.field', 'Con parole tue', h('span.field-hint', 'Facoltativo: es. "voglio presentare il progetto al board senza leggere le slide"'),
            h('textarea', { maxlength: '300', value: d.goalText || '', oninput: (e) => { d.goalText = e.target.value; save(); } }))),
        valid: () => d.goals.length > 0 || (d.goalText || '').trim().length > 3, invalidMsg: 'Scegli almeno un obiettivo.',
      },
      { // 2
        eyebrow: 'Contesto', title: 'Dove ti capita di parlare?', lead: 'Le sfide reali di ogni settimana saranno in queste situazioni.',
        body: () => h('div.stack',
          h('label.field', 'Il tuo ruolo', h('span.field-hint', 'es. sviluppatrice backend, project manager, studente'),
            h('input', { type: 'text', maxlength: '80', value: d.role || '', oninput: (e) => { d.role = e.target.value; save(); } })),
          h('div.field.stack', h('b', 'Situazioni'), chipGroup(M.situations, d.situations, 6)),
          h('div.field.stack', h('b', 'In che lingua vuoi allenarti a parlare?'),
            segmented([{ v: 'it', l: 'Italiano' }, { v: 'en', l: 'Inglese' }], d.speakingLang || 'it', (v) => { d.speakingLang = v; save(); }, 'Lingua'))),
        valid: () => true,
      },
      { // 3
        eyebrow: 'Punto di partenza', title: 'Come ti valuti oggi?', lead: 'Da 1 (difficoltà) a 5 (a tuo agio). Le aree più basse arrivano prima nel percorso. Alla prima settimana registrerai il tuo punto zero, così vedremo i numeri veri.',
        body: () => {
          const card = h('div.card');
          const draw = () => {
            card.textContent = '';
            M.areas.forEach((a) => card.appendChild(h('div.rating-row', h('span', a.label),
              dots5(d.selfRatings[a.id] || 3, (n) => { d.selfRatings[a.id] = n; save(); draw(); }, a.label))));
          };
          draw();
          return h('div.stack', card,
            h('label.field', 'Cosa ti mette più in difficoltà?', h('span.field-hint', 'Facoltativo: es. "quando mi fanno una domanda a sorpresa mi blocco"'),
              h('textarea', { maxlength: '300', value: d.struggle || '', oninput: (e) => { d.struggle = e.target.value; save(); } })));
        },
        valid: () => true,
      },
      { // 4
        eyebrow: 'Tempo', title: 'Quanto tempo hai?', lead: 'Meglio poco ogni giorno che tanto una volta a settimana.',
        body: () => h('div.stack',
          h('div.field.stack', h('b', 'Minuti al giorno'), segmented(M.options.minutesPerDay.map((v) => ({ v, l: `${v} min` })), d.minutesPerDay || 15, (v) => { d.minutesPerDay = v; save(); })),
          h('div.field.stack', h('b', 'Giorni a settimana'), segmented(M.options.daysPerWeek.map((v) => ({ v, l: `${v}` })), d.daysPerWeek || 5, (v) => { d.daysPerWeek = v; save(); })),
          h('div.field.stack', h('b', 'Durata del percorso'), segmented(M.options.weeks.map((v) => ({ v, l: `${v} sett.` })), d.weeks || 8, (v) => { d.weeks = v; save(); })),
          h('div.field.stack', h('b', 'Quando ti alleni'), segmented([{ v: 'morning', l: 'Mattina' }, { v: 'lunch', l: 'Pausa pranzo' }, { v: 'evening', l: 'Sera' }], d.timeOfDay || 'morning', (v) => { d.timeOfDay = v; save(); })),
          h('div.field.stack', h('b', 'Giorno della registrazione settimanale'),
            segmented([1, 2, 3, 4, 5, 6, 0].map((v) => ({ v, l: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][v] })), d.recordingDay != null ? d.recordingDay : 5, (v) => { d.recordingDay = v; save(); }))),
        valid: () => true,
      },
      { // 5
        eyebrow: 'Preferenze', title: 'Come ti piace imparare?', lead: 'Testi ed esempi parleranno dei temi che ti interessano.',
        body: () => {
          const styles = [
            { v: 'practical', t: 'Pratico', s: 'Pochi concetti, tanti esercizi brevi' },
            { v: 'balanced', t: 'Equilibrato', s: 'Spiegazioni brevi e pratica' },
            { v: 'deep', t: 'Approfondito', s: 'Il perché di ogni esercizio, più teoria' },
          ];
          const list = h('div.choice-list');
          const drawStyles = () => {
            list.textContent = '';
            styles.forEach((o) => list.appendChild(h('button.choice', { type: 'button', 'aria-pressed': String((d.style || 'balanced') === o.v), onclick: () => { d.style = o.v; save(); drawStyles(); } }, h('div', h('strong', o.t), h('span', o.s)))));
          };
          drawStyles();
          const chipsWrap = h('div');
          const drawChips = () => { chipsWrap.textContent = ''; chipsWrap.appendChild(chipGroup([...new Set(INTEREST_SUGGESTIONS.concat(d.interests))].map((x) => ({ id: x, label: x })), d.interests, 8, save)); };
          drawChips();
          const custom = h('input', { type: 'text', maxlength: '40', placeholder: 'Aggiungi un tema…', 'aria-label': 'Aggiungi un tema' });
          const addCustom = () => {
            const v = custom.value.trim();
            if (!v) return;
            if (!d.interests.includes(v)) { if (d.interests.length >= 8) return toast('Massimo 8 temi.'); d.interests.push(v); }
            custom.value = ''; save(); drawChips();
          };
          custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
          return h('div.stack',
            h('div.field.stack', h('b', 'Stile'), list),
            h('div.field.stack', h('b', 'Temi che ti interessano'), chipsWrap, h('div.row', custom, h('button.btn.small', { type: 'button', onclick: addCustom }, 'Aggiungi'))),
            h('div.field.stack', h('b', 'Tono del feedback'), segmented([{ v: 'encouraging', l: 'Incoraggiante' }, { v: 'direct', l: 'Diretto' }], d.feedbackTone || 'encouraging', (v) => { d.feedbackTone = v; save(); })));
        },
        valid: () => true,
      },
      { // 6
        eyebrow: 'Riepilogo', title: edit ? 'Le tue preferenze' : 'Tutto pronto', lead: edit ? 'Salvale per usarle nei prossimi esercizi, oppure rigenera il percorso da capo.' : 'L\'AI ora scrive il tuo percorso. Ci vuole circa un minuto.',
        body: () => h('div.card', h('dl.kv',
          h('div', h('dt', 'Obiettivi'), h('dd', d.goals.map((g) => labelOf(M.goals, g)).concat(d.goalText ? [`"${d.goalText}"`] : []).join(' · ') || '—')),
          h('div', h('dt', 'Contesto'), h('dd', [d.role, ...d.situations.map((s) => labelOf(M.situations, s))].filter(Boolean).join(' · ') || '—')),
          h('div', h('dt', 'Tempo'), h('dd', `${d.minutesPerDay || 15} min al giorno · ${d.daysPerWeek || 5} giorni a settimana · ${d.weeks || 8} settimane`)),
          h('div', h('dt', 'Temi'), h('dd', d.interests.join(', ') || '—')))),
        valid: () => true,
      },
    ];

    async function submit(regenerate) {
      const btns = $app.querySelectorAll('.onb-actions button');
      btns.forEach((b) => { b.disabled = true; });
      try {
        const r = await api('PUT', '/api/preferences', { preferences: d });
        S.me.user.preferences = r.preferences; S.me.user.hasPreferences = true;
        if (!regenerate) { toast('Preferenze salvate.'); location.hash = '#/settings'; return; }
        await api('POST', '/api/path/generate');
        store.del('onb'); store.del('onbStep');
        S.me.path = { status: 'generating' };
        if (S.me.user.onboarded) location.hash = '#/generating'; else render();
      } catch (e) {
        toast(e.message); btns.forEach((b) => { b.disabled = false; });
      }
    }

    function draw() {
      const st = steps[i];
      const last = i === steps.length - 1;
      const first = edit ? 1 : 0;
      mount(h('div.onb',
        h('div.onb-top',
          h('div.progress', h('span', { style: `width:${Math.round(((i + 1) / steps.length) * 100)}%` })),
          h('div.eyebrow', `${st.eyebrow} · ${i + 1} di ${steps.length}`)),
        h('div.stack', h('h1', st.title), h('p.lead', st.lead)),
        st.body(),
        h('div.onb-actions',
          i > first ? h('button.btn.ghost', { type: 'button', onclick: () => { i--; save(); draw(); } }, 'Indietro') : (edit ? h('a.btn.ghost', { href: '#/settings' }, 'Annulla') : h('span')),
          last
            ? h('div.row',
              edit && h('button.btn', { type: 'button', onclick: () => submit(false) }, 'Salva'),
              h('button.btn.primary', { type: 'button', onclick: () => {
                if (edit && !confirm('Il percorso attuale verrà archiviato e ne sarà creato uno nuovo. Le registrazioni restano nello storico. Procedere?')) return;
                submit(true);
              } }, edit ? 'Salva e rigenera il percorso' : 'Crea il mio percorso'))
            : h('button.btn.primary', { type: 'button', onclick: () => { if (!st.valid()) return toast(st.invalidMsg || 'Completa il passo.'); i++; save(); draw(); } }, st.next || 'Avanti'))));
    }
    draw();
  }

  /* ================= generation & plan ================= */

  function viewGenerating() {
    const msgs = ['Leggo i tuoi obiettivi e il tuo contesto', 'Scelgo il focus di ogni settimana', 'Preparo la routine quotidiana', 'Scrivo le sfide reali e le tracce di registrazione', 'Rileggo il percorso'];
    const items = msgs.map((m) => h('li', m));
    const list = h('ul.gen-steps', items);
    const box = h('div.generating', h('div.pulse', h('i')), h('h1', 'Sto creando il tuo percorso'), h('p.lead', 'Di solito ci vuole meno di un minuto. Puoi lasciare aperta questa pagina.'), list);
    mount(box);
    let k = 0;
    const mark = () => items.forEach((li, j) => { li.className = j < k ? 'done' : j === k ? 'on' : ''; });
    mark();
    const tick = setInterval(() => { if (k < msgs.length - 1) { k++; mark(); } }, 9000);
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        const { path } = await api('GET', '/api/path');
        S.me.path = path;
        if (path && path.status === 'ready') { location.hash = S.me.user.onboarded ? '#/path' : '#/'; if (!S.me.user.onboarded) render(); return; }
        if (!path || path.status === 'failed') {
          mount(h('div.generating', h('h1', 'Non sono riuscito a creare il percorso'), h('p.lead', (path && path.error) || 'Riprova tra poco.'),
            h('div.row', h('button.btn.primary', { onclick: async () => { try { await api('POST', '/api/path/generate'); render(); } catch (e) { toast(e.message); } } }, 'Riprova'),
              h('a.btn', { href: '#/onboarding' }, 'Modifica le preferenze'))));
          return;
        }
      } catch (e) { /* keep polling */ }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2500);
    onLeave(() => { stop = true; clearInterval(tick); });
  }

  function weekTimeline(plan, pos) {
    return h('ol.timeline', plan.weeks.map((w) => {
      const state = pos && pos.started ? (w.week < pos.week || pos.finished ? 'done' : w.week === pos.week ? 'now' : '') : '';
      return h('li.tl-item', { class: state || null },
        h('div.tl-num', state === 'done' ? icon('check') : String(w.week)),
        h('div.tl-body',
          h('div.row', h('b', w.focus), state === 'now' && h('span.pill.accent', 'Questa settimana'), ...(w.structures || []).map((s) => h('span.pill', s))),
          h('p.small', w.objective),
          h('details', h('summary', 'Dettagli'),
            h('dl.kv',
              h('div', h('dt', 'Perché'), h('dd', w.why)),
              h('div', h('dt', 'Esercizio aggiuntivo'), h('dd', w.extra_exercise)),
              h('div', h('dt', 'Sfida reale'), h('dd', w.real_challenge)),
              h('div', h('dt', 'Registrazione'), h('dd', w.recording_prompt)),
              h('div', h('dt', 'Una correzione alla volta'), h('dd', w.tip))))));
    }));
  }

  function planBody(plan, pos) {
    const total = plan.routine.reduce((a, s) => a + s.minutes, 0);
    return h('div.stack-lg',
      h('div.stack', h('p.lead', plan.summary),
        h('div.card.quiet', h('div.eyebrow', 'Obiettivi'), h('ul.clean', { style: 'margin-top:8px' }, plan.goals.map((g) => h('li', g))))),
      h('section.stack', h('div.section-head', h('h2', 'Routine quotidiana'), h('span.muted.small', `${total} minuti`)),
        h('div.card', h('div.list', plan.routine.map((s, j) => h('div.list-item', h('div.icon-circle', String(j + 1)), h('div.grow', h('b', s.title), h('span.small.muted', s.instructions)), h('span.pill', `${s.minutes} min`)))))),
      h('section.stack', h('h2', `${plan.weeks.length} settimane`), weekTimeline(plan, pos)),
      plan.habits && plan.habits.length ? h('section.stack', h('h2', 'Le abitudini da portarti dietro'), h('ul.clean', plan.habits.map((x) => h('li', x)))) : null);
  }

  function viewPlanPreview(p) {
    const plan = p.plan;
    const start = h('button.btn.primary', {
      onclick: async () => {
        start.disabled = true;
        try { await api('POST', '/api/path/accept', { day: todayKey() }); await refreshMe(); location.hash = '#/'; render(); }
        catch (e) { toast(e.message); start.disabled = false; }
      },
    }, 'Inizia il percorso');
    mount(h('div.stack-lg',
      h('div.stack', h('div.eyebrow', 'Il tuo percorso'), h('h1', plan.title)),
      planBody(plan, null),
      h('div.onb-actions',
        h('button.btn.ghost', { onclick: () => { location.hash = '#/onboarding'; viewOnboarding({}); } }, 'Modifica le risposte'),
        h('div.row',
          h('button.btn', { onclick: async () => { try { await api('POST', '/api/path/generate'); S.me.path = { status: 'generating' }; render(); } catch (e) { toast(e.message); } } }, 'Rigenera'),
          start))));
  }

  async function viewPath() {
    mount(loading());
    const { path } = await api('GET', '/api/path');
    S.me.path = path;
    if (!path || path.status !== 'ready') { location.hash = path && path.status === 'generating' ? '#/generating' : '#/onboarding'; return; }
    if (!path.startDate) return viewPlanPreview(path);
    const pos = position(path.startDate, path.weeks);
    mount(h('div.stack-lg',
      h('div.stack',
        h('div.eyebrow', pos.finished ? 'Percorso completato' : `Settimana ${pos.week} di ${path.weeks}`),
        h('h1', path.plan.title),
        h('div.progress', h('span', { style: `width:${Math.min(100, Math.round(((pos.dayIndex + 1) / (path.weeks * 7)) * 100))}%` }))),
      planBody(path.plan, pos),
      h('div.card.quiet.stack',
        h('h3', 'Vuoi cambiare direzione?'),
        h('p.small.muted', 'Puoi modificare le preferenze e rigenerare il percorso. Quello attuale viene archiviato: le registrazioni restano nello storico.'),
        h('div.row', h('a.btn', { href: '#/onboarding' }, 'Modifica le preferenze e rigenera')))));
  }

  /* ================= today ================= */

  const openSteps = new Set(store.get('openSteps', []));

  async function viewToday() {
    let data;
    try { data = await api('GET', '/api/today?day=' + todayKey()); }
    catch (e) {
      if (e.code === 'no_path') { await refreshMe(); location.hash = S.me.path && S.me.path.status === 'generating' ? '#/generating' : '#/onboarding'; return; }
      if (e.code === 'not_started') { await refreshMe(); return viewPlanPreview(S.me.path); }
      throw e;
    }
    const M = S.meta;
    const { week, position: pos, stats } = data;
    const total = S.me.path ? S.me.path.weeks : data.position.week;
    const progressState = { stepsDone: data.progress.stepsDone.slice(), challengeDone: data.progress.challengeDone, routineDone: data.progress.routineDone };
    const c = data.content;

    async function saveProgress() {
      try {
        const r = await api('POST', '/api/today/progress', Object.assign({ day: data.day }, progressState));
        progressState.routineDone = r.routineDone;
        streakEl.textContent = r.streak.current ? `${r.streak.current} ${r.streak.current === 1 ? 'giorno' : 'giorni'} di fila` : 'Inizia la tua serie oggi';
        if (r.routineDone && !data.progress.routineDone) { toast('Routine completata. Ottimo lavoro.'); data.progress.routineDone = true; }
      } catch (e) { toast(e.message); }
    }

    const streakEl = h('span.pill', data.streak.current ? `${data.streak.current} ${data.streak.current === 1 ? 'giorno' : 'giorni'} di fila` : 'Inizia la tua serie oggi');
    const hero = h('section.hero',
      h('div.eyebrow', pos.finished ? 'Percorso completato' : `Settimana ${pos.week} di ${total} · giorno ${pos.dayIndex + 1}`),
      h('h1', week.focus),
      h('p.lead', week.objective),
      h('div.progress', h('span', { style: `width:${Math.min(100, Math.round(((pos.dayIndex + 1) / (total * 7)) * 100))}%` })),
      h('div.hero-meta', streakEl, h('span', `${stats.routineDays} su ${S.me.user.preferences.daysPerWeek} giorni di routine questa settimana`)));

    const cards = [];
    if (pos.finished) {
      cards.push(h('div.card.accent.stack', h('h2', 'Hai completato il percorso'), h('p', 'Confronta il punto zero con le registrazioni finali e scegli le abitudini da mantenere.'),
        h('div.row', h('a.btn.primary', { href: '#/progress' }, 'Vedi i progressi'), h('a.btn', { href: '#/onboarding' }, 'Crea un nuovo percorso'))));
    }

    // Point zero / final comparison
    const clipCard = (kind, done, title, text) => h('section.card.stack',
      h('div.section-head', h('h2', title), h('span.muted.small', `${done.length} di ${M.baselineClips.length}`)),
      h('p.small.muted', text),
      h('div.list', M.baselineClips.map((clip) => {
        const ok = done.includes(clip.key);
        return h('a.list-item', { href: ok ? '#/progress' : `#/record?kind=${kind}&key=${clip.key}` },
          h('div.icon-circle', ok ? icon('check') : icon('mic')),
          h('div.grow', h('b', `${clip.title} · ${clip.minutes} min`), h('span.small.muted', clip.prompt)),
          ok ? h('span.pill.good', 'Fatta') : h('span.btn.small', 'Registra'));
      })));
    if (stats.baselineDone.length < M.baselineClips.length) {
      cards.push(clipCard('baseline', stats.baselineDone, 'Il tuo punto zero', 'Tre registrazioni con il telefono o il computer: sono il riferimento con cui confronterai l\'ultima settimana.'));
    }
    if ((pos.week === total || pos.finished) && stats.finalDone.length < M.baselineClips.length) {
      cards.push(clipCard('final', stats.finalDone, 'Confronto finale', 'Rifai le tre registrazioni di partenza: vedrai quanto sei cambiato.'));
    }

    // Focus of the day
    cards.push(h('section.card.stack',
      h('div.eyebrow', 'Oggi pensa a una cosa sola'),
      c ? h('p.focus-quote', c.focus_tip) : h('div.skeleton', { style: 'height:22px;width:80%' }),
      h('p.small.muted', week.tip)));

    // Routine
    const stepsList = h('ul.steps');
    const placeholder = () => h('div.stack', h('div.skeleton', { style: 'width:90%' }), h('div.skeleton', { style: 'width:70%' }), h('p.small.muted', data.contentStatus === 'failed' ? '' : 'Sto preparando gli esercizi di oggi…'));
    function stepContent(s) {
      if (s.kind === 'breath') return breathPacer(s.minutes);
      if (!c) return placeholder();
      if (s.kind === 'twister') return h('ol.twisters', c.tongue_twisters.map((t) => h('li', t)));
      if (s.kind === 'reading') {
        const text = h('p.reading');
        c.reading.text.split(/\s\/\s?/).forEach((part, j, arr) => { text.appendChild(document.createTextNode(part)); if (j < arr.length - 1) text.appendChild(h('span.pause', { 'aria-label': 'pausa' }, ' / ')); });
        return h('div.stack', h('h3', c.reading.title), h('p.small.muted', 'Le barre / sono le pause. Il primo minuto con una penna tra i denti, poi senza.'), text);
      }
      if (s.kind === 'improv') return h('div.stack', h('div.words', c.improv_words.map((w) => h('span.word', w))), h('p.small.muted', 'Scegline una e parla per 60 secondi. Quando senti arrivare un "eh", fai una pausa muta.'), timer(1, 'Avvia 60 secondi'));
      if (s.kind === 'structure') {
        const st = M.structures.find((x) => x.id === c.structure_drill.structure);
        return h('div.stack',
          h('div.row', h('span.pill.accent', st ? st.name : c.structure_drill.structure), st && h('span.small.muted', st.scheme)),
          h('p.focus-quote', c.structure_drill.question),
          h('p.small', c.structure_drill.hint),
          h('div.row', h('a.btn.small', { href: '#/record?kind=practice&prompt=' + encodeURIComponent(c.structure_drill.question) }, icon('mic'), 'Rispondi registrandoti')));
      }
      if (s.kind === 'other' && c.extra) return h('p', c.extra);
      return null;
    }
    data.routine.forEach((s) => {
      const done = () => progressState.stepsDone.includes(s.id);
      const li = h('li.step', { class: done() ? 'done' : null });
      if (openSteps.has(s.id)) li.setAttribute('open', '');
      const check = h('button.check', {
        type: 'button', role: 'checkbox', 'aria-checked': String(done()), 'aria-label': `Segna "${s.title}" come fatto`,
        onclick: (e) => {
          e.stopPropagation();
          const k = progressState.stepsDone.indexOf(s.id);
          if (k >= 0) progressState.stepsDone.splice(k, 1); else progressState.stepsDone.push(s.id);
          check.setAttribute('aria-checked', String(done())); li.classList.toggle('done', done());
          saveProgress();
        },
      }, icon('check'));
      const body = h('div.step-body', h('p', s.instructions), stepContent(s), s.kind !== 'breath' && s.kind !== 'improv' && timer(s.minutes));
      body.hidden = !openSteps.has(s.id);
      const head = h('div.step-head', {
        role: 'button', tabindex: '0', 'aria-expanded': String(!body.hidden),
        onclick: () => toggle(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
      }, check, h('div.step-title', h('b', s.title), h('span', `${s.minutes} min`)), h('span', icon('chev')));
      head.querySelector('span:last-child svg').classList.add('chev');
      function toggle() {
        body.hidden = !body.hidden; head.setAttribute('aria-expanded', String(!body.hidden));
        if (body.hidden) { openSteps.delete(s.id); li.removeAttribute('open'); } else { openSteps.add(s.id); li.setAttribute('open', ''); }
        store.set('openSteps', [...openSteps]);
      }
      li.appendChild(head); li.appendChild(body);
      stepsList.appendChild(li);
    });
    const routineSection = h('section.stack',
      h('div.section-head', h('h2', 'Routine di oggi'), h('span.muted.small', `${data.routine.reduce((a, s) => a + s.minutes, 0)} minuti`)),
      data.contentStatus === 'failed' && h('div.notice.warn', h('span', data.contentError || 'Non sono riuscito a preparare gli esercizi.'), h('button.linkbtn', { onclick: async () => { try { await api('GET', '/api/today?retry=1&day=' + todayKey()); render(); } catch (e) { toast(e.message); } } }, 'Riprova')),
      stepsList);
    cards.push(routineSection);

    // Week: extra exercise + real challenge + weekly recording
    const chCheck = h('button.check', {
      type: 'button', role: 'checkbox', 'aria-checked': String(stats.challengeDone || progressState.challengeDone), 'aria-label': 'Sfida fatta',
      onclick: () => { progressState.challengeDone = !(chCheck.getAttribute('aria-checked') === 'true'); chCheck.setAttribute('aria-checked', String(progressState.challengeDone)); saveProgress(); },
    }, icon('check'));
    cards.push(h('section.grid-2',
      h('div.card.stack', h('div.eyebrow', 'Esercizio della settimana'), h('p', c ? c.extra : week.extra_exercise)),
      h('div.card.stack', h('div.eyebrow', 'Sfida reale'), h('p', week.real_challenge),
        h('div.row', chCheck, h('span.small', stats.challengeDone ? 'Fatta questa settimana' : 'Segna quando l\'hai fatta')))));

    if (stats.baselineDone.length >= M.baselineClips.length || pos.week > 1) {
      cards.push(stats.weeklyRecordingDone
        ? h('section.card.quiet.row.between', h('div', h('b', 'Registrazione della settimana fatta'), h('p.small.muted', 'Riascoltala e confrontala con le precedenti.')), h('a.btn.small', { href: '#/progress' }, 'Progressi'))
        : h('section.card.stack', { class: data.isRecordingDay ? 'accent' : null },
          h('div.row.between', h('div.eyebrow', 'Registrazione della settimana'), data.isRecordingDay && h('span.pill.accent', 'Oggi')),
          h('p.focus-quote', week.recording_prompt),
          h('p.small.muted', 'Circa 2 minuti. Dopo la registrazione vedrai velocità, intercalari e pause, e il coach AI ti darà una sola correzione su cui lavorare.'),
          h('div', h('a.btn.primary', { href: '#/record?kind=weekly' }, icon('mic'), 'Registra'))));
    }
    cards.push(h('p.small.muted', { style: 'text-align:center' }, 'Vuoi allenarti ancora? ', h('a', { href: '#/record?kind=practice' }, 'Registra una pratica libera')));

    mount(h('div.stack-lg', hero, ...cards));

    if (data.contentStatus === 'generating') {
      const t = setTimeout(() => { if (parseHash().parts[0] == null || parseHash().parts[0] === 'today') render(); }, 3500);
      onLeave(() => clearTimeout(t));
    }
  }

  /* ================= recorder ================= */

  async function viewRecord(q) {
    const M = S.meta;
    const kind = ['baseline', 'weekly', 'practice', 'final'].includes(q.get('kind')) ? q.get('kind') : 'practice';
    let prompt; let minutes = 2; let key = null;
    if (kind === 'baseline' || kind === 'final') {
      const clip = M.baselineClips.find((x) => x.key === q.get('key')) || M.baselineClips[0];
      prompt = clip.prompt; minutes = clip.minutes; key = clip.key;
    } else if (kind === 'weekly') {
      const p = S.me.path;
      const pos = p ? position(p.startDate, p.weeks) : null;
      prompt = p && p.plan ? p.plan.weeks[pos.week - 1].recording_prompt : 'Parla per due minuti del tuo lavoro.';
    } else {
      prompt = (q.get('prompt') || '').slice(0, 400) || 'Parla liberamente per uno o due minuti: racconta cosa hai fatto oggi, o spiega un\'idea a cui tieni.';
      minutes = 1;
    }
    const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const useBrowserSR = !!SR && !M.serverTranscription;
    const lang = S.me.user.preferences.speakingLang === 'en' ? 'en-US' : 'it-IT';

    const timeEl = h('div.rec-time', '0:00');
    const meter = h('div.meter', { 'aria-hidden': 'true' }, Array.from({ length: 24 }, () => h('i')));
    const live = h('p.live-transcript', useBrowserSR ? 'La trascrizione apparirà qui mentre parli.' : (M.serverTranscription ? 'La trascrizione arriverà dopo la registrazione.' : 'Il tuo browser non trascrive la voce: potrai scrivere il testo dopo.'));
    const btn = h('button.rec-btn', { type: 'button', 'aria-label': 'Inizia a registrare' }, icon('mic'));
    const status = h('p.small.muted', `Durata consigliata: ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}. Premi per iniziare.`);
    const cancel = h('a.btn.ghost', { href: kind === 'practice' ? '#/' : '#/' }, 'Annulla');

    mount(h('div.stack-lg',
      h('a.btn.ghost.small', { href: '#/', style: 'justify-self:start' }, icon('back'), 'Indietro'),
      h('div.stack', h('div.eyebrow', KIND_LABEL[kind]), h('p.focus-quote', { style: 'font-size:1.45rem' }, prompt)),
      supported
        ? h('div.card.recorder', timeEl, meter, btn, status, live)
        : h('div.notice.warn', 'Questo browser non permette di registrare. Usa una versione recente di Chrome, Edge, Firefox o Safari, su HTTPS.'),
      h('div.row', { style: 'justify-content:center' }, cancel)));
    if (!supported) return;

    let stream = null; let rec = null; let chunks = []; let t0 = 0; let tick = null; let raf = null; let ac = null; let sr = null;
    let finalText = ''; let interim = ''; let recording = false;

    function cleanup() {
      recording = false;
      clearInterval(tick); cancelAnimationFrame(raf);
      if (sr) { try { sr.onend = null; sr.stop(); } catch (e) { /* ignore */ } }
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      if (ac && ac.close) ac.close().catch(() => {});
    }
    onLeave(cleanup);

    function startSR() {
      if (!useBrowserSR) return;
      sr = new SR(); sr.lang = lang; sr.continuous = true; sr.interimResults = true;
      sr.onresult = (ev) => {
        interim = '';
        for (let k = ev.resultIndex; k < ev.results.length; k++) {
          if (ev.results[k].isFinal) finalText += ev.results[k][0].transcript.trim() + ' ';
          else interim += ev.results[k][0].transcript;
        }
        live.textContent = '';
        live.appendChild(document.createTextNode(finalText.split(' ').slice(-40).join(' ')));
        if (interim) live.appendChild(h('em', ' ' + interim));
      };
      sr.onerror = () => { /* network / no-speech: keep recording audio anyway */ };
      sr.onend = () => { if (recording) { try { sr.start(); } catch (e) { /* ignore */ } } }; // Chrome stops after silences
      try { sr.start(); } catch (e) { /* ignore */ }
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        status.textContent = 'Non ho accesso al microfono. Controlla i permessi del browser e riprova.';
        return;
      }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = finish;
      rec.start(1000);
      recording = true; t0 = Date.now();
      btn.classList.add('recording'); btn.textContent = ''; btn.appendChild(icon('stop')); btn.setAttribute('aria-label', 'Ferma la registrazione');
      status.textContent = 'Sto registrando. Premi di nuovo per terminare.';
      tick = setInterval(() => {
        const s = (Date.now() - t0) / 1000; timeEl.textContent = fmtTime(s);
        if (s >= 900) stop();
      }, 250);
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ac = new Ctx(); const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
        const buf = new Uint8Array(an.fftSize); const bars = meter.querySelectorAll('i'); const hist = new Array(bars.length).fill(0);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let acc = 0; for (let k = 0; k < buf.length; k++) { const v = (buf[k] - 128) / 128; acc += v * v; }
          hist.push(Math.min(1, Math.sqrt(acc / buf.length) * 4)); hist.shift();
          bars.forEach((b, k) => { b.style.height = `${4 + hist[k] * 40}px`; });
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) { /* meter is cosmetic */ }
      startSR();
    }

    function stop() {
      if (!rec || rec.state === 'inactive') return;
      recording = false;
      if (sr) { try { sr.onend = null; sr.stop(); } catch (e) { /* ignore */ } }
      rec.stop();
    }

    async function finish() {
      const duration = (Date.now() - t0) / 1000;
      cleanup();
      btn.disabled = true; btn.classList.remove('recording');
      if (duration < 3) { status.textContent = 'Registrazione troppo breve. Riprova.'; btn.disabled = false; btn.textContent = ''; btn.appendChild(icon('mic')); return; }
      // Let the last speech-recognition results arrive.
      await new Promise((r) => setTimeout(r, 600));
      const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] === 'audio/mp4' ? 'audio/mp4' : rec.mimeType || 'audio/webm' });
      status.textContent = 'Misuro pause e intonazione…';
      let audioMetrics = null;
      try { audioMetrics = await window.AudioMetrics.analyze(blob); } catch (e) { audioMetrics = null; }
      try {
        status.textContent = 'Salvo la registrazione…';
        const r = await api('POST', '/api/recordings', {
          kind, promptKey: key, prompt, durationSec: Math.round(duration * 10) / 10, transcript: (finalText + ' ' + interim).trim(), audioMetrics, day: todayKey(),
        });
        await api('PUT', `/api/recordings/${r.id}/audio`, blob);
        if (M.serverTranscription) {
          status.textContent = 'Trascrivo…';
          try { await api('POST', `/api/recordings/${r.id}/transcribe`); } catch (e) { toast('Trascrizione non riuscita: potrai scrivere il testo a mano.'); }
        }
        location.hash = `#/rec/${r.id}?new=1`;
      } catch (e) {
        status.textContent = e.message; btn.disabled = false; btn.textContent = ''; btn.appendChild(icon('mic'));
      }
    }

    btn.addEventListener('click', () => { if (recording) stop(); else start(); });
  }

  /* ================= recording detail ================= */

  function highlightFillers(text, byWord) {
    const p = h('p.transcript');
    const keys = Object.keys(byWord || {});
    if (!keys.length) { p.textContent = text; return p; }
    const alt = keys.sort((a, b) => b.length - a.length).map((k) => {
      if (k === 'eh') return 'e+h+'; if (k === 'ehm') return 'e+h+m+'; if (k === 'uhm') return 'u+h*m+';
      return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    });
    const re = new RegExp(`(^|[^\\p{L}])(${alt.join('|')})(?=$|[^\\p{L}])`, 'giu');
    let last = 0; let m;
    while ((m = re.exec(text))) {
      const s = m.index + m[1].length;
      p.appendChild(document.createTextNode(text.slice(last, s)));
      p.appendChild(h('mark', m[2]));
      last = s + m[2].length;
    }
    p.appendChild(document.createTextNode(text.slice(last)));
    return p;
  }

  function metricTiles(m) {
    const pitchWord = m.pitchStdSt == null ? '' : m.pitchStdSt < 1.5 ? 'piatta' : m.pitchStdSt > 3 ? 'espressiva' : 'moderata';
    const tile = (label, value, unit, sub) => h('div.tile', h('span.label', label), h('span.value', value, unit && h('small', unit)), sub && h('span.sub', sub));
    return h('div.tiles',
      tile('Velocità', fmtNum(m.words ? m.wpm : null), 'parole/min', 'obiettivo 130–160'),
      tile('Intercalari', fmtNum(m.words ? m.fillers.perMin : null, 1), '/min', m.words ? `${m.fillers.total} in totale · obiettivo sotto 3` : 'serve la trascrizione'),
      tile('Pause', fmtNum(m.pausesPerMin, 1), '/min', m.pausesPerMin != null ? `${m.longPauses || 0} lunghe (oltre 2 s)` : 'non misurate'),
      tile('Intonazione', fmtNum(m.pitchStdSt, 1), 'semitoni', pitchWord ? `voce ${pitchWord}` : 'non misurata'));
  }

  async function viewRecording(id, q) {
    mount(loading());
    let r = await api('GET', `/api/recordings/${encodeURIComponent(id)}`);
    const M = S.meta;
    // Back to the list if that is where the user came from, otherwise to the day in progress.
    const back = prevRoute === 'progress' ? { href: '#/progress', label: 'Progressi' } : { href: '#/', label: 'Oggi' };
    const box = h('div.stack-lg');
    mount(box);
    // Created once: redraws (evaluation, self-scores) keep the same player, so playback and position survive.
    const player = r.hasAudio ? audioPlayer(`/api/recordings/${r.id}/audio`) : null;

    function draw() {
      box.textContent = '';
      const m = r.metrics || {};
      const words = m.words || 0;
      // transcript card
      const tCard = h('section.card.stack');
      const drawTranscript = (editing) => {
        tCard.textContent = '';
        tCard.appendChild(h('div.section-head', h('h2', 'Trascrizione'),
          !editing && h('button.linkbtn', { onclick: () => drawTranscript(true) }, r.transcript ? 'Correggi' : 'Scrivi')));
        if (editing || !r.transcript) {
          const ta = h('textarea', { rows: '8', maxlength: '20000', 'aria-label': 'Trascrizione', value: r.transcript || '' });
          tCard.appendChild(h('p.small.muted', r.transcript ? 'Correggi le parole riconosciute male: velocità e intercalari si ricalcolano. Lascia gli "eh" e i "cioè" che hai detto davvero.' : 'Nessuna trascrizione automatica. Riascolta e scrivi cosa hai detto (anche gli "eh"): servono per misurare velocità e intercalari.'));
          tCard.appendChild(ta);
          tCard.appendChild(h('div.row',
            h('button.btn.primary.small', { onclick: async (e) => { e.target.disabled = true; try { r = await api('PATCH', `/api/recordings/${r.id}`, { transcript: ta.value }); draw(); toast('Trascrizione salvata.'); } catch (er) { toast(er.message); e.target.disabled = false; } } }, 'Salva'),
            r.transcript && h('button.btn.ghost.small', { onclick: () => drawTranscript(false) }, 'Annulla'),
            M.serverTranscription && r.hasAudio && h('button.btn.ghost.small', { onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Trascrivo…'; try { r = await api('POST', `/api/recordings/${r.id}/transcribe`); draw(); } catch (er) { toast(er.message); e.target.disabled = false; e.target.textContent = 'Trascrivi dall\'audio'; } } }, 'Trascrivi dall\'audio')));
        } else {
          tCard.appendChild(highlightFillers(r.transcript, m.fillers && m.fillers.byWord));
          if (m.fillers && m.fillers.total) tCard.appendChild(h('p.small.muted', 'Evidenziati gli intercalari: ' + Object.entries(m.fillers.byWord).map(([k, v]) => `"${k}" ×${v}`).join(', ')));
        }
      };
      drawTranscript(false);

      // grid card
      const ai = (r.evaluation && r.evaluation.scores) || {};
      const measured = m.measuredScores || {};
      const self = Object.assign({}, r.selfScores || {});
      const SOURCE = { ai: 'coach AI', measured: 'misurato', self: 'tu' };
      const grid = h('section.card.stack',
        h('div.section-head', h('h2', 'Griglia di valutazione'), r.avgScore != null && h('span.pill', `media ${fmtNum(r.avgScore, 1)}`)),
        h('p.small.muted', 'Velocità, intercalari e pause sono misurati; chiarezza, struttura e chiusura li valuta il coach; tono e dizione li valuti tu riascoltandoti.'),
        h('div', M.criteria.map((cr) => {
          const val = cr.source === 'ai' ? ai[cr.id] : cr.source === 'measured' ? measured[cr.id] : self[cr.id];
          const picker = cr.source === 'self'
            ? dots5(val, async (n) => { self[cr.id] = n; try { r = await api('PATCH', `/api/recordings/${r.id}`, { selfScores: self }); draw(); } catch (e) { toast(e.message); } }, cr.label)
            : dots5(val == null ? null : val, null, cr.label);
          return h('div.score-row', h('b', cr.label, h('span.source', SOURCE[cr.source])), picker, h('span.look', cr.look));
        })));

      // AI evaluation card
      const ev = r.evaluation;
      const aiCard = h('section.card.stack');
      if (ev) {
        add(aiCard, 
          h('div.section-head', h('h2', 'Il coach'), ev.structure_used && ev.structure_used.toLowerCase() !== 'nessuna' && h('span.pill.accent', ev.structure_used)),
          h('p', ev.summary),
          h('div.stack', h('div.eyebrow', 'La tua prossima correzione'), h('p.correction', ev.one_correction)),
          h('div.grid-2',
            h('div.stack', h('h3', 'Cosa funziona'), h('ul.clean', ev.strengths.map((x) => h('li', x)))),
            h('div.stack', h('h3', 'Cosa migliorare'), h('ul.clean', ev.improvements.map((x) => h('li', x))))),
          ev.better_opening && h('div.card.quiet.stack', h('div.eyebrow', 'Un\'apertura più forte'), h('p.serif', ev.better_opening)),
          h('div', h('button.btn.ghost.small', { onclick: evaluate }, 'Valuta di nuovo')));
      } else {
        add(aiCard, h('h2', 'Il coach'),
          h('p.muted', words >= 15 ? 'Il coach legge la trascrizione e i numeri misurati, dà i voti su chiarezza, struttura e chiusura e ti indica una sola correzione su cui lavorare.' : 'Serve una trascrizione di almeno 15 parole per la valutazione.'),
          h('div', h('button.btn.accent', { onclick: evaluate, disabled: words < 15 }, icon('sparkle'), 'Valuta con il coach AI')));
      }
      async function evaluate(e) {
        const b = e.currentTarget; b.disabled = true; b.textContent = ''; b.appendChild(h('span.spinner')); b.appendChild(document.createTextNode(' Il coach sta leggendo… (20-40 s)'));
        try { r = await api('POST', `/api/recordings/${r.id}/evaluate`); draw(); }
        catch (er) { toast(er.message); draw(); }
      }

      add(box, 
        h('div.row.between', h('a.btn.ghost.small', { href: back.href }, icon('back'), back.label), h('span.muted.small', fmtDate(r.createdAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))),
        h('div.stack', h('div.eyebrow', `${KIND_LABEL[r.kind]}${r.week ? ' · settimana ' + r.week : ''} · ${fmtTime(r.durationSec)}`), h('h1', { style: 'font-size:1.5rem' }, r.prompt)),
        player,
        metricTiles(m),
        tCard, aiCard, grid,
        h('div.row', { style: 'justify-content:space-between' },
          h('a.btn.primary', { href: back.href }, back.href === '#/' ? 'Torna a Oggi' : 'Torna ai progressi'),
          h('a.btn', { href: `#/record?kind=${r.kind === 'weekly' ? 'practice' : r.kind}${r.promptKey ? '&key=' + r.promptKey : ''}&prompt=${encodeURIComponent(r.prompt)}` }, icon('mic'), 'Registra di nuovo'),
          h('button.btn.ghost.danger', { onclick: async () => { if (!confirm('Eliminare questa registrazione?')) return; try { await api('DELETE', `/api/recordings/${r.id}`); toast('Registrazione eliminata.'); location.hash = back.href; } catch (e) { toast(e.message); } } }, icon('trash'), 'Elimina')));
    }
    draw();
    if (q.get('new') === '1' && (r.metrics.words || 0) >= 15 && !r.evaluation) {
      history.replaceState(null, '', `#/rec/${r.id}`);
      const b = box.querySelector('.btn.accent');
      if (b) b.click();
    }
  }

  /* ================= progress ================= */

  async function viewProgress() {
    $app.classList.add('wide');
    mount(loading());
    let data;
    try { data = await api('GET', '/api/progress'); }
    catch (e) { if (e.code === 'no_path') { location.hash = '#/onboarding'; return; } throw e; }
    const withText = data.series.filter((s) => s.wpm != null);
    const first = withText[0]; const last = withText[withText.length - 1];
    const totalRoutine = data.weeks.reduce((a, w) => a + w.routineDays, 0);

    const delta = (a, b, betterLower, digits = 0, inBand) => {
      if (a == null || b == null || first === last) return null;
      const d = b - a;
      if (Math.abs(d) < Math.pow(10, -digits)) return h('span.delta', 'invariato');
      const good = inBand ? inBand(b) >= inBand(a) : betterLower ? d < 0 : d > 0;
      return h('span.delta', { class: good ? 'good' : 'bad' }, `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d), digits)} dall'inizio`);
    };
    const bandCloseness = (v) => -(v < 130 ? 130 - v : v > 160 ? v - 160 : 0);
    const tile = (label, value, unit, extra) => h('div.tile', h('span.label', label), h('span.value', value, unit && h('small', unit)), extra && h('span.sub', extra));

    const chartCard = (title, sub, points, opts) => {
      const holder = h('div');
      const tableRows = points.map((p) => h('tr', h('td', fmtDate(p.x, { day: 'numeric', month: 'short' })), h('td', p.label || ''), h('td.num', opts.format(p.y))));
      const card = h('section.card.stack', h('div', h('h3', title), h('p.small.muted', sub)), holder,
        h('details', h('summary.small.muted', 'Mostra i dati'), h('div.table-scroll', h('table.grid-table', h('thead', h('tr', h('th', 'Data'), h('th', 'Registrazione'), h('th.num', title))), h('tbody', tableRows)))));
      requestAnimationFrame(() => window.Charts.line(holder, Object.assign({ points, title }, opts)));
      return card;
    };
    const lbl = (s) => `${KIND_LABEL[s.kind]}${s.week ? ' · sett. ' + s.week : ''}`;

    const content = [];
    content.push(h('div.stack', h('div.eyebrow', 'Progressi'), h('h1', 'Come sta cambiando la tua voce')));
    if (!data.series.length) {
      content.push(h('div.card.empty', h('div.icon-circle', icon('mic')), h('h2', 'Ancora nessuna registrazione'), h('p', 'Registra il tuo punto zero: è il riferimento per vedere i progressi.'), h('a.btn.primary', { href: '#/record?kind=baseline&key=explain' }, 'Inizia dal punto zero')));
      return mount(h('div.stack-lg', content));
    }
    content.push(h('div.tiles',
      tile('Velocità', fmtNum(last && last.wpm), 'parole/min', delta(first && first.wpm, last && last.wpm, false, 0, bandCloseness) || 'obiettivo 130–160'),
      tile('Intercalari', fmtNum(last && last.fillersPerMin, 1), '/min', delta(first && first.fillersPerMin, last && last.fillersPerMin, true, 1) || 'obiettivo sotto 3'),
      tile('Voto medio', fmtNum(last && last.avgScore, 1), 'su 5', delta(first && first.avgScore, last && last.avgScore, false, 1)),
      tile('Routine', fmtNum(totalRoutine), totalRoutine === 1 ? 'giorno' : 'giorni', `${data.series.length} registrazioni`)));

    // AI insight
    const insightCard = h('section.card.accent.stack');
    const drawInsight = (ins) => {
      insightCard.textContent = '';
      if (ins) {
        add(insightCard, h('div.section-head', h('div.eyebrow', 'Lettura del coach'), h('span.small.muted', fmtDate(ins.createdAt))),
          h('p.focus-quote', ins.headline),
          h('ul.clean', ins.trends.map((t) => h('li', t))),
          ins.keep.length ? h('p.small', h('b', 'Continua così: '), ins.keep.join(' · ')) : null,
          h('p', h('b', 'Prossimo focus: '), ins.next_focus),
          ins.stale && h('div', h('button.btn.small', { onclick: makeInsight }, 'Aggiorna con le nuove registrazioni')));
      } else {
        add(insightCard, h('h2', 'Cosa dicono i numeri?'), h('p.small', 'Il coach AI confronta le tue registrazioni, dall\'inizio a oggi, e ti dice cosa sta funzionando e su cosa concentrarti.'),
          h('div', h('button.btn.accent', { onclick: makeInsight, disabled: withText.length < 2 }, icon('sparkle'), withText.length < 2 ? 'Servono almeno 2 registrazioni' : 'Leggi i miei progressi')));
      }
    };
    async function makeInsight(e) {
      const b = e.currentTarget; b.disabled = true; b.textContent = ''; b.appendChild(h('span.spinner')); b.appendChild(document.createTextNode(' Analizzo…'));
      try { drawInsight(await api('POST', '/api/progress/insight', { day: todayKey() })); } catch (er) { toast(er.message); drawInsight(data.insight); }
    }
    drawInsight(data.insight);
    content.push(insightCard);

    content.push(h('div.grid-charts',
      chartCard('Parole al minuto', 'La fascia è l\'obiettivo: 130–160.', withText.map((s) => ({ x: s.date, y: s.wpm, label: lbl(s) })), { format: (v) => fmtNum(v), band: [130, 160], bandLabel: 'obiettivo', unit: 'parole/min' }),
      chartCard('Intercalari al minuto', 'Più basso è meglio: sotto 3 al minuto.', withText.map((s) => ({ x: s.date, y: s.fillersPerMin, label: lbl(s) })), { format: (v) => fmtNum(v, 1), band: [0, 3], bandLabel: 'obiettivo', yMin: 0, unit: '/min' }),
      chartCard('Voto medio', 'Media della griglia (misurato, coach, autovalutazione).', data.series.filter((s) => s.avgScore != null).map((s) => ({ x: s.date, y: s.avgScore, label: lbl(s) })), { format: (v) => fmtNum(v, 1), yMin: 1, yMax: 5, unit: 'su 5' }),
      chartCard('Pause al minuto', 'Pause intenzionali: circa 6–16 al minuto.', data.series.filter((s) => s.pausesPerMin != null).map((s) => ({ x: s.date, y: s.pausesPerMin, label: lbl(s) })), { format: (v) => fmtNum(v, 1), band: [6, 16], bandLabel: 'obiettivo', yMin: 0, unit: '/min' })));

    // point zero vs final
    const M = S.meta;
    content.push(h('section.stack', h('h2', 'Punto zero e confronto finale'),
      h('div.grid-2', data.comparison.map((c) => {
        const col = (label, s) => h('div.stack', h('div.eyebrow', label),
          s ? h('div.stack',
            h('span.small', `${fmtNum(s.wpm)} parole/min · ${fmtNum(s.fillersPerMin, 1)} intercalari/min`),
            s.hasAudio && audioPlayer(`/api/recordings/${s.id}/audio`),
            h('a.small', { href: `#/rec/${s.id}` }, 'Dettagli'))
            : h('span.small.muted', label === 'Inizio' ? 'Non ancora registrata' : 'Nell\'ultima settimana'));
        const clip = M.baselineClips.find((x) => x.key === c.key);
        return h('div.card.stack', h('h3', `${c.title} · ${clip.minutes} min`), col('Inizio', c.baseline), h('hr.divider'), col('Fine', c.final),
          !c.baseline && h('a.btn.small', { href: `#/record?kind=baseline&key=${c.key}` }, 'Registra il punto zero'));
      }))));

    // weekly table, as in the program's tracking sheet
    content.push(h('section.card.stack', h('h2', 'Settimana per settimana'),
      h('div.table-scroll', h('table.grid-table',
        h('thead', h('tr', h('th', 'Sett.'), h('th', 'Focus'), h('th.num', `Routine (su ${data.daysPerWeek})`), h('th.num', 'Intercalari/min'), h('th.num', 'Parole/min'), h('th', 'Sfida reale'))),
        h('tbody', data.weeks.map((w) => h('tr',
          h('td', String(w.week)), h('td', w.focus), h('td.num', String(w.routineDays)), h('td.num', fmtNum(w.fillersPerMin, 1)), h('td.num', fmtNum(w.wpm)),
          h('td', w.challengeDone ? h('span.pill.good', 'Fatta') : h('span.muted', '—')))))))));

    // all recordings
    content.push(h('section.card.stack', h('h2', 'Registrazioni'),
      h('div.list', data.series.slice().reverse().map((s) => h('a.list-item', { href: `#/rec/${s.id}` },
        h('div.icon-circle', icon('wave')),
        h('div.grow', h('b', lbl(s)), h('span.small.muted', `${fmtDate(s.date)} · ${s.wpm != null ? fmtNum(s.wpm) + ' parole/min' : 'senza trascrizione'}`)),
        s.avgScore != null && h('span.pill', fmtNum(s.avgScore, 1)))))));

    mount(h('div.stack-lg', content));
  }

  /* ================= guide ================= */

  function viewGuide() {
    const M = S.meta;
    mount(h('div.stack-lg',
      h('div.stack', h('div.eyebrow', 'Guida'), h('h1', 'Il metodo in breve'), h('p.lead', 'Parlare bene è soprattutto pensare in ordine. Queste sono le strutture, le frasi e gli errori su cui lavora il percorso.')),
      h('section.stack', h('h2', 'Strutture per organizzare il pensiero'),
        h('div.grid-2', M.structures.map((s) => h('div.card.stack', h('div.row.between', h('h3', s.name), h('span.pill', s.id)), h('p.small.muted', s.when), h('p', h('b', s.scheme)), h('p.serif', s.example))))),
      h('section.card.stack', h('h2', 'La griglia di valutazione'),
        h('div.table-scroll', h('table.grid-table', h('thead', h('tr', h('th', 'Criterio'), h('th', 'Cosa osservare'), h('th', 'Chi lo valuta'))),
          h('tbody', M.criteria.map((c) => h('tr', h('td', h('b', c.label)), h('td', c.look), h('td', { class: 'muted' }, { ai: 'coach AI', measured: 'misurato', self: 'tu' }[c.source]))))))),
      h('section.card.stack', h('h2', 'Frasi pronte per le riunioni'),
        h('div.table-scroll', h('table.grid-table', h('tbody', M.phrases.map((p) => h('tr', h('td', h('b', p.situation)), h('td.serif', p.phrase))))))),
      h('section.card.stack', h('h2', 'Errori comuni e correzioni'),
        h('div.table-scroll', h('table.grid-table', h('thead', h('tr', h('th', 'Errore'), h('th', 'Come lo riconosci'), h('th', 'Correzione'))),
          h('tbody', M.errors.map((e) => h('tr', h('td', h('b', e.error)), h('td', e.sign), h('td', e.fix)))))))));
  }

  /* ================= settings ================= */

  function viewSettings() {
    const u = S.me.user; const prov = S.me.providers; const linked = S.me.linked || [];
    const prefs = Object.assign({}, u.preferences);
    const savePref = async (k, v) => {
      prefs[k] = v;
      try { const r = await api('PUT', '/api/preferences', { preferences: prefs }); S.me.user.preferences = r.preferences; toast('Salvato.'); } catch (e) { toast(e.message); }
    };
    const row = (title, sub, control) => h('div.rating-row', h('div', h('b', title), sub && h('p.small.muted', sub)), control);
    mount(h('div.stack-lg',
      h('div.stack', h('div.eyebrow', 'Impostazioni'), h('h1', u.name)),
      h('section.card.stack',
        h('h2', 'Percorso'),
        u.hasPreferences
          ? row('Preferenze del percorso', `${(prefs.goals || []).length} obiettivi · ${prefs.minutesPerDay} min al giorno · ${prefs.weeks} settimane`, h('a.btn.small', { href: '#/onboarding' }, 'Modifica'))
          : row('Preferenze', 'Non ancora impostate', h('a.btn.small', { href: '#/onboarding' }, 'Imposta')),
        u.hasPreferences && row('Tono del feedback', null, segmented([{ v: 'encouraging', l: 'Incoraggiante' }, { v: 'direct', l: 'Diretto' }], prefs.feedbackTone, (v) => savePref('feedbackTone', v))),
        u.hasPreferences && row('Giorno della registrazione', null, segmented([1, 2, 3, 4, 5, 6, 0].map((v) => ({ v, l: ['D', 'L', 'M', 'M', 'G', 'V', 'S'][v] })), prefs.recordingDay, (v) => savePref('recordingDay', v)))),
      h('section.card.stack',
        h('h2', 'Aspetto'),
        row('Tema', null, segmented([{ v: 'system', l: 'Sistema' }, { v: 'light', l: 'Chiaro' }, { v: 'dark', l: 'Scuro' }], window.Theme.get(), (v) => window.Theme.set(v)))),
      h('section.card.stack',
        h('h2', 'Account'),
        u.email && row('Email', u.email, h('span')),
        ['google', 'facebook'].filter((p) => prov[p]).map((p) => row(p === 'google' ? 'Google' : 'Facebook', linked.includes(p) ? 'Collegato' : 'Collega anche questo account per entrare in entrambi i modi',
          linked.includes(p) ? h('span.pill.good', 'Collegato') : h('a.btn.small', { href: `/auth/${p}?link=1` }, 'Collega'))),
        row('AI', `${S.meta.ai.provider === 'anthropic' ? 'Claude' : 'Modello OpenAI-compatibile'} · ${S.meta.ai.model}${S.meta.serverTranscription ? ' · trascrizione sul server' : ' · trascrizione nel browser'}`, h('span')),
        h('div.row',
          h('button.btn', { onclick: async () => { await api('POST', '/api/auth/logout'); S.me = await api('GET', '/api/me'); location.hash = ''; render(); } }, 'Esci'),
          h('button.btn.ghost.danger', {
            onclick: async () => {
              if (!confirm('Eliminare l\'account? Percorsi, registrazioni e progressi saranno cancellati definitivamente.')) return;
              try { await api('DELETE', '/api/me'); store.del('onb'); store.del('onbStep'); S.me = await api('GET', '/api/me'); location.hash = ''; render(); } catch (e) { toast(e.message); }
            },
          }, 'Elimina account'))),
      h('p.small.muted', { style: 'text-align:center' }, 'Le registrazioni restano nel tuo account. L\'audio non viene inviato all\'AI: il coach legge solo la trascrizione e i numeri misurati.')));
  }

  /* ================= boot ================= */

  async function boot() {
    mount(loading());
    try {
      [S.me, S.meta] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/meta')]);
    } catch (e) {
      mount(errorBox(e, boot));
      return;
    }
    if (S.me.user && location.search.includes('auth_error')) {
      const err = new URLSearchParams(location.search).get('auth_error');
      history.replaceState(null, '', '/' + location.hash);
      if (AUTH_ERRORS[err]) setTimeout(() => toast(AUTH_ERRORS[err]), 300);
    }
    window.addEventListener('hashchange', render);
    render();
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  boot();
})();
