// ─────────────────────────────────────────────────────────────────────────────
//  Živo stablo – ASCII / "Matrix" stil.
//  Koristi istu geometriju kao klasično stablo (treeGeometry), ali je
//  rasterizira u mrežu znakova: grane postaju | / \ _, lišće postaju
//  katakana i simboli, a u pozadini pada zelena "kiša" znakova.
// ─────────────────────────────────────────────────────────────────────────────
import { W, H, STR, stageIndex, groundY, treeGeometry } from './tree.js';

const CW = 8;   // širina ćelije (px)
const CH = 13;  // visina ćelije (px)
const COLS = Math.floor(W / CW);
const ROWS = Math.ceil(H / CH);

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789$+-*/=%#&<>:;!?{}[]';
const LEAF_GLYPHS = '@&%#*$80oOQ6+';
const GRASS = ",.'\";:`,.";
const SOIL = '.,_-:';

const SEASON_LEAVES = {
  spring: ['#7dffb0', '#4dff8a', '#b8ffd0', '#2ee67a'],
  summer: ['#39ff6a', '#22d65a', '#8dffa8', '#14b84a'],
  autumn: ['#ffcf3a', '#ff9a33', '#c8ff4a', '#ff6b3d'],
  winter: ['#a8f4ff', '#5fd8c0', '#e8ffff', '#3fb98a'],
};
const WITHERED = ['#a89a3a', '#8a7a2a', '#c2b04a', '#7a6a2a'];
// dnevne (svijetle) varijante – tamniji tonovi na svijetloj pozadini
const DAY_LEAVES = {
  spring: ['#2e9e55', '#1f8a45', '#3fae62', '#c2477e'],
  summer: ['#1f8f3a', '#167a2e', '#2ea84a', '#0f6b26'],
  autumn: ['#cf7f0c', '#c2561e', '#6f8f12', '#b8401f'],
  winter: ['#2f8fa8', '#2a7f6e', '#4a93b0', '#246b52'],
};
const DAY_WITHERED = ['#9a8420', '#7a6a1a', '#ad9530', '#6a5a1a'];

