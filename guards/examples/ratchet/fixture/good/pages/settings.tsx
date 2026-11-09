import { isFeatureOn } from "../flags/registry";

export function Settings() {
  return { billingPage: isFeatureOn("new_billing") ? "new" : "old" };
}
