export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
