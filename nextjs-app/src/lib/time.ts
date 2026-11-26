/** Offset (ms) of `tz` from UTC at instant `d`. */
function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Midnight (local to `tz`) of the day containing `d`, as a UTC Date. */
export function startOfDayInTz(d: Date, tz: string): Date {
  const off = tzOffsetMs(d, tz);
  const local = new Date(d.getTime() + off);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocalAsUtc - tzOffsetMs(new Date(midnightLocalAsUtc - off), tz));
}

/** ISO string used as date_bin origin so daily candles align to local midnight. */
export function dayOriginIso(tz: string): string {
  return startOfDayInTz(new Date("2000-01-03T12:00:00Z"), tz).toISOString();
}

export function localDateString(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
