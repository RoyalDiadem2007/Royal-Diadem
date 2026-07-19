/**
 * Minimal ICS (RFC 5545) builder for the student's confirmed 1:1 — an
 * "Add to calendar" that stays on her own device. The title is generic on
 * purpose: her calendar app never learns what the program is or who runs
 * it, only that this hour is hers.
 */

export type IcsEvent = {
  uid: string;
  title: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, 24h. */
  startTime: string;
  /** HH:MM, 24h; when null the event runs one hour. */
  endTime: string | null;
  /** Stamp for DTSTAMP — pass the current time at call site. */
  now: Date;
};

/** "2026-07-24" + "15:30" → "20260724T153000" (floating local time). */
function icsLocal(date: string, time: string): string {
  return `${date.replaceAll('-', '')}T${time.replaceAll(':', '')}00`;
}

/** HH:MM one hour after `time`, capped at the end of the day. */
export function hourAfter(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map((part) => Number(part));
  const next = Math.min(hours + 1, 23);
  return `${String(next).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function buildIcs(event: IcsEvent): string {
  const stamp = `${event.now.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z`;
  // CRLF line endings per RFC 5545.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // Deliberately NOT the brand: the file must not name the program
    // (privacy for a shared or monitored device calendar).
    'PRODID:-//Calendar//EN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsLocal(event.date, event.startTime)}`,
    `DTEND:${icsLocal(event.date, event.endTime ?? hourAfter(event.startTime))}`,
    `SUMMARY:${event.title}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
