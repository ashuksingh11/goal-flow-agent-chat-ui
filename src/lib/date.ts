/**
 * Date display helpers (v4.2).
 *
 * The sim clock runs on REAL calendar dates, so surfaces show a real date
 * ("Tue, Jul 22") instead of an opaque "Day N" ordinal. Parsing is done
 * component-by-component to avoid the UTC shift `new Date("2026-07-22")` applies.
 */

/** Parse an ISO date (YYYY-MM-DD or a full timestamp) into a local Date. Null when unparseable. */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** "Tue, Jul 22" — the label shown in place of "Day N". Null when the input can't be parsed. */
export function formatWhen(iso: string | null | undefined): string | null {
  const d = parseIsoDate(iso);
  return d
    ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(d)
    : null;
}
