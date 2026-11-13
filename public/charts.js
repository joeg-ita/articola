// Small line charts in inline SVG. One measure per chart (never two y-axes), a 2px line, 8px markers ringed by
// the surface, an optional target band, recessive grid, and a crosshair + tooltip on hover/touch/keyboard.
// Colours come from CSS variables, so light and dark themes are handled by the stylesheet.
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  function niceTicks(lo, hi, count) {
    const span = hi - lo || 1;
    const step0 = span / count; const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }

  // opts: { points: [{x: Date|string, y: number, label?: string}], format(y), yMin, yMax, band: [lo, hi], bandLabel, unit }
  function line(container, opts) {
    container.textContent = '';
    const pts = opts.points.filter((p) => typeof p.y === 'number');
    if (pts.length === 0) { const e = document.createElement('p'); e.className = 'chart-empty'; e.textContent = 'Ancora nessun dato.'; container.appendChild(e); return; }
    const W = 640; const H = 220; const M = { t: 14, r: 16, b: 28, l: 40 };
    const fmt = opts.format || ((v) => String(v));
    const ys = pts.map((p) => p.y).concat(opts.band || []);
    let lo = opts.yMin != null ? opts.yMin : Math.min(...ys); let hi = opts.yMax != null ? Math.max(opts.yMax, Math.max(...ys)) : Math.max(...ys);
    if (opts.yMin == null) lo = Math.max(0, lo - (hi - lo || 10) * 0.15);
    if (opts.yMax == null) hi = hi + (hi - lo || 10) * 0.15;
    const xs = pts.map((p) => new Date(p.x).getTime());
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    const X = (t) => (x1 === x0 ? (M.l + W - M.r) / 2 : M.l + ((t - x0) / (x1 - x0)) * (W - M.l - M.r));
    const Y = (v) => M.t + (1 - (v - lo) / (hi - lo || 1)) * (H - M.t - M.b);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opts.title || (window.I18N ? window.I18N.t('Grafico') : 'Grafico') });
    // grid + y ticks
    for (const t of niceTicks(lo, hi, 4)) {
      svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t), class: 'grid' }));
      const tx = el('text', { x: M.l - 8, y: Y(t) + 4, class: 'tick', 'text-anchor': 'end' }); tx.textContent = fmt(t); svg.appendChild(tx);
    }
    if (opts.band) {
      const [b0, b1] = opts.band;
      svg.appendChild(el('rect', { x: M.l, width: W - M.l - M.r, y: Y(Math.min(b1, hi)), height: Math.max(0, Y(Math.max(b0, lo)) - Y(Math.min(b1, hi))), class: 'band' }));
      if (opts.bandLabel) { const bl = el('text', { x: W - M.r - 6, y: Y(Math.min(b1, hi)) + 13, class: 'band-label', 'text-anchor': 'end' }); bl.textContent = opts.bandLabel; svg.appendChild(bl); }
    }
    // x labels: first and last date only (selective labelling)
    const dfmt = (t) => new Date(t).toLocaleDateString(window.I18N ? window.I18N.locale() : 'it-IT', { day: 'numeric', month: 'short' });
    const xl = el('text', { x: X(x0), y: H - 8, class: 'tick', 'text-anchor': x1 === x0 ? 'middle' : 'start' }); xl.textContent = dfmt(x0); svg.appendChild(xl);
    if (x1 !== x0) { const xr = el('text', { x: X(x1), y: H - 8, class: 'tick', 'text-anchor': 'end' }); xr.textContent = dfmt(x1); svg.appendChild(xr); }
    // line + markers
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', { d, class: 'series' }));
    const dots = pts.map((p, i) => { const c = el('circle', { cx: X(xs[i]), cy: Y(p.y), r: 4, class: 'dot' }); svg.appendChild(c); return c; });
    // direct label on the latest value
    const lastI = pts.length - 1;
    const lv = el('text', { x: Math.min(X(xs[lastI]), W - M.r - 2), y: Y(pts[lastI].y) - 10, class: 'value-label', 'text-anchor': X(xs[lastI]) > W - 60 ? 'end' : 'middle' });
    lv.textContent = fmt(pts[lastI].y); svg.appendChild(lv);
    // crosshair
    const cross = el('line', { y1: M.t, y2: H - M.b, class: 'crosshair', visibility: 'hidden' });
    svg.appendChild(cross);
    const hit = el('rect', { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: 'transparent', tabindex: '0', 'aria-label': 'Esplora i valori con le frecce' });
    svg.appendChild(hit);

    const wrap = document.createElement('div'); wrap.className = 'chart-wrap';
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true;
    wrap.appendChild(svg); wrap.appendChild(tip); container.appendChild(wrap);

    let active = -1;
    function show(i) {
      active = i;
      dots.forEach((c, j) => c.setAttribute('r', j === i ? 6 : 4));
      cross.setAttribute('x1', X(xs[i])); cross.setAttribute('x2', X(xs[i])); cross.setAttribute('visibility', 'visible');
      tip.textContent = '';
      const v = document.createElement('strong'); v.textContent = fmt(pts[i].y) + (opts.unit ? ' ' + opts.unit : '');
      const l = document.createElement('span'); l.textContent = new Date(xs[i]).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) + (pts[i].label ? ' · ' + pts[i].label : '');
      tip.appendChild(v); tip.appendChild(l); tip.hidden = false;
      const r = svg.getBoundingClientRect(); const px = (X(xs[i]) / W) * r.width;
      tip.style.left = Math.min(Math.max(px, 70), r.width - 70) + 'px';
      tip.style.top = Math.max(0, (Y(pts[i].y) / H) * r.height - 54) + 'px';
    }
    function hide() { active = -1; tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((c) => c.setAttribute('r', 4)); }
    function nearest(clientX) {
      const r = svg.getBoundingClientRect(); const vx = ((clientX - r.left) / r.width) * W;
      let best = 0; let bd = Infinity; xs.forEach((t, i) => { const dd = Math.abs(X(t) - vx); if (dd < bd) { bd = dd; best = i; } });
      return best;
    }
    hit.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    hit.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, Math.min(pts.length - 1, (active < 0 ? lastI : active) + (e.key === 'ArrowRight' ? 1 : -1)))); }
      if (e.key === 'Escape') hide();
    });
  }

  window.Charts = { line };
})();
