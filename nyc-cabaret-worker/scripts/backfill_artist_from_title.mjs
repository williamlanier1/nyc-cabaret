import { supabaseAdmin } from "../supabase.mjs";
import { ensureArtistFromTitle, smartTitleCase } from "../util.mjs";

async function run() {
  // Pull a large batch of candidate rows where artist is null/empty
  const { data: rows, error } = await supabaseAdmin
    .from("events")
    .select("id,title,artist")
    .or("artist.is.null,artist.eq.")
    .limit(10000);
  if (error) throw error;

  let updated = 0;
  for (const r of rows || []) {
    const title = (r.title || "").trim();
    if (!title) continue;
    const suggested = ensureArtistFromTitle(title, r.artist);
    if (suggested && (!r.artist || r.artist.trim().length === 0)) {
      const newArtist = smartTitleCase(suggested);
      const { error: updErr } = await supabaseAdmin
        .from("events")
        .update({ artist: newArtist, last_modified_at: new Date().toISOString(), tz: "America/New_York" })
        .eq("id", r.id);
      if (updErr) throw updErr;
      updated++;
    }
  }
  console.log(`Artist-from-title backfill updated ${updated} rows.`);
}

run().catch((e) => {
  console.error("Backfill artist-from-title error:", e?.message || e);
  process.exit(1);
});

