import { ingredientTokenOfCrate, parseStockRef } from '../stock/hq-stock-ref';

/** What the stock match needs of an inventory row. */
export interface StockRow {
  readonly class_name: string | null;
  readonly qty: number | string;
}

/**
 * The one place that decides "does this inventory row count as class X". Used by the Nachschub line closing
 * (`NachschubService.ownedOf`) and meant for `ItemPathService.read`, so the Wunschliste/Nachschub/Bestand path
 * and the line closing can never disagree:
 *
 *  - a manual row stores `<kind>:<Class>` (hq-stock-ref), game rows a bare class name: both go through
 *    {@link parseStockRef};
 *  - a material line carries the recipe ingredient (`Iron`), the stock holds cargo crates
 *    (`Carryable_TBO_FL_32SCU_Commodity_Metal_Iron`): a crate counts for its ingredient token
 *    ({@link ingredientTokenOfCrate}); ore stays its own material and never counts as the plain one.
 *
 * Quantities are summed as stored (the unit of a crate row is not converted).
 */
export function stockMatches(rowClassName: string | null | undefined, wantedClassName: string): boolean {
  const want = wantedClassName.trim().toLowerCase();
  if (!want) return false;
  const have = (parseStockRef(rowClassName)?.className ?? '').toLowerCase();
  if (!have) return false;
  if (have === want) return true;
  const token = ingredientTokenOfCrate(parseStockRef(rowClassName)?.className ?? '');
  return !!token && token.toLowerCase() === want;
}

/** Quantity of a class over all inventory rows. */
export function stockQtyOf(rows: readonly StockRow[], className: string): number {
  let n = 0;
  for (const r of rows) {
    if (!stockMatches(r.class_name, className)) continue;
    const q = Number(r.qty);
    if (Number.isFinite(q)) n += q;
  }
  return n;
}
