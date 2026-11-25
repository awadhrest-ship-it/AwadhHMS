// Pure helpers for the kitchen screens (unit-tested in kitchenMath.test.js).
/** Minutes between an ISO timestamp and `now` (a Date/number). Never negative; null when there is no timestamp. */
export const minutesSince = (iso, now = Date.now()) => (iso ? Math.max(0, (Number(now) - new Date(iso).getTime()) / 60000) : null);
/** "7 min", "1 h 05 min" - short and readable from across a kitchen. */
export function fmtMin(m) {
  if (m == null || Number.isNaN(m)) return '-';
  const t = Math.floor(m); if (t < 60) return `${t} min`;
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')} min`;
}
/** Visual state of a station card from its server status + live elapsed time. Delay is the server's call OR our own clock (whichever sees it first). */
export function cardState(card, now = Date.now()) {
  const active = card.status === 'Queued' || card.status === 'Preparing';
  const elapsed = active ? minutesSince(card.queuedAt, now) : card.elapsedMinutes;
  const delayed = active && (card.delayed || (elapsed != null && card.thresholdMinutes > 0 && elapsed > card.thresholdMinutes));
  const over = delayed && elapsed != null ? Math.max(0, elapsed - card.thresholdMinutes) : 0;
  return { active, elapsed, delayed, over, key: card.status === 'Cancelled' ? 'cancelled' : delayed ? 'delayed' : card.status === 'Ready' || card.status === 'Served' ? 'ready' : card.status === 'Preparing' ? 'preparing' : card.isNew ? 'new' : 'queued' };
}
/** Client-side filter that mirrors the server's board filters, so switching a filter feels instant between polls. */
export function filterCards(cards, { station = 'all', orderType = 'all', delayedOnly = false, newOnly = false } = {}, now = Date.now()) {
  return cards.filter((c) => (station === 'all' || c.station === station) && (orderType === 'all' || c.orderType === orderType) && (!delayedOnly || cardState(c, now).delayed) && (!newOnly || c.isNew));
}
/** Which lane a card belongs to. */
export const laneOf = (c) => (c.status === 'Queued' ? 'new' : c.status === 'Preparing' ? 'preparing' : c.status === 'Ready' ? 'ready' : 'done');
