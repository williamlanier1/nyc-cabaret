import ical from "node-ical";
import { uidHash } from "../util.mjs";

// Pull events from a venue's public ICS calendar URL
export async function fetchIcsForVenue(venueSlug, icsUrl) {
  const data = await ical.async.fromURL(icsUrl);
  const out = [];

  for (const key of Object.keys(data)) {
    const v = data[key];
    if (v.type !== "VEVENT") continue;

    const title = (v.summary || "Untitled").toString().trim();
    const startISO = new Date(v.start).toISOString();
    // Some feeds include an end time we do not want to display (e.g., Chelsea Table + Stage).
    // Suppress end_at for that venue so the calendar shows start only.
    const keepEnd = venueSlug !== "chelsea-table-stage";
    const endISO = keepEnd && v.end ? new Date(v.end).toISOString() : null;

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
