'use strict';
/* Balanced Fitness (formerly Roy Fitness) — single-file app. Data = build-time CSV snapshot (data.js) + entries added on this device (localStorage). */
// the kid copy (/fitness/kid/) shares this site's storage, so it uses its own keys
const NS = /\/kid\//.test(location.pathname) ? 'fitkid.' : 'fit.';
const LS_KEY = NS + 'local.v1', PC_KEY = NS + 'pc';
const LOGS = ['food', 'exercise', 'weight', 'bp', 'sleep', 'passes', 'active', 'habits', 'goals', 'settings'];
let SNAP = null, LOCAL = null, CFG = null, BASE = null;
let state = { tab: 'today', day: null };

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pdate = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => dstr(new Date());
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const addDays = (s, n) => { const d = pdate(s); d.setDate(d.getDate() + n); return dstr(d); };
const daysBetween = (a, b) => Math.round((pdate(b) - pdate(a)) / 864e5);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtD = s => { const d = pdate(s); return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; };
const fmtShort = s => { const d = pdate(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const n0 = v => v == null || v === '' || isNaN(v) ? null : Number(v);
const r1 = v => Math.round(v * 10) / 10;
const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

/* ---------- data ---------- */
const KEY = {
  food: e => [e.date, e.time, e.item, e.kcal].join('|'),
  exercise: e => [e.date, e.activity, e.minutes].join('|'),
  weight: e => [e.date, e.weight].join('|'),
  bp: e => [e.datetime, e.sys, e.dia].join('|'),
  sleep: e => [e.date, e.bed, e.wake, e.asleep].join('|'),
  passes: e => e.date,
  active: e => [e.date, e.kcal].join('|'),
  habits: e => [e.date, e.habit].join('|'),
  goals: e => [e.date, e.low, e.high, e.by].join('|'),
  settings: e => [e.date, e.key, e.value].join('|'),
};
function loadLocal() {
  try { LOCAL = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { LOCAL = {}; }
  LOGS.forEach(k => LOCAL[k] = LOCAL[k] || []);
}
function saveLocal() { localStorage.setItem(LS_KEY, JSON.stringify(LOCAL)); }
/** snapshot rows + local rows not already present in the snapshot (i.e. not yet merged back) */
function all(log) {
  const snap = (SNAP[log] || []).map(e => ({ ...e, local: false }));
  const keys = new Set(snap.map(KEY[log]));
  return snap.concat(LOCAL[log].filter(e => !keys.has(KEY[log](e))).map(e => ({ ...e, local: true })));
}
function pendingLocal(log) { const keys = new Set((SNAP[log] || []).map(KEY[log])); return LOCAL[log].filter(e => !keys.has(KEY[log](e))); }
function addLocal(log, e) { e._id = Date.now() + '-' + Math.random().toString(36).slice(2, 7); e._added = new Date().toISOString(); LOCAL[log].push(e); saveLocal(); }
function delLocal(log, id) { LOCAL[log] = LOCAL[log].filter(e => e._id !== id); saveLocal(); }

function dayTotals(date) {
  const food = all('food').filter(f => f.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const ex = all('exercise').filter(x => x.date === date);
  const kcal = sum(food, f => f.kcal), protein = sum(food, f => f.protein);
  const sodKnown = food.filter(f => f.sodium != null);
  const sodium = sum(sodKnown, f => f.sodium), sodEst = sodKnown.some(f => /est/i.test(f.sodiumNote || ''));
  const exKcal = sum(ex, x => x.kcal), act = activeFor(date);
  // Health total without what this app sent ("E" lines) + exercise the phone/watch didn't record (e.g. rowing)
  const own = act && act.source === EXCL, extra = own ? sum(ex.filter(x => !x.inHealth), x => x.kcal) : 0;
  const burn = act ? act.kcal + extra : exKcal;
  const carbKnown = food.filter(f => f.carbs != null), carbs = sum(carbKnown, f => f.carbs);
  return { food, ex, kcal, protein, sodium, sodUnknown: food.length - sodKnown.length, sodEst, carbs, carbUnknown: food.length - carbKnown.length, burn, exKcal, extra, healthKcal: act ? act.kcal : 0, activeSrc: act ? (own ? 'health+' : 'health') : 'logged', net: kcal - burn };
}
const EXCL = 'Apple Health (not from this app)';
/** that day's Apple Health Active Energy total: newest pull on this device, else the saved snapshot */
function activeFor(date) {
  const loc = LOCAL.active.filter(e => e.date === date).sort((a, b) => (a._added || '').localeCompare(b._added || '')).pop();
  return loc || (SNAP.active || []).find(e => e.date === date) || null;
}
const passFor = date => all('passes').find(p => p.date === date);
const passInMonth = ym => all('passes').find(p => p.date.slice(0, 7) === ym);

/* ---------- plan ---------- */
function planFor(date) {
  const P = SNAP.plan; if (!P) return null;
  const inRange = date >= (P.validFrom || '0000') && date <= (P.validThrough || '9999');
  const dn = DOW[pdate(date).getDay()], day = P.days[dn]; if (!day) return null;
  const ex = all('exercise').filter(x => x.date === date);
  // rest / therapy day: cardio drops to an easy 10–20 min walk and everything else becomes optional
  const rest = all('habits').some(h => h.date === date && h.habit === 'rest');
  const comps = day.components.map(cid => {
    const c0 = P.components[cid] || { name: cid, match: [] }, c = rest && cid === 'cardio' ? { ...c0, name: 'Easy walk 10–20 min', minMinutes: 10 } : c0;
    const hits = ex.filter(x => (c.match || []).some(k => x.activity.toLowerCase().includes(k)));
    const mins = sum(hits, h => h.minutes);
    let done = hits.length > 0 && (!c.minMinutes || mins >= c.minMinutes);
    const ticked = !!c.check && all('habits').some(h => h.date === date && h.habit === cid);
    if (ticked) done = true;
    return { id: cid, name: c.name, hits, mins, done, partial: hits.length > 0 && !done, min: c.minMinutes, check: !!c.check && (ticked || !done), date, optional: rest && cid !== 'cardio' };
  });
  const adds = (P.additions || []).filter(a => a.days.includes(dn) && date >= a.from);
  const upcoming = (P.additions || []).filter(a => a.days.includes(dn) && date < a.from);
  return { dn, day, comps, adds, upcoming, inRange, rest, rules: P.rules || [] };
}

function planIcon(cp) {
  const ic = `<span class="ic ${cp.done ? 'y' : 'n'}">${cp.done ? '✓' : ''}</span>`;
  return cp.check ? `<button class="tick" data-habit="${esc(cp.id)}" data-hdate="${cp.date}" aria-label="${cp.done ? 'Uncheck' : 'Check off'} ${esc(cp.name)}">${ic}</button>` : ic;
}
/* ---------- svg helpers ---------- */
function ring(val, target, color, label, unit, atLeast) {
  const pct = target ? val / target : 0, R = 52, C = 2 * Math.PI * R;
  const p1 = Math.min(pct, 1), p2 = Math.max(0, Math.min(pct - 1, 1));
  const over = !atLeast && pct > 1.0001, met = atLeast && pct >= 1;
  return `<div class="ring"><svg viewBox="0 0 130 130">
    <circle cx="65" cy="65" r="${R}" fill="none" style="stroke:var(--card2)" stroke-width="13"/>
    <circle cx="65" cy="65" r="${R}" fill="none" style="stroke:${color}" stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${p1 * C} ${C}" transform="rotate(-90 65 65)"/>
    ${p2 > 0 && !atLeast ? `<circle cx="65" cy="65" r="${R}" fill="none" style="stroke:var(--bad)" stroke-width="13" stroke-linecap="round" stroke-dasharray="${p2 * C} ${C}" transform="rotate(-90 65 65)"/>` : ''}
    <text x="65" y="62" text-anchor="middle" style="fill:var(--tx)" font-size="24" font-weight="700">${Math.round(val)}</text>
    <text x="65" y="82" text-anchor="middle" style="fill:var(--mut)" font-size="11">of ${target}${unit}</text></svg>
    <div class="lbl">${label}${over ? ' · <span style="color:var(--bad)">over</span>' : ''}${met ? ' · <span style="color:var(--ok)">✓</span>' : ''}</div></div>`;
}
function bar(val, target, color, overColor) {
  const pct = Math.min(val / target, 1.5), w = Math.min(pct / 1.5 * 100, 100);
  return `<div class="bar tick" style="--t:${100 / 1.5}%"><i style="width:${w}%;background:${val > target ? overColor : color}"></i></div>`;
}
/** generic line/point chart. series: [{pts:[[x,y]],color,line,dots,dash}], x = day index */
function chart({ w = 360, h = 190, x0, x1, y0, y1, series = [], bands = [], hlines = [], vlines = [], xlabels = [], ylabelsEvery, xfirst }) {
  const L = 32, R = 8, T = 10, B = 22;
  const X = x => L + (x - x0) / (x1 - x0 || 1) * (w - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0 || 1)) * (h - T - B);
  // press-and-hold data: series with a `tip` ({n: name, u: unit}); points are [x, y, value, label?] in chart pixels
  const sd = { L, r: w - R, T, b: h - B, x0, x1, first: xfirst || '', s: series.filter(sr => sr.tip && sr.pts.length).map(sr => ({ n: sr.tip.n || '', u: sr.tip.u || '', c: sr.color, dots: !!sr.dots,
    p: sr.pts.map(p => [r1(X(p[0])), r1(Y(p[1])), p[1], p[3] || '']) })) };
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}"${sd.s.length ? ` data-scrub="${esc(JSON.stringify(sd))}"` : ''}>`;
  const XL = v => v == null ? L : Math.max(L, Math.min(w - R, X(v)));  // clamp a partial range to the plot
  bands.forEach(b => s += `<rect x="${XL(b.x0)}" y="${Y(b.hi)}" width="${Math.max(0, (b.x1 == null ? w - R : XL(b.x1)) - XL(b.x0))}" height="${Math.max(1, Y(b.lo) - Y(b.hi))}" style="fill:${b.color}"/>`);
  const step = ylabelsEvery || Math.max(1, Math.round((y1 - y0) / 5));
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step)
    s += `<line x1="${L}" x2="${w - R}" y1="${Y(y)}" y2="${Y(y)}" style="stroke:var(--grid)"/><text x="${L - 4}" y="${Y(y) + 3}" text-anchor="end">${y}</text>`;
  hlines.forEach(l => { const a = XL(l.x0), b = l.x1 == null ? w - R : XL(l.x1);
    s += `<line x1="${a}" x2="${b}" y1="${Y(l.y)}" y2="${Y(l.y)}" style="stroke:${l.color}" stroke-dasharray="4 3"/>` + (l.label ? `<text x="${b}" y="${Y(l.y) - 3}" text-anchor="end" style="fill:${l.color}">${l.label}</text>` : ''); });
  vlines.forEach(l => s += `<line x1="${X(l.x)}" x2="${X(l.x)}" y1="${T}" y2="${h - B}" style="stroke:${l.color}" stroke-dasharray="2 3"/>` + (l.label ? `<text x="${X(l.x) + 3}" y="${l.ly || T + 9}" style="fill:${l.color}">${l.label}</text>` : ''));
  xlabels.forEach(l => s += `<text x="${X(l.x)}" y="${h - 6}" text-anchor="middle">${l.t}</text>`);
  series.forEach(sr => {
    if (sr.line && sr.pts.length > 1) s += `<polyline fill="none" style="stroke:${sr.color}" stroke-width="${sr.width || 2}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ''} points="${sr.pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}"/>`;
    if (sr.dots) sr.pts.forEach(p => s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${sr.r || 3.5}" style="fill:${p[2] || sr.color};stroke:var(--card)" stroke-width="1"/>`);
  });
  return s + '</svg>';
}
function barChart({ w = 360, h = 170, items, target, color, overColor, unit = '', max }) {
  // items: [{label, v, pass, hollow}]
  const L = 34, R = 6, T = 10, B = 22, n = items.length || 1;
  const ymax = max || Math.max(target * 1.3, ...items.map(i => i.v || 0)) * 1.05;
  const Y = y => T + (1 - y / ymax) * (h - T - B), bw = (w - L - R) / n;
  const sd = { L, r: w - R, T, b: h - B, bw, bars: items.map(it => ({ d: it.d ? fmtShort(it.d) : String(it.label), v: it.v, y: it.v == null ? null : r1(Y(it.v + (it.v2 || 0))), t: it.t || (it.v == null ? '' : `${it.v.toLocaleString()}${unit}`) })) };
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" data-scrub="${esc(JSON.stringify(sd))}">`;
  const raw = ymax / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw);
  for (let y = 0; y <= ymax; y += step) s += `<line x1="${L}" x2="${w - R}" y1="${Y(y)}" y2="${Y(y)}" style="stroke:var(--grid)"/><text x="${L - 4}" y="${Y(y) + 3}" text-anchor="end">${y}</text>`;
  items.forEach((it, i) => {
    const x = L + i * bw + bw * 0.15, bwi = bw * 0.7;
    // segs: stacked parts bottom to top ({v, c}), clipped to one rounded bar
    if (it.v != null && it.segs) { const id = 'bc' + Math.random().toString(36).slice(2, 8); let y0 = 0;
      s += `<clipPath id="${id}"><rect x="${x}" y="${Y(it.v)}" width="${bwi}" height="${Math.max(0, Y(0) - Y(it.v))}" rx="3"/></clipPath><g clip-path="url(#${id})">`;
      it.segs.forEach(g => { s += `<rect x="${x}" y="${Y(y0 + g.v)}" width="${bwi}" height="${Math.max(0, Y(y0) - Y(y0 + g.v))}" style="fill:${g.c}"/>`; y0 += g.v; });
      s += '</g>'; }
    else if (it.v != null) s += `<rect x="${x}" y="${Y(it.v)}" width="${bwi}" height="${Math.max(0, Y(0) - Y(it.v))}" rx="3" style="fill:${it.pass ? 'var(--acc)' : it.v > target ? overColor : color}" ${it.hollow ? 'opacity=".45"' : ''}/>`;
    if (it.v2) s += `<rect x="${x}" y="${Y(it.v + it.v2)}" width="${bwi}" height="${Y(0) - Y(it.v2)}" rx="3" style="fill:${it.c2}"/>`;
    if (n <= 16 || i % 2 === 0) s += `<text x="${x + bwi / 2}" y="${h - 6}" text-anchor="middle">${it.label}</text>`;
  });
  s += `<line x1="${L}" x2="${w - R}" y1="${Y(target)}" y2="${Y(target)}" style="stroke:var(--tx)" stroke-opacity=".6" stroke-dasharray="4 3"/><text x="${w - R}" y="${Y(target) - 3}" text-anchor="end" style="fill:var(--tx2)">${target}${unit}</text>`;
  return s + '</svg>';
}

/* ---------- BP ---------- */
function bpCat(s, d) {
  if (s > 180 || d > 120) return { k: 'crisis', t: 'Crisis-level', c: 'var(--crisis)', high: true };
  if (s >= 140 || d >= 90) return { k: 'bad', t: 'High · stage 2', c: 'var(--bad)', high: true };
  if (s >= 130 || d >= 80) return { k: 'warn', t: 'High · stage 1', c: 'var(--warn)', high: true };
  if (s >= 120) return { k: 'el', t: 'Elevated', c: 'var(--sod)', high: false };
  return { k: 'ok', t: 'Normal', c: 'var(--ok)', high: false };
}

/* ---------- views ---------- */
/** a short display name: no parentheses, sizes or add-ons ("Latte 16 oz decaf single shot with Lactaid" → "Latte decaf single shot") */
function shortName(n) {
  let s = String(n || '').replace(/\s*\([^)]*\)/g, '');
  const m = s.match(/^(dinner|lunch|breakfast|snack|seconds|dessert)\s*:\s*(.+)$/i); if (m) s = m[2];
  s = s.split(/,|;|:| w\/ | \+ | — | - /)[0];
  const w = s.split(/ with /i); if (w[0].length >= 14) s = w[0];
  s = s.replace(/\b\d+(\.\d+)?\s*(fl oz|oz|g|mg|ml|cups?|tbsp|tsp|lb|bags?|cans?|packs?|pkgs?|slices?|strips?|scoops?|pieces?|pcs?)\b/gi, '')
       .replace(/\b\d+\/\d+\s*(cups?|tbsp|tsp)?\b/gi, '').replace(/\s+/g, ' ').trim().replace(/^[-,.\s]+|[-,.\s]+$/g, '');
  return s ? s[0].toUpperCase() + s.slice(1) : n;
}
/** which values the front of a food card shows (this phone only) */
const FSHOW = [['time', 'Time'], ['kcal', 'kcal'], ['protein', 'Protein'], ['carbs', 'Carbs'], ['sodium', 'Sodium']];
function foodShow() { let v = null; try { v = JSON.parse(localStorage.getItem('fit.foodshow')); } catch {} return v && typeof v === 'object' ? v : { time: true, kcal: true }; }
let foodOpts = false;
function foodCard(t) {
  // every food is a small card: the short name up front, tap it to flip to the numbers
  const kid = !!CFG.kid, na = f => f.sodium != null ? f.sodium.toLocaleString() : '?';
  const stat = (v, c, l) => `<div><b class="${c}">${v}</b><span>${l}</span></div>`;
  const sh = foodShow(), opts = FSHOW.filter(([k]) => !kid || !['carbs', 'sodium'].includes(k));
  // numbers are colored like the rings and bars above (protein blue, carbs pink, sodium amber, kcal green), so no units are needed
  const extra = f => [sh.protein ? `<span class="cp">${f.protein}</span>` : '', !kid && sh.carbs ? `<span class="cc">${f.carbs ?? '?'}</span>` : '', !kid && sh.sodium ? `<span class="cs">${na(f)}</span>` : ''].filter(Boolean);
  const tile = f => `<div class="flipcard ftile" data-tile role="button" tabindex="0" aria-label="${esc(f.item)}: show nutrition"><div class="flip-in">
      <div class="face tf"><div class="fn">${f.qty && f.qty !== 1 ? `<span class="fq">${f.qty}×</span> ` : ''}${esc(shortName(f.item))}</div>
        <div>${extra(f).length ? `<div class="fx">${extra(f).join('')}</div>` : ''}
        ${sh.time || sh.kcal || f.local ? `<div class="fm"><span>${sh.time ? esc(f.time) : ''}${f.local ? ' <i class="dot" title="new on this phone"></i>' : ''}</span>${sh.kcal ? `<b class="ck">${f.kcal}</b>` : ''}</div>` : ''}</div></div>
      <div class="face back tb"><div class="ff">${esc(f.item)}</div>
        <div class="fs">${stat(f.protein, 'cp', 'protein')}${kid ? stat(f.kcal, 'ck', 'kcal') : stat(f.carbs ?? '?', 'cc', 'carbs') + stat(na(f), 'cs', 'sodium')}</div></div>
    </div></div>`;
  return `<div class="card"><h3 class="row" style="align-items:center">Food <span style="display:flex;align-items:center;gap:8px"><small>${t.food.length ? `${t.food.length} item${t.food.length === 1 ? '' : 's'} · ${t.kcal.toLocaleString()} kcal` : ''}</small><button class="tipbtn gear${foodOpts ? ' on' : ''}" data-foodopts aria-label="Choose what food cards show">⚙︎</button></span></h3>
    ${foodOpts ? `<div class="chips">${opts.map(([k, l]) => `<button class="chip${sh[k] ? ' on' : ''}" data-fshow="${k}" aria-pressed="${!!sh[k]}">${l}</button>`).join('')}</div>` : ''}${t.food.length ? `<div class="ftiles">${t.food.map(tile).join('')}</div><div class="flegend">${[['ck', 'kcal', sh.kcal], ['cp', 'protein g', sh.protein], ['cc', 'carbs g', !kid && sh.carbs], ['cs', 'sodium mg', !kid && sh.sodium]].filter(x => x[2]).map(([c, l]) => `<span><i class="${c}"></i>${l}</span>`).join('')}<span>tap to flip</span></div>` : '<div class="mut">Nothing logged.</div>'}</div>`;
}
/** a card heading with an ⓘ that opens its notes ([kind, text] pairs, text is HTML) */
const tipBtn = (tips, label = 'Notes') => tips.length ? `<button class="tipbtn" data-flip aria-label="${label}">i</button><template class="flipnotes">${typeof tips === 'string' ? tips : tips.map(([k, t]) => `<div class="note ${k}">${t}</div>`).join('')}</template>` : '';
const tipH3 = (title, small, tips, label) => `<h3 class="row" style="align-items:center">${title}<span style="display:flex;align-items:center;gap:6px">${small ? `<small>${small}</small>` : ''}${tipBtn(tips, label)}</span></h3>`;
function exCard(t) {
  if (CFG.exerciseInput === false) return `<div class="card">${tipH3('Activity', 'from Apple Health', [['', 'Exercise is tracked by your RingConn ring and iPhone, not entered here.']], 'About activity')}${t.activeSrc !== 'logged' ? `<div>Active energy: <b>${t.healthKcal} kcal</b>${t.extra ? ` <span class="sm mut">+ ${t.extra} logged here earlier</span>` : ''}</div>` : '<div class="mut">Nothing pulled for this day yet. Tap ⇪ → Pull from Health.</div>'}
${t.ex.length ? `<ul class="list">${t.ex.map(x => `<li><span class="m"><div class="n">${esc(x.activity)}</div><div class="s">${x.minutes ?? '?'} min</div></span><span class="v">${x.kcal ?? '–'} kcal</span></li>`).join('')}</ul>` : ''}</div>`;
  return `<div class="card"><h3>Exercise <small>${t.exKcal} kcal logged</small></h3>${t.activeSrc === 'health+' ? `<div class="note" style="margin:0 0 8px">Active for net: <b>${t.burn} kcal</b> = Apple Health ${t.healthKcal}${t.extra ? ` + ${t.extra} logged here that iPhone/Watch didn't record` : ''}</div>` : t.activeSrc === 'health' ? `<div class="note warn" style="margin:0 0 8px">Apple Health Active Energy: <b>${t.burn} kcal</b>, used for net instead of the logged total. Update the “Health to Fitness” shortcut (setup guide, Active Energy step) so exercise sent from this app isn't lost.</div>` : ''}${t.ex.length ? `<ul class="list">${t.ex.map(x => `<li><span class="m"><div class="n">${esc(x.activity)}${x.local ? '<span class="pill local">new</span>' : ''}${x.inHealth ? '<span class="pill">iPhone/Watch</span>' : ''}</div><div class="s">${x.minutes ?? '?'} min</div></span><span class="v">${x.kcal ?? '–'} kcal</span></li>`).join('')}</ul>` : '<div class="mut">No exercise logged.</div>'}</div>`;
}
/** weight goals over time: [{date, low, high, by}], first from config, then changes from the goals log */
function goalHistory() {
  const c = CFG, out = [{ date: c.startDate, low: c.weightGoalLow, high: c.weightGoalHigh, by: c.goalDate }];
  all('goals').slice().sort((a, b) => a.date.localeCompare(b.date) || (a._added || '').localeCompare(b._added || '')).forEach(g => {
    const e = { date: g.date, low: g.low, high: g.high ?? g.low, by: g.by || out[out.length - 1].by };
    if (out[out.length - 1].date === e.date) out[out.length - 1] = e; else out.push(e);
  });
  return out;
}
/** latest value of a setting from the settings log (the last change wins), else the fallback */
function setting(k, fb) { const v = all('settings').filter(e => e.key === k).sort((a, b) => a.date.localeCompare(b.date) || (a._added || '').localeCompare(b._added || '')).pop(); return v ? v.value : fb; }
const sleepTarget = () => Number(setting('sleep_target_h', CFG.sleepTargetLow || 7)) || 7;
function openSleepTarget() {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Sleep target</b><button class="iconbtn" data-close>✕</button></div>
    <form class="f" id="sleepTargetForm"><label>Hours asleep per night</label><input name="h" type="number" step="0.25" min="4" max="12" inputmode="decimal" required value="${sleepTarget()}">
    <div class="sm mut">Used for the chart line and the history bars.</div><button class="btn" type="submit">Save target</button></form></div>`;
  sh.classList.remove('hidden');
}
function saveSleepTarget(form) {
  const h = Number(new FormData(form).get('h'));
  if (!(h >= 4 && h <= 12)) return toast('Pick between 4 and 12 hours');
  const d = todayStr(); LOCAL.settings.filter(x => x.date === d && x.key === 'sleep_target_h').forEach(x => delLocal('settings', x._id));
  addLocal('settings', { date: d, key: 'sleep_target_h', value: String(h) }); closeSheet(); toast('Sleep target saved'); render();
}
/* ---------- daily targets (calories, protein, sodium): config has the starting values, the settings log the changes ---------- */
const TGT = [['kcalTarget', 'kcal_target'], ['proteinTarget', 'protein_target_g'], ['sodiumTarget', 'sodium_target_mg'], ['bpSys', 'bp_target_sys'], ['bpDia', 'bp_target_dia'], ['bpStepSys', 'bp_step_sys'], ['bpStepDia', 'bp_step_dia']];
const TGT_DEF = { bpSys: 130, bpDia: 80, bpStepSys: 120, bpStepDia: 80 };
function applyTargets() { if (BASE) TGT.forEach(([c, k]) => { const v = Number(setting(k, BASE[c] ?? TGT_DEF[c])); if (v > 0) CFG[c] = v; }); }
const round = (v, n) => Math.round(v / n) * n;
function targetPresets() {
  const ws = all('weight').slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))), lb = ws.length ? ws[ws.length - 1].weight : CFG.startWeight, kg = lb / 2.20462;
  const age = CFG.birthYear ? new Date().getFullYear() - CFG.birthYear : 45, cm = (CFG.heightIn || 66) * 2.54;
  // Mifflin–St Jeor resting burn; active energy is subtracted separately, so "net" maintenance is about resting × 1.1 (digestion, small moves)
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (CFG.sex === 'female' ? -161 : 5), maint = round(bmr * 1.1, 10);
  const g = goalHistory().pop(), days = g && g.by ? (pdate(g.by) - pdate(todayStr())) / 864e5 : 0, toLose = g ? lb - g.high : 0;
  const goalNet = days > 7 && toLose > 0 ? round(maint - toLose * 3500 / days, 10) : null;
  return {
    lb: r1(lb), maint,
    kcalTarget: [[maint, 'Maintain weight'], [maint - 250, 'Lose ½ lb/week'], [maint - 500, 'Lose 1 lb/week'],
      ...(goalNet ? [[goalNet, `Reach ${goalTxt(g)} lb by ${fmtShort(g.by)}${goalNet < 1200 ? ' (stretch)' : ''}`]] : [])],
    proteinTarget: [[round(kg * 0.8, 5), 'Adult minimum (0.8 g/kg)'], [round(kg * 1.2, 5), '50+ or active (1.2 g/kg)'],
      [round(kg * 1.6, 5), 'Keep muscle while losing (1.6 g/kg)'], [round(kg * 2.0, 5), 'Build muscle (2.0 g/kg)']],
    sodiumTarget: [[1500, 'High BP (American Heart Assn. ideal)'], [2300, 'Normal BP (US Dietary Guidelines)']],
    bp: [['Not on BP medication', [['120/80|normal', 'Normal range'], ['130/80|nomeds', 'Stay out of high BP (ACC/AHA)']]],
      ['On BP medication', [['130/80|meds', 'Standard goal (ACC/AHA)'], ['120/80|meds-int', 'Intensive, if tolerated (SPRINT trial)'], ['140/90|meds-easy', 'Less strict, e.g. 60+ or dizzy (AAFP)']]]],
  };
}
function openTargets() {
  const P = targetPresets(), sh = $('#sheet');
  const sec = (c, title, unit, note) => { const cur = CFG[c], hit = P[c].some(([v]) => v === cur);
    return `<label>${title}</label><select data-fill="${c}">${P[c].map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v.toLocaleString()} ${unit} · ${t}</option>`).join('')}<option value=""${hit ? '' : ' selected'}>Custom</option></select>
      <input name="${c}" type="number" inputmode="numeric" required value="${cur}" aria-label="${title} (${unit})"><div class="sm mut">${note}</div>`; };
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Daily targets</b><button class="iconbtn" data-close>✕</button></div>
    <form class="f" id="targetForm">
    ${sec('kcalTarget', 'Net calories (eaten − active)', 'kcal', `Based on ${P.lb} lb; maintenance net is about ${P.maint.toLocaleString()}. Faster than ~1 lb a week makes losing muscle more likely.`)}
    ${sec('proteinTarget', 'Protein', 'g', `Based on ${P.lb} lb.`)}
    ${sec('sodiumTarget', 'Sodium', 'mg', 'Mostly estimated, so leave some room.')}
    ${bpSec(P)}
    <div class="sm mut" style="margin-top:10px">Starts today. General guidelines, not medical advice; your doctor's numbers come first.</div><button class="btn" type="submit">Save targets</button></form></div>`;
  sh.classList.remove('hidden');
}
const BP_PLAN = { normal: '', nomeds: '', meds: 'on meds', 'meds-int': 'on meds, intensive', 'meds-easy': 'on meds' };
function bpSec(P) { const cur = `${CFG.bpSys}/${CFG.bpDia}`, opts = P.bp.flatMap(([, o]) => o.map(([v]) => v));
  const sel = opts.find(v => v === `${cur}|${setting('bp_target_plan', '')}`) || opts.find(v => v.startsWith(cur + '|')) || '';
  return `<label>Blood pressure (below)</label><select name="bpPlan" data-fill="bpSys,bpDia">${P.bp.map(([g, o]) => `<optgroup label="${g}">${o.map(([v, t]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${v.split('|')[0]} · ${t}</option>`).join('')}</optgroup>`).join('')}<option value=""${sel ? '' : ' selected'}>Custom</option></select>
    <div style="display:flex;align-items:center;gap:8px"><input name="bpSys" type="number" inputmode="numeric" required value="${CFG.bpSys}" aria-label="Systolic target"><b class="mut">/</b><input name="bpDia" type="number" inputmode="numeric" required value="${CFG.bpDia}" aria-label="Diastolic target"></div>
    <div class="sm mut">Home readings under this count as on target. On medication, go by your doctor's goal; feeling dizzy when you stand up can mean it's too low.</div>
    <div class="bpstep"${(f => f ? '' : ' hidden')(String(setting('bp_target_plan', '')).startsWith('meds'))}><label>Ask about a lower dose when steadily under</label>
    <select data-fill="bpStepSys,bpStepDia">${[['120/80', 'Normal range'], ['115/75', 'Well inside normal']].map(([v, t]) => `<option value="${v}"${v === `${CFG.bpStepSys}/${CFG.bpStepDia}` ? ' selected' : ''}>${v} · ${t}</option>`).join('')}<option value=""${['120/80', '115/75'].includes(`${CFG.bpStepSys}/${CFG.bpStepDia}`) ? '' : ' selected'}>Custom</option></select>
    <div style="display:flex;align-items:center;gap:8px"><input name="bpStepSys" type="number" inputmode="numeric" required value="${CFG.bpStepSys}" aria-label="Step-down systolic"><b class="mut">/</b><input name="bpStepDia" type="number" inputmode="numeric" required value="${CFG.bpStepDia}" aria-label="Step-down diastolic"></div>
    <div class="sm mut">When 30 days of home readings stay under this, the BP tab suggests asking your doctor whether the dose can come down. Don't stop or cut back on your own; some BP medicines are risky to stop suddenly.</div></div>`; }
function openBpTarget() { openTargets(); const s = $('#sheet select[data-fill="bpSys,bpDia"]'); if (s) s.scrollIntoView({ block: 'center' }); }
function saveTargets(form) {
  const f = Object.fromEntries(new FormData(form)), d = todayStr(), lim = { kcalTarget: [800, 4000], proteinTarget: [20, 300], sodiumTarget: [500, 5000], bpSys: [90, 180], bpDia: [50, 110], bpStepSys: [90, 160], bpStepDia: [50, 100] };
  for (const [c] of TGT) { const v = Number(f[c]); if (!(v >= lim[c][0] && v <= lim[c][1])) return toast('Check the ' + { kcalTarget: 'calorie', proteinTarget: 'protein', sodiumTarget: 'sodium', bpSys: 'systolic', bpDia: 'diastolic', bpStepSys: 'lower-dose systolic', bpStepDia: 'lower-dose diastolic' }[c] + ' number'); }
  TGT.forEach(([c, k]) => { const v = Math.round(Number(f[c])); if (v === CFG[c]) return;
    LOCAL.settings.filter(x => x.date === d && x.key === k).forEach(x => delLocal('settings', x._id));
    addLocal('settings', { date: d, key: k, value: String(v) }); });
  const plan = (f.bpPlan || '').split('|')[1] || '';
  if (plan !== setting('bp_target_plan', '')) { LOCAL.settings.filter(x => x.date === d && x.key === 'bp_target_plan').forEach(x => delLocal('settings', x._id));
    addLocal('settings', { date: d, key: 'bp_target_plan', value: plan }); }
  closeSheet(); toast('Targets saved'); render();
}
const goalTxt = g => g.low === g.high ? `${g.low}` : `${g.low}–${g.high}`;
function openGoal() {
  const g = goalHistory().pop(), sh = $('#sheet');
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Weight goal</b><button class="iconbtn" data-close>✕</button></div>
    <form class="f" id="goalForm"><label>Goal weight (lb)</label><input name="low" type="number" step="0.5" inputmode="decimal" required value="${g.low}">
    <label>Upper end, for a range (optional)</label><input name="high" type="number" step="0.5" inputmode="decimal" value="${g.high !== g.low ? g.high : ''}" placeholder="same as goal">
    <label>Reach it by</label><input name="by" type="date" required value="${g.by}">
    <div class="sm mut">Starts today. Your weight chart marks the change.</div><button class="btn" type="submit">Save goal</button></form></div>`;
  sh.classList.remove('hidden');
}
function saveGoal(form) {
  const f = Object.fromEntries(new FormData(form)), low = Number(f.low), high = f.high === '' ? low : Number(f.high);
  if (!(low > 50) || !(high >= low)) return toast('Check the goal numbers');
  const d = todayStr(), mine = LOCAL.goals.filter(x => x.date === d);  // changing it twice in a day keeps only the last
  mine.forEach(x => delLocal('goals', x._id));
  addLocal('goals', { date: d, low, high, by: f.by }); closeSheet(); toast('Goal saved'); render();
}
const V = {};
V.today = () => {
  if (CFG.kid) return V.kidToday();
  const date = state.day || todayStr(), t = dayTotals(date), c = CFG, isToday = date === todayStr();
  const pass = passFor(date), ym = date.slice(0, 7), mPass = passInMonth(ym);
  const remain = c.kcalTarget - t.kcal + t.burn;
  const pl = planFor(date);
  let h = `<div class="datenav"><button data-nav="-1">‹</button><div class="d">${isToday ? 'Today · ' : ''}${fmtD(date)}${pass ? ' <span class="pill pass">PASS</span>' : ''}</div><button data-nav="1" ${isToday ? 'disabled style="opacity:.3"' : ''}>›</button></div>`;
  h += `<div class="card"><div class="rings">${ring(t.kcal, c.kcalTarget, 'var(--kcal)', 'Calories eaten', '')}${ring(t.protein, c.proteinTarget, 'var(--pro)', 'Protein', ' g')}</div>
    <div style="margin-top:12px"><div class="row"><span class="b" style="color:var(--sod)">Sodium</span><span>${t.sodium.toLocaleString()} / ${c.sodiumTarget.toLocaleString()} mg</span></div>
    ${bar(t.sodium, c.sodiumTarget, 'var(--sod)', 'var(--bad)')}
    ${t.sodUnknown ? `<div class="sm mut" style="margin-top:4px">${t.sodUnknown} item(s) with unknown sodium not counted</div>` : ''}
    <div class="row" style="margin-top:8px"><span class="b" style="color:var(--carb)">Carbs</span><span>${r1(t.carbs)} g${t.carbUnknown && t.food.length ? ` <span class="sm mut">· ${t.carbUnknown} item${t.carbUnknown === 1 ? '' : 's'} not counted</span>` : ''}</span></div></div>
    <div class="stat3" style="margin-top:12px"><div><b>${t.kcal}</b><span>eaten</span></div><div><b>${t.burn ? '−' + t.burn : 0}</b><span>${t.activeSrc === 'logged' && CFG.exerciseInput !== false ? 'exercise' : 'active (Health)'}</span></div><div><b style="color:${t.net > c.kcalTarget ? 'var(--bad)' : 'var(--ok)'}">${t.net}</b><span>net / ${c.kcalTarget} goal</span></div></div>
    <div class="sm mut" style="text-align:center;margin-top:8px">Net ${t.net} vs goal ${c.kcalTarget}: <b style="color:${remain >= 0 ? 'var(--ok)' : 'var(--bad)'}">${remain >= 0 ? `${remain} under` : `${-remain} over`}</b> · ${r1(Math.max(0, c.proteinTarget - t.protein))} g protein to go</div></div>`;
  // Pass
  h += `<div class="card">${tipH3(`${MONTHL[pdate(date).getMonth()]} Pass`, mPass ? '<span class="pill pass">used</span>' : '<span class="pill ok">available</span>', [['', "1 Pass (cheat day) per calendar month. Pass days don't count as target misses or break streaks."]], 'About the Pass')}`;
  if (mPass) h += `<div>Used ${fmtD(mPass.date)}${mPass.note ? ' — ' + esc(mPass.note) : ''}${mPass.local ? ' <span class="pill local">this device</span>' : ''}</div>
     ${mPass.local ? `<button class="btn sec" data-unpass="${mPass._id}">Undo Pass</button>` : ''}`;
  else h += `
     <button class="btn" style="background:var(--acc);color:var(--on-acc)" data-usepass="${date}">Use Pass ${isToday ? 'today' : 'on ' + fmtShort(date)}</button>`;
  h += `</div>`;
  // Workout
  if (pl) {
    // the day's notes sit behind an ⓘ so the card stays short
    const tips = [pl.rest ? ['', 'Rest or therapy day: an easy walk counts. Skip anything that hurts, and keep a treated area resting if your provider said to.'] : null,
      pl.day.note ? ['warn', pl.day.note] : null, ...pl.adds.map(a => ['', a.text]),
      pl.comps.some(cp => cp.id === 'cardio') ? ['', 'Finish cardio by ~7 PM for sleep. No loaded overhead lifting/pressing.'] : null].filter(Boolean);
    h += `<div class="card"><h3 class="row" style="align-items:center">Today's workout <span style="display:flex;align-items:center;gap:6px"><small>${pl.dn}${pl.inRange ? '' : ' · <span class="pill warn">plan ended — update plan.json</span>'}</small>${tips.length ? `${tipBtn(tips.map(([k, t]) => [k, esc(t)]), 'Notes for today')}` : ''}</span></h3>
      <div class="row" style="align-items:center"><div class="b">${pl.rest ? 'Rest / therapy day' : esc(pl.day.title)}</div>
        <button class="sw sm" role="switch" aria-checked="${pl.rest}" data-habit="rest" data-hdate="${date}"><span></span>rest day</button></div>
      ${pl.rest ? `<div class="sm mut">Planned: <s>${esc(pl.day.title)}</s></div>` : ''}
      ${pl.comps.map(cp => `<div class="check">${planIcon(cp)}<span>${esc(cp.name)}${cp.check && !cp.hits.length ? (cp.done ? '' : ' <span class="sm mut">— tap to check off</span>') : cp.hits.length ? ` <span class="sm mut">— ${cp.hits.map(x => esc(x.activity)).join('; ')}${cp.min ? ` (${cp.mins} min)` : ''}</span>` : ` <span class="sm mut">— ${CFG.exerciseInput === false ? 'no workout from Health yet' : 'not logged yet'}</span>`}${cp.partial ? ' <span class="pill warn">partial</span>' : ''}${cp.optional && !cp.done ? ' <span class="pill">optional</span>' : ''}</span></div>`).join('')}
</div>`;
  }
  if (isToday) h += sleepCoachCard(true);
  h += foodCard(t) + exCard(t);
  return h;
};

/* ---------- kid copy (config "kid": true): kept as simple as possible — Today (habits, calories, protein, food) and Weight ----------
   habits: protein checks itself from his food; the rest (config "habits") are tapped off. Sleep is left to his RingConn app. */
const AUTOH = [
  { id: 'protein', short: 'Protein', name: () => `${CFG.proteinTarget} g of protein`, done: d => sum(all('food').filter(f => f.date === d), f => f.protein) >= CFG.proteinTarget },
];
function habitList() {
  return AUTOH.map(h => ({ ...h, name: h.name(), auto: true }))
    .concat((CFG.habits || []).map(h => ({ ...h, short: h.short || h.name, done: d => all('habits').some(x => x.date === d && x.habit === h.id) })));
}
/** days in a row up to date; a habit not done yet today doesn't break the streak until the day is over */
function habitStreak(h, date) {
  let s = 0, d = h.done(date) || date !== todayStr() ? date : addDays(date, -1);
  while (s < 999 && h.done(d)) { s++; d = addDays(d, -1); }
  return s;
}
function habitsCard(date) {
  const hs = habitList(), n = hs.filter(h => h.done(date)).length;
  return `<div class="card"><h3>Habits <small>${n} of ${hs.length}${n === hs.length ? ' · <span style="color:var(--ok)">all done!</span>' : ''}</small></h3>${hs.map(h => {
    const ok = h.done(date), st = habitStreak(h, date);
    const body = `<span class="ic ${ok ? 'y' : 'n'}">${ok ? '✓' : ''}</span><span style="flex:1">${esc(h.name)}</span>${st >= 2 ? `<span class="pill ok">🔥 ${st}</span>` : ''}`;
    return h.auto ? `<div class="check">${body}</div>`
      : `<button class="check" data-habit="${esc(h.id)}" style="width:100%;background:none;border:0;color:inherit;font:inherit;font-size:14px;text-align:left;cursor:pointer">${body}</button>`; }).join('')}
    <div class="sm mut" style="margin-top:6px">Tap to check off. 🔥 = days in a row.</div></div>`;
}
function toggleHabit(id, date) {
  const d = date || state.day || todayStr(), loc = LOCAL.habits.find(x => x.date === d && x.habit === id);
  if (loc) delLocal('habits', loc._id);
  else if (all('habits').some(x => x.date === d && x.habit === id)) return toast('Already saved for that day');
  else addLocal('habits', { date: d, habit: id });
  const y = scrollY; render(); scrollTo(0, y);
}
V.kidToday = () => {
  const date = state.day || todayStr(), t = dayTotals(date), c = CFG, isToday = date === todayStr(), pOk = t.protein >= c.proteinTarget;
  let h = `<div class="datenav"><button data-nav="-1">‹</button><div class="d">${isToday ? 'Today · ' : ''}${fmtD(date)}</div><button data-nav="1" ${isToday ? 'disabled style="opacity:.3"' : ''}>›</button></div>`;
  h += habitsCard(date);
  h += `<div class="card"><div class="stat3" style="grid-template-columns:1fr 1fr"><div><b>${t.kcal.toLocaleString()}</b><span>calories</span></div><div><b style="color:${pOk ? 'var(--ok)' : 'var(--tx)'}">${r1(t.protein)} g${pOk ? ' ✓' : ''}</b><span>protein (goal ${c.proteinTarget} g)</span></div></div></div>`;
  return h + foodCard(t);
};
V.kidWeight = () => {
  const ws = all('weight').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!ws.length) return '<div class="card">No weigh-ins yet. Tap ＋ → Weight to add one.</div>';
  const first = ws[0].date, last = todayStr() > ws[ws.length - 1].date ? todayStr() : ws[ws.length - 1].date, xi = s => daysBetween(first, s);
  const ys = ws.map(w => w.weight), y0 = Math.floor(Math.min(...ys) - 2), y1 = Math.ceil(Math.max(...ys) + 2), xl = [{ x: 0, t: fmtShort(first) }];
  if (last !== first) xl.push({ x: xi(last) * 0.93, t: fmtShort(last) });
  const svg = chart({ x0: 0, x1: Math.max(1, xi(last)), y0, y1, xlabels: xl, xfirst: first, series: [{ pts: ws.map(w => [xi(w.date), w.weight]), color: 'var(--pro)', line: true, dots: true, tip: { u: ' lb' } }] });
  const cur = ws[ws.length - 1];
  return `<div class="card"><h3>Weight <small>latest ${cur.weight} lb · ${fmtShort(cur.date)}</small></h3>${svg}
    <div class="sm mut" style="margin-top:6px">You're still growing, so your weight going up over time is normal. Once a week, same time of day, is plenty.</div></div>
    <div class="card"><h3>Weigh-ins</h3><ul class="list">${ws.slice().reverse().map(w => `<li><span class="m"><div class="n">${fmtD(w.date)}${w.local ? '<span class="pill local">new</span>' : ''}</div></span><span class="v b">${w.weight} lb</span></li>`).join('')}</ul></div>`;
};

function dayRows(n) {
  const days = [], today = todayStr();
  const foodDates = all('food').map(f => f.date).sort();
  const start = foodDates.length ? foodDates[0] : today;
  for (let d = today; d >= start && days.length < n; d = addDays(d, -1)) days.push(d);
  return days.map(d => {
    const t = dayTotals(d), pass = !!passFor(d), logged = t.food.length > 0;
    return { d, ...t, pass, logged, kOk: t.net <= CFG.kcalTarget, pOk: t.protein >= CFG.proteinTarget * 0.9, sOk: t.sodium <= CFG.sodiumTarget, today: d === today };
  });
}
V.trends = () => {
  const rows = dayRows(30), c = CFG;
  const done = rows.filter(r => r.logged && !r.today);           // completed days only
  const counted = done.filter(r => !r.pass);                       // pass days excluded from misses
  const streak = (() => { let s = 0; for (const r of rows) { if (r.today && !r.kOk) continue; if (!r.logged) break; if (r.pass) continue; if (r.kOk) s++; else break; } return s; })();
  const pct = f => counted.length ? Math.round(counted.filter(f).length / counted.length * 100) + '%' : '–';
  const chron = rows.slice(0, 14).reverse();
  let h = `<div class="card"><h3>Targets <small>${counted.length} full days${done.length > counted.length ? ` · ${done.length - counted.length} Pass day excluded` : ''}</small></h3>
    <div class="stat3"><div><b>${pct(r => r.kOk)}</b><span>net ≤ ${c.kcalTarget}</span></div><div><b>${pct(r => r.pOk)}</b><span>protein ≥ ${Math.round(c.proteinTarget * .9)} g</span></div><div><b>${pct(r => r.sOk)}</b><span>Na ≤ ${c.sodiumTarget} mg</span></div></div>
    <div class="sm mut" style="margin-top:8px;text-align:center">Calorie streak: <b style="color:var(--tx)">${streak} day${streak === 1 ? '' : 's'}</b> (Pass days skip, don't break)</div>
    <div style="text-align:right;margin-top:4px"><button class="linkbtn" data-targets>Change targets</button></div></div>`;
  const U = { net: ' kcal', sodium: ' mg', protein: ' g' };
  const items = key => chron.map(r => ({ label: pdate(r.d).getDate(), d: r.d, v: r.logged ? r[key] : null, pass: r.pass, hollow: r.today,
    t: r.logged ? `${Math.round(r[key]).toLocaleString()}${U[key]}${r.pass ? ' · Pass' : ''}` : '' }));
  h += `<div class="card"><h3>Net calories <small>eaten − active · last 14 days</small></h3>${barChart({ items: items('net'), target: c.kcalTarget, color: 'var(--ok)', overColor: 'var(--bad)' })}
    <div class="legend"><span><i style="background:var(--ok)"></i>on target</span><span><i style="background:var(--bad)"></i>over</span><span><i style="background:var(--acc)"></i>Pass day</span><span><i style="background:var(--ok);opacity:.45"></i>today (in progress)</span></div></div>`;
  h += `<div class="card"><h3>Sodium <small>mg/day</small></h3>${barChart({ items: items('sodium'), target: c.sodiumTarget, color: 'var(--sod)', overColor: 'var(--bad)' })}</div>`;
  h += `<div class="card"><h3>Protein <small>g/day</small></h3>${barChart({ items: items('protein'), target: c.proteinTarget, color: 'var(--pro)', overColor: 'var(--pro)' })}</div>`;
  h += `<div class="card">${tipH3('Daily log', '', [['', `Protein shown green at ≥90% of ${c.proteinTarget} g. Na “+” = some items unknown.`]], 'About the daily log')}<table class="t"><tr><th>Day</th><th>kcal</th><th>Prot</th><th>Na</th><th>Active</th><th>Net</th></tr>${rows.filter(r => r.logged).map(r => `<tr><td>${fmtShort(r.d)}${r.pass ? ' <span class="pill pass">PASS</span>' : ''}${r.today ? ' <span class="pill">today</span>' : ''}</td>
      <td class="${r.pass ? '' : r.kOk ? 'good' : 'over'}">${r.kcal}</td><td class="${r.pass ? '' : r.pOk ? 'good' : ''}">${r.protein}</td><td class="${r.pass ? '' : r.sOk ? 'good' : 'over'}">${r.sodium}${r.sodUnknown ? '+' : ''}</td><td>${r.burn}</td><td>${r.net}</td></tr>`).join('')}</table>
</div>`;
  return h;
};

V.plan = () => {
  const P = SNAP.plan; if (!P) return '<div class="card">No plan.json found at build time.</div>';
  const today = todayStr(), d0 = pdate(today), monday = addDays(today, -((d0.getDay() + 6) % 7));
  let h = `<div class="card"><h3>${esc(P.name)}</h3><div class="sm mut">${fmtShort(P.validFrom)} – ${fmtShort(P.validThrough)}${today > P.validThrough ? ' · <span class="pill warn">ended — update plan.json</span>' : ` · ${daysBetween(today, P.validThrough)} days left`}</div></div>`;
  // today and the next six days; past days are hidden. Each card shows only its title; tap to open the details
  h += `<div class="card plan"><h3>Next 7 days <small>${fmtShort(today)} – ${fmtShort(addDays(today, 6))}</small></h3><div class="ptiles">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i), pl = planFor(d), isT = !i;
    const done = pl.comps.filter(cp => cp.done).length;
    const op = PLAN_OPEN.has(d);
    h += `<div class="ptile${isT ? ' today' : ''}${op ? ' open' : ''}" data-pdate="${d}"><button class="ph" data-expand aria-expanded="${op}">
        <span class="dn">${pl.dn}<small>${pdate(d).getDate()}</small></span>
        <span class="pt">${esc(pl.day.title)}${isT ? ' <span class="pill ok">today</span>' : ''}${passFor(d) ? ' <span class="pill pass">PASS</span>' : ''}${pl.rest ? ' <span class="pill">rest</span>' : ''}${isT && done ? ` <span class="pill">${done}/${pl.comps.length}</span>` : ''}</span>
        <span class="chev" aria-hidden="true">›</span></button>
      <div class="pdet"><div><div class="pin">
        ${pl.comps.map(cp => `<div class="check">${isT ? planIcon(cp) : '<span class="ic n"></span>'}<span class="sm">${esc(cp.name)}${cp.optional ? ' <span class="pill">optional</span>' : ''}${cp.partial ? ` <span class="pill warn">${cp.mins} min</span>` : ''}</span></div>`).join('')}
        ${pl.day.note ? `<div class="sm" style="color:var(--warn)">${esc(pl.day.note)}</div>` : ''}
        ${pl.adds.map(a => `<div class="sm mut">+ ${esc(a.text)}</div>`).join('')}</div></div></div></div>`;
  }
  h += `</div>`;
  h += `</div>`;
  h += `<div class="card"><h3>Rules</h3><ul style="margin:0;padding-left:18px">${P.rules.map(r => `<li style="margin:4px 0">${esc(r)}</li>`).join('')}</ul></div>`;
  h += `<div class="card"><h3>Weekly template</h3><table class="t">${Object.entries(P.days).map(([k, v]) => `<tr><td class="b">${k}</td><td style="text-align:left">${esc(v.title)}${v.note ? `<div class="sm" style="color:var(--warn)">${esc(v.note)}</div>` : ''}</td></tr>`).join('')}</table></div>`;
  h += `<div class="card"><h3>Coming up</h3>${(P.additions || []).map(a => `<div class="note"><b>From ${fmtShort(a.from)} · ${a.days.join('/')}</b><br>${esc(a.text)}</div>`).join('')}</div>`;
  return h;
};

V.weight = () => {
  if (CFG.kid) return V.kidWeight();
  const GH = goalHistory(), G = GH[GH.length - 1];
  const c = { ...CFG, weightGoalLow: G.low, weightGoalHigh: G.high, goalDate: G.by }, ws = all('weight').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!ws.length) return '<div class="card">No weights yet.</div>';
  const first = ws[0].date < c.startDate ? ws[0].date : c.startDate, xEnd = GH.reduce((m, g) => g.by > m ? g.by : m, todayStr());
  const xi = s => daysBetween(first, s);
  const pts = ws.map(w => [xi(w.date) + (w.time ? +w.time.slice(0, 2) / 24 : 0.3), w.weight, w.note === 'estimate' ? 'var(--est)' : 'var(--pro)', fmtShort(w.date) + (w.note === 'estimate' ? ' · estimate' : '')]);
  const ys = ws.map(w => w.weight).concat([c.startWeight], GH.map(g => g.low), GH.map(g => g.high));
  const y0 = Math.floor(Math.min(...ys) - 1), y1 = Math.ceil(Math.max(...ys) + 1);
  const total = daysBetween(first, xEnd), xl = [];
  for (let d = first; d <= xEnd; d = addDays(d, 1)) if (pdate(d).getDate() === 1 || (d === first && pdate(d).getDate() < 24)) xl.push({ x: xi(d), t: fmtShort(d) });
  const xmas = s => s.slice(5) === '12-25';
  xl.push({ x: xi(c.goalDate), t: xmas(c.goalDate) ? '🎄' : '🏁' });
  const mid = (c.weightGoalLow + c.weightGoalHigh) / 2;
  // each goal runs from the day it was set to the next change; its steady path starts from where you were then
  const wAt = d => { const b = ws.filter(w => w.date <= d); return b.length ? b[b.length - 1].weight : c.startWeight; };
  const segs = GH.map((g, i) => { const nx = GH[i + 1], m = (g.low + g.high) / 2, w0 = i ? wAt(g.date) : c.startWeight;
    const x0 = xi(g.date), xb = xi(g.by), x1 = nx ? xi(nx.date) : Math.max(xb, xi(todayStr()));
    const at = x => xb > x0 ? w0 + (m - w0) * Math.min(1, (x - x0) / (xb - x0)) : m;
    return { g, m, w0, x0, x1, path: [[x0, w0], ...(xb < x1 ? [[xb, m]] : []), [x1, at(x1)]] }; });
  const cur0 = segs[segs.length - 1];
  const svg = chart({ x0: 0, x1: total, y0, y1, ylabelsEvery: y1 - y0 > 12 ? 4 : 2,
    bands: segs.map(s => ({ lo: s.g.low, hi: s.g.high, x0: s.x0, x1: s.x1, color: 'var(--band)' })),
    hlines: segs.map((s, i) => ({ y: s.g.high, x0: s.x0, x1: s.x1, color: i === segs.length - 1 ? 'var(--ok)' : 'var(--mut2)', label: i === segs.length - 1 ? `goal ${goalTxt(s.g)}` : '' })),
    vlines: [{ x: xi(todayStr()), color: 'var(--mut2)', label: 'today' },
             ...segs.slice(1).map(s => ({ x: s.x0, color: 'var(--ok)', label: `goal → ${goalTxt(s.g)}`, ly: 30 }))],
    xlabels: xl, xfirst: first,
    series: [...segs.map((s, i) => ({ pts: s.path, color: i === segs.length - 1 ? 'var(--acc)' : 'var(--mut2)', line: true, dash: '5 4', width: 1.5, tip: i === segs.length - 1 ? { n: 'path', u: ' lb' } : null })),
             { pts, color: 'var(--pro)', line: true, dots: true, tip: { u: ' lb' } }] });
  const cur = ws[ws.length - 1], lost = r1(c.startWeight - cur.weight), daysLeft = daysBetween(todayStr(), c.goalDate);
  const toHi = r1(cur.weight - c.weightGoalHigh), toLo = r1(cur.weight - c.weightGoalLow);
  const bmi = r1(cur.weight * 703 / (c.heightIn * c.heightIn)), age = new Date().getFullYear() - c.birthYear;
  const pStart = GH.length > 1 ? G.date : c.startDate, pFrom = cur0.w0;
  const plannedNow = r1(pFrom - (pFrom - mid) * Math.min(1, Math.max(0, daysBetween(pStart, todayStr()) / (daysBetween(pStart, c.goalDate) || 1))));
  let h = `<div class="card"><h3>Weight trend <small>goal by ${fmtShort(c.goalDate)}</small></h3>${svg}
    <div class="legend"><span><i style="background:var(--pro)"></i>weigh-ins</span><span><i style="background:var(--acc)"></i>steady path to ${mid}</span><span><i style="background:var(--band3)"></i>goal${GH.length > 1 ? ' (changes marked)' : ' range'}</span><span><i style="background:var(--est)"></i>estimate</span></div></div>
    <div class="card"><div class="stat3"><div><b>${cur.weight}</b><span>latest (${fmtShort(cur.date)})</span></div><div><b style="color:var(--ok)">−${lost}</b><span>since ${fmtShort(c.startDate)}</span></div><div><b>${toHi > 0 ? toHi : '✓'}</b><span>lb to ${c.weightGoalHigh}</span></div></div>
    <div class="sm mut" style="margin-top:10px">${daysLeft > 0 ? `${daysLeft} days to ${xmas(c.goalDate) ? 'Christmas' : fmtShort(c.goalDate)}. Reaching ${goalTxt(G)} needs ${[...new Set([r1(Math.max(0, toHi) / daysLeft * 7), r1(Math.max(0, toLo) / daysLeft * 7)])].join('–')} lb/week from here.` : ''} Steady-path value today: ${plannedNow} lb (${cur.weight <= plannedNow ? 'ahead of' : 'behind'} pace). Early drops are often water, so expect it to slow down.<br>BMI ${bmi} at 5′3″ · age ${age}.</div>
    <div style="text-align:right;margin-top:6px"><button class="linkbtn" data-goal>Change goal</button></div></div>`;
  h += `<div class="card"><h3>Weigh-ins</h3><ul class="list">${ws.slice().reverse().map(w => `<li><span class="m"><div class="n">${fmtD(w.date)}${w.time ? ' ' + w.time : ''}${w.note ? ` <span class="pill">${esc(w.note)}</span>` : ''}${w.local ? '<span class="pill local">new</span>' : ''}</div></span><span class="v b">${w.weight} lb</span></li>`).join('')}</ul></div>`;
  return h;
};

