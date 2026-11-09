import { isFeatureOn } from "../flags/registry";

export function digestSections(): string[] {
  // Moved to the registry last week.
  return isFeatureOn("new_billing") ? ["usage", "invoices"] : ["usage"];
}
