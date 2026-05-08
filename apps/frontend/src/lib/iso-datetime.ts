/**
 * iso-datetime.ts — helpers for datetime-local <-> ISO-8601 conversion.
 *
 * toIso8601: converts "<input type='datetime-local'>" value (YYYY-MM-DDTHH:mm)
 *            to ISO-8601 with seconds + Z suffix (YYYY-MM-DDTHH:mm:00.000Z).
 *
 * fromIso8601: inverse — slices ISO string to YYYY-MM-DDTHH:mm for datetime-local inputs.
 */

export function toIso8601(dateTimeLocal: string): string {
  if (dateTimeLocal === "") return "";
  return `${dateTimeLocal}:00.000Z`;
}

export function fromIso8601(iso: string): string {
  if (iso === "") return "";
  // Take first 16 chars: "YYYY-MM-DDTHH:mm"
  return iso.slice(0, 16);
}
