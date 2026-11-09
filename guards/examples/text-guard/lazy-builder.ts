/**
 * A minimal lazy query builder, shaped like the ones in supabase-js, Knex,
 * Kysely or Drizzle: building the query sends nothing, the request leaves only
 * inside then(). The premise test runs against it.
 */
export type Send = (request: { table: string; op: string; payload: unknown }) => Promise<unknown>;

export function createClient(send: Send) {
  return {
    from(table: string) {
      return {
        insert(payload: unknown) {
          return {
            then<R>(onFulfilled: (value: unknown) => R, onRejected?: (reason: unknown) => R): Promise<R> {
              return send({ table, op: "insert", payload }).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
  };
}
