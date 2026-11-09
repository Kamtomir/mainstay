/** The sanctioned way: a named flag the operator can switch per customer, no deploy. */
const EDITION = process.env.EDITION ?? "standard";

export function isEnterprise(): boolean {
  return EDITION === "enterprise";
}

export function isFeatureOn(key: string): boolean {
  return FLAGS[key]?.(EDITION) ?? false;
}

const FLAGS: Record<string, (edition: string) => boolean> = {
  new_billing: (edition) => edition === "enterprise",
};
