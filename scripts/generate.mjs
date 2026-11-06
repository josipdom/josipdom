// ─────────────────────────────────────────────────────────────────────────────
//  Generira dist/tree.svg (+ light/dark varijante) iz stvarnih GitHub podataka.
//
//  Primjeri:
//    node scripts/generate.mjs --demo                    (izmišljeni podaci, bez interneta)
//    node scripts/generate.mjs --user TVOJ_USERNAME      (treba GITHUB_TOKEN ili `gh` CLI)
//    node scripts/generate.mjs --user x --lang en --season auto
//
//  U GitHub Actionu se username i token uzimaju automatski iz okoline.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTree, computeStats, stageName, healthOf } from '../src/tree.js';
import { renderAscii } from '../src/ascii.js';
import { sunTimes, themeByTime, DEFAULT_LAT, DEFAULT_LON } from '../src/sun.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const outDir = join(ROOT, args.out || 'dist');
const lang = args.lang || process.env.TREE_LANG || 'hr';
const season = args.season || process.env.TREE_SEASON || 'auto';
const hemisphere = args.hemisphere || process.env.TREE_HEMISPHERE || 'north';
// dan/noć: 'time' = po stvarnom izlasku/zalasku sunca na lokaciji, 'theme' = po temi posjetitelja
const daynight = args.daynight || process.env.TREE_DAYNIGHT || 'time';
const lat = Number(args.lat || process.env.TREE_LAT || DEFAULT_LAT);
const lon = Number(args.lon || process.env.TREE_LON || DEFAULT_LON);

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try { return execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
}

async function gql(token, query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'zivo-stablo' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (j.errors) throw new Error('GitHub API: ' + j.errors.map((e) => e.message).join('; '));
  return j.data;
}

async function fetchGithub(login, token) {
  // 1) kalendar zadnjih godinu dana + popis godina u kojima je bilo doprinosa
  const q1 = `query($login:String!){user(login:$login){contributionsCollection{contributionYears contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;
  const d1 = await gql(token, q1, { login });
  if (!d1.user) throw new Error(`Korisnik "${login}" ne postoji.`);
  const cc = d1.user.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, count: d.contributionCount }));

  // 2) ukupno po godinama (API daje najviše godinu dana po upitu, pa koristimo aliase)
  const now = new Date();
  const years = cc.contributionYears;
  const parts = years.map((y) => {
    const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
    return `y${y}:contributionsCollection(from:"${y}-01-01T00:00:00Z",to:"${to}"){contributionCalendar{totalContributions}}`;
  });
  let total = 0;
  if (parts.length) {
    const d2 = await gql(token, `query($login:String!){user(login:$login){${parts.join(' ')}}}`, { login });
    for (const y of years) total += d2.user[`y${y}`].contributionCalendar.totalContributions;
  }
  return { total, days };
}

function demoData() {
  // izmišljen, ali uvjerljiv kalendar: ~4 commita tjedno, s pauzama
  const days = [];
  const now = new Date();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 365; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 864e5);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const pause = i > 120 && i < 150;
    const count = !pause && rnd() < (weekend ? 0.3 : 0.6) ? 1 + Math.floor(rnd() * 6) : 0;
    days.push({ date: d.toISOString().slice(0, 10), count });
  }
  const lastYear = days.reduce((s, d) => s + d.count, 0);
  return { total: Number(args.total) || lastYear + 640, days };
}

const hm = (d) => d ? d.toLocaleTimeString('hr-HR', { timeZone: process.env.TREE_TZ || 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' }) : '-';

async function main() {
  const login = args.user || process.env.GH_USER || process.env.GITHUB_REPOSITORY_OWNER || 'demo';
  let data;
  if (args.demo) {
    data = demoData();
    console.log('ℹ️  Demo način – izmišljeni podaci.');
  } else {
    const token = getToken();
    if (!token) {
      console.error('✖ Nema GitHub tokena. Postavi GITHUB_TOKEN, prijavi se s `gh auth login`, ili pokreni s --demo.');
      process.exit(1);
    }
    console.log(`⏳ Dohvaćam doprinose za @${login}…`);
    data = await fetchGithub(login, token);
  }

  const now = args.at ? new Date(args.at) : new Date();
  const stats = computeStats(data.days, now);
  // glavne datoteke (tree.svg, tree-ascii.svg): po satu ili po temi posjetitelja
  const mainTheme = daynight === 'time' ? themeByTime(now, lat, lon) : 'auto';
  const base = { login, total: data.total, ...stats, lang, season, hemisphere };

  await mkdir(outDir, { recursive: true });
  const files = { 'tree.svg': mainTheme, 'tree-light.svg': 'light', 'tree-dark.svg': 'dark' };
  for (const [name, theme] of Object.entries(files)) {
    await writeFile(join(outDir, name), renderTree({ ...base, theme }));
  }
  for (const theme of ['auto', 'light', 'dark']) {
    await writeFile(join(outDir, theme === 'auto' ? 'tree-ascii.svg' : `tree-ascii-${theme}.svg`), renderAscii({ ...base, theme: theme === 'auto' ? mainTheme : theme }));
  }
  const sun = sunTimes(now, lat, lon);
  const info = {
    login,
    total: data.total,
    ...stats,
    health: Math.round(healthOf(stats.active30, stats.sinceLast) * 100) / 100,
    stage: stageName(data.total, lang),
    generatedAt: now.toISOString(),
    daynight: daynight === 'time' ? (mainTheme === 'light' ? 'day' : 'night') : 'theme',
    sunrise: sun.sunrise?.toISOString() ?? null,
    sunset: sun.sunset?.toISOString() ?? null,
  };
  await writeFile(join(outDir, 'stats.json'), JSON.stringify(info, null, 2));
  console.log(`🌳 @${login}: ${info.total} doprinosa · ${info.stage} · ${stats.active30} aktivnih dana / 30 · zdravlje ${Math.round(info.health * 100)}%`);
  if (daynight === 'time') console.log(`${mainTheme === 'light' ? '☀️  dan' : '🌙 noć'} (izlazak ${hm(sun.sunrise)}, zalazak ${hm(sun.sunset)} po lokalnom vremenu)`);
  console.log(`✔ Spremljeno u ${outDir}`);
}

main().catch((e) => { console.error('✖', e.message); process.exit(1); });
