import { isEnterprise } from "../flags/registry";

export function Home() {
  const banner = isEnterprise() ? "Your account manager" : "Upgrade";
  const showSso = isEnterprise();
  return { banner, showSso };
}
