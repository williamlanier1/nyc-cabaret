import { supabaseAdmin } from "../supabase.mjs";
import { smartTitleCase } from "../util.mjs";

function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }

function splitFromQuotes(raw) {
  const t0 = norm(raw);
  if (!t0) return { title: t0, artist: null };
  const mq = t0.match(/^(.+?)\s*[“\"]([^\"]+)[”\"]/);
  if (mq) {
    const pre = norm(mq[1] || "");
    const inner = norm(mq[2] || "");
    if (inner) return { title: inner.replace(/[“”\"]/g, "").trim(), artist: pre || null };
  }
  const mq2 = t0.match(/[“\"]([^\"]+)[”\"]/);
  if (mq2) {
    const inner = norm(mq2[1] || "");
    if (inner) return { title: inner.replace(/[“”\"]/g, "").trim(), artist: null };
  }
  return { title: t0, artist: null };
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

async function run() {
  const venueId = await getVenueId("dont-tell-mama");
  const { data: rows, error } = await supabaseAdmin
    .from("events")
    .select("id,title,artist")
    .eq("venue_id", venueId)
    .limit(5000);
  if (error) throw error;

  let updated = 0;
  for (const r of rows || []) {
    const { title: newTitle0, artist: newArtist0 } = splitFromQuotes(r.title || "");
    const newTitle = smartTitleCase(newTitle0);
    const newArtist = newArtist0 ? smartTitleCase(newArtist0) : r.artist;
    const patch = {};
    if (newTitle && newTitle !== r.title) patch.title = newTitle;
    if (newArtist && newArtist !== r.artist) patch.artist = newArtist;
    if (Object.keys(patch).length > 0) {
      patch.last_modified_at = new Date().toISOString();
      patch.tz = "America/New_York";
      const { error: updErr } = await supabaseAdmin.from("events").update(patch).eq("id", r.id);
      if (updErr) throw updErr;
      updated++;
    }
  }
  console.log(`DTM quotes-split backfill updated ${updated} rows.`);
}

run().catch((e) => {
  console.error("Backfill DTM quotes error:", e?.message || e);
  process.exit(1);
});

