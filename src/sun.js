// ─────────────────────────────────────────────────────────────────────────────
//  Izlazak i zalazak sunca (NOAA aproksimacija, točnost ~1-2 min).
//  Radi i u Node-u i u browseru, bez ovisnosti.
// ─────────────────────────────────────────────────────────────────────────────

/** Zadana lokacija: Zagreb. */
export const DEFAULT_LAT = 45.815;
export const DEFAULT_LON = 15.982;

const RAD = Math.PI / 180;

/**
 * Izlazak i zalazak sunca za UTC datum zadanog trenutka.
 * @returns {{ sunrise: Date|null, sunset: Date|null, polar: 'day'|'night'|null }}
 */
export function sunTimes(date = new Date(), lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const day0 = Date.UTC(y, date.getUTCMonth(), date.getUTCDate());
  const n = Math.round((day0 - start) / 864e5) + 1; // dan u godini, 1..366
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const g = (2 * Math.PI / (leap ? 366 : 365)) * (n - 1); // podne

  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };
  const ha = Math.acos(cosH) / RAD;

  const riseMin = 720 - 4 * (lon + ha) - eqtime;
  const setMin = 720 - 4 * (lon - ha) - eqtime;
  return {
    sunrise: new Date(day0 + riseMin * 6e4),
    sunset: new Date(day0 + setMin * 6e4),
    polar: null,
  };
}

/** Je li sunce iznad horizonta na zadanoj lokaciji u zadanom trenutku? */
export function isDaytime(date = new Date(), lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  const t = sunTimes(date, lat, lon);
  if (t.polar) return t.polar === 'day';
  return date >= t.sunrise && date < t.sunset;
}

/** 'light' danju, 'dark' noću. */
export function themeByTime(date = new Date(), lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  return isDaytime(date, lat, lon) ? 'light' : 'dark';
}