V.sleep = () => {
  const ss = all('sleep').sort((a, b) => b.date.localeCompare(a.date) || (a.nap - b.nap));
  if (!ss.length) return '<div class="card">No sleep logged.</div>';
  const today = todayStr(), days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(today, -i));
  const items = days.map(d => { const main = ss.filter(s => s.date === d && !s.nap), nap = ss.filter(s => s.date === d && s.nap);
    const v = main.length ? r1(sum(main, s => s.asleep) / 60) : null, stg = main.length === 1 && main[0].deep != null ? main[0] : null, st = stg ? stg.deep + stg.light + stg.dream : 0;
    // phases stacked deep → light → REM, scaled to the night's time asleep; awake time is left out
    const nh = nap.length ? r1(sum(nap, s => s.asleep) / 60) : 0;
    return { label: pdate(d).getDate(), d, t: v == null && !nh ? '' : `${v ?? 0} h${nh ? ` + ${nh} h nap` : ''}`, v, segs: st ? [['deep', 'var(--deep)'], ['light', 'var(--pro)'], ['dream', 'var(--acc)']].map(([k, c]) => ({ v: stg[k] / st * v, c })) : null,
      v2: nap.length ? r1(sum(nap, s => s.asleep) / 60) : 0, c2: 'var(--ok)' }; });
  const mains = ss.filter(s => !s.nap && s.asleep), avg = mains.length ? r1(sum(mains.slice(0, 7), s => s.asleep) / Math.min(7, mains.length) / 60) : null;
  const sT = sleepTarget(), sRef = `${sT} h target`;
  let h = sleepCoachCard() + `<div class="card">${tipH3('Sleep', 'hours · night ending on date', CFG.sleepInput === false ? [['', 'Sleep comes from your RingConn ring via Apple Health (⇪ → Pull from Health).']] : [], 'About sleep')}${barChart({ items, target: sT, color: 'var(--mut2)', overColor: 'var(--mut2)', unit: 'h', max: Math.max(10, Math.ceil(sT)) })}
    <div class="legend"><span><i style="background:var(--deep)"></i>deep</span><span><i style="background:var(--pro)"></i>light</span><span><i style="background:var(--acc)"></i>REM</span>${items.some(i => i.v != null && !i.segs) ? '<span><i style="background:var(--mut2)"></i>no stages</span>' : ''}${items.some(i => i.v2) ? '<span><i style="background:var(--ok)"></i>nap</span>' : ''}<span>${sRef}</span></div>
    <div class="row" style="margin-top:6px;align-items:center"><span class="sm mut">${avg != null ? `Avg of last ${Math.min(7, mains.length)} nights: <b style="color:var(--tx)">${avg} h</b>` : ''}</span><button class="linkbtn" data-sleeptarget>Change target</button></div></div>`;
  // bars show time asleep on one scale: the sleep target fills the width, and an arrow marks a night past it
  const tgtMin = sT * 60, showAwake = sleepAwake(), showTL = sleepPref('tl');
  // timeline: every night on one clock axis, from the earliest bedtime hour to the latest wake hour
  const clk = t => { const m = +t.slice(0, 2) * 60 + +t.slice(3, 5); return m >= 720 ? m - 1440 : m; };
  const tlN = ss.filter(s => !s.nap && /^\d\d:\d\d$/.test(s.bed || '') && /^\d\d:\d\d$/.test(s.wake || ''));
  const tlLo = tlN.length ? Math.floor(Math.min(...tlN.map(s => clk(s.bed))) / 60) * 60 : 0, tlHi = tlN.length ? Math.ceil(Math.max(...tlN.map(s => clk(s.wake))) / 60) * 60 : 60, tlSpan = Math.max(60, tlHi - tlLo);
  const hr = m => { const h = ((m / 60) % 24 + 24) % 24; return (h % 12 || 12) + (h < 12 ? 'a' : 'p'); };
  const tlStep = tlSpan > 600 ? 120 : 60, tlGrid = `background-image:linear-gradient(to right,var(--tick) 1px,transparent 1px);background-size:${tlStep / tlSpan * 100}% 100%`;
  const TLC = { D: 'var(--deep)', C: 'var(--pro)', R: 'var(--acc)', A: 'var(--awake)', S: 'var(--pro)', I: 'transparent' };
  const tlBar = s => { const b = clk(s.bed), w = clk(s.wake) < b ? clk(s.wake) + 1440 : clk(s.wake), runs = (s.stages || '').match(/[A-Z]\d+/g);
    const inner = runs ? runs.map(r => `<i style="width:${+r.slice(1) / (w - b) * 100}%;background:${TLC[r[0]] || 'transparent'};border-radius:0;flex:none"></i>`).join('') : '<i style="width:100%;background:var(--mut2);opacity:.5;border-radius:0"></i>';
    return `<div class="bar" style="height:10px;margin-top:5px;background-color:var(--card2);${tlGrid}"><div style="position:absolute;top:0;bottom:0;display:flex;overflow:hidden;left:${(b - tlLo) / tlSpan * 100}%;width:${(w - b) / tlSpan * 100}%">${inner}</div></div>`; };
  // with awake shown, widen the scale to the longest night so nothing is cut off, and mark the target with a tick
  const scaleMin = showAwake ? Math.max(tgtMin, ...ss.filter(s => s.deep != null).map(s => (s.asleep || 0) + (s.awake || 0))) : tgtMin;
  h += `<div class="card"><h3>History</h3><div style="display:flex;gap:14px;align-items:center;justify-content:flex-end;margin:-6px 0 4px">${showTL ? '' : `<button class="sw sm" role="switch" aria-checked="${showAwake}" data-awake><span></span>awake</button>`}<button class="sw sm" role="switch" aria-checked="${showTL}" data-sleeptl><span></span>timeline</button></div>${showTL && tlN.length ? `<div class="sm mut" style="position:relative;height:14px;margin:2px 0 -4px">${Array.from({ length: Math.floor(tlSpan / tlStep) + 1 }, (_, i) => tlLo + i * tlStep).map((m, i, a) => `<span style="position:absolute;left:${(m - tlLo) / tlSpan * 100}%;transform:translateX(${i === 0 ? 0 : i === a.length - 1 ? -100 : -50}%);font-size:11px">${hr(m)}</span>`).join('')}</div>` : ''}<ul class="list">${ss.map(s => {
    const st = s.deep != null ? [['deep', 'var(--deep)'], ['light', 'var(--pro)'], ['dream', 'var(--acc)']] : null, tot = st ? sum(st, k => s[k[0]]) : 0;
    return `<li${showTL ? ' style="flex-wrap:wrap"' : ''}><span class="m"><div class="n">${fmtD(s.date)} ${s.nap ? '<span class="pill pass">nap</span>' : ''}${/self/i.test(s.source) ? '<span class="pill">self-report</span>' : ''}${s.local ? '<span class="pill local">new</span>' : ''}</div>
      <div class="s">${s.nap ? 'nap' : `${esc(s.bed)} → ${esc(s.wake)}`}${s.source && !/self/i.test(s.source) ? ' · ' + esc(s.source) : ''}${s.nap && s.wake ? ' · ' + esc(s.wake) : ''}</div>
      ${showTL ? '' : st && tot ? `<div style="display:flex;align-items:center;gap:4px;margin-top:5px"><div class="bar${showAwake ? ' tick' : ''}" style="flex:1;height:8px;margin:0;--t:${tgtMin / scaleMin * 100}%">${(() => { const L = s.asleep || tot, aw = showAwake ? (s.awake || 0) : 0, all = L + aw;
        // same scale either way: stages share the time asleep, awake is added after it, and the track clips past the target
        return `<div style="display:flex;height:100%;width:${Math.min(1, all / scaleMin) * 100}%">${st.map(k => `<i style="width:${s[k[0]] / tot * L / all * 100}%;background:${k[1]};border-radius:0"></i>`).join('')}${aw ? `<i style="width:${aw / all * 100}%;background:var(--awake);border-radius:0"></i>` : ''}</div>`; })()}</div><span class="sm" style="width:12px;color:var(--ok);line-height:1"${(s.asleep || tot) > tgtMin ? ' aria-label="over target">→' : '>'}</span></div><div class="s">deep ${s.deep} · light ${s.light} · REM ${s.dream} · awake ${s.awake} min</div>` : ''}</span>
      <span class="v"><b>${s.asleep != null ? Math.floor(s.asleep / 60) + 'h ' + pad(s.asleep % 60) + 'm' : '?'}</b>${s.score != null ? `<div class="s">score ${s.score}</div>` : ''}</span>${showTL ? `<div style="flex-basis:100%;min-width:0">${tlN.includes(s) ? tlBar(s) : ''}${st && tot ? `<div class="s">deep ${s.deep} · light ${s.light} · REM ${s.dream} · awake ${s.awake} min</div>` : ''}</div>` : ''}</li>`; }).join('')}</ul></div>`;
  return h;
};

