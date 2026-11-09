export interface Order {
  id: string;
  workspaceId: string;
  customerEmail: string;
  total: number;
}

const ORDERS: Order[] = [
  { id: "o1", workspaceId: "w1", customerEmail: "ana@example.com", total: 120 },
  { id: "o2", workspaceId: "w1", customerEmail: "ben@example.com", total: 75 },
  { id: "o3", workspaceId: "w2", customerEmail: "cho@example.com", total: 300 },
];

export function listOrders(workspaceId: string): Order[] {
  return ORDERS.filter((o) => o.workspaceId === workspaceId);
}
