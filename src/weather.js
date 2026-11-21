// ─────────────────────────────────────────────────────────────────────────────
//  Current weather from Open-Meteo (free, no API key) and how to draw it.
//  Works in Node and in the browser.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PLACE = { name: 'Zagreb', lat: 45.815, lon: 15.982, tz: 'Europe/Zagreb' };

// WMO weather code -> [kind, intensity 1..3, English description]
const CODES = {
  0: ['clear', 1, 'clear sky'],
  1: ['clear', 1, 'mainly clear'],
  2: ['partly', 1, 'partly cloudy'],
  3: ['cloudy', 1, 'overcast'],
  45: ['fog', 1, 'fog'],
  48: ['fog', 2, 'freezing fog'],
  51: ['drizzle', 1, 'light drizzle'],
  53: ['drizzle', 2, 'drizzle'],
  55: ['drizzle', 3, 'heavy drizzle'],
  56: ['drizzle', 1, 'freezing drizzle'],
  57: ['drizzle', 2, 'freezing drizzle'],
  61: ['rain', 1, 'light rain'],
  63: ['rain', 2, 'rain'],
  65: ['rain', 3, 'heavy rain'],
  66: ['rain', 1, 'freezing rain'],
  67: ['rain', 3, 'freezing rain'],
  71: ['snow', 1, 'light snow'],
  73: ['snow', 2, 'snow'],
  75: ['snow', 3, 'heavy snow'],
  77: ['snow', 1, 'snow grains'],
  80: ['rain', 1, 'light showers'],
  81: ['rain', 2, 'showers'],
  82: ['rain', 3, 'violent showers'],
  85: ['snow', 2, 'snow showers'],
  86: ['snow', 3, 'heavy snow showers'],
  95: ['storm', 2, 'thunderstorm'],
  96: ['storm', 3, 'thunderstorm with hail'],
  99: ['storm', 3, 'thunderstorm with hail'],
};

/** Ready-made weather for the preview and for testing. */
export const PRESETS = {
  clear: 0, partly: 2, cloudy: 3, fog: 45, drizzle: 53, rain: 63, heavy: 65, snow: 73, storm: 95,
};

/**
 * Normalised weather used by the renderers.
 * @returns {{code:number, kind:string, intensity:number, desc:string, temp:number|null, wind:number, cloud:number|null, ok:boolean}}
 */
export function weatherFrom(code = 0, extra = {}) {
  const [kind, intensity, desc] = CODES[code] || CODES[0];
  return {
    code,
    kind,
    intensity,
    desc,
    temp: extra.temp ?? null,
    wind: extra.wind ?? (kind === 'storm' ? 35 : 8),
    cloud: extra.cloud ?? null,
    ok: extra.ok ?? true,
  };
}

/** Fill in defaults for a weather object (or null = calm clear sky). */
export function normWeather(w) {
  if (!w) return weatherFrom(0, { wind: 6 });
  return { ...weatherFrom(w.code ?? 0), ...w };
}

export const isWet = (w) => w.kind === 'drizzle' || w.kind === 'rain' || w.kind === 'storm';
export const isGloomy = (w) => w.kind !== 'clear' && w.kind !== 'partly';

/** Fetch the current weather. Never throws: on failure returns a calm sky with ok:false. */
export async function fetchWeather(place = DEFAULT_PLACE, fetchFn = globalThis.fetch) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${place.lat}&longitude=${place.lon}`
    + '&current=temperature_2m,weather_code,wind_speed_10m,cloud_cover'
    + `&timezone=${encodeURIComponent(place.tz || 'UTC')}`;
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'living-tree' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = (await res.json()).current;
    return weatherFrom(c.weather_code, {
      temp: Math.round(c.temperature_2m),
      wind: Math.round(c.wind_speed_10m),
      cloud: c.cloud_cover,
      ok: true,
    });
  } catch (e) {
    return { ...weatherFrom(0, { wind: 6, ok: false }), error: e.message };
  }
}

/** One-line summary, e.g. "7°C, light rain, wind 12 km/h". */
export function weatherLine(w) {
  const parts = [];
  if (w.temp != null) parts.push(`${w.temp}°C`);
  parts.push(w.ok === false ? 'weather offline' : w.desc);
  parts.push(`wind ${Math.round(w.wind)} km/h`);
  return parts.join(', ');
}
