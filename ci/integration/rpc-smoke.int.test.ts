/**
 * RPC smoke tests: call every function the app calls, once, for real.
 *
 * A plpgsql body is checked lazily: a misspelled column inside it compiles at
 * CREATE time and fails on the first call. Mocks never make that call. In the
 * reference deployment this layer caught a family of money functions that
 * failed on every single call.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./db";

const db = pool();
afterAll(() => db.end());

async function account(): Promise<string> {
  const { rows } = await db.query<{ id: string }>("insert into accounts (name) values ('smoke') returning id");
  return rows[0].id;
}

describe("place_order", () => {
  it("writes one order and returns its id", async () => {
    const acc = await account();
    const { rows } = await db.query<{ id: string }>("select place_order($1, 42.50) as id", [acc]);
    const order = await db.query("select amount, status from orders where id = $1", [rows[0].id]);
    expect(order.rows).toEqual([{ amount: "42.50", status: "pending" }]);
  });

  it("rejects a non-positive amount with invalid_parameter_value (22023)", async () => {
    const acc = await account();
    await expect(db.query("select place_order($1, 0)", [acc])).rejects.toMatchObject({ code: "22023" });
  });

  it("rejects an unknown account (P0002)", async () => {
    await expect(db.query("select place_order(gen_random_uuid(), 10)")).rejects.toMatchObject({ code: "P0002" });
  });
});