// ── ASCII "nebo" ──
const SUN = [
  '      .---.      ',
  '  -- (     ) --  ',
  "      '---'      ",
];
const SUN_RAYS_A = [
  '   \\    |    /   ',
  '                 ',
  '                 ',
  '                 ',
  '   /    |    \\   ',
];
const SUN_RAYS_B = [
  "    .   '   .    ",
  '                 ',
  ' -             - ',
  '                 ',
  "    '   .   '    ",
];
const MOON = [
  "     _.._   ",
  "   .' .-'`  ",
  "  /  /      ",
  "  |  |      ",
  "  \\  '.___.",
  "   '._  _.' ",
  "      ''    ",
];
const CLOUD = [
  '    .--~~--.     ',
  '  .(        ).   ',
  ' (___.__.__)__)  ',
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function rng(seed) {
  let a = 0;
  for (const c of String(seed)) a = (Math.imul(a ^ c.codePointAt(0), 2654435761) + 1) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// stabilni "random" po ćeliji (da se znakovi ne mijenjaju svaki dan bez razloga)
const cellHash = (c, r, salt = 0) => {
  let h = Math.imul(c * 374761393 + r * 668265263 + salt * 2246822519, 3266489917);
  h ^= h >>> 15;
  return ((h >>> 0) % 100000) / 100000;
};
const pick = (str, v) => [...str][Math.floor(v * [...str].length) % [...str].length];

function bez(P0, C, P1, t) {
  const u = 1 - t;
  return [u * u * P0[0] + 2 * u * t * C[0] + t * t * P1[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P1[1]];
}
function bezAng(P0, C, P1, t) {
  const dx = 2 * (1 - t) * (C[0] - P0[0]) + 2 * t * (P1[0] - C[0]);
  const dy = 2 * (1 - t) * (C[1] - P0[1]) + 2 * t * (P1[1] - C[1]);
  return Math.atan2(dx, -dy);
}
const angleChar = (a) => {
  const m = Math.abs(a);
  if (m < 0.38) return '|';
  if (m < 1.18) return a > 0 ? '/' : '\\';
  return '_';
};

export function renderAscii(o) {
  const geo = treeGeometry(o);
  const lang = STR[o.lang] ? o.lang : 'hr';
  const T = STR[lang];
  const rnd = rng(geo.login + ':ascii');
  const R = (a, b) => a + (b - a) * rnd();
  const grid = new Map(); // key -> {ch, cls, pri, kind}
  const key = (c, r) => r * COLS + c;
  const put = (c, r, ch, cls, pri, kind) => {
    if (c < 0 || c >= COLS || r < 1 || r >= ROWS - 1) return;
    const k = key(c, r);
    const cur = grid.get(k);
    if (cur && cur.pri > pri) return;
    grid.set(k, { ch, cls, pri, kind, a: 0 });
  };

  // ── tlo ──
  const groundRow = [];
  for (let c = 0; c < COLS; c++) {
    const gr = Math.floor(groundY(c * CW + CW / 2) / CH);
    groundRow[c] = gr;
    put(c, gr, pick(GRASS, cellHash(c, gr, 1)), 'gd', 1, 'g');
    for (let r = gr + 1; r < ROWS - 1; r++) {
      if (cellHash(c, r, 2) < 0.22) put(c, r, pick(SOIL, cellHash(c, r, 3)), 'sl', 1, 's');
    }
  }

  // ── grane ──
  for (const b of geo.branches) {
    const len = Math.hypot(b.P1[0] - b.P0[0], b.P1[1] - b.P0[1]);
    const steps = Math.max(2, Math.ceil(len / 2.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const P = bez(b.P0, b.C, b.P1, t);
      const a = bezAng(b.P0, b.C, b.P1, t);
      const w = b.w0 + (b.w1 - b.w0) * t;
      const r = Math.floor(P[1] / CH);
      const ch = angleChar(a);
      const thick = w > CW * 1.3;
      if (!thick) {
        put(Math.floor(P[0] / CW), r, ch, 'br', 2, 'b');
      } else {
        const hw = w / 2 / Math.max(0.4, Math.abs(Math.cos(a)));
        for (let x = P[0] - hw; x <= P[0] + hw + 0.01; x += CW / 2) put(Math.floor(x / CW), r, ch, 'tr', 4, 'B');
      }
    }
  }
  // tekstura debla: unutarnje ćelije
  for (const [k, v] of grid) {
    if (v.kind !== 'B') continue;
    const c = k % COLS, r = Math.floor(k / COLS);
    const L = grid.get(key(c - 1, r)), Rr = grid.get(key(c + 1, r));
    if (L && L.kind === 'B' && Rr && Rr.kind === 'B') {
      v.ch = v.ch === '_' ? '=' : pick('|:|!|', cellHash(c, r, 4));
      v.cls = 'tk';
    }
  }
  // korijenje na tlu
  if (geo.total > 0 && geo.g > 0.25) {
    const r = groundRow[Math.floor(geo.BX / CW)];
    const half = Math.max(1, Math.round(geo.trunkW / CW / 2));
    const c0 = Math.floor(geo.BX / CW);
    put(c0 - half - 1, r, '/', 'tr', 5, 'B');
    put(c0 + half + 1, r, '\\', 'tr', 5, 'B');
    if (geo.g > 0.55) { put(c0 - half - 2, r, '_', 'tr', 5, 'B'); put(c0 + half + 2, r, '_', 'tr', 5, 'B'); }
  }

  // ── lišće ──
  const leafCells = [];
  for (const lf of geo.leaves) {
    let c = Math.floor(lf.x / CW), r = Math.floor(lf.y / CH);
    const spots = [[c, r]];
    const h = cellHash(c, r, 5);
    if (h < 0.6) spots.push([c + (h < 0.3 ? -1 : 1), r]);
    if (h > 0.82) spots.push([c, r - 1]);
    for (const [cc, rr] of spots) {
      if (rr >= groundRow[clamp(cc, 0, COLS - 1)] ) continue;
      const v = cellHash(cc, rr, 6);
      const cls = lf.withered ? 'w' + Math.floor(v * 4) : 'l' + Math.floor(cellHash(cc, rr, 7) * 4);
      put(cc, rr, pick(LEAF_GLYPHS, v), cls, 3, 'l');
      leafCells.push([cc, rr]);
    }
  }
  // sjemenka
  if (geo.total <= 0) {
    const c = Math.floor(geo.BX / CW);
    put(c, groundRow[c], 'o', 'l0', 9, 'l');
  }

  // ── treperenje: neke ćelije lišća mijenjaju znak ──
  const flick = new Map();
  for (let i = 0; i < Math.min(46, leafCells.length / 6); i++) {
    const [c, r] = leafCells[Math.floor(rnd() * leafCells.length)];
    const cell = grid.get(key(c, r));
    if (!cell || cell.kind !== 'l' || flick.has(key(c, r))) continue;
    flick.set(key(c, r), { alt: pick(GLYPHS, rnd()), dur: R(1.2, 4) });
  }

  // ── redovi ──
  const pal = SEASON_LEAVES[geo.season] || SEASON_LEAVES.summer;
  let topRow = ROWS;
  for (const [k, v] of grid) if (v.kind !== 'g' && v.kind !== 's') topRow = Math.min(topRow, Math.floor(k / COLS));
  const baseRow = Math.floor((geo.BY || 400) / CH);
  const windAmp = 4 + (1 - (geo.scaleAll || 1)) * 4;

  let rows = '';
  for (let r = 0; r < ROWS; r++) {
    const cells = [];
    for (let c = 0; c < COLS; c++) {
      const v = grid.get(key(c, r));
      if (v && v.ch !== ' ') cells.push([c, v]);
    }
    if (!cells.length) continue;
    let txt = '';
    let run = null;
    const flush = () => {
      if (!run) return;
      txt += `<tspan class="${run.cls}" x="${run.xs.join(' ')}">${esc(run.chars)}</tspan>`;
      run = null;
    };
    for (const [c, v] of cells) {
      const x = c * CW + CW / 2;
      const fk = flick.get(key(c, r));
      if (fk) {
        flush();
        const d = f1(fk.dur);
        txt += `<tspan class="${v.cls} fk" x="${x}" style="animation-duration:${d}s">${esc(v.ch)}</tspan><tspan class="${v.cls} fk" x="${x}" style="animation-duration:${d}s;animation-delay:-${f1(fk.dur / 2)}s">${esc(fk.alt)}</tspan>`;
        continue;
      }
      if (!run || run.cls !== v.cls) { flush(); run = { cls: v.cls, xs: [], chars: '' }; }
      run.xs.push(x);
      run.chars += v.ch;
    }
    flush();
    const y = r * CH + CH - 3;
    const el = `<text y="${y}">${txt}</text>`;
    // vjetar: što je red više, to se više njiše (smicanje)
    const h = clamp((baseRow - r) / Math.max(1, baseRow - topRow));
    const amp = Math.pow(h, 1.6) * windAmp;
    if (amp > 0.4) {
      const g = [0, 0.7, 0.2, 1, -0.15, 0.8, 0.3, 0].map((k) => f1(k * amp) + ' 0').join(';');
      rows += `<g><animateTransform attributeName="transform" type="translate" dur="8s" begin="-${f1(8 - h * 0.8)}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.14;.29;.43;.57;.71;.86;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1" values="${g}"/>${el}</g>`;
    } else rows += el;
  }

  // ── matrix kiša u pozadini ──
  let rain = '';
  const usedCols = new Set();
  const nRain = 38;
  for (let i = 0; i < nRain; i++) {
    let c = Math.floor(rnd() * COLS);
    if (usedCols.has(c)) c = Math.floor(rnd() * COLS);
    usedCols.add(c);
    const n = Math.floor(R(6, 19));
    const x = c * CW + CW / 2;
    let chars = '';
    const xs = [], ys = [];
    for (let j = 0; j < n; j++) { chars += pick(GLYPHS, rnd()); xs.push(x); ys.push(j * CH); }
    const head = chars.slice(-1);
    const body = [...chars].slice(0, -1).join('');
    rain += `<g class="rn" style="animation-duration:${f1(R(5, 13))}s;animation-delay:-${f1(R(0, 13))}s"><text x="${xs.join(' ')}" y="${ys.join(' ')}" fill="url(#rg)">${esc(body)}<tspan class="hd">${esc(head)}</tspan></text></g>`;
  }

  // ── padajući znakovi (lišće) i snijeg ──
  let fall = '';
  const nFall = geo.total > 0 ? Math.round(1 + (1 - geo.health) * 5 + (geo.season === 'autumn' ? 6 : 0)) : 0;
  for (let i = 0; i < nFall && leafCells.length; i++) {
    const [c, r] = leafCells[Math.floor(rnd() * leafCells.length)];
    const x = c * CW + CW / 2, y = r * CH + CH - 3;
    const dy = groundRow[c] * CH - y;
    const dx = R(30, 110);
    const dur = R(10, 18);
    const t = `dur="${f1(dur)}s" begin="-${f1(R(0, dur))}s" repeatCount="indefinite"`;
    fall += `<g opacity="0"><animateMotion path="M${x} ${y}c${f1(dx * 0.2)} ${f1(dy * 0.3)} ${f1(dx * 0.6)} ${f1(dy * 0.3)} ${f1(dx)} ${f1(dy)}" ${t} keyPoints="0;1;1" keyTimes="0;.55;1" calcMode="linear"/><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.03;.5;.56;1" ${t}/><text class="w${i % 4}" text-anchor="middle">${esc(pick(LEAF_GLYPHS, rnd()))}</text></g>`;
  }
  if (geo.season === 'winter') {
    for (let i = 0; i < 45; i++) {
      fall += `<text class="sn" x="${f1(R(-40, W))}" y="-6" style="animation-duration:${f1(R(9, 17))}s;animation-delay:-${f1(R(0, 17))}s">${rnd() < 0.5 ? '*' : '.'}</text>`;
    }
  }

  // ── nebo: sunce, oblaci i ptice (dan) / mjesec, zvijezde i krijesnice (noć) ──
  const art = (lines, col, row, cls, extra = '') => {
    let t = '';
    lines.forEach((line, i) => {
      const xs = [], chars = [];
      [...line].forEach((ch, j) => { if (ch !== ' ') { xs.push((col + j) * CW + CW / 2); chars.push(ch); } });
      if (chars.length) t += `<tspan x="${xs.join(' ')}" y="${(row + i) * CH + CH - 3}">${esc(chars.join(''))}</tspan>`;
    });
    return `<text class="${cls}"${extra}>${t}</text>`;
  };
  const skyCol = COLS - 22;
  let day = '<g class="dy">';
  day += art(SUN, skyCol, 3, 'su');
  day += art(SUN_RAYS_A, skyCol, 2, 'su ry');
  day += art(SUN_RAYS_B, skyCol, 2, 'su ry', ' style="animation-delay:-1.2s"');
  for (let i = 0; i < 3; i++) {
    const row = Math.floor(R(3, 10));
    const col = Math.floor(R(0, COLS - 20)) - Math.floor(COLS / 2);
    day += `<g class="cl" style="animation-duration:${Math.round(R(90, 150))}s;animation-delay:-${Math.round(R(0, 150))}s">${art(CLOUD, col, row, 'cd')}</g>`;
  }
  // ptice: "v" koje mašu krilima ("v" <-> "-")
  for (let i = 0; i < 3; i++) {
    const y = R(40, 140), dur = R(28, 45);
    day += `<g><animateMotion path="M-30 ${f1(y)}q${W / 4} -18 ${W / 2} 0t${W / 2 + 60} 0" dur="${f1(dur)}s" begin="-${f1(R(0, dur))}s" repeatCount="indefinite"/><text class="bd"><tspan class="fp" x="0">v</tspan><tspan class="fp" x="0" style="animation-delay:-.25s">-</tspan></text></g>`;
  }
  day += '</g>';

  let night = '<g class="nt">';
  night += art(MOON, skyCol + 3, 2, 'mn');
  for (let i = 0; i < 55; i++) {
    const c = Math.floor(R(1, COLS - 1)), r = Math.floor(R(2, 18));
    night += `<text class="st" x="${c * CW + CW / 2}" y="${r * CH + CH - 3}" style="animation-duration:${f1(R(1.5, 5))}s;animation-delay:-${f1(R(0, 5))}s">${pick(".'.*+.", rnd())}</text>`;
  }
  const nff = geo.total > 0 ? Math.round(2 + geo.active30 / 2.5) : 0;
  for (let i = 0; i < nff; i++) {
    const x = R(geo.BX - 280, geo.BX + 280);
    const gr = groundRow[Math.floor(clamp(x / CW, 0, COLS - 1))] || 30;
    const y = R(150, gr * CH - 10);
    const rx = R(15, 45), ry = R(10, 30);
    night += `<g><animateMotion path="M${f1(x)} ${f1(y)}c${f1(rx)} -${f1(ry)} ${f1(rx * 2)} ${f1(ry)} 0 ${f1(ry * 1.4)}s-${f1(rx * 1.6)} -${f1(ry * 2)} 0 -${f1(ry * 1.4)}z" dur="${f1(R(9, 16))}s" begin="-${f1(R(0, 9))}s" repeatCount="indefinite"/><text class="ff" style="animation-duration:${f1(R(2, 4.5))}s;animation-delay:-${f1(R(0, 4))}s">*</text></g>`;
  }
  night += '</g>';

  // ── natpisi ──
  const nf = new Intl.NumberFormat(lang === 'hr' ? 'hr-HR' : 'en-US');
  const stage = T.stages[stageIndex(geo.total)];
  const health = Math.round(geo.health * 100);
  const head = `${geo.login}@github:~$ ./zivo-stablo --grow`;
  let status = `[ ${stage.toUpperCase()} ] ${nf.format(geo.total)} ${T.contrib} | ${geo.active30} ${T.active} | ${lang === 'hr' ? 'zdravlje' : 'health'} ${health}%`;
  if (geo.streak >= 3) status += ` | ${T.streak(geo.streak)}`;
  if (geo.total <= 0) status += ` | ${T.seed.replace('…', '...')}`;

  // ── stilovi: dan (svijetli terminal) i noć (crni Matrix) ──
  const theme = o.theme || 'auto';
  const dayPal = DAY_LEAVES[geo.season] || DAY_LEAVES.summer;
  const leafCss = (p, w) => p.map((c, i) => `.l${i}{fill:${c}}`).join('') + w.map((c, i) => `.w${i}{fill:${c}}`).join('');
  const base = `
text{font-family:ui-monospace,'Cascadia Mono',Consolas,'DejaVu Sans Mono','Courier New',monospace;font-size:12px;text-anchor:middle}
.l0,.l1,.l2,.l3,.su,.mn,.ff{font-weight:700}
.rn{animation:rn linear infinite}
.fk{animation:fk 2s steps(1) infinite}
.sn{animation:sn 12s linear infinite}
.hx{text-anchor:start;font-weight:700}.hx2{text-anchor:start}
.cur{animation:bl 1.1s steps(1) infinite}
.ry{animation:fk 2.4s steps(1) infinite}
.cl{animation:dr 120s linear infinite}
.fp{animation:fk .5s steps(1) infinite}
.st,.ff{animation:tw 3s ease-in-out infinite alternate}
@keyframes rn{from{transform:translateY(-260px)}to{transform:translateY(${H + 20}px)}}
@keyframes fk{0%{fill-opacity:1}50%{fill-opacity:0}}
@keyframes sn{from{transform:translate(0,0)}to{transform:translate(40px,${H + 20}px)}}
@keyframes bl{0%{opacity:1}50%{opacity:0}}
@keyframes dr{from{transform:translateX(-160px)}to{transform:translateX(${W + 300}px)}}
@keyframes tw{from{opacity:.15}to{opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
  const light = `
.bg{fill:#eef5e6}.bar{fill:#e3eed9;opacity:.9}
.br{fill:#2e7a3a}.tr{fill:#4a5e2a}.tk{fill:#3a4a20}.gd{fill:#3f8f3f}.sl{fill:#9cb88c}
${leafCss(dayPal, DAY_WITHERED)}
.hd{fill:#0b6a26}.rn{opacity:.28}.rg0,.rg1{stop-color:#2f9a4a}.rg2{stop-color:#17702f}
.sn{fill:#6aa6c8}.hx,.cur{fill:#1b6b2b}.hx2{fill:#3d6b45}
.su{fill:#e0a400}.cd{fill:#9fb7c4}.bd{fill:#4a5a52}
.gld,.vgd{opacity:1}.gln,.vgn{opacity:0}.scn{opacity:.25}
.nt{display:none}`;
  const dark = `
.bg{fill:#040a06}.bar{fill:#040a06;opacity:.85}
.br{fill:#3fbf5a}.tr{fill:#2f9e4a}.tk{fill:#1f7a37}.gd{fill:#1f8f3f}.sl{fill:#0f4d22}
${leafCss(pal, WITHERED)}
.hd{fill:#d9ffe0}.rn{opacity:.5}.rg0{stop-color:#00ff66}.rg1{stop-color:#00e65c}.rg2{stop-color:#7dffa0}
.sn{fill:#d8f6ff}.hx,.cur{fill:#39ff6a}.hx2{fill:#7dbf8a}
.mn{fill:#e8f5c8}.st{fill:#cfe8d5}.ff{fill:#e8ff6a}
.gld,.vgd{opacity:0}.gln,.vgn,.scn{opacity:1}
.dy{display:none}.nt{display:inline}`;
  let style = base + light;
  if (theme === 'dark') style += dark;
  else if (theme === 'auto') style += `@media (prefers-color-scheme:dark){${dark}}`;
  style = style.replace(/\n/g, '');

  const statusX = 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="tt">` +
    `<title id="tt">${esc(T.title(geo.login))} – ${esc(stage)}</title>` +
    `<style>${style}</style>` +
    `<defs>` +
    `<linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rg0" stop-opacity="0"/><stop offset=".75" class="rg1" stop-opacity=".55"/><stop offset="1" class="rg2" stop-opacity=".9"/></linearGradient>` +
    `<radialGradient id="vg" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></radialGradient>` +
    `<radialGradient id="vgd" cx=".5" cy=".45" r=".8"><stop offset=".6" stop-color="#5a7a50" stop-opacity="0"/><stop offset="1" stop-color="#5a7a50" stop-opacity=".22"/></radialGradient>` +
    `<radialGradient id="gl" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#1aff5a" stop-opacity=".09"/><stop offset="1" stop-color="#1aff5a" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="gs"><stop offset="0" stop-color="#ffd84a" stop-opacity=".5"/><stop offset="1" stop-color="#ffd84a" stop-opacity="0"/></radialGradient>` +
    `<pattern id="sc" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity=".35"/></pattern>` +
    `<clipPath id="cp"><rect width="${W}" height="${H}" rx="16"/></clipPath>` +
    `</defs>` +
    `<g clip-path="url(#cp)">` +
    `<rect class="bg" width="${W}" height="${H}"/>` +
    `<ellipse class="gln" cx="${f1(geo.BX)}" cy="${H * 0.5}" rx="${W * 0.45}" ry="${H * 0.55}" fill="url(#gl)"/>` +
    `<circle class="gld" cx="${(skyCol + 8.5) * CW}" cy="${4 * CH + 4}" r="110" fill="url(#gs)"/>` +
    `<g>${rain}</g>` +
    day + night +
    `<g>${rows}</g>` +
    fall +
    `<rect class="bar" width="${W}" height="${CH + 8}"/>` +
    `<text class="hx" x="${statusX}" y="15">${esc(head)}</text>` +
    `<rect class="bar" width="${W}" height="${CH + 9}" y="${H - CH - 9}"/>` +
    `<text class="hx2" x="${statusX}" y="${H - 7}">${esc(status)}<tspan class="cur"> _</tspan></text>` +
    `<rect class="scn" width="${W}" height="${H}" fill="url(#sc)"/>` +
    `<rect class="vgn" width="${W}" height="${H}" fill="url(#vg)"/>` +
    `<rect class="vgd" width="${W}" height="${H}" fill="url(#vgd)"/>` +
    `</g></svg>`;
}
