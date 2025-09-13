export type DbEvent = {
  id?: string;
  title: string;
  artist: string | null;
  start_at: string;       // ISO UTC
  end_at: string | null;  // ISO UTC or null
  url: string | null;
  status?: string | null;
  tz?: string | null;
  venue_id?: string;
};

export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  const Y = d.getUTCFullYear();
  const M = String(d.getUTCMonth() + 1).padStart(2, "0");
  const D = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${Y}${M}${D}T${h}${m}${s}Z`;
}

export function icsUid(e: DbEvent): string {
  const base = e.id ?? `${e.title}-${e.start_at}`;
  return icsEscape(base).replace(/\s+/g, "-");
}

export function eventToIcs(e: DbEvent): string {
  const now = new Date().toISOString();
  const dtstamp = toIcsUtc(now);
  const dtstart = toIcsUtc(e.start_at);
  const dtend = e.end_at ? toIcsUtc(e.end_at) : undefined;

  const summary =
    e.artist && e.artist.trim().length > 0
      ? `${e.artist} — ${e.title}`
      : e.title;

  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${icsUid(e)}@nyc-cabaret`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
  ];

  if (dtend) lines.push(`DTEND:${dtend}`);
  lines.push(`SUMMARY:${icsEscape(summary)}`);

  if (e.url) lines.push(`URL:${icsEscape(e.url)}`);
  if (e.status) lines.push(`STATUS:${icsEscape(e.status)}`);
  lines.push("END:VEVENT");

  return lines.join("\r\n");
}

export function buildIcs(events: DbEvent[], calendarName: string): string {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "PRODID:-//nyc-cabaret//calendar//EN",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];
  const body = events.map(eventToIcs);
  const footer = ["END:VCALENDAR"];
  return [...header, ...body, ...footer].join("\r\n");
}
