import { isEnterprise } from "../flags/registry";

export function invoiceTerms(): string {
  // Isolation, not a feature: enterprise customers are invoiced, everyone else pays by card.
  return isEnterprise() ? "net-30" : "card";
}
