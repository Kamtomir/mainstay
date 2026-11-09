import { isEnterprise } from "../flags/registry";

export function Settings() {
  // New this week: the new billing page, for enterprise only "for now".
  return { billingPage: isEnterprise() ? "new" : "old" };
}
