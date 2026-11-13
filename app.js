'use strict';
/* Balanced (formerly Roy Fitness) — single-file app. Data = build-time CSV snapshot (data.js) + entries added on this device (localStorage). */
const LS_KEY = 'fit.local.v1', PC_KEY = 'fit.pc';
const LOGS = ['food', 'exercise', 'weight', 'bp', 'sleep', 'passes', 'active'];
let SNAP = null, LOCAL = null, CFG = null;
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
  const comps = day.components.map(cid => {
    const c = P.components[cid] || { name: cid, match: [] };
    const hits = ex.filter(x => c.match.some(k => x.activity.toLowerCase().includes(k)));
    const mins = sum(hits, h => h.minutes);
    const done = hits.length > 0 && (!c.minMinutes || mins >= c.minMinutes);
    return { id: cid, name: c.name, hits, mins, done, partial: hits.length > 0 && !done, min: c.minMinutes };
  });
  const adds = (P.additions || []).filter(a => a.days.includes(dn) && date >= a.from);
  const upcoming = (P.additions || []).filter(a => a.days.includes(dn) && date < a.from);
  return { dn, day, comps, adds, upcoming, inRange, rules: P.rules || [] };
}

/* ---------- svg helpers ---------- */
function ring(val, target, color, label, unit) {
  const pct = target ? val / target : 0, R = 52, C = 2 * Math.PI * R;
  const p1 = Math.min(pct, 1), p2 = Math.max(0, Math.min(pct - 1, 1));
  const over = pct > 1.0001;
  return `<div class="ring"><svg viewBox="0 0 130 130">
    <circle cx="65" cy="65" r="${R}" fill="none" style="stroke:var(--card2)" stroke-width="13"/>
    <circle cx="65" cy="65" r="${R}" fill="none" style="stroke:${color}" stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${p1 * C} ${C}" transform="rotate(-90 65 65)"/>
    ${p2 > 0 ? `<circle cx="65" cy="65" r="${R}" fill="none" style="stroke:var(--bad)" stroke-width="13" stroke-linecap="round" stroke-dasharray="${p2 * C} ${C}" transform="rotate(-90 65 65)"/>` : ''}
    <text x="65" y="62" text-anchor="middle" style="fill:var(--tx)" font-size="24" font-weight="700">${Math.round(val)}</text>
    <text x="65" y="82" text-anchor="middle" style="fill:var(--mut)" font-size="11">of ${target}${unit}</text></svg>
    <div class="lbl">${label}${over ? ' · <span style="color:var(--bad)">over</span>' : ''}</div></div>`;
}
function bar(val, target, color, overColor) {
  const pct = Math.min(val / target, 1.5), w = Math.min(pct / 1.5 * 100, 100);
  return `<div class="bar tick" style="--t:${100 / 1.5}%"><i style="width:${w}%;background:${val > target ? overColor : color}"></i></div>`;
}
/** generic line/point chart. series: [{pts:[[x,y]],color,line,dots,dash}], x = day index */
function chart({ w = 360, h = 190, x0, x1, y0, y1, series = [], bands = [], hlines = [], vlines = [], xlabels = [], ylabelsEvery }) {
  const L = 32, R = 8, T = 10, B = 22;
  const X = x => L + (x - x0) / (x1 - x0 || 1) * (w - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0 || 1)) * (h - T - B);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  bands.forEach(b => s += `<rect x="${L}" y="${Y(b.hi)}" width="${w - L - R}" height="${Y(b.lo) - Y(b.hi)}" style="fill:${b.color}"/>`);
  const step = ylabelsEvery || Math.max(1, Math.round((y1 - y0) / 5));
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step)
    s += `<line x1="${L}" x2="${w - R}" y1="${Y(y)}" y2="${Y(y)}" style="stroke:var(--grid)"/><text x="${L - 4}" y="${Y(y) + 3}" text-anchor="end">${y}</text>`;
  hlines.forEach(l => s += `<line x1="${L}" x2="${w - R}" y1="${Y(l.y)}" y2="${Y(l.y)}" style="stroke:${l.color}" stroke-dasharray="4 3"/>` + (l.label ? `<text x="${w - R}" y="${Y(l.y) - 3}" text-anchor="end" style="fill:${l.color}">${l.label}</text>` : ''));
  vlines.forEach(l => s += `<line x1="${X(l.x)}" x2="${X(l.x)}" y1="${T}" y2="${h - B}" style="stroke:${l.color}" stroke-dasharray="2 3"/>` + (l.label ? `<text x="${X(l.x) + 3}" y="${T + 9}" style="fill:${l.color}">${l.label}</text>` : ''));
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
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  const raw = ymax / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw);
  for (let y = 0; y <= ymax; y += step) s += `<line x1="${L}" x2="${w - R}" y1="${Y(y)}" y2="${Y(y)}" style="stroke:var(--grid)"/><text x="${L - 4}" y="${Y(y) + 3}" text-anchor="end">${y}</text>`;
  items.forEach((it, i) => {
    const x = L + i * bw + bw * 0.15, bwi = bw * 0.7;
    if (it.v != null) s += `<rect x="${x}" y="${Y(it.v)}" width="${bwi}" height="${Math.max(0, Y(0) - Y(it.v))}" rx="3" style="fill:${it.pass ? 'var(--acc)' : it.v > target ? overColor : color}" ${it.hollow ? 'opacity=".45"' : ''}/>`;
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
const V = {};
V.today = () => {
  const date = state.day || todayStr(), t = dayTotals(date), c = CFG, isToday = date === todayStr();
  const pass = passFor(date), ym = date.slice(0, 7), mPass = passInMonth(ym);
  const remain = c.kcalTarget - t.kcal + t.burn;
  const pl = planFor(date);
  let h = `<div class="datenav"><button data-nav="-1">‹</button><div class="d">${isToday ? 'Today · ' : ''}${fmtD(date)}${pass ? ' <span class="pill pass">PASS</span>' : ''}</div><button data-nav="1" ${isToday ? 'disabled style="opacity:.3"' : ''}>›</button></div>`;
  h += `<div class="card"><div class="rings">${ring(t.kcal, c.kcalTarget, 'var(--kcal)', 'Calories eaten', '')}${ring(t.protein, c.proteinTarget, 'var(--pro)', 'Protein', ' g')}</div>
    <div style="margin-top:12px"><div class="row"><span class="b" style="color:var(--sod)">Sodium</span><span>${t.sodium.toLocaleString()} / ${c.sodiumTarget.toLocaleString()} mg${t.sodEst ? ' <span class="pill">est.</span>' : ''}</span></div>
    ${bar(t.sodium, c.sodiumTarget, 'var(--sod)', 'var(--bad)')}
    ${t.sodUnknown ? `<div class="sm mut" style="margin-top:4px">${t.sodUnknown} item(s) with unknown sodium not counted</div>` : ''}
    <div class="row" style="margin-top:8px"><span class="b" style="color:var(--carb)">Carbs</span><span>${r1(t.carbs)} g${t.carbUnknown && t.food.length ? ` <span class="sm mut">· ${t.carbUnknown} item${t.carbUnknown === 1 ? '' : 's'} not counted</span>` : ''}</span></div></div>
    <div class="stat3" style="margin-top:12px"><div><b>${t.kcal}</b><span>eaten</span></div><div><b>${t.burn ? '−' + t.burn : 0}</b><span>${t.activeSrc === 'logged' ? 'exercise' : 'active (Health)'}</span></div><div><b style="color:${t.net > c.kcalTarget ? 'var(--bad)' : 'var(--ok)'}">${t.net}</b><span>net / ${c.kcalTarget} goal</span></div></div>
    <div class="sm mut" style="text-align:center;margin-top:8px">Net ${t.net} vs goal ${c.kcalTarget}: <b style="color:${remain >= 0 ? 'var(--ok)' : 'var(--bad)'}">${remain >= 0 ? `${remain} under` : `${-remain} over`}</b> · ${Math.max(0, c.proteinTarget - t.protein)} g protein to go</div></div>`;
  // Pass
  h += `<div class="card"><h3>${MONTHL[pdate(date).getMonth()]} Pass <small>${mPass ? '<span class="pill pass">used</span>' : '<span class="pill ok">available</span>'}</small></h3>`;
  if (mPass) h += `<div>Used ${fmtD(mPass.date)}${mPass.note ? ' — ' + esc(mPass.note) : ''}${mPass.local ? ' <span class="pill local">this device</span>' : ''}</div>
     <div class="sm mut">1 Pass per calendar month. Pass days don't count as misses or break streaks.</div>
     ${mPass.local ? `<button class="btn sec" data-unpass="${mPass._id}">Undo Pass</button>` : ''}`;
  else h += `<div class="sm mut">1 Pass (cheat day) per calendar month. Pass days don't count as target misses or break streaks.</div>
     <button class="btn" style="background:var(--acc);color:var(--on-acc)" data-usepass="${date}">Use Pass ${isToday ? 'today' : 'on ' + fmtShort(date)}</button>`;
  h += `</div>`;
  // Workout
  if (pl) {
    h += `<div class="card"><h3>Today's workout <small>${pl.dn}${pl.inRange ? '' : ' · <span class="pill warn">plan ended — update plan.json</span>'}</small></h3>
      <div class="b">${esc(pl.day.title)}</div>
      ${pl.comps.map(cp => `<div class="check"><span class="ic ${cp.done ? 'y' : 'n'}">${cp.done ? '✓' : ''}</span><span>${esc(cp.name)}${cp.hits.length ? ` <span class="sm mut">— ${cp.hits.map(x => esc(x.activity)).join('; ')}${cp.min ? ` (${cp.mins} min)` : ''}</span>` : ' <span class="sm mut">— not logged yet</span>'}${cp.partial ? ' <span class="pill warn">partial</span>' : ''}</span></div>`).join('')}
      ${pl.day.note ? `<div class="note warn">${esc(pl.day.note)}</div>` : ''}
      ${pl.adds.map(a => `<div class="note">${esc(a.text)}</div>`).join('')}
      ${pl.comps.some(cp => cp.id === 'cardio') ? `<div class="sm mut" style="margin-top:6px">Finish cardio by ~7 PM for sleep. No loaded overhead lifting/pressing.</div>` : ''}</div>`;
  }
  // Foods
  h += `<div class="card"><h3>Food <small>${t.food.length} items</small></h3>${t.food.length ? `<ul class="list">${t.food.map(f => `<li><span class="t">${esc(f.time)}</span><span class="m"><div class="n">${esc(f.item)}${f.local ? '<span class="pill local">new</span>' : ''}</div>
      <div class="s">${f.protein} g protein${f.carbs != null ? ` · ${f.carbs} g carbs` : ''} · ${f.sodium != null ? f.sodium + ' mg Na' + (/est/i.test(f.sodiumNote) ? ' (est)' : '') : 'Na ?'}</div></span><span class="v">${f.kcal} kcal</span></li>`).join('')}</ul>` : '<div class="mut">Nothing logged.</div>'}</div>`;
  h += `<div class="card"><h3>Exercise <small>${t.exKcal} kcal logged</small></h3>${t.activeSrc === 'health+' ? `<div class="note" style="margin:0 0 8px">Active for net: <b>${t.burn} kcal</b> = Apple Health ${t.healthKcal}${t.extra ? ` + ${t.extra} logged here that iPhone/Watch didn't record` : ''}</div>` : t.activeSrc === 'health' ? `<div class="note warn" style="margin:0 0 8px">Apple Health Active Energy: <b>${t.burn} kcal</b>, used for net instead of the logged total. Update the “Health to Fitness” shortcut (setup guide, Active Energy step) so exercise sent from this app isn't lost.</div>` : ''}${t.ex.length ? `<ul class="list">${t.ex.map(x => `<li><span class="m"><div class="n">${esc(x.activity)}${x.local ? '<span class="pill local">new</span>' : ''}${x.inHealth ? '<span class="pill">iPhone/Watch</span>' : ''}</div><div class="s">${x.minutes ?? '?'} min</div></span><span class="v">${x.kcal ?? '–'} kcal</span></li>`).join('')}</ul>` : '<div class="mut">No exercise logged.</div>'}</div>`;
  return h;
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
    <div class="sm mut" style="margin-top:8px;text-align:center">Calorie streak: <b style="color:var(--tx)">${streak} day${streak === 1 ? '' : 's'}</b> (Pass days skip, don't break)</div></div>`;
  const items = key => chron.map(r => ({ label: pdate(r.d).getDate(), v: r.logged ? r[key] : null, pass: r.pass, hollow: r.today }));
  h += `<div class="card"><h3>Net calories <small>eaten − active · last 14 days</small></h3>${barChart({ items: items('net'), target: c.kcalTarget, color: 'var(--ok)', overColor: 'var(--bad)' })}
    <div class="legend"><span><i style="background:var(--ok)"></i>on target</span><span><i style="background:var(--bad)"></i>over</span><span><i style="background:var(--acc)"></i>Pass day</span><span><i style="background:var(--ok);opacity:.45"></i>today (in progress)</span></div></div>`;
  h += `<div class="card"><h3>Sodium <small>mg/day · mostly estimates</small></h3>${barChart({ items: items('sodium'), target: c.sodiumTarget, color: 'var(--sod)', overColor: 'var(--bad)' })}</div>`;
  h += `<div class="card"><h3>Protein <small>g/day</small></h3>${barChart({ items: items('protein'), target: c.proteinTarget, color: 'var(--pro)', overColor: 'var(--pro)' })}</div>`;
  h += `<div class="card"><h3>Daily log</h3><table class="t"><tr><th>Day</th><th>kcal</th><th>Prot</th><th>Na</th><th>Active</th><th>Net</th></tr>${rows.filter(r => r.logged).map(r => `<tr><td>${fmtShort(r.d)}${r.pass ? ' <span class="pill pass">PASS</span>' : ''}${r.today ? ' <span class="pill">today</span>' : ''}</td>
      <td class="${r.pass ? '' : r.kOk ? 'good' : 'over'}">${r.kcal}</td><td class="${r.pass ? '' : r.pOk ? 'good' : ''}">${r.protein}</td><td class="${r.pass ? '' : r.sOk ? 'good' : 'over'}">${r.sodium}${r.sodUnknown ? '+' : ''}</td><td>${r.burn}</td><td>${r.net}</td></tr>`).join('')}</table>
      <div class="sm mut" style="margin-top:6px">Protein shown green at ≥90% of ${c.proteinTarget} g. Na “+” = some items unknown.</div></div>`;
  return h;
};

V.plan = () => {
  const P = SNAP.plan; if (!P) return '<div class="card">No plan.json found at build time.</div>';
  const today = todayStr(), d0 = pdate(today), monday = addDays(today, -((d0.getDay() + 6) % 7));
  let h = `<div class="card"><h3>${esc(P.name)}</h3><div class="sm mut">${fmtShort(P.validFrom)} – ${fmtShort(P.validThrough)}${today > P.validThrough ? ' · <span class="pill warn">ended — update plan.json</span>' : ` · ${daysBetween(today, P.validThrough)} days left`}</div></div>`;
  h += `<div class="card plan"><h3>This week <small>${fmtShort(monday)} – ${fmtShort(addDays(monday, 6))}</small></h3>`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i), pl = planFor(d), past = d < today, isT = d === today;
    h += `<div class="day ${isT ? 'today' : ''}"><div class="dn">${pl.dn}<div class="sm mut" style="font-weight:400">${pdate(d).getDate()}</div></div><div style="flex:1">
      <div class="b">${esc(pl.day.title)}${isT ? ' <span class="pill ok">today</span>' : ''}${passFor(d) ? ' <span class="pill pass">PASS</span>' : ''}</div>
      ${(past || isT) ? pl.comps.map(cp => `<div class="check"><span class="ic ${cp.done ? 'y' : 'n'}">${cp.done ? '✓' : ''}</span><span class="sm">${esc(cp.name)}${cp.partial ? ` <span class="pill warn">${cp.mins} min</span>` : ''}</span></div>`).join('') : ''}
      ${pl.day.note ? `<div class="sm" style="color:var(--warn)">${esc(pl.day.note)}</div>` : ''}
      ${pl.adds.map(a => `<div class="sm mut">+ ${esc(a.text)}</div>`).join('')}</div></div>`;
  }
  h += `</div><div class="card"><h3>Weekly template</h3><table class="t">${Object.entries(P.days).map(([k, v]) => `<tr><td class="b">${k}</td><td style="text-align:left">${esc(v.title)}${v.note ? `<div class="sm" style="color:var(--warn)">${esc(v.note)}</div>` : ''}</td></tr>`).join('')}</table></div>`;
  h += `<div class="card"><h3>Coming up</h3>${(P.additions || []).map(a => `<div class="note"><b>From ${fmtShort(a.from)} · ${a.days.join('/')}</b><br>${esc(a.text)}</div>`).join('')}</div>`;
  h += `<div class="card"><h3>Rules</h3><ul style="margin:0;padding-left:18px">${P.rules.map(r => `<li style="margin:4px 0">${esc(r)}</li>`).join('')}</ul></div>`;
  return h;
};

V.weight = () => {
  const c = CFG, ws = all('weight').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!ws.length) return '<div class="card">No weights yet.</div>';
  const first = ws[0].date < c.startDate ? ws[0].date : c.startDate, xEnd = c.goalDate > todayStr() ? c.goalDate : todayStr();
  const xi = s => daysBetween(first, s);
  const pts = ws.map(w => [xi(w.date) + (w.time ? +w.time.slice(0, 2) / 24 : 0.3), w.weight, w.note === 'estimate' ? 'var(--est)' : 'var(--pro)']);
  const ys = ws.map(w => w.weight).concat([c.weightGoalLow, c.startWeight]);
  const y0 = Math.floor(Math.min(...ys) - 1), y1 = Math.ceil(Math.max(...ys) + 1);
  const total = daysBetween(first, xEnd), xl = [];
  for (let d = first; d <= xEnd; d = addDays(d, 1)) if (pdate(d).getDate() === 1 || (d === first && pdate(d).getDate() < 24)) xl.push({ x: xi(d), t: fmtShort(d) });
  xl.push({ x: xi(c.goalDate), t: '🎄' });
  const mid = (c.weightGoalLow + c.weightGoalHigh) / 2;
  const svg = chart({ x0: 0, x1: total, y0, y1, ylabelsEvery: y1 - y0 > 12 ? 4 : 2,
    bands: [{ lo: c.weightGoalLow, hi: c.weightGoalHigh, color: 'var(--band)' }],
    hlines: [{ y: c.weightGoalHigh, color: 'var(--ok)', label: `goal ${c.weightGoalLow}–${c.weightGoalHigh}` }],
    vlines: [{ x: xi(todayStr()), color: 'var(--mut2)', label: 'today' }],
    xlabels: xl,
    series: [{ pts: [[xi(c.startDate), c.startWeight], [xi(c.goalDate), mid]], color: 'var(--acc)', line: true, dash: '5 4', width: 1.5 },
             { pts, color: 'var(--pro)', line: true, dots: true }] });
  const cur = ws[ws.length - 1], lost = r1(c.startWeight - cur.weight), daysLeft = daysBetween(todayStr(), c.goalDate);
  const toHi = r1(cur.weight - c.weightGoalHigh), toLo = r1(cur.weight - c.weightGoalLow);
  const bmi = r1(cur.weight * 703 / (c.heightIn * c.heightIn)), age = new Date().getFullYear() - c.birthYear;
  const plannedNow = r1(c.startWeight - (c.startWeight - mid) * Math.min(1, Math.max(0, daysBetween(c.startDate, todayStr()) / daysBetween(c.startDate, c.goalDate))));
  let h = `<div class="card"><h3>Weight trend <small>goal by ${fmtShort(c.goalDate)}</small></h3>${svg}
    <div class="legend"><span><i style="background:var(--pro)"></i>weigh-ins</span><span><i style="background:var(--acc)"></i>steady path to ${mid}</span><span><i style="background:var(--band3)"></i>goal range</span><span><i style="background:var(--est)"></i>estimate</span></div></div>
    <div class="card"><div class="stat3"><div><b>${cur.weight}</b><span>latest (${fmtShort(cur.date)})</span></div><div><b style="color:var(--ok)">−${lost}</b><span>since ${fmtShort(c.startDate)}</span></div><div><b>${toHi > 0 ? toHi : '✓'}</b><span>lb to ${c.weightGoalHigh}</span></div></div>
    <div class="sm mut" style="margin-top:10px">${daysLeft > 0 ? `${daysLeft} days to Christmas. Reaching ${c.weightGoalHigh}–${c.weightGoalLow} needs ${r1(Math.max(0, toHi) / daysLeft * 7)}–${r1(Math.max(0, toLo) / daysLeft * 7)} lb/week from here.` : ''} Steady-path value today: ${plannedNow} lb (${cur.weight <= plannedNow ? 'ahead of' : 'behind'} pace). Early drops are often water, so expect it to slow down.<br>BMI ${bmi} at 5′3″ · age ${age}.</div></div>`;
  h += `<div class="card"><h3>Weigh-ins</h3><ul class="list">${ws.slice().reverse().map(w => `<li><span class="m"><div class="n">${fmtD(w.date)}${w.time ? ' ' + w.time : ''}${w.note ? ` <span class="pill">${esc(w.note)}</span>` : ''}${w.local ? '<span class="pill local">new</span>' : ''}</div></span><span class="v b">${w.weight} lb</span></li>`).join('')}</ul></div>`;
  return h;
};

