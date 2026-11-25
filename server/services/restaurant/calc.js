/**
 * Pure bill calculation (no database). All arithmetic is in integer paise.
 *   gross         = sum(unit price x quantity)
 *   complimentary = value of approved complimentary items (they are not charged and not taxed)
 *   discount      = approved discount on (gross - complimentary), percent or fixed amount, capped at that base
 *   net           = gross - complimentary - discount            (sales excluding tax)
 *   tax           = each configured tax % applied to the taxable part of net (items flagged non-taxable are excluded)
 *   total         = net + tax
 * The discount is spread over the lines proportionally (largest remainder) so line figures always add up to the bill figure.
 */
const { toMinor, percentOf, allocate } = require('./money');

function calcBill({ lines, adjustments = [], taxes = [] }) {
  const L = lines.map((l) => ({ key: String(l.orderItem), name: l.name, taxable: l.taxable !== false, qty: l.quantity, unit: toMinor(l.unitPrice) }));
  const applied = adjustments.filter((a) => a.status === 'Applied');
  const compQty = new Map();
  applied.filter((a) => a.kind === 'Complimentary').forEach((a) => a.lines.forEach((x) => compQty.set(String(x.orderItem), (compQty.get(String(x.orderItem)) || 0) + x.quantity)));
  const rows = L.map((l) => { const c = Math.min(compQty.get(l.key) || 0, l.qty); return { ...l, gross: l.unit * l.qty, comp: l.unit * c, compQty: c }; });
  const gross = rows.reduce((s, r) => s + r.gross, 0), comp = rows.reduce((s, r) => s + r.comp, 0), base = gross - comp;
  const d = applied.find((a) => a.kind === 'Discount');
  let discount = 0; if (d) discount = Math.min(base, d.mode === 'percent' ? percentOf(base, d.value) : toMinor(d.value));
  const share = allocate(discount, rows.map((r) => r.gross - r.comp));
  rows.forEach((r, i) => { r.discount = share[i]; r.net = r.gross - r.comp - r.discount; });
  const taxable = rows.reduce((s, r) => s + (r.taxable ? r.net : 0), 0);
  const taxLines = taxes.map((t) => ({ code: t.code, name: t.name, ratePercent: t.ratePercent, amountMinor: percentOf(taxable, t.ratePercent) }));
  const net = base - discount, tax = taxLines.reduce((s, t) => s + t.amountMinor, 0);
  return { grossMinor: gross, complimentaryMinor: comp, discountMinor: discount, netMinor: net, taxableMinor: taxable, taxLines, taxMinor: tax, totalMinor: net + tax, rows };
}
/** What discount / complimentary value a request would be worth against the current bill (used to size the approval and to refuse nonsense). */
function baseBeforeDiscount(lines, adjustments) { const c = calcBill({ lines, adjustments: adjustments.filter((a) => a.kind === 'Complimentary') }); return c.grossMinor - c.complimentaryMinor; }
module.exports = { calcBill, baseBeforeDiscount };
