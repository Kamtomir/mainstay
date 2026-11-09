/** Wraps #tags in <mark>. The character before the tag is a group, returned in the replacement. */
const TAG = /(^|\s)#(\w+)/g;

export function highlightTags(text: string): string {
  return text.replace(TAG, "$1<mark>#$2</mark>");
}
