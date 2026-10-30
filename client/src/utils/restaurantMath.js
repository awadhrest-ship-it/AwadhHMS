// Client-side ESTIMATE of a restaurant cart total (used only to show the person a running figure while they build an order).
// The server recalculates every price, discount, tax and total itself - nothing computed here is ever sent as authoritative.
// Same integer-paise, half-up rules as server/services/restaurant/money.js.
export const toMinor = (rupees) => Math.round(Number(rupees) * 100 + (Number(rupees) < 0 ? -1e-9 : 1e-9));
export const fromMinor = (minor) => Math.round(minor) / 100;
export const percentOf = (baseMinor, ratePercent) => Math.floor((baseMinor * Math.round(Number(ratePercent) * 100) + 5000) / 10000);
export function estimateCart(lines, taxes = []) {
  const gross = lines.reduce((s, l) => s + toMinor(l.price) * l.quantity, 0);
  const taxable = lines.reduce((s, l) => s + (l.taxable === false ? 0 : toMinor(l.price) * l.quantity), 0);
  const taxLines = taxes.map((t) => ({ ...t, amountMinor: percentOf(taxable, t.ratePercent) }));
  const tax = taxLines.reduce((s, t) => s + t.amountMinor, 0);
  return { grossMinor: gross, taxMinor: tax, totalMinor: gross + tax, taxLines };
}
