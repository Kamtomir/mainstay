/** Wraps #tags in <mark>. */
const TAG = /(?<=^|\s)#(\w+)/g;

export function highlightTags(text: string): string {
  return text.replace(TAG, "<mark>#$1</mark>");
}
