/** A four-digit year that is not part of a longer number. */
const YEAR = /(^|\D)((?:19|20)\d{2})(?!\d)/;

export function parseYear(text: string): number | null {
  const m = YEAR.exec(text);
  return m ? Number(m[2]) : null;
}
