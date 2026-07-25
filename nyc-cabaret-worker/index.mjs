import { supabaseAdmin } from "./supabase.mjs";
import { fetch54BelowMonths } from "./connectors/54below.mjs";
import { fetchDontTellMamaMonths } from "./connectors/donttellmama.mjs";
import { fetchJoesPubOfficial } from "./connectors/joespub_official.mjs";
import { fetchJoesPubFromDoNYC } from "./connectors/joespub.mjs";
import { fetchIcsForVenue } from "./connectors/ics.mjs";
import { fetchBeechman } from "./connectors/beechman2.mjs";

/* ----------------------- helpers ----------------------- */

// remove events you don't want in the DB
function dropUnwanted(events) {
  const isUnwanted = (s) => {
    const t = (s || "").toString();
    return (
      /live\s*stream/i.test(t) ||
      /livestream/i.test(t) ||
      /virtual/i.test(t) ||
      /on\s*demand/i.test(t) ||
      /cancel+ed?/i.test(t) ||             // Cancel, Canceled, Cancelled
      /private\s*event/i.test(t) ||
      /\bclosed\b/i.test(t) ||
      /no\s*shows?/i.test(t) ||
      /no\s*performances?/i.test(t) ||
      /\bdark\b/i.test(t)
    );
  };
  return events.filter((e) =>
    !isUnwanted(e.title) &&
    !isUnwanted(e.url) &&
    !isUnwanted(e.source_ref) &&
    !(e.status && /cancel/i.test(String(e.status)))
  );
}

// dedupe by uid_hash to avoid "ON CONFLICT ... affect row a second time"
function uniqByUid(events) {
  const m = new Map();
  for (const e of events) m.set(e.uid_hash, e); // last wins
  return [...m.values()];
}

async function getVenueId(slug) {
  const { data, error } = await supabaseAdmin
    .from("venues")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data.id;
}

// Supabase/PostgREST caps a single select at 1000 rows by default. Once a venue
// crosses that many stored events, an unpaginated select silently truncates the
// result, the worker stops seeing some already-imported rows, tries to insert
// them again, and crashes on the uid_hash unique constraint. Page through all
// rows explicitly so this can't happen regardless of table size.
async function fetchAllExisting(venueId) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("events")
      .select("id, uid_hash, start_at, end_at")
      .eq("venue_id", venueId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function upsert(venueSlug, events) {
  const venueId = await getVenueId(venueSlug);

  // Fetch existing rows once for selective updates (paginated — see fetchAllExisting)
  const existing = await fetchAllExisting(venueId);

  const byUid = new Map();
  for (const row of existing || []) byUid.set(row.uid_hash, row);

  const nowISO = new Date().toISOString();
  const toInsert = [];
  const toUpdate = [];
  const toRetitle = [];

  const normISO = (v) => {
    if (!v) return null;
    try { return new Date(v).toISOString(); } catch { return null; }
  };

  // Rows/events that don't match any uid_hash on the other side. A venue that
  // tweaks a listed title even slightly (fixes a typo, adds a featured
  // performer) changes its uid_hash, since the hash is (venue, title, time).
  // Left alone, that creates a brand-new row every time and the old one with
  // the stale title sits there forever — this is why the site shows doubled
  // listings. See the same-timestamp matching below for the fix.
  const unmatchedExisting = [];
  const matchedExistingIds = new Set();
  const unmatchedEvents = [];

  for (const e of events) {
    const ex = byUid.get(e.uid_hash);
    if (!ex) {
      unmatchedEvents.push(e);
      continue;
    }
    matchedExistingIds.add(ex.id);

    // Only update start/end if changed. Do NOT touch title/artist here — this
    // is the exact-hash-match path, so the title didn't change.
    const exStart = normISO(ex.start_at);
    const exEnd = normISO(ex.end_at);
    const newStart = normISO(e.start_at);
    const newEnd = normISO(e.end_at ?? null);

    const changed = exStart !== newStart || exEnd !== newEnd;
    if (changed) {
      toUpdate.push({
        id: ex.id,
        start_at: e.start_at,
        end_at: e.end_at ?? null,
        tz: "America/New_York",
        last_modified_at: nowISO,
      });
    }
  }
  for (const row of existing || []) {
    if (!matchedExistingIds.has(row.id)) unmatchedExisting.push(row);
  }

  // Pair up unmatched existing rows with unmatched incoming events by exact
  // start_at, but only when the pairing is unambiguous — exactly one orphaned
  // existing row and exactly one orphaned incoming event at that same instant.
  // A venue with concurrent rooms (two real, different shows at the same
  // moment) would show up as 2:2 or more here and correctly gets skipped —
  // both just insert as distinct new rows instead of being merged.
  const existingByStart = new Map();
  for (const row of unmatchedExisting) {
    const key = normISO(row.start_at);
    if (!existingByStart.has(key)) existingByStart.set(key, []);
    existingByStart.get(key).push(row);
  }
  const eventsByStart = new Map();
  for (const e of unmatchedEvents) {
    const key = normISO(e.start_at);
    if (!eventsByStart.has(key)) eventsByStart.set(key, []);
    eventsByStart.get(key).push(e);
  }

  const stillUnmatchedEvents = [];
  for (const e of unmatchedEvents) {
    const key = normISO(e.start_at);
    const exRows = existingByStart.get(key);
    const newRows = eventsByStart.get(key);
    if (exRows && exRows.length === 1 && newRows && newRows.length === 1) {
      toRetitle.push({
        id: exRows[0].id,
        uid_hash: e.uid_hash,
        title: e.title,
        artist: e.artist ?? null,
        start_at: e.start_at,
        end_at: e.end_at ?? null,
        tz: "America/New_York",
        last_modified_at: nowISO,
      });
    } else {
      stillUnmatchedEvents.push(e);
    }
  }

  for (const e of stillUnmatchedEvents) {
    toInsert.push({
      uid_hash: e.uid_hash,
      title: e.title,
      artist: e.artist ?? null,
      venue_id: venueId,
      start_at: e.start_at,
      end_at: e.end_at ?? null,
      tz: "America/New_York",
      url: e.url ?? null,
      status: e.status || "confirmed",
      source_type: e.source_type,
      source_ref: e.source_ref ?? null,
      last_modified_at: nowISO,
    });
  }

  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from("events").insert(toInsert);
    if (error) throw error;
  }

  if (toUpdate.length > 0) {
    for (const u of toUpdate) {
      const { id, ...patch } = u;
      const { error } = await supabaseAdmin.from("events").update(patch).eq("id", id);
      if (error) throw error;
    }
  }

  if (toRetitle.length > 0) {
    for (const u of toRetitle) {
      const { id, ...patch } = u;
      const { error } = await supabaseAdmin.from("events").update(patch).eq("id", id);
      if (error) throw error;
    }
  }
}

