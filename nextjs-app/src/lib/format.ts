const nf = (min: number, max: number) =>
  new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: min, maximumFractionDigits: max });

const n2 = nf(2, 2);
const n0 = nf(0, 0);
const n1 = nf(1, 1);

export const fmt = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : digits === 2 ? n2.format(v) : digits === 0 ? n0.format(v) : digits === 1 ? n1.format(v) : nf(digits, digits).format(v);

export const fmtPct = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${nf(digits, digits).format(v)}%`;

export const fmtSigned = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${nf(digits, digits).format(v)}`;

export function fmtTime(iso: string | Date, tz = "Asia/Riyadh") {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtDateTime(iso: string | Date, tz = "Asia/Riyadh") {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
