// ─────────────────────────────────────────────────────────────────────────────
//  Living tree – animated SVG generator.
//  Pure, dependency-free function: runs both in Node.js (GitHub Action) and in the
//  browser (preview page). The same "seed" (username) always yields the same tree –
//  only its size, leaf density and colours change.
// ─────────────────────────────────────────────────────────────────────────────

import { normWeather, isWet, isGloomy, weatherLine } from './weather.js';

export const W = 840;
export const H = 480;
export const GROUND = 404;
const CX = W / 2;

// Number of contributions at which the tree is "fully grown" (logarithmic scale).
export const FULL_GROWN = 2000;

// ── Strings ───────────────────────────────────────────────────────────────────
const STAGE_AT = [0, 1, 10, 50, 200, 600, 1500];
export const STR = {
  hr: {
    stages: ['Sjemenka', 'Klica', 'Mladica', 'Mlado stablo', 'Stablo', 'Krošnjato stablo', 'Prastaro stablo'],
    contrib: 'doprinosa',
    active: 'aktivnih dana / 30',
    streak: (n) => `${n} dana zaredom`,
    seed: 'čeka prvi commit…',
    title: (u) => `Živo stablo korisnika ${u}`,
  },
  en: {
    stages: ['Seed', 'Sprout', 'Seedling', 'Young tree', 'Tree', 'Leafy tree', 'Ancient tree'],
    contrib: 'contributions',
    active: 'active days / 30',
    streak: (n) => `${n}-day streak`,
    seed: 'waiting for the first commit…',
    title: (u) => `Living tree of ${u}`,
  },
};

