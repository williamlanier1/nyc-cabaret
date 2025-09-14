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
  // If no lowercase letters and there is at least one uppercase -> ALL CAPS
  if (!/[a-z]/.test(t) && /[A-Z]/.test(t)) return true;
  // Otherwise, treat as shouty if >=80% of alpha letters are uppercase
  const letters = t.match(/[A-Za-z]/g) || [];
  if (letters.length === 0) return false;
  const upper = letters.filter((ch) => /[A-Z]/.test(ch)).length;
  return upper / letters.length >= 0.8;
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
      const newTitle = smartTitleCase(r.title || "");
      if (newTitle && newTitle !== r.title) {
        patch.title = newTitle;
      }
      if (r.artist) {
        const newArtist = smartTitleCase(r.artist);
        if (newArtist !== r.artist) patch.artist = newArtist;
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
