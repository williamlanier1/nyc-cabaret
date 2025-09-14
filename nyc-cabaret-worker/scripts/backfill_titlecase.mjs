import { supabaseAdmin } from "../supabase.mjs";
import { smartTitleCase } from "../util.mjs";

const VENUE_SLUGS = ["dont-tell-mama", "54-below"];

async function getVenueId(slug) {
  const { data, error } = await supabaseAdmin
    .from("venues")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data.id;
}

function needsTitleCase(s) {
  const t = (s || "").trim();
  if (!t) return false;
  return !/[a-z]/.test(t) && /[A-Z]/.test(t);
}

async function run() {
  let total = 0;
  for (const slug of VENUE_SLUGS) {
    const venueId = await getVenueId(slug);
    const { data: rows, error } = await supabaseAdmin
      .from("events")
      .select("id,title,artist")
      .eq("venue_id", venueId)
      .limit(5000);
    if (error) throw error;

    for (const r of rows || []) {
      const patch = {};
      if (needsTitleCase(r.title)) {
        patch.title = smartTitleCase(r.title);
      }
      if (r.artist && needsTitleCase(r.artist)) {
        patch.artist = smartTitleCase(r.artist);
      }
      if (Object.keys(patch).length > 0) {
        patch.last_modified_at = new Date().toISOString();
        patch.tz = "America/New_York";
        const { error: updErr } = await supabaseAdmin
          .from("events")
          .update(patch)
          .eq("id", r.id);
        if (updErr) throw updErr;
        total++;
      }
    }
  }
  console.log(`Titlecase backfill updated ${total} rows.`);
}

run().catch((e) => {
  console.error("Backfill titlecase error:", e?.message || e);
  process.exit(1);
});

