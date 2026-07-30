export function staleDaysFrom(asOf: string | null | undefined, now = new Date()): number | null {
  const match = asOf?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || Number.isNaN(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const current = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asOfUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const currentUtc = Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day));
  return Math.max(0, Math.floor((currentUtc - asOfUtc) / 86_400_000));
}
