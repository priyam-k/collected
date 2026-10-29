export const nowIso = (): string => new Date().toISOString();

export function isoOrNull(v: string | Date | null | undefined): string | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** YYYY-MM-DD in the server's local timezone (TZ env). */
export function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function hoursBetween(a: string | Date, b: string | Date): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 36e5;
}