V.sleep = () => {
  const ss = all('sleep').sort((a, b) => b.date.localeCompare(a.date) || (a.nap - b.nap));
  if (!ss.length) return '<div class="card">No sleep logged.</div>';
  const today = todayStr(), days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(today, -i));
  const items = days.map(d => { const main = ss.filter(s => s.date === d && !s.nap), nap = ss.filter(s => s.date === d && s.nap);
    return { label: pdate(d).getDate(), v: main.length ? r1(sum(main, s => s.asleep) / 60) : null, v2: nap.length ? r1(sum(nap, s => s.asleep) / 60) : 0, c2: 'var(--acc)' }; });
  const mains = ss.filter(s => !s.nap && s.asleep), avg = mains.length ? r1(sum(mains.slice(0, 7), s => s.asleep) / Math.min(7, mains.length) / 60) : null;
  let h = `<div class="card"><h3>Sleep <small>hours · night ending on date</small></h3>${barChart({ items, target: 7, color: 'var(--pro)', overColor: 'var(--pro)', unit: 'h', max: 10 })}
    <div class="legend"><span><i style="background:var(--pro)"></i>night</span><span><i style="background:var(--acc)"></i>nap</span><span>7 h reference</span></div>
    ${avg != null ? `<div class="sm mut" style="margin-top:6px">Avg of last ${Math.min(7, mains.length)} nights: <b style="color:var(--tx)">${avg} h</b></div>` : ''}</div>`;
  h += `<div class="card"><h3>History</h3><ul class="list">${ss.map(s => {
    const st = s.deep != null ? [['deep', 'var(--deep)'], ['light', 'var(--pro)'], ['dream', 'var(--acc)'], ['awake', 'var(--awake)']] : null, tot = st ? sum(st, k => s[k[0]]) : 0;
    return `<li><span class="m"><div class="n">${fmtD(s.date)} ${s.nap ? '<span class="pill pass">nap</span>' : ''}${/self/i.test(s.source) ? '<span class="pill">self-report</span>' : ''}${s.local ? '<span class="pill local">new</span>' : ''}</div>
      <div class="s">${s.nap ? 'nap' : `${esc(s.bed)} → ${esc(s.wake)}`}${s.source && !/self/i.test(s.source) ? ' · ' + esc(s.source) : ''}${s.nap && s.wake ? ' · ' + esc(s.wake) : ''}</div>
      ${st && tot ? `<div class="bar" style="display:flex;margin-top:5px;height:8px">${st.map(k => `<i style="width:${s[k[0]] / tot * 100}%;background:${k[1]};border-radius:0"></i>`).join('')}</div><div class="s">deep ${s.deep} · light ${s.light} · REM ${s.dream} · awake ${s.awake} min</div>` : ''}</span>
      <span class="v"><b>${s.asleep != null ? Math.floor(s.asleep / 60) + 'h ' + pad(s.asleep % 60) + 'm' : '?'}</b>${s.score != null ? `<div class="s">score ${s.score}</div>` : ''}</span></li>`; }).join('')}</ul></div>`;
  return h;
};

