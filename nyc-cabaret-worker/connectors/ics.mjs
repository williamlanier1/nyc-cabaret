import ical from "node-ical";
import { DateTime, IANAZone } from "luxon";
import { uidHash } from "../util.mjs";

// Some feeds (e.g. Pangea's WordPress "Events Calendar" export) tag DTSTART/DTEND
// with a TZID like "UTC+0" that isn't a real IANA timezone. node-ical can't resolve
// it, so it falls back to treating the raw digits as literal UTC — which shifts
// every event by several hours versus the wall-clock time the venue actually meant
// (e.g. an advertised 7:00pm show comes out as 19:00 UTC = 3:00pm Eastern). When
// that happens, reinterpret the same digits as local wall-clock time instead.
function toCorrectedISO(d, localZone) {
  if (!d) return null;
  const tz = d.tz;
  if (tz && !IANAZone.isValidZone(tz)) {
    return DateTime.fromObject(
      {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
      },
      { zone: localZone }
    ).toUTC().toISO();
  }
  return new Date(d).toISOString();
}

// Pull events from a venue's public ICS calendar URL
export async function fetchIcsForVenue(venueSlug, icsUrl, opts = {}) {
  const localZone = opts.zone || "America/New_York";
  const data = await ical.async.fromURL(icsUrl);
  const out = [];

  for (const key of Object.keys(data)) {
    const v = data[key];
    if (v.type !== "VEVENT") continue;

    let title = (v.summary || "Untitled").toString().trim();
    const startISO = toCorrectedISO(v.start, localZone);
    // Some feeds include an end time we do not want to display (e.g., Chelsea Table + Stage).
    // Suppress end_at for that venue so the calendar shows start only.
    const keepEnd = venueSlug !== "chelsea-table-stage";
    const endISO = keepEnd && v.end ? toCorrectedISO(v.end, localZone) : null;

    out.push({
      uid_hash: uidHash(venueSlug, title, startISO),
      title,
      artist: null,
      venue_slug: venueSlug,
      start_at: startISO,
      end_at: endISO,
      url: v.url || null,
      status: (v.status || "confirmed").toLowerCase(),
      source_type: "ics",
      source_ref: icsUrl
    });
  }
  return out;
}
