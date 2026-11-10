// readInventory() reads stock from the Supabase inventory table, and says "can't
// read" (null) instead of crashing or guessing. Supabase is faked here, so the
// test needs no account and costs nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { data: unknown; error: unknown };

let client: { from: ReturnType<typeof vi.fn> } | null;
let reply: Reply;
let selected: string | undefined;

vi.mock("@/lib/supabase/server", () => ({
  createStatelessClient: () => client,
}));

const ROWS = [
  {
    sku: "CN-NSK",
    product: "Copper Notes",
    color: "Night Sky",
    units_in_stock: 0,
    next_shipment: "2026-11-14",
  },
  {
    sku: "CH-TEA",
    product: "Copper Home",
    color: "Patina Teal",
    units_in_stock: 6,
    next_shipment: "2026-11-06",
  },
];

beforeEach(() => {
  reply = { data: ROWS, error: null };
  selected = undefined;
  client = {
    from: vi.fn((table: string) => ({
      select: async (columns: string) => {
        selected = `${table}: ${columns}`;
        return reply;
      },
    })),
  };
});

describe("readInventory", () => {
  it("returns every row of the Supabase inventory table", async () => {
    const { readInventory } = await import("@/lib/copper/inventory");
    expect(await readInventory()).toEqual(ROWS);
    expect(selected).toContain("inventory");
    expect(selected).toContain("units_in_stock");
  });

  it("reads again on every call, so a changed row shows up with no deploy", async () => {
    const { readInventory } = await import("@/lib/copper/inventory");
    const before = await readInventory();
    reply = {
      data: ROWS.map((row) =>
        row.sku === "CN-NSK" ? { ...row, units_in_stock: 40 } : row,
      ),
      error: null,
    };
    const after = await readInventory();
    expect(before?.find((row) => row.sku === "CN-NSK")?.units_in_stock).toBe(0);
    expect(after?.find((row) => row.sku === "CN-NSK")?.units_in_stock).toBe(40);
  });

  it("returns null when Supabase isn't set up", async () => {
    client = null;
    const { readInventory } = await import("@/lib/copper/inventory");
    expect(await readInventory()).toBeNull();
  });

  it("returns null when Supabase reports an error", async () => {
    reply = { data: null, error: { message: "project is paused" } };
    const { readInventory } = await import("@/lib/copper/inventory");
    expect(await readInventory()).toBeNull();
  });
});