V.bp = () => {
  const bs = all('bp').sort((a, b) => a.datetime.localeCompare(b.datetime));
  if (!bs.length) return '<div class="card">No readings.</div>';
  const first = bs[0].datetime.slice(0, 10), last = todayStr() > bs[bs.length - 1].datetime ? todayStr() : bs[bs.length - 1].datetime.slice(0, 10);
  const xi = dt => daysBetween(first, dt.slice(0, 10)) + (+dt.slice(11, 13) || 12) / 24;
  const span = Math.max(1, daysBetween(first, last) + 1), xl = [];
  for (let d = first; d <= last; d = addDays(d, 1)) if (pdate(d).getDate() === 1 || (d === first && pdate(d).getDate() < 20)) xl.push({ x: xi(d + ' 00'), t: fmtShort(d) });
  const sys = bs.map(b => [xi(b.datetime), b.sys, bpCat(b.sys, 0).c]), dia = bs.map(b => [xi(b.datetime), b.dia, bpCat(0, b.dia).c]);
  const ymax = Math.max(180, ...bs.map(b => b.sys)) + 5;
  const svg = chart({ x0: 0, x1: span, y0: 60, y1: ymax, ylabelsEvery: 20, xlabels: xl,
    bands: [{ lo: 60, hi: 80, color: 'var(--band2)' }, { lo: 90, hi: 120, color: 'var(--band2)' }],
    hlines: [{ y: 140, color: 'var(--bad)', label: '140' }, { y: 130, color: 'var(--warn)', label: '130' }, { y: 90, color: 'var(--bad)', label: '90' }, { y: 80, color: 'var(--warn)', label: '80' }],
    series: [{ pts: sys, color: 'var(--mut2)', line: true, dots: true, width: 1 }, { pts: dia, color: 'var(--dia)', line: true, dots: true, width: 1, r: 3 }] });
  const recent = bs.filter(b => daysBetween(b.datetime.slice(0, 10), bs[bs.length - 1].datetime.slice(0, 10)) <= 30);
  const avgS = Math.round(sum(recent, b => b.sys) / recent.length), avgD = Math.round(sum(recent, b => b.dia) / recent.length);
  const highs = bs.filter(b => bpCat(b.sys, b.dia).high).length, st2 = bs.filter(b => b.sys >= 140 || b.dia >= 90).length, l = bs[bs.length - 1], lc = bpCat(l.sys, l.dia), ac = bpCat(avgS, avgD);
  let h = `<div class="card"><h3>Blood pressure <small>upper = systolic, lower = diastolic</small></h3>${svg}
    <div class="legend"><span><i style="background:var(--ok)"></i>normal</span><span><i style="background:var(--sod)"></i>elevated</span><span><i style="background:var(--warn)"></i>stage 1 (130/80)</span><span><i style="background:var(--bad)"></i>stage 2 (140/90)</span></div></div>
    <div class="card"><div class="stat3"><div><b style="color:${lc.c}">${l.sys}/${l.dia}</b><span>latest</span></div><div><b style="color:${ac.c}">${avgS}/${avgD}</b><span>avg ${recent.length} (30 d)</span></div><div><b style="color:var(--bad)">${highs}/${bs.length}</b><span>high (${st2} stage 2+)</span></div></div>
    <div class="sm mut" style="margin-top:8px">Categories follow ACC/AHA home-reading cutoffs. Several readings are in the stage-2 range; worth reviewing with your doctor. Anything over 180/120 with symptoms needs urgent care.</div></div>`;
  h += bpRangeCard(bs);
  h += `<div class="card"><h3>Readings</h3><ul class="list">${bs.slice().reverse().map(b => { const c = bpCat(b.sys, b.dia);
    return `<li><span class="m"><div class="n">${fmtD(b.datetime)} <span class="sm mut">${esc(b.datetime.slice(11))}</span>${b.local ? '<span class="pill local">new</span>' : ''}</div><div class="s">${esc(b.note)}</div></span>
      <span class="v"><b style="color:${c.c}">${b.sys}/${b.dia}</b><div><span class="pill ${c.k}">${c.high ? '⚠ ' : ''}${c.t}</span></div></span></li>`; }).join('')}</ul></div>`;
  return h;
};

