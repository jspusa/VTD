const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const GRACE_MS = 45 * 60 * 1000;

const hoursForDay = (day) => (day === 0 || day === 6
  ? [9, 19]
  : [9, 11, 13, 15, 17, 19]);

export function latestExpectedRunAt(now = new Date()) {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();

  for (let daysBack = 0; daysBack < 8; daysBack += 1) {
    const localDay = new Date(Date.UTC(year, month, date - daysBack));
    const hours = [...hoursForDay(localDay.getUTCDay())].reverse();
    for (const hour of hours) {
      const slot = new Date(Date.UTC(
        localDay.getUTCFullYear(),
        localDay.getUTCMonth(),
        localDay.getUTCDate(),
        hour - 8,
        27,
      ));
      if (slot.getTime() <= now.getTime()) return slot;
    }
  }
  return null;
}

export function isRunStale(finishedAt, now = new Date()) {
  const expected = latestExpectedRunAt(now);
  const finished = finishedAt ? new Date(finishedAt) : null;
  if (!expected || now.getTime() < expected.getTime() + GRACE_MS) return false;
  return !finished || Number.isNaN(finished.getTime()) || finished.getTime() < expected.getTime();
}