/* ---------- sleep coach: tips for the day after a night, and for the night ahead ----------
   Thresholds from the research in reports/ (local only): AASM/SRS ≥7 h (Watson 2015); NSF 2017 quality consensus
   (efficiency ≥85% good, ≤74% poor; deep and REM shares); rings track sleep vs wake well but stages only roughly
   (Chinoy 2022, Svensson 2024), so stages are judged against your own recent nights as well as the general range. */
function sleepCoach() {
  const ss = all('sleep').filter(s => !s.nap && s.asleep).sort((a, b) => b.date.localeCompare(a.date));
  const n = ss[0], today = todayStr();
  if (!n || n.date < addDays(today, -1)) return null;
  const clk = t => /^\d\d:\d\d$/.test(t || '') ? (m => m >= 720 ? m - 1440 : m)(+t.slice(0, 2) * 60 + +t.slice(3, 5)) : null;
  const staged = s => s.deep != null && s.dream != null && s.light != null && (s.deep + s.light + s.dream) > 0;
  const pct = (s, k) => s[k] / (s.deep + s.light + s.dream) * 100;
  const prior = ss.slice(1, 15).filter(staged), base = k => prior.length >= 5 ? sum(prior, s => pct(s, k)) / prior.length : null;
  const hrs = n.asleep / 60, eff = n.awake != null ? n.asleep / (n.asleep + n.awake) * 100 : null;
  // longest stretch awake after first falling asleep (from the minute-by-minute stages)
  const runs = (n.stages || '').match(/[A-Z]\d+/g) || [], firstSleep = runs.findIndex(r => r[0] !== 'A' && r[0] !== 'I');
  const longWake = firstSleep < 0 ? 0 : Math.max(0, ...runs.slice(firstSleep).filter(r => r[0] === 'A').map(r => +r.slice(1)));
  const st = staged(n) ? Object.fromEntries(['deep', 'dream', 'light'].map(k => [k, pct(n, k)])) : null;
  const bDeep = base('deep'), bRem = base('dream');
  const f = {
    vshort: hrs < 6, short: hrs >= 6 && hrs < 7, long: hrs > 9,
    lowDeep: !!st && (st.deep < 10 || (bDeep != null && st.deep < bDeep * 0.75)),
    lowRem: !!st && (st.dream < 15 || (bRem != null && st.dream < bRem * 0.75)),
    restless: (eff != null && eff < 85) || longWake >= 30,
  };
  // usual bedtime = median of the last 7 nights; caffeine cutoff ≈ 9 h before it (Gardiner 2023: ≥8.8 h for a coffee)
  const beds = ss.slice(0, 7).map(s => clk(s.bed)).filter(v => v != null).sort((a, b) => a - b);
  const bed = beds.length ? beds[beds.length >> 1] : 22 * 60 + 30;
  const tm = m => { m = ((Math.round(m / 15) * 15) % 1440 + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}${mm ? ':' + pad(mm) : ''} ${h < 12 ? 'AM' : 'PM'}`; };
  const t = dayTotals(today), sodHigh = t.sodium > CFG.sodiumTarget * 0.8;
  const day = [], night = [];
  // ---- today
  if (f.vshort) {
    day.push(['ex', 'Keep your workout, but ease off', 'Moderate effort, earlier in the day, no max attempts. Short sleep cuts performance about 8% and makes effort feel harder, mostly later in the day (Craven 2022).']);
    day.push(['food', 'Expect extra hunger', `Short nights add about 250–385 kcal of eating the next day (Al Khatib 2017). Plan a protein snack for the afternoon instead of grazing.`]);
    day.push(['nap', 'A 10–20 min nap, before about 2 PM', 'Short naps boost alertness without grogginess; earlier naps work better and spare tonight’s sleep (Dutheil 2021).']);
    if (hrs < 5) day.push(['warn', 'Be careful driving', 'Under 5 h of sleep roughly doubles to quadruples crash risk (AAA Foundation 2016).']);
    day.push(['bp', 'BP may read higher today', 'A short night can nudge blood pressure up. If a reading looks high, re-check after a normal night before worrying.']);
  } else if (f.short) {
    day.push(['food', 'You may be hungrier than usual', 'Even a somewhat short night raises appetite (Al Khatib 2017). Front-load protein and keep a planned snack handy.']);
    day.push(['ex', 'Normal workout is fine', 'Train in the morning or midday if you can; the drop-off after a short night shows up mostly later in the day (Craven 2022).']);
  } else if (!f.restless && !f.lowDeep && !f.lowRem && !f.long) {
    day.push(['ok', 'Well rested: a good day to push', 'Enough sleep with a normal mix of stages. If your plan has a harder session, today suits it.']);
  }
  if (f.lowDeep) day.push(['deep', 'Deep sleep ran low', 'Deep sleep supports physical recovery and blood-sugar control (Tasali 2008). Favor fiber and protein over sweets today, and keep any lifting moderate.']);
  if (f.lowRem) day.push(['rem', 'REM ran low', 'Low REM can leave you a bit more irritable or stressed (small studies). Most REM comes late in the night, so an early wake-up cuts it.']);
  if (f.restless) day.push(['wake', longWake >= 30 ? `Awake ${longWake} min in the night` : 'Restless night', `Sleep efficiency ${eff != null ? Math.round(eff) + '%' : '—'} (85%+ is good, NSF 2017). Get 30 min of outdoor light this morning to steady your body clock.`]);
  if (f.long) day.push(['ok', 'A long night', 'Over 9 h now and then is fine, often catch-up. If it’s regular and you still feel tired, mention it to your doctor.']);
  // thinking and number work: sleep loss hits attention and vigilance hardest (Lim & Dinges 2010), so routine figures slip before reasoning does
  const mx = [f.lowDeep ? ' New things may stick less today (less deep sleep, Van Der Werf 2009): write them down.' : ''].join('');
  if (f.vshort) day.push(['mind', 'Number work: morning, and check it twice', 'Sleep loss mainly causes attention lapses (Lim & Dinges 2010), so slips hide in routine sums. Use a calculator, re-add totals, and put off big money or health decisions; tired brains take more risks (Killgore 2010).' + mx]);
  else if (f.short || f.restless) day.push(['mind', 'Hardest thinking before lunch', 'Alertness dips in the early afternoon, more after a light night. Do calculations in 25–50 min blocks with short breaks (Albulescu 2022) and double-check anything that matters.' + mx]);
  else day.push(['mind', f.lowDeep ? 'Mental work: write new things down' : 'Clear head: tackle the hard problem', f.lowDeep ? mx.trim() : 'Put your most demanding mental work in your best hours, usually late morning. Short breaks between blocks keep accuracy up (Albulescu 2022).']);
  // feelings: sleep loss lowers positive mood and raises anxiety (Tomaso 2021 meta-analysis); the amygdala over-reacts (Yoo 2007)
  if (f.vshort) day.push(['mood', 'Heads up: shorter fuse today', 'After a short night the brain’s alarm center reacts about 60% more (Yoo 2007) and good moods fade fastest (Tomaso 2021). If small things feel big, that’s the sleep talking. Postpone hard conversations if you can (couples argue more after poor sleep, Gordon & Chen 2014), and get outside for a walk.']);
  else if (f.short || f.restless) day.push(['mood', 'Mood may run a little flat', 'Even modest sleep loss lowers positive feelings and nudges up anxiety (Tomaso 2021). Name it (“I’m tired, not upset”) and pause before replying to tough messages.' + (f.lowRem ? ' Low REM too: emotions may sit closer to the surface.' : '')]);
  else if (f.lowRem) day.push(['mood', 'Emotions may sit closer to the surface', 'REM sleep takes the sting out of yesterday’s emotional moments (Walker & van der Helm 2009). Give yourself extra patience and step away before answering anything that annoys you.']);
  else day.push(['mood', 'Good footing for hard conversations', 'Rested brains read other people’s faces more accurately and handle stress better (Goldstein-Piekarski 2015). If something difficult needs saying, today suits it.']);
  day.push(['caf', `Last coffee by ${tm(bed - 9 * 60)}`, `Caffeine needs about 9 h to stop costing sleep; a pre-workout drink about 13 h (Gardiner 2023). Based on your usual ${tm(bed)} bedtime.`]);
  // ---- tonight
  night.push(['bed', `In bed by ${tm(bed)}, same wake time`, f.vshort || f.short ? 'Make up with a steady schedule rather than a big lie-in: regular sleepers sleep better and live longer (Phillips 2017, Windred 2024).' : 'A steady bedtime and wake time is the habit with the strongest link to good sleep (Windred 2024).']);
  if (f.lowDeep || f.vshort) night.push(['ex', 'Move today, finish 1+ h before bed', 'Exercise adds deep sleep (Kredlow 2015); evening exercise is fine, just avoid vigorous effort in the last hour (Stutz 2019).']);
  if (f.lowRem || f.restless) night.push(['alc', 'Skip alcohol tonight', 'Alcohol delays and cuts REM and breaks up the second half of the night, even at low doses (Ebrahim 2013, Pietilä 2018).']);
  if (f.lowDeep || f.restless) night.push(['bath', `Warm shower around ${tm(bed - 90)}`, 'A warm bath or shower 1–2 h before bed helps you fall asleep faster and may deepen sleep (Haghayegh 2019).']);
  night.push(['light', `Dim lights and screens from ${tm(bed - 180)}`, 'Bright evening light delays sleep; keep it dim for the last 3 h and the bedroom dark (Brown 2022).']);
  if (f.restless) night.push(['temp', 'Cool, quiet bedroom', 'Too warm or too cold cuts deep sleep and REM (Okamoto-Mizuno 2012). Around 60–67 °F works for most people.']);
  if (f.restless || sodHigh) night.push(['salt', sodHigh ? `Go easy on salt tonight (${t.sodium.toLocaleString()} mg so far)` : 'Light on salt and fluids late', 'Less salt meant fewer bathroom trips at night (Matsuo 2019). Finish most drinks a couple of hours before bed.']);
  if (f.lowDeep) night.push(['meal', `Dinner done by ${tm(bed - 150)}`, 'Fiber went with more deep sleep and saturated fat and sugar with less (St-Onge 2016). Finishing 2–3 h before bed is common advice, though less tested.']);
  // ---- a pattern, not just one night
  const wk = ss.slice(0, 7), wkAvg = wk.length >= 5 ? sum(wk, s => s.asleep) / wk.length / 60 : null;
  const effs = ss.slice(0, 14).filter(s => s.awake != null).map(s => s.asleep / (s.asleep + s.awake) * 100), poorEff = effs.length >= 7 && effs.filter(e => e < 85).length / effs.length > 0.6;
  const pattern = wkAvg != null && wkAvg < 6.5 ? `Your last ${wk.length} nights average ${r1(wkAvg)} h.` : poorEff ? 'Most of your last two weeks were restless nights.' : null;
  // an older night (last night not pulled yet) still informs tonight, but not today's plan
  return { n, hrs, eff, st, f, day: n.date === today ? day : [], night, pattern, longWake, isToday: n.date === today };
}
const SC_ICON = { mood: '☺︎', mind: '∑', ex: '🏃', food: '🍽', nap: '☾', warn: '⚠︎', bp: '♥', ok: '✓', deep: '◐', rem: '◑', wake: '☼', caf: '☕︎', bed: '⏾', alc: '🍷', bath: '♨︎', light: '☀︎', temp: '❄︎', salt: '🧂', meal: '🥗' };
function sleepGrade(c) { const f = c.f; return f.vshort ? ['bad', 'short'] : f.short ? ['warn', 'a bit short'] : f.restless ? ['warn', 'restless'] : f.lowDeep || f.lowRem ? ['warn', 'light on ' + (f.lowDeep ? 'deep' : 'REM')] : ['ok', 'good']; }
function sleepCoachCard(compact) {
  const c = sleepCoach(); if (!c) return '';
  const [gk, gt] = sleepGrade(c), n = c.n;
  const tip = ([k, title, why]) => `<li class="sct"><span class="sci" aria-hidden="true">${SC_ICON[k] || '•'}</span><span><b>${title}</b>${compact ? '' : `<span class="s">${why}</span>`}</span></li>`;
  const stg = c.st ? [['deep', 'Deep', 'var(--deep)', c.f.lowDeep], ['light', 'Light', 'var(--pro)', false], ['dream', 'REM', 'var(--acc)', c.f.lowRem]] : [];
  const head = `<h3 class="row" style="align-items:center">${c.isToday ? 'Last night' : fmtD(n.date)}<span style="display:flex;align-items:center;gap:6px"><span class="pill ${gk}">${gt}</span>${compact ? '' : tipBtn([['', 'Tips are based on sleep research (AASM, NSF and meta-analyses). Rings tell sleep from wake well but only estimate stages, so deep and REM are also compared with your own last two weeks.'], ['', 'Ranges used: 7–9 h asleep; deep 10–25% and REM 15–30% of sleep; efficiency (asleep ÷ time in bed) 85%+.']], 'About these tips')}</span></h3>`;
  const sum1 = `<div class="scsum"><b>${Math.floor(n.asleep / 60)}h ${pad(n.asleep % 60)}m</b>${stg.map(([k, l, col, low]) => `<span><i style="background:${col}"></i>${l} ${Math.round(c.st[k])}%${low ? ' <em>low</em>' : ''}</span>`).join('')}${c.eff != null ? `<span>Eff ${Math.round(c.eff)}%</span>` : ''}</div>`;
  if (compact) return `<div class="card sccard">${head}${sum1}<ul class="sclist">${[...new Set([c.day[0], ...['mind', 'mood'].map(k => c.day.find(x => x[0] === k))])].filter(Boolean).map(tip).join('')}${tip(c.night[0])}</ul>${c.isToday ? '' : '<div class="sm mut">Last night isn’t in yet: ⇪ → Pull from Health.</div>'}<button class="linkbtn" data-tab="sleep">All sleep tips ›</button></div>`;
  return `<div class="card sccard">${head}${sum1}
    ${c.isToday ? `<div class="sch">For today</div><ul class="sclist">${c.day.map(tip).join('')}</ul>` : '<div class="sm mut" style="margin-top:8px">Last night isn’t in yet: ⇪ → Pull from Health for today’s tips.</div>'}
    <div class="sch">For tonight</div><ul class="sclist">${c.night.map(tip).join('')}</ul>
    ${c.pattern ? `<div class="note warn" style="margin-top:10px">${c.pattern} If it keeps up, the proven fix is CBT-I (insomnia therapy, AASM 2021), not more sleep tips. Loud snoring or gasping is worth raising with your doctor.</div>` : ''}</div>`;
}

V.bp = () => {
  const bs = all('bp').sort((a, b) => a.datetime.localeCompare(b.datetime));
  if (!bs.length) return '<div class="card">No readings.</div>';
  // the chart shows the same period as the Highs & lows buttons
  const rg = bpRange(), cs = rg === 'all' ? bs : bs.filter(b => b.datetime.slice(0, 10) >= addDays(todayStr(), -(+rg - 1)));
  const first = rg === 'all' ? bs[0].datetime.slice(0, 10) : addDays(todayStr(), -(+rg - 1)), last = todayStr() > bs[bs.length - 1].datetime ? todayStr() : bs[bs.length - 1].datetime.slice(0, 10);
  const xi = dt => daysBetween(first, dt.slice(0, 10)) + (+dt.slice(11, 13) || 12) / 24;
  const span = Math.max(1, daysBetween(first, last) + 1), xl = [], every = span <= 10 ? 1 : span <= 45 ? 7 : 0;
  for (let d = first, i = 0; d <= last; d = addDays(d, 1), i++)
    if (every ? i % every === 0 : pdate(d).getDate() === 1 ? span <= 200 || pdate(d).getMonth() % 3 === 0 : d === first && span <= 200 && pdate(d).getDate() < 20) xl.push({ x: xi(d + ' 00') + (every === 1 ? 0.5 : 0), t: every === 1 && i ? String(pdate(d).getDate()) : fmtShort(d) });
  const lbl = b => `${fmtShort(b.datetime)} ${b.datetime.slice(11, 16)}`;
  const sys = cs.map(b => [xi(b.datetime), b.sys, bpCat(b.sys, 0).c, lbl(b)]), dia = cs.map(b => [xi(b.datetime), b.dia, bpCat(0, b.dia).c, lbl(b)]);
  const ymax = Math.max(180, ...cs.map(b => b.sys)) + 5;
  const svg = chart({ x0: 0, x1: span, y0: 60, y1: ymax, ylabelsEvery: 20, xlabels: xl,
    bands: [{ lo: 60, hi: 80, color: 'var(--band2)' }, { lo: 90, hi: 120, color: 'var(--band2)' }],
    hlines: [...[{ y: 140, color: 'var(--bad)' }, { y: 130, color: 'var(--warn)' }, { y: 90, color: 'var(--bad)' }, { y: 80, color: 'var(--warn)' }].filter(l => l.y !== CFG.bpSys && l.y !== CFG.bpDia).map(l => ({ ...l, label: String(l.y) })),
      { y: CFG.bpSys, color: 'var(--ok)', label: `target ${CFG.bpSys}` }, { y: CFG.bpDia, color: 'var(--ok)', label: String(CFG.bpDia) }],
    xfirst: first, series: [{ pts: sys, color: 'var(--mut2)', line: true, dots: true, width: 1, tip: { n: 'sys' } }, { pts: dia, color: 'var(--dia)', line: true, dots: true, width: 1, r: 3, tip: { n: 'dia' } }] });
  const recent = bs.filter(b => daysBetween(b.datetime.slice(0, 10), bs[bs.length - 1].datetime.slice(0, 10)) <= 30);
  const avgS = Math.round(sum(recent, b => b.sys) / recent.length), avgD = Math.round(sum(recent, b => b.dia) / recent.length);
  const onT = b => b.sys < CFG.bpSys && b.dia < CFG.bpDia, hit = cs.filter(onT).length, pct = cs.length ? Math.round(hit / cs.length * 100) : 0;
  const highs = bs.filter(b => bpCat(b.sys, b.dia).high).length, st2 = bs.filter(b => b.sys >= 140 || b.dia >= 90).length, l = bs[bs.length - 1], lc = bpCat(l.sys, l.dia), ac = bpCat(avgS, avgD);
  let h = `<div class="card"><h3>Blood pressure <small>upper = systolic, lower = diastolic</small></h3>${cs.length ? '' : '<div class="sm mut">No readings in this period.</div>'}${svg}
    <div class="legend"><span><i style="background:var(--ok)"></i>normal</span><span><i style="background:var(--sod)"></i>elevated</span><span><i style="background:var(--warn)"></i>stage 1 (130/80)</span><span><i style="background:var(--bad)"></i>stage 2 (140/90)</span></div>
    <div class="row" style="margin-top:10px;align-items:center"><span><b style="color:var(--ok)">${hit}/${cs.length}</b> <span class="sm mut">under ${CFG.bpSys}/${CFG.bpDia}${BP_PLAN[setting('bp_target_plan', '')] ? ` (${BP_PLAN[setting('bp_target_plan', '')]})` : ''} · ${pct}%</span></span><button class="linkbtn" data-bptarget>Change target</button></div></div>`;
  h += bpStepCard(bs);
  h += bpRangeCard(bs);
  h += `<div class="card"><div class="stat3"><div><b style="color:${lc.c}">${l.sys}/${l.dia}</b><span>latest</span></div><div><b style="color:${ac.c}">${avgS}/${avgD}</b><span>avg ${recent.length} (30 d)</span></div><div><b style="color:var(--bad)">${highs}/${bs.length}</b><span>high (${st2} stage 2+)</span></div></div>
    <div class="sm mut" style="margin-top:8px">Categories follow ACC/AHA home-reading cutoffs. Several readings are in the stage-2 range; worth reviewing with your doctor. Anything over 180/120 with symptoms needs urgent care.</div></div>`;
  h += `<div class="card"><h3>Readings</h3><ul class="list">${bs.slice().reverse().map(b => { const c = bpCat(b.sys, b.dia);
    return `<li><span class="m"><div class="n">${fmtD(b.datetime)} <span class="sm mut">${esc(b.datetime.slice(11))}</span>${b.local ? '<span class="pill local">new</span>' : ''}</div><div class="s">${esc(b.note)}</div></span>
      <span class="v"><b style="color:${c.c}">${b.sys}/${b.dia}</b><div><span class="pill ${c.k}">${c.high ? '⚠ ' : ''}${c.t}</span></div></span></li>`; }).join('')}</ul></div>`;
  return h;
};

/** on BP medication: has the last 30 days stayed under the "ask about a lower dose" line? (needs 10+ readings, 90% under, average under) */
function bpStepCard(bs) {
  if (!String(setting('bp_target_plan', '')).startsWith('meds')) return '';
  const from = addDays(todayStr(), -29), r = bs.filter(b => b.datetime.slice(0, 10) >= from), S = CFG.bpStepSys, D = CFG.bpStepDia;
  const n = r.length, under = r.filter(b => b.sys < S && b.dia < D).length, pct = n ? Math.round(under / n * 100) : 0;
  const aS = n ? Math.round(sum(r, b => b.sys) / n) : 0, aD = n ? Math.round(sum(r, b => b.dia) / n) : 0, low = r.filter(b => b.sys < 100).length;
  const ready = n >= 10 && pct >= 90 && aS < S && aD < D;
  const bar = `<div class="bar" style="margin:8px 0 6px"><i style="width:${pct}%;background:${ready ? 'var(--ok)' : 'var(--acc)'}"></i></div>`;
  let msg = ready ? `<b style="color:var(--ok)">Steadily under ${S}/${D} for 30 days.</b> Worth asking your doctor whether a lower dose makes sense. Don't stop or cut back on your own.`
    : n < 10 ? `Needs at least 10 readings in 30 days to judge (${n} so far).`
    : `Needs 90% of readings and the average under ${S}/${D}.`;
  if (low || (n >= 5 && aS < 110)) msg += ` <div style="margin-top:6px;color:var(--warn)">${low ? `${low} reading${low === 1 ? ' is' : 's are'} under 100 systolic. ` : ''}Low readings on medication, especially with dizziness, are worth a call to your doctor.</div>`;
  return `<div class="card"><h3 class="row" style="align-items:center">Lower-dose check<small>last 30 days</small></h3>
    <div class="row"><span><b style="color:${ready ? 'var(--ok)' : 'var(--tx)'}">${under}/${n}</b> <span class="sm mut">under ${S}/${D} · ${pct}%</span></span><span class="sm mut">avg ${aS}/${aD}</span></div>${bar}
    <div class="sm">${msg}</div></div>`;
}
const BP_RANGES = [['7', '7 d'], ['30', '30 d'], ['90', '90 d'], ['365', '1 yr'], ['all', 'All']];
function sleepAwake() { try { return localStorage.getItem('fit.sleepawake') === '1'; } catch { return false; } }
function sleepPref(k) { try { return localStorage.getItem('fit.sleep' + k) === '1'; } catch { return false; } }
function bpRange() { try { return localStorage.getItem('fit.bprange') || '30'; } catch { return '30'; } }
function bpRangeCard(bs) {
  const r = bpRange(), today = todayStr(), from = r === 'all' ? '' : addDays(today, -(+r - 1));
  const sel = bs.filter(b => b.datetime.slice(0, 10) >= from);
  const seg = `<div class="seg" style="margin-bottom:10px">${BP_RANGES.map(([k, t]) => `<button data-bprange="${k}" class="${k === r ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const span = r === 'all' ? (bs.length ? `since ${fmtShort(bs[0].datetime)}` : '') : `${fmtShort(from)} – ${fmtShort(today)}`;
  if (!sel.length) return `<div class="card"><h3>Highs &amp; lows <small>${span}</small></h3>${seg}<div class="mut">No readings in this period.</div></div>`;
  const pick = (k, f) => sel.reduce((a, b) => (f(b[k], a[k]) || (b[k] === a[k] && b.datetime > a.datetime) ? b : a));
  const hiS = pick('sys', (x, y) => x > y), loS = pick('sys', (x, y) => x < y), hiD = pick('dia', (x, y) => x > y), loD = pick('dia', (x, y) => x < y);
  const cell = (b, k) => { const c = k === 'sys' ? bpCat(b.sys, 0) : bpCat(0, b.dia);
    return `<td><b style="color:${c.c}">${b[k]}</b><div class="sm mut">${b.sys}/${b.dia} · ${fmtShort(b.datetime)} ${esc(b.datetime.slice(11))}</div></td>`; };
  const avgS = Math.round(sum(sel, b => b.sys) / sel.length), avgD = Math.round(sum(sel, b => b.dia) / sel.length), ac = bpCat(avgS, avgD);
  return `<div class="card"><h3>Highs &amp; lows <small>${span}</small></h3>${seg}
    <table class="t bpx"><tr><th></th><th>Highest</th><th>Lowest</th></tr>
      <tr><td class="b">Systolic</td>${cell(hiS, 'sys')}${cell(loS, 'sys')}</tr>
      <tr><td class="b">Diastolic</td>${cell(hiD, 'dia')}${cell(loD, 'dia')}</tr></table>
    <div class="sm mut" style="margin-top:8px">${sel.length} reading${sel.length === 1 ? '' : 's'} · average <b style="color:${ac.c}">${avgS}/${avgD}</b> (${ac.t})</div></div>`;
}

/* ---------- quick add ---------- */
/* ---------- food library: every food logged so far + data/food_library.csv, newest values win ---------- */
let LIBVIEW = [];
const libKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function foodLib() {
  const m = new Map(), alias = new Map();
  // data/food_library.csv rows are canonical: fixed values, and their aliases fold logged variants into one entry
  (SNAP.foodLib || []).forEach(e => {
    const k = libKey(e.item); if (!k) return;
    m.set(k, { item: e.item.trim(), kcal: e.kcal, protein: e.protein, carbs: e.carbs ?? null, sodium: e.sodium ?? null, sodiumNote: e.sodiumNote || '', n: 0, last: '', fixed: true });
    (e.aliases || []).forEach(a => alias.set(libKey(a), k));
  });
  all('food').forEach(e => {
    let k = libKey(e.item); if (!k) return; k = alias.get(k) || k;
    const when = `${e.date} ${e.time || ''}`, o = m.get(k);
    const q = e.qty > 0 ? e.qty : 1, per = (x, r) => x == null ? null : r(x / q);
    const v = { item: e.item.trim(), kcal: per(e.kcal, Math.round), protein: per(e.protein, r1), carbs: per(e.carbs, r1), sodium: per(e.sodium, Math.round), sodiumNote: e.sodiumNote || '' };
    if (!o) return m.set(k, { ...v, n: 1, last: when });
    o.n++;
    if (when >= o.last) { o.last = when; if (!o.fixed) Object.assign(o, v); }
  });
  return [...m.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last) || a.item.localeCompare(b.item));
}
function libList(q) {
  const words = libKey(q).split(' ').filter(Boolean), lib = foodLib();
  LIBVIEW = (words.length ? lib.filter(f => words.every(w => f.item.toLowerCase().includes(w))) : lib).slice(0, words.length ? 30 : 8);
  if (!LIBVIEW.length) return `<div class="sm mut" style="padding:8px 2px">No saved food matches. Type it in below; it joins the library once saved.</div>`;
  return `<ul class="list lib">${LIBVIEW.map((f, i) => `<li><button type="button" data-libpick="${i}"><span class="m"><div class="n">${esc(f.item)}</div>
    <div class="s">${f.kcal} kcal · ${f.protein} g protein${f.carbs != null ? ` · ${f.carbs} g carbs` : ''} · ${f.sodium != null ? f.sodium + ' mg Na' : 'Na ?'}${f.n ? ` · ×${f.n}` : ' · saved'}</div></span></button></li>`).join('')}</ul>`;
}
function libPick(i) {
  const f = LIBVIEW[i], form = $('#addForm'); if (!f || !form) return;
  form.item.value = f.item; form.kcal.value = f.kcal; form.protein.value = f.protein;
  form.sodium.value = f.sodium ?? ''; form.carbs.value = f.carbs ?? ''; form.sodEst.checked = !/label/i.test(f.sodiumNote);
  form.libNote.value = f.sodiumNote; form.libSod.value = f.sodium ?? '';
  form.qty.value = 1; FBASE = { kcal: f.kcal, protein: f.protein, carbs: f.carbs, sodium: f.sodium };
  $('#libQ').value = ''; $('#libBox').innerHTML = `<div class="note" style="margin-top:0">Filled from your library for a qty of 1. Change Qty and the numbers follow, or adjust anything, then Save.</div>`;
}
/* qty: the nutrition fields always hold totals for the qty; FBASE keeps the values for a qty of 1 */
let FBASE = {};
const QROUND = { kcal: Math.round, protein: r1, carbs: r1, sodium: Math.round };
const formQty = form => { const q = Number(form.qty.value); return q > 0 ? q : 1; };
function qtyInput(form, name) {
  if (name === 'qty') { Object.keys(QROUND).forEach(k => { if (FBASE[k] != null) form[k].value = QROUND[k](FBASE[k] * formQty(form)); }); return; }
  const v = form[name].value; FBASE[name] = v === '' ? null : Number(v) / formQty(form);
}

