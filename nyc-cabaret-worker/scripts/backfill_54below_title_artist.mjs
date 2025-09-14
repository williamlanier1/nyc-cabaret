import { supabaseAdmin } from "../supabase.mjs";

const TZ = "America/New_York";
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

function extractArtistFromTitle(title) {
  const t = (title || "").trim();
  if (t.includes(":")) {
    const left = t.split(":")[0].trim();
    if (
      left.length >= 3 &&
      !/^\d/.test(left) &&
      !/sings/i.test(left) &&
      !/greatest hits/i.test(left) &&
      !/anniversary/i.test(left) &&
      !/broadway/i.test(left) &&
      !/presents/i.test(left)
    )
      return left;
  }
  const m = t.match(/^(.+?)\s+(at|@)\s+54\s*Below/i);
  if (m?.[1]?.length >= 3) return m[1].trim();
  return null;
}

function splitTitleAndArtist(rawTitle) {
  const t = (rawTitle || "").trim();
  if (!t) return { title: t, artist: null };
  const colonIdx = t.indexOf(":");
  if (colonIdx > 0) {
    const left = t.slice(0, colonIdx).trim();
    const right = t.slice(colonIdx + 1).trim();
    const extracted = extractArtistFromTitle(t);
    if (left && right && extracted && extracted.toLowerCase() === left.toLowerCase()) {
      return { title: right, artist: left };
    }
  }
  return { title: t, artist: extractArtistFromTitle(t) };
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
  const venueSlug = "54-below";
  const venueId = await getVenueId(venueSlug);

  // Fetch all events for the venue; we'll process both:
  // 1) artist empty + colon titles -> split into artist/title
  // 2) artist present + title begins with `${artist}:` -> strip artist from title
  const { data: rows, error } = await supabaseAdmin
    .from("events")
    .select("id,title,artist")
    .eq("venue_id", venueId)
    .limit(5000);
  if (error) throw error;

  const updates = [];
  for (const r of rows || []) {
    const t0 = norm(r.title || "");
    const a0 = norm(r.artist || "");
    const hasArtist = a0.length > 0;

    if (!hasArtist && t0.includes(":")) {
      const { title, artist } = splitTitleAndArtist(t0);
      if (artist && title && (artist !== r.artist || title !== t0)) {
        updates.push({ id: r.id, title, artist, last_modified_at: new Date().toISOString(), tz: TZ });
        continue;
      }
    }

    if (hasArtist) {
      const prefix = a0 + ":";
      if (t0.toLowerCase().startsWith(prefix.toLowerCase())) {
        const stripped = norm(t0.slice(prefix.length));
        if (stripped && stripped !== t0) {
          updates.push({ id: r.id, title: stripped, last_modified_at: new Date().toISOString(), tz: TZ });
          continue;
        }
      }
    }
  }

  if (updates.length === 0) {
    console.log("No rows to backfill.");
    return;
  }

  // Batch upsert by id
  const { error: upErr } = await supabaseAdmin
    .from("events")
    .upsert(updates, { onConflict: "id" });
  if (upErr) throw upErr;
  console.log(`Backfill updated ${updates.length} rows.`);
}

run().catch((e) => {
  console.error("Backfill error:", e?.message || e);
  process.exit(1);
});
