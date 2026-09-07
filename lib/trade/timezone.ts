/**
 * Converts a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm",
 * no offset) into a proper ISO timestamp, given the IANA zone name the
 * offer was created in. Pilot limitation (documented in
 * docs/trade-portal.md): only Asia/Tehran is supported with a real,
 * correct fixed offset — Iran permanently abolished DST in 2022, so
 * +03:30 is safe year-round with no library needed. Any other zone name
 * falls back to UTC (+00:00) rather than silently guessing wrong; a
 * future multi-timezone pilot would need a real IANA offset library
 * (date-fns-tz / luxon), deliberately not added for this scope.
 */
const KNOWN_OFFSETS: Record<string, string> = {
  "Asia/Tehran": "+03:30",
};

export function localDateTimeToIso(localValue: string, timezone: string): string {
  const offset = KNOWN_OFFSETS[timezone] ?? "+00:00";
  return `${localValue}:00${offset}`;
}
