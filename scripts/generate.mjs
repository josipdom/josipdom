// ─────────────────────────────────────────────────────────────────────────────
//  Generates the tree SVGs: always a full-grown tree, dressed in the current
//  weather of the chosen place (Zagreb by default), by day or by night.
//
//  Examples:
//    node scripts/generate.mjs                      (live weather from Open-Meteo)
//    node scripts/generate.mjs --weather rain       (force a weather: clear, partly, cloudy,
//                                                    fog, drizzle, rain, heavy, snow, storm)
//    node scripts/generate.mjs --at 2026-11-21T19:00:00Z --weather snow
//
//  In a GitHub Action the username is taken from the environment.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTree, FULL_GROWN, seasonOf } from '../src/tree.js';
import { renderAscii } from '../src/ascii.js';
import { sunTimes, themeByTime, DEFAULT_LAT, DEFAULT_LON } from '../src/sun.js';
import { fetchWeather, weatherFrom, weatherLine, PRESETS } from '../src/weather.js';

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
const lang = args.lang || process.env.TREE_LANG || 'en';
const season = args.season || process.env.TREE_SEASON || 'auto';
const hemisphere = args.hemisphere || process.env.TREE_HEMISPHERE || 'north';
// day/night: 'time' = by actual sunrise/sunset at the location, 'theme' = by the visitor's theme
const daynight = args.daynight || process.env.TREE_DAYNIGHT || 'time';
const place = args.place || process.env.TREE_PLACE || 'Zagreb';
const lat = Number(args.lat || process.env.TREE_LAT || DEFAULT_LAT);
const lon = Number(args.lon || process.env.TREE_LON || DEFAULT_LON);
const tz = process.env.TREE_TZ || 'Europe/Zagreb';
const forced = args.weather || process.env.TREE_WEATHER;

const hm = (d) => (d ? d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '-');

async function main() {
  const login = args.user || process.env.GH_USER || process.env.GITHUB_REPOSITORY_OWNER || 'github';
  const now = args.at ? new Date(args.at) : new Date();

  let weather;
  if (forced) {
    if (!(forced in PRESETS)) throw new Error(`Unknown weather "${forced}". Use one of: ${Object.keys(PRESETS).join(', ')}`);
    weather = weatherFrom(PRESETS[forced], {
      temp: args.temp != null ? Number(args.temp) : null,
      wind: args.wind != null ? Number(args.wind) : undefined,
    });
  } else {
    console.log(`⏳ Fetching the weather for ${place}…`);
    weather = await fetchWeather({ name: place, lat, lon, tz });
    if (!weather.ok) console.warn(`⚠️  Weather unavailable (${weather.error}), drawing a calm sky.`);
  }

  const mainTheme = daynight === 'time' ? themeByTime(now, lat, lon) : 'auto';
  const base = {
    login,
    // always a full-grown, healthy tree
    total: FULL_GROWN, active30: 30, sinceLast: 0, streak: 0,
    lang, season, hemisphere, now, place, weather,
    updated: hm(now),
  };

  await mkdir(outDir, { recursive: true });
  const files = { 'tree.svg': mainTheme, 'tree-light.svg': 'light', 'tree-dark.svg': 'dark' };
  for (const [name, theme] of Object.entries(files)) {
    await writeFile(join(outDir, name), renderTree({ ...base, theme }));
  }
  for (const theme of ['auto', 'light', 'dark']) {
    const name = theme === 'auto' ? 'tree-ascii.svg' : `tree-ascii-${theme}.svg`;
    await writeFile(join(outDir, name), renderAscii({ ...base, theme: theme === 'auto' ? mainTheme : theme }));
  }

  const sun = sunTimes(now, lat, lon);
  const info = {
    login,
    place,
    weather,
    season: season === 'auto' ? seasonOf(now, hemisphere) : season,
    daynight: daynight === 'time' ? (mainTheme === 'light' ? 'day' : 'night') : 'theme',
    sunrise: sun.sunrise?.toISOString() ?? null,
    sunset: sun.sunset?.toISOString() ?? null,
    generatedAt: now.toISOString(),
  };
  await writeFile(join(outDir, 'stats.json'), JSON.stringify(info, null, 2));
  console.log(`🌳 @${login} · ${place}: ${weatherLine(weather)} · ${info.season}`);
  if (daynight === 'time') console.log(`${mainTheme === 'light' ? '☀️  day' : '🌙 night'} (sunrise ${hm(sun.sunrise)}, sunset ${hm(sun.sunset)} local time)`);
  console.log(`✔ Saved to ${outDir}`);
}

main().catch((e) => { console.error('✖', e.message); process.exit(1); });