/* ----------------------- main -------------------------- */

async function run() {
  // 54 Below — crawl 6 months forward using the month=October+2025 style URLs
  try {
    const events54 = await fetch54BelowMonths("https://54below.org/calendar/", 6);
    const clean54 = uniqByUid(dropUnwanted(events54));
    await upsert("54-below", clean54);
    console.log(`Imported 54 Below: ${clean54.length} events`);
  } catch (err) {
    console.warn("54 Below import failed:", err?.message || err);
  }

  // Ingestion for additional venues can be added here as needed.
  try {
    const eventsDTM = await fetchDontTellMamaMonths("https://shows.donttellmamanyc.com/", 6);
    const cleanDTM = uniqByUid(dropUnwanted(eventsDTM));
    // Ensure this matches your venues.slug in Supabase
    await upsert("dont-tell-mama", cleanDTM);
    console.log(`Imported Don't Tell Mama: ${cleanDTM.length} events`);
  } catch (err) {
    console.warn("Don't Tell Mama import failed:", err?.message || err);
  }

  // Joe's Pub — prefer official site; fallback to DoNYC if official yields none
  try {
    let eventsJP = await fetchJoesPubOfficial("https://publictheater.org/joes-pub");
    if (!eventsJP || eventsJP.length === 0) {
      eventsJP = await fetchJoesPubFromDoNYC("https://donyc.com/venues/joes-pub");
    }
    const cleanJP = uniqByUid(dropUnwanted(eventsJP));
    await upsert("joes-pub", cleanJP);
    console.log(`Imported Joe's Pub: ${cleanJP.length} events`);
  } catch (err) {
    console.warn("Joe's Pub import failed:", err?.message || err);
  }

  // Chelsea Table + Stage via provided ICS link
  try {
    const icsUrl = "https://data.accentapi.com/widget_export_calendar/25441071?v=1757886133543";
    const eventsCTS = await fetchIcsForVenue("chelsea-table-stage", icsUrl);
    const cleanCTS = uniqByUid(dropUnwanted(eventsCTS));
    await upsert("chelsea-table-stage", cleanCTS);
    console.log(`Imported Chelsea Table + Stage: ${cleanCTS.length} events`);
  } catch (err) {
    console.warn("Chelsea Table + Stage import failed:", err?.message || err);
  }

  // Laurie Beechman Theatre (slug: beechman): ICS-first with HTML fallback
  try {
    const eventsBeech = await fetchBeechman("https://www.thebeechman.com");
    const cleanBeech = uniqByUid(dropUnwanted(eventsBeech));
    await upsert("beechman", cleanBeech);
    console.log(`Imported Beechman: ${cleanBeech.length} events`);
  } catch (err) {
    console.warn("Beechman import failed:", err?.message || err);
  }

  // Pangea — ICS feed via WordPress Events Calendar. The feed tags times with a
  // bogus "UTC+0" TZID; fetchIcsForVenue corrects those back to America/New_York
  // wall-clock time (see connectors/ics.mjs). Requires a "pangea" row in venues.
  try {
    const eventsPangea = await fetchIcsForVenue(
      "pangea",
      "https://www.pangeanyc.com/music/?ical=1"
    );
    const cleanPangea = uniqByUid(dropUnwanted(eventsPangea));
    await upsert("pangea", cleanPangea);
    console.log(`Imported Pangea: ${cleanPangea.length} events`);
  } catch (err) {
    console.warn("Pangea import failed:", err?.message || err);
  }

}

run()
  .then(() => {
    console.log("Ingestion completed.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Worker error:", err);
    process.exit(1);
  });