const BP_RANGES = [['7', '7 d'], ['30', '30 d'], ['90', '90 d'], ['365', '1 yr'], ['all', 'All']];
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
    const v = { item: e.item.trim(), kcal: e.kcal, protein: e.protein, carbs: e.carbs ?? null, sodium: e.sodium ?? null, sodiumNote: e.sodiumNote || '' };
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
  $('#libQ').value = ''; $('#libBox').innerHTML = `<div class="note" style="margin-top:0">Filled from your library. Adjust anything, then Save.</div>`;
}

const FORMS = {
  food: d => `<label>From your foods</label><input id="libQ" type="search" placeholder="Search saved foods (e.g. latte, Ben's)" autocomplete="off">
    <div id="libBox">${libList('')}</div>
    <input type="hidden" name="libNote"><input type="hidden" name="libSod">
    <label>Item</label><input name="item" required placeholder="e.g. Greek yogurt 3/4 cup">
    <div class="g2"><div><label>kcal</label><input name="kcal" type="number" inputmode="decimal" required></div><div><label>Protein g</label><input name="protein" type="number" inputmode="decimal" value="0"></div></div>
    <div class="g2"><div><label>Carbs g</label><input name="carbs" type="number" inputmode="decimal" placeholder="optional"></div><div><label>Sodium mg</label><input name="sodium" type="number" inputmode="numeric" placeholder="optional"></div></div>
    <label class="chk"><input type="checkbox" name="sodEst" checked> Sodium is an estimate</label>
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
  kind = kind || ({ weight: 'weight', sleep: 'sleep', bp: 'bp' }[state.tab]) || 'food';
  const d = state.tab === 'today' && state.day ? state.day : todayStr();
  const sh = $('#sheet');
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">Quick add</b><button class="iconbtn" data-close>✕</button></div>
    <div class="seg">${['food', 'exercise', 'weight', 'bp', 'sleep'].map(k => `<button data-kind="${k}" class="${k === kind ? 'on' : ''}">${{ food: 'Food', exercise: 'Exercise', weight: 'Weight', bp: 'BP', sleep: 'Sleep' }[k]}</button>`).join('')}</div>
    <form class="f" id="addForm" data-kind="${kind}">${FORMS[kind](d)}<button class="btn" type="submit">Save</button></form>
    <div class="sm mut" style="margin-top:10px">Saved on this phone only. Use ⇪ Export to send new entries back for merging.</div></div>`;
  sh.classList.remove('hidden');
}
function minsBetween(bed, wake) { if (!bed || !wake) return null; const [a, b] = bed.split(':').map(Number), [c, d] = wake.split(':').map(Number); let m = (c * 60 + d) - (a * 60 + b); if (m <= 0) m += 1440; return m; }
function submitAdd(form) {
  const kind = form.dataset.kind, f = Object.fromEntries(new FormData(form)), num = v => v === '' || v == null ? null : Number(v);
  let e;
  if (kind === 'food') e = { date: f.date, time: f.time, item: f.item.trim(), kcal: num(f.kcal) || 0, protein: num(f.protein) || 0, carbs: num(f.carbs), sodium: num(f.sodium), sodiumNote: f.sodium === '' ? '' : (f.libNote && f.sodium === f.libSod && !!f.sodEst === !/label/i.test(f.libNote)) ? f.libNote : (f.sodEst ? 'est' : 'label') };
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
  food: ['date', 'time', 'item', 'calories', 'protein_g', 'sodium_mg', 'sodium_note', 'carbs_g'],
  exercise: ['date', 'activity', 'minutes', 'est_kcal', 'in_health'],
  weight: ['date', 'weight_lb'],
  bp: ['datetime', 'systolic', 'diastolic', 'note'],
  sleep: ['date', 'bed', 'wake', 'asleep_min', 'deep', 'light', 'dream', 'awake', 'source', 'sleep_score'],
  passes: ['date', 'note'],
  active: ['date', 'active_kcal', 'source'],
};
const TOROW = {
  food: e => [e.date, e.time, e.item, e.kcal, e.protein, e.sodium, e.sodiumNote, e.carbs],
  exercise: e => [e.date, e.activity, e.minutes, e.kcal, e.inHealth ? 'yes' : ''],
  weight: e => [e.date + (e.time ? ' ' + e.time : '') + (e.note ? ` (${e.note})` : ''), e.weight],
  bp: e => [e.datetime, e.sys, e.dia, e.note],
  sleep: e => [e.date, e.bed, e.wake, e.asleep, e.deep, e.light, e.dream, e.awake, e.source, e.score],
  passes: e => [e.date, e.note],
  active: e => [e.date, e.kcal, e.source],
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
const H_SEND = 'Fitness to Health', H_PULL = 'Health to Fitness', H_FLAG = 'fit.health.pending';
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
function parseHealth(text) {
  const out = { weight: [], bp: [], sleep: [], active: [], bad: 0 }, sys = {}, dia = {}, segs = [], act = {}, actE = {};
  String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    const f = line.split('|').map(x => x.trim()), t = f[0].toUpperCase();
    if (t === 'A' || t === 'E') { const d = hDate(f[1]), v = hNum(f[2]); if (!d || v == null) return out.bad++;
      const k = dstr(d), m = t === 'E' ? actE : act; m[k] = (m[k] || 0) + (/kj/i.test(f[3] || '') ? v / 4.184 : v); return; }
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
      cur.segs.forEach(s => m[s.st] += (s.b - s.a) / 6e4);
      const staged = m.core + m.deep + m.rem > 0, asleep = Math.round(m.core + m.deep + m.rem + m.asleep || Math.max(0, m.inbed - m.awake));
      const bed = cur.a, wake = cur.b, nap = (wake - bed) < 4 * 36e5 && bed.getHours() >= 10 && bed.getHours() < 20;
      if (asleep >= 10) nights.push({ date: dstr(wake), bed: nap ? 'nap' : hLocal(bed).slice(11), wake: hLocal(wake).slice(11), asleep,
        deep: staged ? Math.round(m.deep) : null, light: staged ? Math.round(m.core) : null, dream: staged ? Math.round(m.rem) : null,
        awake: m.awake ? Math.round(m.awake) : null, source: src, score: null, nap, _staged: staged });
      cur = null; };
    ss.forEach(s => { if (cur && s.a - cur.b <= 90 * 6e4) { cur.segs.push(s); if (s.b > cur.b) cur.b = s.b; } else { flush(); cur = { a: s.a, b: s.b, segs: [s] }; } });
    flush();
  });
  const best = {};
  nights.forEach(n => { const k = n.date + (n.nap ? 'n' : ''), o = best[k];
    if (!o || (n._staged && !o._staged) || (n._staged === o._staged && n.asleep > o.asleep)) best[k] = n; });
  out.sleep = Object.values(best).map(({ _staged, ...n }) => n).sort((x, y) => x.date.localeCompare(y.date));
  out.active = [...new Set([...Object.keys(act), ...Object.keys(actE)])].sort().map(date => date in actE
    ? { date, kcal: Math.round(actE[date]), source: EXCL } : { date, kcal: Math.round(act[date]), source: 'Apple Health' });
  return out;
}
/** drop candidates the app already has (snapshot or this device), incl. ones that came from this app via Send */
function hNew(c) {
  const W = all('weight'), B = all('bp'), Z = all('sleep');
  const mins = s => pdate(s).getTime() / 6e4 + (+s.slice(11, 13)) * 60 + (+s.slice(14, 16));
  return {
    weight: c.weight.filter(e => !W.some(w => w.date === e.date && Math.abs(w.weight - e.weight) < 0.15)),
    bp: c.bp.filter(e => !B.some(b => b.sys === e.sys && b.dia === e.dia && Math.abs(mins(b.datetime) - mins(e.datetime)) <= 2)),
    sleep: c.sleep.filter(e => !Z.some(z => z.date === e.date && !!z.nap === e.nap)),
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
  const c = parseHealth(text), n = hNew(c), tot = n.weight.length + n.bp.length + n.sleep.length + n.active.length;
  const found = c.weight.length + c.bp.length + c.sleep.length + c.active.length;
  HIMPORT = n;
  const li = (l, e) => `<li><span class="m sm">${esc(TOROW[l](e).filter(v => v != null && v !== '' && v !== false).join(' · '))}</span></li>`;
  const sh = $('#sheet');
  sh.innerHTML = `<div class="panel"><div class="row" style="margin-bottom:10px"><b style="font-size:18px">From Apple Health</b><button class="iconbtn" data-close>✕</button></div>
    <div class="sm mut">Found ${found} reading${found === 1 ? '' : 's'}; ${tot} new, ${found - tot} already in the app${c.bad ? ` · ${c.bad} line(s) not understood` : ''}.</div>
    ${['weight', 'bp', 'sleep', 'active'].filter(l => n[l].length).map(l => `<div class="card" style="margin-top:12px"><h3>${l === 'active' ? 'active energy (kcal/day)' : l} <small>${n[l].length}</small></h3><ul class="list">${n[l].map(e => li(l, e)).join('')}</ul></div>`).join('')}
    ${tot ? `<button class="btn" data-hadd>Add ${tot} entr${tot === 1 ? 'y' : 'ies'}</button>` : '<button class="btn sec" data-close>Nothing new — close</button>'}</div>`;
  sh.classList.remove('hidden');
}
function healthAdd() {
  if (!HIMPORT) return;
  let n = 0;
  // a day's Active Energy keeps growing, so a newer pull replaces that day's earlier value
  HIMPORT.active.forEach(e => { LOCAL.active = LOCAL.active.filter(x => x.date !== e.date); });
  ['weight', 'bp', 'sleep', 'active'].forEach(l => HIMPORT[l].forEach(e => { addLocal(l, e); e._health = 'from'; n++; }));
  saveLocal(); HIMPORT = null; closeSheet(); toast(`Added ${n} from Health`); render();
}
function healthCard() {
  const n = hCount(hQueue());
  return `<div class="card" style="margin-top:12px"><h3>Apple Health <small><a href="health.html">setup guide</a></small></h3>
    <div class="sm mut">Works through two Shortcuts on this iPhone. Send before you export, so new entries reach Health too.</div>
    <button class="btn" data-hsend ${n ? '' : 'disabled'}>♥ Send ${n} new entr${n === 1 ? 'y' : 'ies'} to Health</button>
    <button class="btn sec" data-hpull>Pull weight, BP &amp; sleep from Health</button>
    <button class="btn sec" data-hpaste>Paste from Health</button></div>`;
}

/* ---------- render / events ---------- */
const TITLES = { today: 'Today', plan: 'Workout plan', trends: 'Trends', weight: 'Weight', sleep: 'Sleep', bp: 'Blood pressure' };
function render() {
  $('#title').textContent = TITLES[state.tab];
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#view').innerHTML = V[state.tab]();
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
  else if (t.dataset.libpick) libPick(+t.dataset.libpick);
  else if (t.dataset.bprange) { try { localStorage.setItem('fit.bprange', t.dataset.bprange); } catch {} const y = scrollY; render(); scrollTo(0, y); }
  else if ('hsend' in t.dataset) healthSend();
  else if ('hpull' in t.dataset) healthPull();
  else if ('hpaste' in t.dataset) healthPaste();
  else if ('himport' in t.dataset) showImport($('#hText').value);
  else if ('hadd' in t.dataset) healthAdd();
  else if (t.dataset.hsent) { const fl = getFlag(); if (t.dataset.hsent === 'yes' && fl) { markSent(fl.ids); toast(`Marked ${fl.ids.length} as sent`); } setFlag(null); closeSheet(); render(); }
});
document.addEventListener('input', e => { if (e.target.id === 'libQ') $('#libBox').innerHTML = libList(e.target.value); });
document.addEventListener('submit', e => { if (e.target.id === 'addForm') { e.preventDefault(); submitAdd(e.target); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && SNAP) { render(); openHealthReturn(); } }); // day rollover, back from Shortcuts

/* ---------- unlock (encrypted snapshot) ---------- */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(enc, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function start(snap) { SNAP = snap; CFG = snap.config; loadLocal(); $('#lock').classList.add('hidden'); render(); openHealthReturn(); }
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
