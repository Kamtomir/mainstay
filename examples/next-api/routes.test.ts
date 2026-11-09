/**
 * The same claim, checked at runtime: an anonymous request gets 401 from every
 * route. The guard covers routes nobody has written yet; this test shows the
 * hole it found is real (the export route hands out customer emails).
 */
import { describe, expect, it } from "vitest";
import { expectRed, plantedViolations } from "../../guards/expect-red";
import { GET as exportOrders } from "./app/api/orders/export/route";
import { GET as listOrders } from "./app/api/orders/route";

const ROUTES: Record<string, (request: Request) => Promise<Response>> = {
  "app/api/orders/route.ts": listOrders,
  "app/api/orders/export/route.ts": exportOrders,
};

const anonymous = () => new Request("https://app.example.test/api/orders/export?workspace=w1");

expectRed(["app/api/orders/export/route.ts"], () => {
  const planted = plantedViolations();
  describe("an anonymous request gets 401 from every route", () => {
    for (const [file, handler] of Object.entries(ROUTES)) {
      const leaks = planted?.includes(file) ?? false;
      it(leaks ? `${file} (expected red: demo)` : file, async () => {
        const response = await handler(anonymous());
        if (leaks) {
          expect(response.status, "the demo route was supposed to answer without a session").toBe(200);
          expect(await response.text()).toContain("@example.com");
          return;
        }
        expect(response.status, "an anonymous request must be rejected with 401").toBe(401);
      });
    }
  });
});

describe("a signed-in user gets their own workspace", () => {
  it("lists only workspace w1 orders for a w1 user", async () => {
    const response = await listOrders(
      new Request("https://app.example.test/api/orders", { headers: { authorization: "Bearer demo-u1-w1" } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { orders: { id: string }[] };
    expect(body.orders.map((o) => o.id)).toEqual(["o1", "o2"]);
  });
});
