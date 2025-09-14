import { supabaseAdmin } from "./supabase.mjs";
import { fetch54BelowMonths } from "./connectors/54below.mjs";

/* ----------------------- helpers ----------------------- */

// remove events you don't want in the DB
function dropUnwanted(events) {
  return events.filter(
    (e) =>
      !/livestream/i.test(e.title) &&      // skip livestreams
      !/private\s*event/i.test(e.title)    // skip "Private Event" / "Private Events"
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

async function upsert(venueSlug, events) {
  const venueId = await getVenueId(venueSlug);

  const rows = events.map((e) => ({
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
    last_modified_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("events")
    .upsert(rows, { onConflict: "uid_hash" });

  if (error) throw error;
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
