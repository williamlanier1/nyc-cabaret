import { supabaseAdmin } from "./supabase.mjs";
import { fetch54BelowMonths } from "./connectors/54below.mjs";

/* ----------------------- helpers ----------------------- */

// remove events you don't want in the DB
function dropUnwanted(events) {
  const isUnwanted = (t) => {
    const s = (t || "").toString();
    return (
      /live\s*stream/i.test(s) ||          // livestream, live stream
      /livestream/i.test(s) ||
      /private\s*event/i.test(s) ||        // Private Event(s)
      /\bclosed\b/i.test(s) ||             // Closed / Venue Closed
      /no\s*shows?/i.test(s) ||            // No Show / No Shows
      /no\s*performances?/i.test(s) ||     // No Performance(s)
      /\bdark\b/i.test(s)                  // Dark night
    );
  };
  return events.filter((e) => !isUnwanted(e.title));
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

async function upsert(venueSlug, events) {
  const venueId = await getVenueId(venueSlug);

  // Fetch existing rows once for selective updates
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("events")
    .select("id, uid_hash, start_at, end_at")
    .eq("venue_id", venueId);
  if (selErr) throw selErr;

  const byUid = new Map();
  for (const row of existing || []) byUid.set(row.uid_hash, row);

  const nowISO = new Date().toISOString();
  const toInsert = [];
  const toUpdate = [];

  const normISO = (v) => {
    if (!v) return null;
    try { return new Date(v).toISOString(); } catch { return null; }
  };

  for (const e of events) {
    const ex = byUid.get(e.uid_hash);
    if (!ex) {
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
      continue;
    }

    // Only update if date/time changed. Do NOT touch title/artist (manual edits allowed).
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
        // keep TZ consistent with worker policy
        tz: "America/New_York",
        last_modified_at: nowISO,
      });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabaseAdmin.from("events").insert(toInsert);
    if (error) throw error;
  }

  if (toUpdate.length > 0) {
    // Use upsert on primary key id to update multiple rows with different values
    const { error } = await supabaseAdmin
      .from("events")
      .upsert(toUpdate, { onConflict: "id" });
    if (error) throw error;
  }
}

/* ----------------------- main -------------------------- */

async function run() {
  // 54 Below — crawl 6 months forward using the month=October+2025 style URLs
  const events54 = await fetch54BelowMonths("https://54below.org/calendar/", 6);
  const clean54 = uniqByUid(dropUnwanted(events54));
  await upsert("54-below", clean54);

  console.log(`Imported 54 Below: ${clean54.length} events`);

  // Ingestion for additional venues can be added here as needed.
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
