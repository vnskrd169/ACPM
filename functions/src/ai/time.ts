const MANILA_TIME_ZONE = 'Asia/Manila';

export function manilaDateIso(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function manilaDateStartTimestamp(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00+08:00`);
}
