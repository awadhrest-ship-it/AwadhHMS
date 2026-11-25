/**
 * Exact money arithmetic for the restaurant. Every amount is converted to integer paise before any calculation, so there is no
 * floating-point drift; only the final figures are converted back to rupees (2 decimals) for storage and display.
 */
const toMinor = (rupees) => Math.round(Number(rupees) * 100 + (Number(rupees) < 0 ? -1e-9 : 1e-9));
const fromMinor = (minor) => Math.round(minor) / 100;
/** True when a rupee value has at most 2 decimal places (what a price / payment may be). */
const isMoney = (n) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
/** round-half-up of base x (percent / 100). The percent may have up to 2 decimals (e.g. 2.5, 18, 9.75). */
const percentOf = (baseMinor, ratePercent) => { const bp = Math.round(Number(ratePercent) * 100); return Math.floor((baseMinor * bp + 5000) / 10000); };
/**
 * Split `totalMinor` across `weights` so that the parts are whole paise and add up to exactly `totalMinor` (largest-remainder method;
 * ties go to the earlier entry so the result is deterministic). Used for discounts across lines and tax across split bills.
 */
function allocate(totalMinor, weights) {
  const n = weights.length; if (!n) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) { const out = new Array(n).fill(0); out[0] = totalMinor; return out; }
  const sign = totalMinor < 0 ? -1 : 1, t = Math.abs(totalMinor);
  const raw = weights.map((w) => (t * w) / sum);
  const base = raw.map(Math.floor);
  let left = t - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - base[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) base[order[k].i] += 1;
  return base.map((v) => v * sign);
}
module.exports = { toMinor, fromMinor, isMoney, percentOf, allocate };
