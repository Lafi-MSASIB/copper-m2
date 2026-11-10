// How many of each product color are on the shelf, and when the next shipment
// lands (Product Bible Section 10). Stock changes, so check_availability reads
// it fresh every time instead of remembering it.
// This is the only file that knows where stock is kept: it lives in the
// Supabase `inventory` table, so a shop manager can change it without a deploy.
import { createStatelessClient } from "@/lib/supabase/server";

/** One row of stock, named like the database columns it comes from. */
export type InventoryRow = {
  sku: string;
  product: string;
  color: string;
  units_in_stock: number;
  next_shipment: string;
};

/** Every stock row, or `null` when stock can't be read right now. */
export async function readInventory(): Promise<InventoryRow[] | null> {
  const supabase = createStatelessClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("inventory")
    .select("sku, product, color, units_in_stock, next_shipment");
  if (error || !data) return null;

  return data as InventoryRow[];
}
