// Server only: never imported by a client module, so its lookbehind is fine.
const AMOUNT = /(?<=\$)\d+(?:\.\d{2})?/g;

export function amounts(text: string): string[] {
  return text.match(AMOUNT) ?? [];
}