const FORMS = {
  food: d => `<label>From your foods</label><input id="libQ" type="search" placeholder="Search saved foods (e.g. latte, Ben's)" autocomplete="off">
    <div id="libBox">${libList('')}</div>
    <input type="hidden" name="libNote"><input type="hidden" name="libSod">
    <label>Item</label><input name="item" required placeholder="e.g. Greek yogurt 3/4 cup">
    <div class="g2"><div><label>Qty</label><input name="qty" type="number" step="any" min="0" inputmode="decimal" value="1"></div><div class="sm mut" style="align-self:end;padding-bottom:10px">Servings of the item above. The numbers below are for the whole qty.</div></div>
    <div class="g2"><div><label>kcal</label><input name="kcal" type="number" step="any" inputmode="decimal" required></div><div><label>Protein g</label><input name="protein" type="number" step="any" inputmode="decimal" value="0"></div></div>
    ${CFG.kid ? '<input type="hidden" name="carbs"><input type="hidden" name="sodium"><input type="hidden" name="sodEst" value="on">'
      : `<div class="g2"><div><label>Carbs g</label><input name="carbs" type="number" step="any" inputmode="decimal" placeholder="optional"></div><div><label>Sodium mg</label><input name="sodium" type="number" step="any" inputmode="numeric" placeholder="optional"></div></div>
    <label class="chk"><input type="checkbox" name="sodEst" checked> Sodium is an estimate</label>`}
    <div class="g2"><div><label>Date</label><input name="date" type="date" value="${d}" required></div><div><label>Time</label><input name="time" type="time" value="${nowTime()}" required></div></div>`,
  exercise: d => `<label>Activity</label><input name="activity" required placeholder="e.g. Walk, Lower body + core, Shoulder care" list="actList">
    <datalist id="actList"><option>Outdoor walk</option><option>Lower body + core</option><option>Shoulder care exercises</option><option>Band shoulder work</option><option>Rowing (damper 2-3)</option><option>Line dancing</option></datalist>
    <div class="g3"><div><label>Minutes</label><input name="minutes" type="number" inputmode="numeric" required></div><div><label>Est kcal</label><input name="kcal" type="number" inputmode="numeric"></div><div><label>Date</label><input name="date" type="date" value="${d}" required></div></div>
    <label class="chk"><input type="checkbox" name="inHealth"> Already recorded by iPhone/Watch (don't send to Health)</label>`,
  weight: d => `<div class="g2"><div><label>Weight (lb)</label><input name="weight" type="number" step="0.1" inputmode="decimal" required></div><div><label>Date</label><input name="date" type="date" value="${d}" required></div></div>`,
  bp: d => `<div class="g2"><div><label>Systolic</label><input name="sys" type="number" inputmode="numeric" required></div><div><label>Diastolic</label><input name="dia" type="number" inputmode="numeric" required></div></div>
    <div class="g2"><div><label>Date</label><input name="date" type="date" value="${d}" required></div><div><label>Time</label><input name="time" type="time" value="${nowTime()}" required></div></div>
    <label>Note</label><input name="note" placeholder="optional (e.g. morning, after coffee)">`,
  sleep: d => `<label class="chk"><input type="checkbox" name="nap"> This was a nap</label>
    <div class="g2"><div><label>Date (wake day)</label><input name="date" type="date" value="${d}" required></div><div><label>Sleep score</label><input name="score" type="number" inputmode="numeric" placeholder="optional"></div></div>
    <div class="g2"><div><label>Bed time</label><input name="bed" type="time"></div><div><label>Wake time</label><input name="wake" type="time"></div></div>
    <label>Minutes asleep (blank = wake − bed)</label><input name="asleep" type="number" inputmode="numeric">
    <div class="g3"><div><label>Deep</label><input name="deep" type="number"></div><div><label>Light</label><input name="light" type="number"></div><div><label>REM</label><input name="dream" type="number"></div></div>
    <label>Source</label><input name="source" value="self-report">`,
};
function openAdd(kind) {
  kind = kind || ({ weight: 'weight', sleep: CFG.sleepInput === false ? '' : 'sleep', bp: 'bp' }[state.tab]) || 'food';
  if (CFG.kid && kind !== 'weight') kind = 'food';
  const d = state.tab === 'today' && state.day ? state.day : todayStr();
  const sh = $('#sheet'); FBASE = {};
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Quick add</b><button class="iconbtn" data-close>✕</button></div>
    <div class="seg">${(CFG.kid ? ['food', 'weight'] : ['food', 'exercise', 'weight', 'bp', 'sleep'].filter(k => (k !== 'exercise' || CFG.exerciseInput !== false) && (k !== 'sleep' || CFG.sleepInput !== false))).map(k => `<button data-kind="${k}" class="${k === kind ? 'on' : ''}">${{ food: 'Food', exercise: 'Exercise', weight: 'Weight', bp: 'BP', sleep: 'Sleep' }[k]}</button>`).join('')}</div>
    <form class="f" id="addForm" data-kind="${kind}">${FORMS[kind](d)}<button class="btn" type="submit">Save</button></form>
    <div class="sm mut" style="margin-top:10px">Saved on this phone only. Use ⇪ Export to send new entries back for merging.</div></div>`;
  sh.classList.remove('hidden');
}
function minsBetween(bed, wake) { if (!bed || !wake) return null; const [a, b] = bed.split(':').map(Number), [c, d] = wake.split(':').map(Number); let m = (c * 60 + d) - (a * 60 + b); if (m <= 0) m += 1440; return m; }
function submitAdd(form) {
  const kind = form.dataset.kind, f = Object.fromEntries(new FormData(form)), num = v => v === '' || v == null ? null : Number(v);
  let e;
  if (kind === 'food') e = { date: f.date, time: f.time, item: f.item.trim(), ...(Number(f.qty) > 0 && Number(f.qty) !== 1 ? { qty: Number(f.qty) } : {}), kcal: num(f.kcal) || 0, protein: num(f.protein) || 0, carbs: num(f.carbs), sodium: num(f.sodium), sodiumNote: f.sodium === '' ? '' : (f.libNote && f.sodium === f.libSod && !!f.sodEst === !/label/i.test(f.libNote)) ? f.libNote : (f.sodEst ? 'est' : 'label') };
  if (kind === 'exercise') e = { date: f.date, activity: f.activity.trim(), minutes: num(f.minutes), kcal: num(f.kcal), ...(f.inHealth ? { inHealth: true } : {}) };
  if (kind === 'weight') e = { date: f.date, time: '', note: '', weight: num(f.weight) };
  if (kind === 'bp') e = { datetime: `${f.date} ${f.time}`, sys: num(f.sys), dia: num(f.dia), note: f.note || '' };
  if (kind === 'sleep') { const nap = !!f.nap; e = { date: f.date, bed: nap ? 'nap' : f.bed, wake: f.wake, asleep: num(f.asleep) ?? minsBetween(f.bed, f.wake), deep: num(f.deep), light: num(f.light), dream: num(f.dream), awake: null, source: f.source || 'self-report', score: num(f.score), nap }; }
  addLocal(kind, e); closeSheet();
  const c = bpCat(e.sys || 0, e.dia || 0);
  toast(kind === 'bp' && c.high ? `Saved — ${c.t} reading` : 'Saved'); render();
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheet').innerHTML = ''; }

/* ---------- export ---------- */
const SCHEMA = {
  food: ['date', 'time', 'item', 'calories', 'protein_g', 'sodium_mg', 'sodium_note', 'carbs_g', 'qty'],
  exercise: ['date', 'activity', 'minutes', 'est_kcal', 'in_health'],
  weight: ['date', 'weight_lb'],
  bp: ['datetime', 'systolic', 'diastolic', 'note'],
  sleep: ['date', 'bed', 'wake', 'asleep_min', 'deep', 'light', 'dream', 'awake', 'source', 'sleep_score', 'stages'],
  passes: ['date', 'note'],
  active: ['date', 'active_kcal', 'source'],
  habits: ['date', 'habit'],
  goals: ['date', 'goal_low_lb', 'goal_high_lb', 'by_date'],
  settings: ['date', 'setting', 'value'],
};
const TOROW = {
  food: e => [e.date, e.time, e.item, e.kcal, e.protein, e.sodium, e.sodiumNote, e.carbs, e.qty && e.qty !== 1 ? e.qty : ''],
  exercise: e => [e.date, e.activity, e.minutes, e.kcal, e.inHealth ? 'yes' : ''],
  weight: e => [e.date + (e.time ? ' ' + e.time : '') + (e.note ? ` (${e.note})` : ''), e.weight],
  bp: e => [e.datetime, e.sys, e.dia, e.note],
  sleep: e => [e.date, e.bed, e.wake, e.asleep, e.deep, e.light, e.dream, e.awake, e.source, e.score, e.stages],
  passes: e => [e.date, e.note],
  active: e => [e.date, e.kcal, e.source],
  habits: e => [e.date, e.habit],
  goals: e => [e.date, e.low, e.high, e.by],
  settings: e => [e.date, e.key, e.value],
};
const csvCell = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function exportCSV() {
  // one combined file: first column = log name, then that log's own columns (same order as its CSV)
  const lines = ['log,fields...'];
  LOGS.forEach(log => pendingLocal(log).forEach(e => lines.push([log, ...TOROW[log](e)].map(csvCell).join(','))));
  return lines.join('\n') + '\n';
}
async function doExport() {
  const n = LOGS.reduce((t, l) => t + pendingLocal(l).length, 0);
  if (!n) return toast('No new entries to export');
  const csv = exportCSV(), name = `fitness_added_${todayStr()}_${nowTime().replace(':', '')}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (err) { if (err.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/* ---------- theme: auto (follows iPhone setting) / light / dark; stored per device ---------- */
const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
function getTheme() { try { return localStorage.getItem('fit.theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme(t) {
  const r = document.documentElement;
  t === 'auto' ? r.removeAttribute('data-theme') : r.setAttribute('data-theme', t);
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = getComputedStyle(r).getPropertyValue('--bg').trim();
}
function themeCard() {
  const cur = getTheme();
  return `<div class="card" style="margin-top:12px"><h3>Appearance</h3><div class="seg" style="margin-bottom:0">${THEMES.map(([k, l]) =>
    `<button data-theme="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="sm mut" style="margin-top:6px">Auto follows your iPhone's Light/Dark setting.</div></div>`;
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => applyTheme(getTheme()));
applyTheme(getTheme());
function openData() {
  const sh = $('#sheet'), counts = LOGS.map(l => [l, pendingLocal(l)]);
  const total = counts.reduce((t, c) => t + c[1].length, 0);
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Data &amp; export</b><button class="iconbtn" data-close>✕</button></div>
    <div class="sm mut">Snapshot built ${esc(SNAP.builtAt)} from the CSVs. ${total} new entr${total === 1 ? 'y' : 'ies'} on this device not yet in the snapshot.</div>
    <button class="btn" data-export>⇪ Export new entries (CSV)</button>
    <button class="btn sec" data-copy>Copy CSV to clipboard</button>
    ${themeCard()}
    ${healthCard()}
    ${counts.filter(c => c[1].length).map(([l, es]) => `<div class="card" style="margin-top:12px"><h3>${l} <small>${es.length}</small></h3><ul class="list">${es.map(e => `<li><span class="m sm">${esc(TOROW[l](e).filter(v => v != null && v !== '').join(' · '))}</span><button class="del" data-del="${l}:${e._id}">✕</button></li>`).join('')}</ul></div>`).join('')}
    <div class="sm mut" style="margin-top:12px">After the export has been merged into the CSVs and the app rebuilt, merged entries disappear from this list automatically.</div>
    ${total ? '<button class="btn danger" data-clear>Delete all new entries on this device</button>' : ''}
    ${SNAP._enc ? '<button class="btn sec" data-lock>Lock &amp; forget passcode on this device</button>' : ''}</div>`;
  sh.classList.remove('hidden');
}

/* ---------- Apple Health (via two iOS Shortcuts; web apps can't reach HealthKit directly) ----------
   Send: app → shortcuts://run-shortcut?name=Fitness to Health&input=text&text=<JSON>, then the user confirms it finished.
   Pull: "Health to Fitness" copies lines to the clipboard; the user comes back and taps Paste.
   Line format: W|iso|value|unit|source · S|iso|systolic · D|iso|diastolic · Z|startIso|endIso|stage|source */
const H_SEND = 'Fitness to Health', H_PULL = 'Health to Fitness', H_FLAG = NS + 'health.pending';
let HIMPORT = null;
const hLocal = d => `${dstr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
function hWhen(e, date, time) {
  if (time) return `${date} ${time}`;
  const a = e._added ? new Date(e._added) : null;
  return a && dstr(a) === date ? hLocal(a) : `${date} 12:00`;
}
function hQueue() { const q = {}; ['weight', 'bp', 'food', 'exercise'].forEach(l => q[l] = pendingLocal(l).filter(e => !e._health)); return q; }
const hCount = q => Object.values(q).reduce((t, a) => t + a.length, 0);
function hPayload(q) {
  const p = { weight: [], bp: [], kcal: [], protein: [], carbs: [], sodium: [], active: [], workouts: [] };
  q.weight.forEach(e => e.weight != null && p.weight.push({ v: e.weight, d: hWhen(e, e.date, e.time) }));
  q.bp.forEach(e => p.bp.push({ s: e.sys, dia: e.dia, d: e.datetime }));
  q.food.forEach(e => { const d = `${e.date} ${e.time}`;
    if (e.kcal) p.kcal.push({ v: e.kcal, d }); if (e.protein) p.protein.push({ v: e.protein, d }); if (e.carbs) p.carbs.push({ v: e.carbs, d }); if (e.sodium) p.sodium.push({ v: e.sodium, d }); });
  q.exercise.forEach(e => e.kcal && !e.inHealth && p.active.push({ v: e.kcal, d: hWhen(e, e.date, '') }));
  q.exercise.forEach(e => e.minutes && p.workouts.push({ name: e.activity, min: e.minutes, kcal: e.kcal || 0, d: hWhen(e, e.date, '') }));
  return p;
}
function runShortcut(name, text) {
  location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(name) + (text != null ? '&input=text&text=' + encodeURIComponent(text) : '');
}
const setFlag = v => { try { v ? localStorage.setItem(H_FLAG, JSON.stringify(v)) : localStorage.removeItem(H_FLAG); } catch {} };
const getFlag = () => { try { return JSON.parse(localStorage.getItem(H_FLAG)); } catch { return null; } };
function healthSend() {
  const q = hQueue(), n = hCount(q);
  if (!n) return toast('Nothing new to send');
  setFlag({ kind: 'send', ids: Object.values(q).flat().map(e => e._id), at: Date.now() });
  runShortcut(H_SEND, JSON.stringify(hPayload(q)));
}
function healthPull() { setFlag({ kind: 'pull', at: Date.now() }); runShortcut(H_PULL); }

function hNum(s) {
  s = String(s ?? '').trim(); if (!s.includes('.')) s = s.replace(',', '.');
  const v = parseFloat(s.replace(/[^\d.\-]/g, '')); return isNaN(v) ? null : v;
}
function hDate(s) { const d = new Date(String(s ?? '').trim().replace(' at ', ' ')); return isNaN(d) ? null : d; }
function hStage(v) {
  const s = String(v ?? '').trim().toLowerCase();
  const code = { 0: 'inbed', 1: 'asleep', 2: 'awake', 3: 'core', 4: 'deep', 5: 'rem' }[s];
  if (code) return code;
  if (/in ?bed/.test(s)) return 'inbed'; if (/awake/.test(s)) return 'awake'; if (/deep/.test(s)) return 'deep';
  if (/rem/.test(s)) return 'rem'; if (/core|light/.test(s)) return 'core'; if (/asleep|unspecified/.test(s)) return 'asleep';
  return null;
}
/** clipboard text from "Health to Fitness" → candidate entries {weight, bp, sleep} in app format */
/** workout duration from Shortcuts: "20 min", "1,200 sec", "1 hr 5 min", "0:20:00" or bare seconds → whole minutes */
function hDur(s) {
  s = String(s || '').replace(/,/g, '').trim(); if (!s) return null;
  const c = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (c) return Math.round(c[3] != null ? +c[1] * 60 + +c[2] + +c[3] / 60 : +c[1] + +c[2] / 60);
  let m = 0, any = false;
  s.replace(/([\d.]+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/gi, (_, n, u) => { any = true; u = u[0].toLowerCase(); m += u === 'h' ? n * 60 : u === 's' ? n / 60 : +n; });
  if (any) return Math.round(m);
  const n = hNum(s); return n == null ? null : Math.round(n > 300 ? n / 60 : n);
}
function parseHealth(text) {
  const out = { weight: [], bp: [], sleep: [], active: [], food: [], exercise: [], bad: 0 }, sys = {}, dia = {}, segs = [], act = {}, actE = {}, actH = {}, seenA = new Set(), meals = {};
  String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    const f = line.split('|').map(x => x.trim()), t = f[0].toUpperCase();
    if (t === 'K') { const d = hDate(f[1]), type = (f[2] || '').replace(/^HKWorkoutActivityType/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      if (!d || !type) return out.bad++;
      const e = { date: dstr(d), activity: type + (f[5] ? ` (${f[5]})` : ''), minutes: hDur(f[3]), kcal: f[4] ? Math.round(/kj/i.test(f[4]) ? hNum(f[4]) / 4.184 : hNum(f[4]) || 0) || null : null, inHealth: true };
      if (!out.exercise.some(x => KEY.exercise(x) === KEY.exercise(e))) out.exercise.push(e); return; }
    if ('FPCNX'.includes(t) && t.length === 1) { const d = hDate(f[1]), v = hNum(f[2]); if (!d || v == null) return out.bad++;
      const k = hLocal(d);
      if (t === 'X') { out.exercise.push({ date: dstr(d), activity: 'Exercise (recovered from Health)', minutes: null, kcal: Math.round(/kj/i.test(f[3] || '') ? v / 4.184 : v) }); return; }
      const m = meals[k] = meals[k] || { date: dstr(d), time: k.slice(11), item: 'Food (recovered from Health)', kcal: 0, protein: 0, sodium: null, sodiumNote: 'Health', carbs: null };
      if (t === 'F') m.kcal += Math.round(/kj/i.test(f[3] || '') ? v / 4.184 : v);
      else if (t === 'P') m.protein = r1(m.protein + v);
      else if (t === 'C') m.carbs = r1((m.carbs || 0) + v);
      else m.sodium = Math.round((m.sodium || 0) + (/^g$/i.test((f[3] || '').trim()) ? v * 1000 : v));
      return; }
    if (t === 'A' || t === 'E') { const d = hDate(f[1]), v = hNum(f[2]); if (!d || v == null) return out.bad++;
      // Active Energy is summed, so an identical repeated line (e.g. the block added twice in the shortcut) must count once
      const id = [t, f[1], f[2], f[4] || ''].join('|'); if (seenA.has(id)) return out.dupA = (out.dupA || 0) + 1; seenA.add(id);
      const k = dstr(d), kc = /kj/i.test(f[3] || '') ? v / 4.184 : v, src = (f[4] || '').trim();
      // per-sample E lines carry their source: iPhone and the ring both log the same movement, so each hour counts only its largest source
      if (t === 'E' && src) { const h = ((actH[k] = actH[k] || {})[hLocal(d).slice(11, 13)] = actH[k][hLocal(d).slice(11, 13)] || {}); h[src] = (h[src] || 0) + kc; return; }
      const m = t === 'E' ? actE : act; m[k] = (m[k] || 0) + kc; return; }
    if (t === 'W') { const d = hDate(f[1]), v = hNum(f[2]); if (!d || v == null) return out.bad++;
      const lb = /kg/i.test(f[3] || '') ? v * 2.20462 : v;
      out.weight.push({ date: dstr(d), time: hLocal(d).slice(11), note: 'Health', weight: r1(lb) }); }
    else if (t === 'S' || t === 'D') { const d = hDate(f[1]), v = hNum(f[2]); if (!d || v == null) return out.bad++; (t === 'S' ? sys : dia)[hLocal(d)] = Math.round(v); }
    else if (t === 'Z') { const a = hDate(f[1]), b = hDate(f[2]), st = hStage(f[3]); if (!a || !b || !st || b <= a) return out.bad++; segs.push({ a, b, st, src: f[4] || 'Apple Health' }); }
    else out.bad++;
  });
  Object.keys(sys).forEach(k => dia[k] != null && out.bp.push({ datetime: k, sys: sys[k], dia: dia[k], note: 'from Apple Health' }));
  // sleep: cluster each source's segments into sessions (gap ≤ 90 min), then keep the best source per wake day
  const bySrc = {};
  segs.sort((x, y) => x.a - y.a).forEach(s => (bySrc[s.src] = bySrc[s.src] || []).push(s));
  const nights = [];
  Object.entries(bySrc).forEach(([src, ss]) => {
    let cur = null;
    const flush = () => { if (!cur) return;
      const m = { inbed: 0, asleep: 0, awake: 0, core: 0, deep: 0, rem: 0 };
      // count each minute once: duplicate or overlapping segments (same night written twice) must not add up
      const PRI = { inbed: 0, asleep: 1, awake: 2, core: 3, rem: 4, deep: 5 }, mins = new Map();
      cur.segs.forEach(s => { for (let t = Math.floor(s.a / 6e4), e = Math.ceil(s.b / 6e4); t < e; t++) { const o = mins.get(t); if (o == null || PRI[s.st] > PRI[o]) mins.set(t, s.st); } });
      mins.forEach(st => m[st]++);
      // the night minute by minute, run-length coded from bed time: "A33C5D45…" (D deep, C core, R REM, A awake, S asleep, I in bed)
      const SC = { inbed: 'I', asleep: 'S', awake: 'A', core: 'C', rem: 'R', deep: 'D' }; let tl = '', run = null, n = 0;
      for (let t = Math.floor(cur.a / 6e4), e = Math.ceil(cur.b / 6e4); t < e; t++) { const c = SC[mins.get(t)] || 'I'; if (c === run) n++; else { if (run) tl += run + n; run = c; n = 1; } }
      if (run) tl += run + n;
      const staged = m.core + m.deep + m.rem > 0, asleep = Math.round(m.core + m.deep + m.rem + m.asleep || Math.max(0, m.inbed - m.awake));
      const bed = cur.a, wake = cur.b, nap = (wake - bed) < 4 * 36e5 && bed.getHours() >= 10 && bed.getHours() < 20;
      if (asleep >= 10) nights.push({ date: dstr(wake), bed: nap ? 'nap' : hLocal(bed).slice(11), wake: hLocal(wake).slice(11), asleep,
        deep: staged ? Math.round(m.deep) : null, light: staged ? Math.round(m.core) : null, dream: staged ? Math.round(m.rem) : null,
        awake: m.awake ? Math.round(m.awake) : null, source: src, score: null, nap, stages: staged ? tl : '', _staged: staged });
      cur = null; };
    ss.forEach(s => { if (cur && s.a - cur.b <= 90 * 6e4) { cur.segs.push(s); if (s.b > cur.b) cur.b = s.b; } else { flush(); cur = { a: s.a, b: s.b, segs: [s] }; } });
    flush();
  });
  const best = {};
  nights.forEach(n => { const k = n.date + (n.nap ? 'n' : ''), o = best[k];
    if (!o || (n._staged && !o._staged) || (n._staged === o._staged && n.asleep > o.asleep)) best[k] = n; });
  out.sleep = Object.values(best).map(({ _staged, ...n }) => n).sort((x, y) => x.date.localeCompare(y.date));
  out.food = Object.values(meals).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // "last N days" is a rolling window, so its first day is cut off partway: drop it rather than overwrite a full total
  const hDays = Object.keys(actH).sort(); if (hDays.length > 1) delete actH[hDays[0]];
  for (const [k, hrs] of Object.entries(actH)) actE[k] = (actE[k] || 0) + sum(Object.values(hrs), h => Math.max(...Object.values(h)));
  out.active = [...new Set([...Object.keys(act), ...Object.keys(actE)])].sort().map(date => date in actE
    ? { date, kcal: Math.round(actE[date]), source: EXCL } : { date, kcal: Math.round(act[date]), source: 'Apple Health' });
  return out;
}
/** drop candidates the app already has (snapshot or this device), incl. ones that came from this app via Send */
const SLEEPF = ['bed', 'wake', 'asleep', 'deep', 'light', 'dream', 'awake'];
function hNew(c) {
  const W = all('weight'), B = all('bp'), Z = all('sleep');
  const mins = s => pdate(s).getTime() / 6e4 + (+s.slice(11, 13)) * 60 + (+s.slice(14, 16));
  return {
    weight: c.weight.filter(e => !W.some(w => w.date === e.date && Math.abs(w.weight - e.weight) < 0.15)),
    bp: c.bp.filter(e => !B.some(b => b.sys === e.sys && b.dia === e.dia && Math.abs(mins(b.datetime) - mins(e.datetime)) <= 2)),
    // a night pulled earlier on this phone is replaced when Health now says something different; nights entered by hand stay
    sleep: c.sleep.filter(e => !Z.some(z => z.date === e.date && !!z.nap === e.nap && !(z.local && z._health === 'from' && SLEEPF.some(k => (z[k] ?? null) !== (e[k] ?? null))))),
    // a recovered entry is one minute's foods added together, so any food already logged at that minute means it's covered
    food: (c.food || []).filter(e => !all('food').some(f => f.date === e.date && f.time === e.time)),
    exercise: (c.exercise || []).filter(e => !all('exercise').some(x => e.inHealth ? KEY.exercise(x) === KEY.exercise(e) : x.date === e.date && Math.abs((x.kcal || 0) - e.kcal) <= 1)),
    active: (c.active || []).filter(e => { const cur = activeFor(e.date); return !cur || cur.source !== e.source || Math.abs(cur.kcal - e.kcal) >= 1; }),
  };
}
function openHealthReturn() {
  const fl = getFlag(); if (!fl) return;
  if (Date.now() - fl.at > 6 * 36e5) return setFlag(null);
  const sh = $('#sheet');
  if (fl.kind === 'send') {
    sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Back from Shortcuts</b></div>
      <div>Did <b>${esc(H_SEND)}</b> finish without an error?</div>
      <div class="sm mut" style="margin-top:6px">${fl.ids.length} entr${fl.ids.length === 1 ? 'y' : 'ies'} will be marked as sent so they aren't sent twice.</div>
      <button class="btn" data-hsent="yes">Yes, mark as sent</button><button class="btn sec" data-hsent="no">No, keep them unsent</button></div>`;
  } else {
    sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Back from Shortcuts</b><button class="iconbtn" data-close>✕</button></div>
      <div class="sm mut">If <b>${esc(H_PULL)}</b> said it copied your Health data, paste it in.</div>
      <button class="btn" data-hpaste>Paste from Health</button></div>`;
    setFlag(null);
  }
  sh.classList.remove('hidden');
}
function markSent(ids) {
  const set = new Set(ids), now = new Date().toISOString();
  LOGS.forEach(l => LOCAL[l].forEach(e => { if (set.has(e._id)) e._health = now; })); saveLocal();
}
async function healthPaste() {
  let text = null;
  try { text = await navigator.clipboard.readText(); } catch {}
  if (text && /^[WSDZ]\|/m.test(text)) return showImport(text);
  const sh = $('#sheet');
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Paste from Health</b><button class="iconbtn" data-close>✕</button></div>
    <div class="sm mut">${text ? "The clipboard doesn't look like Health data." : "Couldn't read the clipboard."} Long-press the box and choose Paste.</div>
    <textarea id="hText" class="hta" rows="6" placeholder="W|2026-11-09T07:12:00-08:00|158.4|lb|Health"></textarea>
    <button class="btn" data-himport>Import</button></div>`;
  sh.classList.remove('hidden');
}
function showImport(text) {
  const c = parseHealth(text), n = hNew(c), HL = ['weight', 'bp', 'sleep', 'active', 'food', 'exercise'];
  const tot = HL.reduce((s, l) => s + n[l].length, 0), found = HL.reduce((s, l) => s + c[l].length, 0);
  HIMPORT = n;
  const li = (l, e) => `<li><span class="m sm">${esc(TOROW[l](e).filter(v => v != null && v !== '' && v !== false).join(' · '))}</span></li>`;
  const sh = $('#sheet');
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">From Apple Health</b><button class="iconbtn" data-close>✕</button></div>
    <div class="sm mut">Found ${found} reading${found === 1 ? '' : 's'}; ${tot} new, ${found - tot} already in the app${c.bad ? ` · ${c.bad} line(s) not understood` : ''}${c.dupA ? ` · ${c.dupA} repeated Active Energy line(s) ignored; check the shortcut for a doubled Active Energy section` : ''}.</div>
    ${n.food.length || n.exercise.some(e => !e.inHealth) ? '<div class="note">Recovered food and exercise keep their time, calories and nutrients, but not their names. You can rename them after merging.</div>' : ''}
    ${HL.filter(l => n[l].length).map(l => `<div class="card" style="margin-top:12px"><h3>${l === 'active' ? 'active energy (kcal/day)' : l} <small>${n[l].length}</small></h3><ul class="list">${n[l].map(e => li(l, e)).join('')}</ul></div>`).join('')}
    ${tot ? `<button class="btn" data-hadd>Add ${tot} entr${tot === 1 ? 'y' : 'ies'}</button>` : '<button class="btn sec" data-close>Nothing new — close</button>'}</div>`;
  sh.classList.remove('hidden');
}
function healthAdd() {
  if (!HIMPORT) return;
  let n = 0;
  // a day's Active Energy keeps growing, so a newer pull replaces that day's earlier value
  HIMPORT.active.forEach(e => { LOCAL.active = LOCAL.active.filter(x => x.date !== e.date); });
  HIMPORT.sleep.forEach(e => { LOCAL.sleep = LOCAL.sleep.filter(x => !(x._health === 'from' && x.date === e.date && !!x.nap === !!e.nap)); });
  ['weight', 'bp', 'sleep', 'active', 'food', 'exercise'].forEach(l => (HIMPORT[l] || []).forEach(e => { e._health = 'from'; addLocal(l, e); n++; }));
  saveLocal(); HIMPORT = null; closeSheet(); toast(`Added ${n} from Health`); render();
}
function healthCard() {
  const n = hCount(hQueue());
  return `<div class="card" style="margin-top:12px"><h3>Apple Health <small><a href="health.html">setup guide</a></small></h3>
    <div class="sm mut">Works through ${CFG.kid ? 'a Shortcut' : 'two Shortcuts'} on this iPhone. Send before you export, so new entries reach Health too.</div>
    <button class="btn" data-hsend ${n ? '' : 'disabled'}>♥ Send ${n} new entr${n === 1 ? 'y' : 'ies'} to Health</button>
    ${CFG.kid ? '' : `<button class="btn sec" data-hpull>Pull weight, BP &amp; sleep from Health</button>
    <button class="btn sec" data-hpaste>Paste from Health</button>`}</div>`;
}

/* ---------- render / events ---------- */
const TITLES = { today: 'Today', plan: 'Workout plan', trends: 'Trends', weight: 'Weight', sleep: 'Sleep', bp: 'Blood pressure' };
function render() {
  applyTargets();
  $('#title').textContent = TITLES[state.tab];
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#view').innerHTML = V[state.tab]();
}
// plan day cards open and close in place
document.addEventListener('click', e => { const b = e.target.closest('[data-expand]'); if (!b) return;
  const t = b.parentElement, on = t.classList.toggle('open'); b.setAttribute('aria-expanded', on); PLAN_OPEN[on ? 'add' : 'delete'](t.dataset.pdate); });
const PLAN_OPEN = new Set();
// ⓘ flips the card over to show its notes; tapping the back flips it again
document.addEventListener('click', e => {
  const front = e.target.closest('.card:not(.back) [data-flip]'), back = e.target.closest('.flipcard.on .back');
  const tile = e.target.closest('[data-tile]');
  if (tile) { e.stopImmediatePropagation(); tile.classList.toggle('on'); }
  else if (front) { e.stopImmediatePropagation(); flipCard(front.closest('.card')); }
  else if (back) { e.stopImmediatePropagation(); back.closest('.flipcard').classList.remove('on'); }
}, true);
function flipCard(card) {
  let fc = card.parentElement.classList.contains('flip-in') ? card.parentElement.parentElement : null;
  if (!fc) {
    fc = document.createElement('div'); fc.className = 'flipcard'; const inner = document.createElement('div'); inner.className = 'flip-in';
    card.replaceWith(fc); fc.appendChild(inner); card.classList.add('face'); inner.appendChild(card);
    const title = (card.querySelector('h3')?.firstChild?.textContent || '').trim(), notes = card.querySelector('template.flipnotes')?.innerHTML || '';
    const b = document.createElement('div'); b.className = 'card face back';
    b.innerHTML = `<h3>${esc(title)}<button class="tipbtn on" aria-label="Flip back">✕</button></h3>${notes}`; inner.appendChild(b);
    void fc.offsetWidth;
  }
  fc.classList.toggle('on');
}
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) { if (e.target.id === 'sheet') closeSheet(); return; }
  if (t.dataset.tab) { state.tab = t.dataset.tab; render(); scrollTo(0, 0); }
  else if (t.dataset.nav) { const d = addDays(state.day || todayStr(), +t.dataset.nav); if (d <= todayStr()) { state.day = d === todayStr() ? null : d; render(); } }
  else if (t.id === 'fab') openAdd();
  else if (t.id === 'btnData') openData();
  else if (t.dataset.kind && t.closest('.seg')) openAdd(t.dataset.kind);
  else if ('close' in t.dataset) closeSheet();
  else if (t.dataset.usepass) {
    const date = t.dataset.usepass;
    if (passInMonth(date.slice(0, 7))) return toast('Pass already used this month');
    const note = prompt('Use your monthly Pass for ' + fmtD(date) + '? Optional note:', '');
    if (note === null) return;
    addLocal('passes', { date, note: note.trim() }); toast('Pass used — enjoy!'); render();
  }
  else if (t.dataset.unpass) { if (confirm('Undo this Pass?')) { delLocal('passes', t.dataset.unpass); render(); } }
  else if ('export' in t.dataset) doExport();
  else if ('copy' in t.dataset) navigator.clipboard.writeText(exportCSV()).then(() => toast('Copied'), () => toast('Copy failed'));
  else if (t.dataset.del) { const [l, id] = t.dataset.del.split(':'); if (confirm('Delete this entry?')) { delLocal(l, id); openData(); render(); } }
  else if ('clear' in t.dataset) { if (confirm('Delete ALL new entries on this device? Export first!')) { LOGS.forEach(l => LOCAL[l] = []); saveLocal(); openData(); render(); } }
  else if ('lock' in t.dataset) { localStorage.removeItem(PC_KEY); location.reload(); }
  else if (t.dataset.theme) { try { localStorage.setItem('fit.theme', t.dataset.theme); } catch {} applyTheme(t.dataset.theme); openData(); }
  else if (t.dataset.habit) toggleHabit(t.dataset.habit, t.dataset.hdate);
  else if ('goal' in t.dataset) openGoal();
  else if ('sleeptarget' in t.dataset) openSleepTarget();
  else if ('foodopts' in t.dataset) { foodOpts = !foodOpts; const y = scrollY; render(); scrollTo(0, y); }
  else if (t.dataset.fshow) { const v = foodShow(); v[t.dataset.fshow] = !v[t.dataset.fshow]; try { localStorage.setItem('fit.foodshow', JSON.stringify(v)); } catch {} const y = scrollY; render(); scrollTo(0, y); }
  else if ('targets' in t.dataset) openTargets();
  else if ('bptarget' in t.dataset) openBpTarget();
  else if (t.dataset.libpick) libPick(+t.dataset.libpick);
  else if ('sleeptl' in t.dataset) { try { localStorage.setItem('fit.sleeptl', sleepPref('tl') ? '0' : '1'); } catch {} const y = scrollY; render(); scrollTo(0, y); }
  else if ('awake' in t.dataset) { try { localStorage.setItem('fit.sleepawake', sleepAwake() ? '0' : '1'); } catch {} const y = scrollY; render(); scrollTo(0, y); }
  else if (t.dataset.bprange) { try { localStorage.setItem('fit.bprange', t.dataset.bprange); } catch {} const y = scrollY; render(); scrollTo(0, y); }
  else if ('hsend' in t.dataset) healthSend();
  else if ('hpull' in t.dataset) healthPull();
  else if ('hpaste' in t.dataset) healthPaste();
  else if ('himport' in t.dataset) showImport($('#hText').value);
  else if ('hadd' in t.dataset) healthAdd();
  else if (t.dataset.hsent) { const fl = getFlag(); if (t.dataset.hsent === 'yes' && fl) { markSent(fl.ids); toast(`Marked ${fl.ids.length} as sent`); } setFlag(null); closeSheet(); render(); }
});
document.addEventListener('change', e => { const t = e.target;
  if (t.name === 'bpPlan') { const b = t.form.querySelector('.bpstep'); if (b) b.hidden = !(t.value.split('|')[1] || '').startsWith('meds'); }
  if (t.dataset && t.dataset.fill && t.value) { const vs = t.value.split('|')[0].split('/'); t.dataset.fill.split(',').forEach((n, i) => t.form[n].value = vs[i]); }
});
/* ---------- press and hold a chart: crosshair at your finger with the date and values ---------- */
const fmtV = v => (Math.round(v * 10) / 10).toLocaleString();
function scrubAt(svg, cx) {
  const D = JSON.parse(svg.dataset.scrub), vb = svg.viewBox.baseVal, rc = svg.getBoundingClientRect();
  const px = Math.max(D.L, Math.min(D.r, (cx - rc.left) / rc.width * vb.width)), rows = [];
  let x = px, head = '';
  if (D.bars) {
    const i = Math.max(0, Math.min(D.bars.length - 1, Math.floor((px - D.L) / D.bw))), b = D.bars[i];
    x = D.L + (i + 0.5) * D.bw; head = b.d;
    rows.push({ y: b.y, t: b.t || 'no data', c: 'var(--tx)' });
  } else {
    D.s.sort((a, b) => b.dots - a.dots);  // measured values first, then paths
    const dots = D.s.filter(s => s.dots).flatMap(s => s.p);
    const near = dots.reduce((a, p) => !a || Math.abs(p[0] - px) < Math.abs(a[0] - px) ? p : a, null);
    if (near && Math.abs(near[0] - px) <= 14) { x = near[0]; head = near[3]; }
    D.s.forEach(s => { let v = null, y;
      if (s.dots) { const q = s.p.find(q => Math.abs(q[0] - x) < 0.3); if (q) { v = q[2]; y = q[1]; } }
      else for (let i = 1; i < s.p.length; i++) { const a = s.p[i - 1], b = s.p[i];
        if (x >= a[0] && x <= b[0]) { const f = (x - a[0]) / (b[0] - a[0] || 1); y = a[1] + (b[1] - a[1]) * f; v = a[2] + (b[2] - a[2]) * f; break; } }
      if (v != null) rows.push({ y, t: (s.n ? s.n + ' ' : '') + fmtV(v) + s.u, c: s.c }); });
    if (!head && D.first) head = fmtShort(addDays(D.first, Math.floor(D.x0 + (x - D.L) / (D.r - D.L) * (D.x1 - D.x0))));
  }
  svg.querySelector('.scrub')?.remove();
  let g = `<g class="scrub"><line x1="${x}" x2="${x}" y1="${D.T}" y2="${D.b}" class="sx"/>`;
  rows.forEach(r => { if (r.y != null) g += `<line x1="${D.L}" x2="${D.r}" y1="${r.y}" y2="${r.y}" class="sy" style="stroke:${r.c}"/><circle cx="${x}" cy="${r.y}" r="4.5" style="fill:${r.c}"/>`; });
  const lines = [head, ...rows.map(r => r.t)].filter(Boolean);
  g += `<rect class="sb" rx="6"/><text class="st">${lines.map((t, i) => `<tspan x="0" dy="${i ? 13 : 0}"${i ? '' : ' class="sh"'}>${esc(t)}</tspan>`).join('')}</text></g>`;
  svg.insertAdjacentHTML('beforeend', g);
  // the label sits beside the line, on whichever side has room
  const tx = svg.querySelector('.scrub .st'), bb = tx.getBBox(), wd = bb.width + 14, hd = lines.length * 13 + 8;
  const lx = x + 8 + wd <= vb.width ? x + 8 : x - 8 - wd;
  tx.querySelectorAll('tspan').forEach(t => t.setAttribute('x', lx + 7)); tx.setAttribute('y', D.T + 13);
  const rb = svg.querySelector('.scrub .sb'); rb.setAttribute('x', lx); rb.setAttribute('y', D.T); rb.setAttribute('width', wd); rb.setAttribute('height', hd);
}
let SCR = null, lastTouch = 0;
const scrubOff = svg => svg && svg.querySelector('.scrub')?.remove();
document.addEventListener('touchstart', e => { lastTouch = Date.now(); const svg = e.target.closest && e.target.closest('svg[data-scrub]'); if (!svg || e.touches.length > 1) return;
  const t = e.touches[0]; SCR = { svg, x: t.clientX, y: t.clientY, on: false };
  SCR.tm = setTimeout(() => { if (SCR && SCR.svg === svg) { SCR.on = true; svg.classList.add('scrubbing'); scrubAt(svg, SCR.x); } }, 200); }, { passive: true });
document.addEventListener('touchmove', e => { if (!SCR) return; const t = e.touches[0];
  if (!SCR.on) { if (Math.hypot(t.clientX - SCR.x, t.clientY - SCR.y) > 8) { clearTimeout(SCR.tm); SCR = null; } else SCR.x = t.clientX; return; }
  e.preventDefault(); scrubAt(SCR.svg, t.clientX); }, { passive: false });
['touchend', 'touchcancel'].forEach(k => document.addEventListener(k, () => { if (!SCR) return; clearTimeout(SCR.tm); SCR.svg.classList.remove('scrubbing'); scrubOff(SCR.svg); SCR = null; }));
// with a mouse it follows the pointer
let HOV = null;
document.addEventListener('mousemove', e => { if (Date.now() - lastTouch < 1000) return; const svg = e.target.closest && e.target.closest('svg[data-scrub]');
  if (HOV && HOV !== svg) scrubOff(HOV); HOV = svg; if (svg) scrubAt(svg, e.clientX); });
// typing a number picks the matching preset, else Custom
document.addEventListener('input', e => { const t = e.target, sel = t.form && t.name && [...t.form.querySelectorAll('select[data-fill]')].find(s => s.dataset.fill.split(',').includes(t.name));
  if (sel) { const v = sel.dataset.fill.split(',').map(n => String(Number(t.form[n].value))).join('/'); const os = [...sel.options].map(o => o.value).filter(o => o.split('|')[0] === v);
    if (!os.includes(sel.value)) sel.value = os[0] || ''; } });
document.addEventListener('input', e => { if (e.target.id === 'libQ') $('#libBox').innerHTML = libList(e.target.value);
  const form = e.target.form; if (form && form.id === 'addForm' && form.dataset.kind === 'food' && (e.target.name === 'qty' || e.target.name in QROUND)) qtyInput(form, e.target.name); });
document.addEventListener('submit', e => { if (e.target.id === 'addForm') { e.preventDefault(); submitAdd(e.target); } else if (e.target.id === 'goalForm') { e.preventDefault(); saveGoal(e.target); } else if (e.target.id === 'sleepTargetForm') { e.preventDefault(); saveSleepTarget(e.target); } else if (e.target.id === 'targetForm') { e.preventDefault(); saveTargets(e.target); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && SNAP) { render(); openHealthReturn(); } }); // day rollover, back from Shortcuts

/* ---------- unlock (encrypted snapshot) ---------- */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(enc, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function start(snap) { SNAP = snap; CFG = snap.config; BASE = { ...snap.config }; loadLocal();
  if (CFG.kid) { const keep = ['today', 'weight']; document.querySelectorAll('#tabs button').forEach(b => { if (!keep.includes(b.dataset.tab)) b.remove(); }); } $('#lock').classList.add('hidden'); render(); openHealthReturn(); }
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (window.SNAPSHOT) return start(window.SNAPSHOT);
  const enc = window.SNAPSHOT_ENC;
  if (!enc) { $('#view').innerHTML = '<div class="card">No data snapshot (data.js missing).</div>'; return; }
  const saved = localStorage.getItem(PC_KEY);
  if (saved) { try { const s = await decrypt(enc, saved); s._enc = true; return start(s); } catch { localStorage.removeItem(PC_KEY); } }
  $('#lock').classList.remove('hidden');
  $('#lockForm').onsubmit = async ev => {
    ev.preventDefault(); $('#lockErr').textContent = 'Unlocking…';
    const pass = $('#lockInput').value;
    try { const s = await decrypt(enc, pass); s._enc = true; if ($('#lockRemember').checked) localStorage.setItem(PC_KEY, pass); $('#lockErr').textContent = ''; start(s); }
    catch { $('#lockErr').textContent = 'Wrong passcode'; }
  };
}
boot();
