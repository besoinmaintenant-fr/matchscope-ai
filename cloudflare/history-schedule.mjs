/** Safely isolate one daily historical sync from existing collectors. */
export function historySyncIsDue(date) {
  return date instanceof Date && Number.isFinite(date.getTime()) &&
    date.getUTCHours() === 3 && date.getUTCMinutes() === 10;
}