export function stageIndex(total) {
  let i = 0;
  for (let k = 0; k < STAGE_AT.length; k++) if (total >= STAGE_AT[k]) i = k;
  return i;
}
export function stageName(total, lang = 'en') {
  return (STR[lang] || STR.en).stages[stageIndex(total)];
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 2.2);
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const DEG = 180 / Math.PI;

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (const c of s) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = hashStr(String(seed));
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bez(P0, C, P1, t) {
  const u = 1 - t;
  return [u * u * P0[0] + 2 * u * t * C[0] + t * t * P1[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P1[1]];
}
// tangent angle measured from "up", clockwise (like SVG rotate)
function bezAng(P0, C, P1, t) {
  const dx = 2 * (1 - t) * (C[0] - P0[0]) + 2 * t * (P1[0] - C[0]);
  const dy = 2 * (1 - t) * (C[1] - P0[1]) + 2 * t * (P1[1] - C[1]);
  return Math.atan2(dx, -dy);
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

// ── Stats from the contribution calendar ──────────────────────────────────────
/**
 * @param {{date:string,count:number}[]} days  daily contributions (last ~year)
 * @param {Date} now
 */
export function computeStats(days, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const byAge = new Map();
  for (const d of days) {
    const [y, m, dd] = d.date.split('-').map(Number);
    const age = Math.round((today - Date.UTC(y, m - 1, dd)) / 864e5);
    if (age >= 0) byAge.set(age, (byAge.get(age) || 0) + d.count);
  }
  let active30 = 0, sinceLast = 999, streak = 0;
  for (let a = 0; a < 30; a++) if ((byAge.get(a) || 0) > 0) active30++;
  for (let a = 0; a < 400; a++) if ((byAge.get(a) || 0) > 0) { sinceLast = a; break; }
  // the streak counts from today or yesterday (today isn't over yet)
  let a = (byAge.get(0) || 0) > 0 ? 0 : 1;
  while ((byAge.get(a) || 0) > 0) { streak++; a++; }
  return { active30, sinceLast, streak };
}

/** Health 0..1 – how leafy and green the tree is. */
export function healthOf(active30, sinceLast) {
  let h = 1 - Math.exp(-active30 / 6);
  if (sinceLast > 5) h *= Math.exp(-(sinceLast - 5) / 20);
  return clamp(h);
}

export function seasonOf(date = new Date(), hemisphere = 'north') {
  let m = date.getUTCMonth(); // 0..11
  if (hemisphere === 'south') m = (m + 6) % 12;
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

// ── Tree structure (deterministic, at full size) ───────────────────
const MAXD = 7;
const structCache = new Map();

export function buildStructure(seed) {
  const key = String(seed || 'tree').toLowerCase();
  if (structCache.has(key)) return structCache.get(key);
  let r = rng(key);
  const R = (a, b) => a + (b - a) * r();
  let count = 0;

  const leaf = (t, side, a) => ({
    t, side, a,
    s: R(0.75, 1.2), // size
    k: r(),          // density threshold (leaves don't "jump around" when density changes)
    k2: r(),         // withering threshold
    c: Math.floor(r() * 5),
    f: r() < 0.35 ? 0 : 1 + Math.floor(r() * 4), // flutter class (0 = still)
  });

  function make(depth, rel, len, wr, at, born) {
    count++;
    const dur = R(0.16, 0.22);
    const n = {
      depth, rel, len, wr, at, born, dur,
      bend: R(-0.16, 0.16),
      amp: R(0.8, 1.25),
      r1: r(),
      children: [],
      leaves: [],
      tip: [],
    };
    const nAlong = Math.max(1, Math.round(len / (depth < 3 ? 14 : 9)));
    for (let i = 0; i < nAlong; i++) n.leaves.push(leaf(R(0.12, 0.98), r() < 0.5 ? -1 : 1, R(30, 75)));
    const nTip = 4 + (r() < 0.6 ? 1 : 0) + (r() < 0.3 ? 1 : 0);
    for (let i = 0; i < nTip; i++) n.tip.push(leaf(1, 0, (i / (nTip - 1) - 0.5) * 120 + R(-12, 12)));

    if (depth < MAXD) {
      if (depth < 3 || r() < 0.9) {
        n.children.push(make(depth + 1, R(-0.22, 0.22), len * R(0.74, 0.86), R(0.72, 0.82), 1, born + dur * R(0.7, 0.95)));
      }
      let sides;
      if (depth === 0) sides = 2;
      else if (depth <= 2) sides = r() < 0.5 ? 2 : 1;
      else if (depth <= 4) sides = r() < 0.85 ? 1 : 0;
      else sides = r() < 0.68 ? 1 : 0;
      let sign = r() < 0.5 ? -1 : 1;
      for (let i = 0; i < sides; i++) {
        const at = depth === 0 ? R(0.62, 0.95) : R(0.3, 0.92);
        const lenR = depth === 0 ? R(0.7, 0.85) : R(0.55, 0.75);
        n.children.push(make(depth + 1, sign * R(0.45, 0.95), len * lenR, R(0.55, 0.7), at, born + dur * at * R(0.6, 1)));
        sign = -sign;
      }
    }
    return n;
  }

  const root = make(0, R(-0.06, 0.06), 100, 1, 0, 0);

  // A few extra branches for a fuller, more even crown: where a main limb only
  // branches to one side, give it a branch on the other side too. Uses its own
  // random stream, so the original shape of the tree stays exactly the same.
  r = rng(key + ':extra');
  (function addExtra(n) {
    const kids = n.children.slice();
    kids.forEach(addExtra);
    if (n.depth < 1 || n.depth > 2) return;
    const sides = kids.filter((c) => Math.abs(c.rel) >= 0.45);
    if (sides.length !== 1) return;
    const sign = -Math.sign(sides[0].rel);
    const at = R(0.35, 0.85);
    n.children.push(make(n.depth + 1, sign * R(0.5, 0.85), n.len * R(0.55, 0.72), R(0.55, 0.68), at, n.born + n.dur * at * R(0.6, 1)));
  })(root);

  // ...and two more on whichever side of the crown is thinner, reaching outwards and up
  {
    const m = baseCtx({ root, fit: 1 }, { g: 1, scale: 1, measure: true });
    m.nodes = [];
    walk(root, m, [CX, GROUND], 0, 20);
    const tips = m.nodes.filter((p) => p.n.children.length === 0);
    const left = tips.filter((p) => p.P1[0] < CX).length;
    const side = left > tips.length - left ? 1 : -1;
    const midY = tips.reduce((s, p) => s + p.P1[1], 0) / tips.length;
    const cand = m.nodes.filter((p) => (p.n.depth === 2 || p.n.depth === 3) && (p.P1[0] - CX) * side > 0 && p.P1[1] < midY + 20);
    for (let i = 0; i < 2 && cand.length; i++) {
      const { n } = cand.splice(Math.floor(r() * cand.length), 1)[0];
      const at = R(0.45, 0.85);
      n.children.push(make(n.depth + 1, side * R(0.45, 0.75), n.len * R(0.6, 0.75), R(0.55, 0.68), at, n.born + n.dur * at * R(0.6, 1)));
    }
  }

  // normalise birth times so the tree is fully grown at g = 1
  let maxEnd = 0;
  (function walkT(n) { maxEnd = Math.max(maxEnd, n.born + n.dur); n.children.forEach(walkT); })(root);
  (function normT(n) { n.born /= maxEnd; n.dur /= maxEnd; n.children.forEach(normT); })(root);

  const st = { root, count, seed: key, fit: 1 };
  // measure the grown tree and scale it to fit the image
  const ctx = baseCtx(st, { g: 1, scale: 1, measure: true });
  walk(root, ctx, [CX, GROUND], 0, 20);
  const b = ctx.bbox;
  // partly centre the crown by shifting the trunk against its lean
  const shift = -0.7 * ((b.minX + b.maxX) / 2 - CX);
  const fitH = (GROUND - 30) / (GROUND - b.minY + 12);
  const fitL = (CX - 40) / (CX - b.minX - shift + 12);
  const fitR = (CX - 40) / (b.maxX - CX + shift + 12);
  st.fit = Math.min(fitH, fitL, fitR);
  st.baseX = CX + shift * st.fit;
  structCache.set(key, st);
  return st;
}

// ── Palettes ─────────────────────────────────────────────────────────────────
const PALETTES = {
  spring: ['#6cc04a', '#8fd35f', '#4fa83d', '#a5dc6e', '#5cb848'],
  summer: ['#3d8b37', '#4f9e3f', '#2f7531', '#64ae48', '#3a8040'],
  autumn: ['#e08a2c', '#c9532a', '#edb83f', '#a8402a', '#7c9a3a'],
  winter: ['#4d6b47', '#5d7a52', '#3f5c3c', '#6b8560', '#556f4c'],
};
const WITHERED = ['#c9a94a', '#b98c3a', '#d7bf5e', '#a07436', '#bfa055'];
const SEASON_DENSITY = { spring: 0.9, summer: 1, autumn: 0.8, winter: 0.5 };

function baseCtx(st, o) {
  return {
    g: o.g,
    scale: o.scale,
    measure: !!o.measure,
    bbox: { minX: CX, maxX: CX, minY: GROUND },
    minW: 0.6,
    leafW: 6,
    leafScale: o.leafScale || 1,
    density: o.density ?? 1,
    wither: o.wither ?? 0,
    wind: o.wind || 1,
    season: o.season || 'summer',
    health: o.health ?? 1,
    swayDepth: 4,
    T: 8,
    leafPos: [],
    leafCount: 0,
  };
}

// ── Drawing a branch ──────────────────────────────────────────────────────────
function branchPath(P0, C, P1, w0, w1) {
  const a0 = bezAng(P0, C, P1, 0), a1 = bezAng(P0, C, P1, 1);
  const am = (a0 + a1) / 2;
  const n0 = [Math.cos(a0), Math.sin(a0)], n1 = [Math.cos(a1), Math.sin(a1)], nm = [Math.cos(am), Math.sin(am)];
  const h0 = w0 / 2, h1 = w1 / 2, hm = (w0 + w1) / 4;
  const L0 = [P0[0] - n0[0] * h0, P0[1] - n0[1] * h0];
  const R0 = [P0[0] + n0[0] * h0, P0[1] + n0[1] * h0];
  const L1 = [P1[0] - n1[0] * h1, P1[1] - n1[1] * h1];
  const R1 = [P1[0] + n1[0] * h1, P1[1] + n1[1] * h1];
  const CL = [C[0] - nm[0] * hm, C[1] - nm[1] * hm];
  const CR = [C[0] + nm[0] * hm, C[1] + nm[1] * hm];
  const p = (q) => f1(q[0]) + ' ' + f1(q[1]);
  return `M${p(L0)}Q${p(CL)} ${p(L1)}A${f1(h1)} ${f1(h1)} 0 0 1 ${p(R1)}Q${p(CR)} ${p(R0)}A${f1(h0)} ${f1(h0)} 0 0 1 ${p(L0)}Z`;
}

const GUST = [0, 0.7, 0.22, 1, -0.12, 0.8, 0.3, 0];
const KT = GUST.map((_, i) => f2(i / (GUST.length - 1))).join(';');
const KS = Array(GUST.length - 1).fill('.45 0 .55 1').join(';');

function leafEl(ctx, x, y, angDeg, lf) {
  ctx.leafCount++;
  const sc = f2((lf.s * ctx.leafScale) / 10 * 10.5);
  const cls = (lf.k2 < ctx.wither ? 'y' : 'g') + lf.c;
  if (ctx.leafPos.length < 600) ctx.leafPos.push([x, y, cls]);
  if (ctx.collect) ctx.collect.leaves.push({ x, y, cls, withered: cls[0] === 'y', k2: lf.k2 });
  const tr = `translate(${f1(x)} ${f1(y)}) rotate(${Math.round(angDeg)}) scale(${sc})`;
  return lf.f
    ? `<g transform="${tr}"><use href="#L" class="f${lf.f} ${cls}"/></g>`
    : `<use href="#L" class="${cls}" transform="${tr}"/>`;
}

function walk(n, ctx, P0, parentAng, w0) {
  const s = clamp((ctx.g - n.born) / n.dur);
  if (s <= 0) return '';
  const e = easeOut(s);
  const L = Math.max(0.4, n.len * ctx.scale * e);
  const ang = (parentAng + n.rel * (0.55 + 0.45 * e)) * 0.95;
  const P1 = [P0[0] + Math.sin(ang) * L, P0[1] - Math.cos(ang) * L];
  const nx = Math.cos(ang), ny = Math.sin(ang);
  const b = n.bend * L;
  const C = [(P0[0] + P1[0]) / 2 + nx * b, (P0[1] + P1[1]) / 2 + ny * b];
  const vis = n.children.filter((c) => ctx.g > c.born);
  const terminal = vis.length === 0;
  const w1 = Math.max(ctx.minW, w0 * (terminal ? 0.45 : 0.8));

  if (ctx.measure) {
    if (ctx.nodes) ctx.nodes.push({ n, P1 });
    ctx.bbox.minX = Math.min(ctx.bbox.minX, P1[0]);
    ctx.bbox.maxX = Math.max(ctx.bbox.maxX, P1[0]);
    ctx.bbox.minY = Math.min(ctx.bbox.minY, P1[1]);
    for (const c of vis) {
      const cs = easeOut(clamp((ctx.g - c.born) / c.dur));
      walk(c, ctx, bez(P0, C, P1, c.at), bezAng(P0, C, P1, c.at), lerp(w0, w1, c.at) * c.wr * (0.45 + 0.55 * cs));
    }
    return '';
  }

  if (ctx.collect) ctx.collect.branches.push({ P0, C, P1, w0, w1, depth: n.depth, terminal });
  let out = `<path class="b" d="${branchPath(P0, C, P1, w0, w1)}"/>`;

  // leaves along thin branches
  for (const lf of n.leaves) {
    if (lf.k >= ctx.density) continue;
    if (lf.t * L < 2) continue;
    const wl = lerp(w0, w1, lf.t);
    if (wl > ctx.leafW) continue;
    const P = bez(P0, C, P1, lf.t);
    const a = bezAng(P0, C, P1, lf.t);
    const off = wl * 0.4 * lf.side;
    const la = (a * DEG + lf.side * lf.a) * 0.8;
    out += leafEl(ctx, P[0] + Math.cos(a) * off, P[1] + Math.sin(a) * off, la, lf);
  }

  // child branches
  let kids = '';
  for (const c of vis) {
    const cs = easeOut(clamp((ctx.g - c.born) / c.dur));
    const wc = Math.max(ctx.minW, lerp(w0, w1, c.at) * c.wr * (0.45 + 0.55 * cs));
    kids += walk(c, ctx, bez(P0, C, P1, c.at), bezAng(P0, C, P1, c.at), wc);
  }
  out += kids;

  // bud / leaf cluster at the branch tip
  if (terminal) {
    for (const lf of n.tip) {
      if (lf.k >= Math.max(ctx.density, 0.12)) continue;
      out += leafEl(ctx, P1[0], P1[1], (ang * DEG + lf.a) * 0.85, lf);
    }
    if (ctx.season === 'spring' && n.r1 < 0.55 && ctx.density > 0.2) {
      out += `<use href="#F" class="bl${n.r1 < 0.2 ? 2 : 1}" transform="translate(${f1(P1[0])} ${f1(P1[1])}) scale(${f2(ctx.leafScale * (0.8 + n.r1))})"/>`;
    }
    if ((ctx.season === 'summer' || ctx.season === 'autumn') && ctx.g > 0.6 && n.depth >= 4 && n.r1 < (ctx.health - 0.5) * 0.7) {
      out += `<circle class="fr" cx="${f1(P1[0] + 1)}" cy="${f1(P1[1] + 4)}" r="${f1(2.8 * ctx.leafScale)}"/>`;
    }
  }

  if (n.depth <= ctx.swayDepth) {
    const amp = (0.3 + 0.32 * n.depth) * n.amp * ctx.wind;
    const vals = GUST.map((k) => `${f2(k * amp)} ${f1(P0[0])} ${f1(P0[1])}`).join(';');
    const lag = (P0[0] / W) * 1.6 + n.depth * 0.12;
    out = `<g><animateTransform attributeName="transform" type="rotate" dur="${ctx.T}s" begin="${f2(lag - ctx.T)}s" repeatCount="indefinite" calcMode="spline" keyTimes="${KT}" keySplines="${KS}" values="${vals}"/>${out}</g>`;
  }
  return out;
}

// ── Scene ──────────────────────────────────────────────────────────────────
export const groundY = (x) => GROUND + 14 * ((x - CX) / CX) ** 2 + 3 * Math.sin((x - CX) / 70);
const backY = (x) => GROUND - 34 - 16 * Math.sin(x / 210 + 0.8) - 8 * Math.sin(x / 90);

function hillPath(fn) {
  let d = `M-2 ${f1(fn(-2))}`;
  for (let x = 10; x <= W + 10; x += 12) d += `L${x} ${f1(fn(x))}`;
  return d + `L${W + 10} ${H + 2}L-2 ${H + 2}Z`;
}

function css(theme, season, pal, palDark, wx, drift) {
  const gloomy = isGloomy(wx);
  const leafCss = (p, w) => p.map((c, i) => `.g${i}{fill:${c}}`).join('') + w.map((c, i) => `.y${i}{fill:${c}}`).join('');
  const winter = season === 'winter';
  const light = `
.sk1{stop-color:${gloomy ? '#aebcc6' : '#bfe0f5'}}.sk2{stop-color:${gloomy ? '#e4e9e7' : '#f1f7ec'}}
.cr{fill:${isWet(wx) || wx.kind === 'storm' ? '#8d9aa3' : '#d5dde2'}}.rn{stroke:#5a86a8;stroke-width:1.2;stroke-linecap:round;opacity:.7}
.fg{fill:#eef2f1}.fl{fill:#fff}
.hb{fill:${winter ? '#e3ebf1' : '#acd08d'}}.hf{fill:${winter ? '#f4f7fa' : '#80b35c'}}
.gs{stroke:${winter ? '#9fb39a' : '#5d9843'};stroke-width:1.3;fill:none;stroke-linecap:round}
.b{fill:#6b4a33}.rt{fill:#5d402c}.sd{fill:#8a5a36}
.tx{font:600 12px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;fill:#34452f;paint-order:stroke;stroke:#ffffff;stroke-opacity:.55;stroke-width:3px}
.cl{fill:#fff;opacity:.85}.sun{opacity:1}.nt{display:none}
.bl1{fill:#f7c1d6}.bl2{fill:#fff4f8}.fr{fill:#d6402f}.gf{fill:#f3d34a}.sn{fill:#fff}
${leafCss(pal, WITHERED)}`;
  const dark = `
.sk1{stop-color:${gloomy ? '#0a0f14' : '#08111f'}}.sk2{stop-color:${gloomy ? '#1d252c' : '#1c2c40'}}
.cr{fill:#56616b;opacity:.55}.rn{stroke:#8fb9d6}.fg{fill:#7d8a92}.fl{fill:#dbe9ff}
.hb{fill:${winter ? '#5d6c7e' : '#22402a'}}.hf{fill:${winter ? '#8494a7' : '#1b3523'}}
.gs{stroke:${winter ? '#6c7d8f' : '#2f5a35'}}
.b{fill:#4b3426}.rt{fill:#3f2c20}
.tx{fill:#cfdcc9;stroke:#000;stroke-opacity:.35}
.cl{opacity:.1}.sun{opacity:0}.nt{display:inline}
.bl1{fill:#c993a8}.bl2{fill:#d8cdd2}.fr{fill:#a8352a}.gf{fill:#b49b35}
${leafCss(palDark, WITHERED.map((c) => mixHex(c, '#101820', 0.3)))}`;
  const motion = `
.f1,.f2,.f3,.f4,.gs{transform-box:fill-box;transform-origin:50% 100%}
.f1{animation:fa 2.6s ease-in-out infinite alternate}
.f2{animation:fa 3.2s ease-in-out -1.3s infinite alternate}
.f3{animation:fb 2.2s ease-in-out -.7s infinite alternate}
.f4{animation:fb 3.7s ease-in-out -2.1s infinite alternate}
.gs{animation:gw 4s ease-in-out infinite alternate}
.cl{animation:dr 120s linear infinite}
.st{animation:tw 3s ease-in-out infinite alternate}
.sn{animation:sn 11s linear infinite}
.rn{animation:rn 1s linear infinite}
.fd{animation:fd 22s ease-in-out infinite alternate}
.fl{opacity:0;animation:lt 7s linear infinite}
@keyframes fa{from{transform:rotate(-7deg)}to{transform:rotate(9deg)}}
@keyframes fb{from{transform:rotate(5deg) scale(1)}to{transform:rotate(-10deg) scale(.9)}}
@keyframes gw{from{transform:rotate(-4deg)}to{transform:rotate(7deg)}}
@keyframes dr{from{transform:translateX(-260px)}to{transform:translateX(1100px)}}
@keyframes tw{from{opacity:.25}to{opacity:1}}
@keyframes sn{from{transform:translate(0,0)}to{transform:translate(${f1(30 + drift * 0.8)}px,520px)}}
@keyframes rn{from{transform:translate(0,0)}to{transform:translate(${f1(drift * 0.35)}px,520px)}}
@keyframes fd{from{transform:translateX(-40px)}to{transform:translateX(40px)}}
@keyframes lt{0%,88%,100%{opacity:0}89%{opacity:.8}90%{opacity:.1}92%{opacity:.55}95%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
  let s = light + motion;
  if (theme === 'dark') s += dark;
  else if (theme === 'auto') s += `@media (prefers-color-scheme:dark){${dark}}`;
  return s.replace(/\n/g, '');
}

/**
 * Main function – returns the SVG as a string.
 * @param {object} o
 * @param {string} o.login        GitHub user (also the seed for the tree's shape)
 * @param {number} o.total        total contributions (all years)
 * @param {number} o.active30     days with at least one contribution in the last 30
 * @param {number} o.sinceLast    days since the last contribution
 * @param {number} [o.streak]     current streak in days
 * @param {'auto'|'spring'|'summer'|'autumn'|'winter'} [o.season]
 * @param {'auto'|'light'|'dark'} [o.theme]
 * @param {'hr'|'en'} [o.lang]
 * @param {Date} [o.now]
 * @param {boolean} [o.label]     show the stats label
 */
export function renderTree(o) {
  const login = o.login || 'github';
  const total = Math.max(0, Math.round(o.total || 0));
  const lang = STR[o.lang] ? o.lang : 'en';
  const T = STR[lang];
  const theme = o.theme || 'auto';
  const now = o.now || new Date();
  const season = !o.season || o.season === 'auto' ? seasonOf(now, o.hemisphere) : o.season;
  const active30 = clamp(o.active30 ?? 0, 0, 30);
  const sinceLast = o.sinceLast ?? 999;
  const health = healthOf(active30, sinceLast);
  const fullAt = o.fullGrown || FULL_GROWN;
  const g = total <= 0 ? 0 : clamp(Math.log(1 + total) / Math.log(1 + fullAt));
  const scaleAll = 0.16 + 0.84 * Math.pow(g, 1.15);
  const rnd = rng(login + ':scene');
  const R = (a, b) => a + (b - a) * rnd();
  const wx = normWeather(o.weather);
  const windK = clamp((wx.wind || 0) / 50);
  const wet = isWet(wx);
  const gloomy = isGloomy(wx);
  const drift = -Math.round(wx.wind * 2.2);

  const st = buildStructure(login);
  const BX = st.baseX, BY = groundY(BX);
  const pal = PALETTES[season];
  const palDark = pal.map((c) => mixHex(c, '#0b1620', 0.32));
  const density = clamp((0.06 + 0.94 * health) * SEASON_DENSITY[season]);
  const wither = season === 'autumn' ? 0.15 + 0.85 * Math.pow(1 - health, 1.2) : Math.pow(1 - health, 1.2);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="tt">`);
  out.push(`<title id="tt">${esc(T.title(login))} – ${esc(weatherLine(wx))}</title>`);
  out.push(`<style>${css(theme, season, pal, palDark, wx, drift)}</style>`);
  out.push(`<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sk1"/><stop offset="1" class="sk2"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#fff3b8" stop-opacity=".95"/><stop offset=".35" stop-color="#ffe98a" stop-opacity=".5"/><stop offset="1" stop-color="#ffe98a" stop-opacity="0"/></radialGradient>
<radialGradient id="ff"><stop offset="0" stop-color="#fbff9e"/><stop offset=".3" stop-color="#e9ff6a" stop-opacity=".7"/><stop offset="1" stop-color="#d4ff4a" stop-opacity="0"/></radialGradient>
<clipPath id="cp"><rect width="${W}" height="${H}" rx="16"/></clipPath>
<path id="L" d="M0 0C-1.2-1-3.9-3.6-3.6-6.6-3.2-9.3-1-10.8 0-11.6 1-10.8 3.2-9.3 3.6-6.6 3.9-3.6 1.2-1 0 0Z"/>
<g id="F"><circle cx="0" cy="-2.4" r="1.9"/><circle cx="2.3" cy="-.7" r="1.9"/><circle cx="1.4" cy="2" r="1.9"/><circle cx="-1.4" cy="2" r="1.9"/><circle cx="-2.3" cy="-.7" r="1.9"/><circle cx="0" cy="0" r="1.1" fill="#f3c74a"/></g>
</defs>`.replace(/\n/g, ''));
  out.push(`<g clip-path="url(#cp)">`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
  if (wx.kind === 'storm') out.push(`<rect class="fl" width="${W}" height="${H}"/>`);

  // sun
  if (!gloomy) out.push(`<g class="sun"><circle cx="702" cy="78" r="70" fill="url(#glow)"/><circle cx="702" cy="78" r="20" fill="#fff6cf"/></g>`);

  // night: stars, moon
  let night = '<g class="nt">';
  if (!gloomy) night += `<path d="M700 58a22 22 0 1 0 22 30 17 17 0 1 1-22-30z" fill="#f4efd6"/><circle cx="706" cy="80" r="46" fill="url(#glow)" opacity=".25"/>`;
  const nStars = { clear: 46, partly: 22 }[wx.kind] ?? 0;
  for (let i = 0; i < nStars; i++) {
    const x = R(10, W - 10), y = R(8, 250), r = R(0.5, 1.5);
    night += `<circle class="st" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#fff" style="animation-duration:${f1(R(2, 5))}s;animation-delay:-${f1(R(0, 5))}s"/>`;
  }
  out.push(night + `</g>`);

  // clouds
  const nCloud = { clear: 2, partly: 4, cloudy: 8, fog: 5, drizzle: 7, rain: 8, snow: 7, storm: 9 }[wx.kind] ?? 3;
  for (let i = 0; i < nCloud; i++) {
    const y = R(gloomy ? 20 : 40, gloomy ? 120 : 150), s = R(0.7, 1.25) * (gloomy ? 1.5 : 1), x = R(0, W);
    const d = Math.round(R(110, 170) / (1 + windK * 2.5));
    out.push(`<g class="cl${gloomy ? ' cr' : ''}" style="animation-duration:${d}s;animation-delay:-${Math.round(R(0, d))}s"><g transform="translate(${f1(x - W / 2)} ${f1(y)}) scale(${f2(s)})"><ellipse cx="0" cy="0" rx="34" ry="13"/><ellipse cx="-18" cy="3" rx="22" ry="10"/><ellipse cx="20" cy="-6" rx="22" ry="13"/><ellipse cx="2" cy="-12" rx="18" ry="12"/></g></g>`);
  }

  out.push(`<path class="hb" d="${hillPath(backY)}"/>`);

  // tree
  if (total <= 0) {
    out.push(`<g transform="translate(${f1(BX)} ${f1(BY - 2)})"><ellipse class="sd" cx="0" cy="0" rx="9" ry="6" transform="rotate(-18)"/><path d="M-3 -3q3 -2 6 1" stroke="#5c3a20" stroke-width="1" fill="none"/></g>`);
  } else {
    const ctx = baseCtx(st, {
      g,
      scale: st.fit * scaleAll,
      leafScale: 0.72 + 0.28 * scaleAll,
      density, wither, season, health,
      wind: (1 + (1 - scaleAll) * 1.3) * (0.6 + windK * 2.2),
    });
    ctx.T = Math.round((8 - windK * 3) * 10) / 10;
    const trunkW = Math.max(1.4, 26 * st.fit * (0.07 + 0.93 * Math.pow(g, 1.25)));
    let roots = '';
    if (g > 0.3) {
      for (const sgn of [-1, 1]) {
        const a = sgn * 1.25;
        const len = trunkW * 1.5;
        const P0 = [BX + sgn * trunkW * 0.15, BY + 4];
        const P1 = [P0[0] + Math.sin(a) * len, P0[1] - Math.cos(a) * len + 4];
        const C = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2 - 3];
        roots += `<path class="rt" d="${branchPath(P0, C, P1, trunkW * 0.55, 1.2)}"/>`;
      }
    }
    const tree = walk(st.root, ctx, [BX, BY + 6], 0, trunkW);
    out.push(`<g>${roots}${tree}</g>`);

    // falling leaves
    const nFall = Math.min(ctx.leafPos.length, Math.round(1 + (1 - health) * 5 + (season === 'autumn' ? 7 : 0) + windK * 6));
    for (let i = 0; i < nFall; i++) {
      const [x, y, cls] = ctx.leafPos[Math.floor(rnd() * ctx.leafPos.length)];
      const dy = groundY(x) - y + R(-2, 6);
      const dx = R(50, 140);
      const dur = R(12, 20);
      const c = rnd() < 0.6 ? 'y' + Math.floor(rnd() * 5) : cls;
      const path = `M${f1(x)} ${f1(y)}c${f1(dx * 0.1)} ${f1(dy * 0.3)} ${f1(dx * 0.6)} ${f1(dy * 0.2)} ${f1(dx * 0.5)} ${f1(dy * 0.55)}s${f1(dx * 0.2)} ${f1(dy * 0.35)} ${f1(dx * 0.5)} ${f1(dy * 0.45)}`;
      const t = `dur="${f1(dur)}s" begin="-${f1(R(0, dur))}s" repeatCount="indefinite"`;
      out.push(`<g opacity="0"><animateMotion path="${path}" ${t} keyPoints="0;1;1" keyTimes="0;.55;1" calcMode="linear"/><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.03;.5;.56;1" ${t}/><g class="f3" style="animation-duration:${f1(R(0.8, 1.6))}s"><use href="#L" class="${c}" transform="scale(${f2(0.8 * ctx.leafScale)})"/></g></g>`);
    }
  }

  // ground + grass
  out.push(`<path class="hf" d="${hillPath(groundY)}"/>`);
  if (total > 0) out.push(`<ellipse cx="${f1(BX + 6)}" cy="${f1(BY + 3)}" rx="${f1(20 + 150 * scaleAll * st.fit)}" ry="${f1(3 + 6 * scaleAll)}" fill="#0c2a0c" opacity=".13"/>`);
  let grass = '';
  for (let i = 0; i < 46; i++) {
    const x = R(6, W - 6);
    if (Math.abs(x - BX) < 14) continue;
    const y = groundY(x) + 1.5;
    const h = R(5, 11);
    grass += `<path class="gs" style="animation-delay:-${f1(R(0, 4))}s" d="M${f1(x)} ${f1(y)}q-1 -${f1(h * 0.6)} -3 -${f1(h)}M${f1(x + 1.5)} ${f1(y)}q.5 -${f1(h * 0.7)} 2.5 -${f1(h * 1.1)}M${f1(x + 0.6)} ${f1(y)}v-${f1(h * 0.8)}"/>`;
  }
  out.push(grass);
  if (season === 'spring' || season === 'summer') {
    for (let i = 0; i < 9; i++) {
      const x = R(30, W - 30);
      if (Math.abs(x - BX) < 40) continue;
      out.push(`<use href="#F" class="${season === 'spring' ? 'bl1' : 'gf'}" transform="translate(${f1(x)} ${f1(groundY(x) - 2)}) scale(.75)"/>`);
    }
  }

  // snow
  if (wet) {
    const n = wx.kind === 'drizzle' ? [30, 50, 80][wx.intensity - 1] : wx.kind === 'storm' ? 190 : [70, 120, 180][wx.intensity - 1];
    const [d0, d1] = wx.kind === 'drizzle' ? [2, 3] : wx.kind === 'storm' ? [0.55, 0.9] : [0.75, 1.2];
    const len = wx.kind === 'drizzle' ? 4 : 11;
    const dx = (drift * 0.35 / 520) * len;
    let rain = '';
    for (let i = 0; i < n; i++) {
      const d = R(d0, d1);
      const x = R(0, W - drift * 0.4);
      rain += `<line class="rn" x1="${f1(x)}" y1="-14" x2="${f1(x + dx)}" y2="${f1(-14 + len)}" style="animation-duration:${f1(d)}s;animation-delay:-${f1(R(0, d))}s"/>`;
    }
    out.push(rain);
  }
  if (wx.kind === 'fog') {
    let fog = '';
    for (let i = 0; i < 7; i++) {
      fog += `<ellipse class="fg fd" cx="${f1(R(0, W))}" cy="${f1(R(GROUND - 120, GROUND + 10))}" rx="${f1(R(140, 260))}" ry="${f1(R(18, 34))}" opacity="${f2(R(0.35, 0.6))}" style="animation-duration:${f1(R(16, 28))}s;animation-delay:-${f1(R(0, 20))}s"/>`;
    }
    out.push(fog);
  }
  if (wx.kind === 'snow') {
    for (let i = 0; i < [45, 80, 130][wx.intensity - 1]; i++) {
      out.push(`<circle class="sn" cx="${f1(R(-40, W))}" cy="-8" r="${f1(R(0.8, 2.2))}" style="animation-duration:${f1(R(8, 16))}s;animation-delay:-${f1(R(0, 16))}s"/>`);
    }
  }

  // fireflies (night only) – more activity = more fireflies
  let ff = `<g class="nt">`;
  const warm = wx.temp == null || wx.temp >= 12;
  const nff = total > 0 && warm && !wet && wx.kind !== 'snow' && wx.kind !== 'fog' ? Math.round(2 + active30 / 2.5) : 0;
  for (let i = 0; i < nff; i++) {
    const x = R(BX - 300, BX + 300), y = R(GROUND - 230, GROUND - 20);
    const rx = R(15, 45), ry = R(10, 30);
    ff += `<g><animateMotion path="M${f1(x)} ${f1(y)}c${f1(rx)} -${f1(ry)} ${f1(rx * 2)} ${f1(ry)} 0 ${f1(ry * 1.4)}s-${f1(rx * 1.6)} -${f1(ry * 2)} 0 -${f1(ry * 1.4)}z" dur="${f1(R(9, 16))}s" begin="-${f1(R(0, 9))}s" repeatCount="indefinite"/><circle r="7" fill="url(#ff)"><animate attributeName="opacity" values="0;1;.15;.9;0" dur="${f1(R(2.5, 5))}s" begin="-${f1(R(0, 4))}s" repeatCount="indefinite"/></circle></g>`;
  }
  out.push(ff + `</g>`);

  // label
  if (o.label !== false) {
    const nf = new Intl.NumberFormat(lang === 'hr' ? 'hr-HR' : 'en-US');
    const left = `@${login} · ${o.place || 'Zagreb'}`;
    const right = weatherLine(wx) + (o.updated ? ` · updated ${o.updated}` : '');
    void nf;
    out.push(`<text class="tx" x="20" y="${H - 16}">${esc(left)}</text><text class="tx" x="${W - 20}" y="${H - 16}" text-anchor="end">${esc(right)}</text>`);
  }

  out.push(`</g></svg>`);
  return out.join('');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * Tree geometry without drawing (for alternative styles, e.g. ASCII).
 * Takes the same options as renderTree.
 */
export function treeGeometry(o) {
  const login = o.login || 'github';
  const total = Math.max(0, Math.round(o.total || 0));
  const now = o.now || new Date();
  const season = !o.season || o.season === 'auto' ? seasonOf(now, o.hemisphere) : o.season;
  const active30 = clamp(o.active30 ?? 0, 0, 30);
  const sinceLast = o.sinceLast ?? 999;
  const health = healthOf(active30, sinceLast);
  const g = total <= 0 ? 0 : clamp(Math.log(1 + total) / Math.log(1 + (o.fullGrown || FULL_GROWN)));
  const scaleAll = 0.16 + 0.84 * Math.pow(g, 1.15);
  const st = buildStructure(login);
  const BX = st.baseX, BY = groundY(BX);
  const density = clamp((0.06 + 0.94 * health) * SEASON_DENSITY[season]);
  const wither = season === 'autumn' ? 0.15 + 0.85 * Math.pow(1 - health, 1.2) : Math.pow(1 - health, 1.2);
  const geo = { login, total, season, health, g, scaleAll, BX, BY, active30, sinceLast, streak: o.streak || 0, branches: [], leaves: [] };
  if (total > 0) {
    const ctx = baseCtx(st, { g, scale: st.fit * scaleAll, leafScale: 0.72 + 0.28 * scaleAll, density, wither, season, health });
    ctx.collect = geo;
    geo.trunkW = Math.max(1.4, 26 * st.fit * (0.07 + 0.93 * Math.pow(g, 1.25)));
    walk(st.root, ctx, [BX, BY + 6], 0, geo.trunkW);
  }
  return geo;
}
