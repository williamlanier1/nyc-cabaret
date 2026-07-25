import ical from "node-ical";
import { DateTime, IANAZone } from "luxon";
import { uidHash, smartTitleCase, ensureArtistFromTitle } from "../util.mjs";

// Pangea's WordPress feed bakes the room name and a redundant time/cover-charge
// string into SUMMARY, e.g. "Cabaret Room: DAN MANJOVI, 8:30pm-10:30pm, no cover"
// — noisy since the time already shows in its own column, and the performer's
// name never makes it into the artist field. Strip the room prefix and the
// trailing time/cover string, then pull an artist name out when what's left
// looks like one (reusing the same heuristic 54 Below's connector uses).
function cleanPangeaTitle(raw) {
  let t = (raw || "").trim();
  t = t.replace(/^(cabaret room|front lounge)\s*:\s*/i, "");
  t = t.replace(
    /,\s*\d{1,2}(:\d{2})?\s*(am|pm)\s*(-\s*\d{1,2}(:\d{2})?\s*(am|pm))?\s*(,\s*no\s*cover)?\s*$/i,
    ""
  );
  const title = smartTitleCase(t.trim());
  const artist = ensureArtistFromTitle(title, null);
  return { title, artist };
}

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

    const rawTitle = (v.summary || "Untitled").toString().trim();
    let title = rawTitle;
    let artist = null;
    if (venueSlug === "pangea") {
      const cleaned = cleanPangeaTitle(rawTitle);
      title = cleaned.title;
      artist = cleaned.artist;
    }
    const startISO = toCorrectedISO(v.start, localZone);
    // Some feeds include an end time we do not want to display (e.g., Chelsea Table + Stage).
    // Suppress end_at for that venue so the calendar shows start only.
    const keepEnd = venueSlug !== "chelsea-table-stage";
    const endISO = keepEnd && v.end ? toCorrectedISO(v.end, localZone) : null;

    out.push({
      // Hash the raw feed text, not the cleaned display title, so identity stays
      // stable even as the cleanup logic improves — otherwise every refinement
      // here would orphan the previous run's rows as duplicates.
      uid_hash: uidHash(venueSlug, rawTitle, startISO),
      title,
      artist,
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
