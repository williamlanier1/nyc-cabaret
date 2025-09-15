import { supabaseAdmin } from "../supabase.mjs";
import { smartTitleCase } from "../util.mjs";

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

async function getVenueId(slug) {
  const { data, error } = await supabaseAdmin
    .from("venues")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data.id;
}

async function fetchShowTitleFromShowClix(detailUrl) {
  try {
    const res = await fetch(detailUrl, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" }});
    const html = await res.text();
    // Embedded EVENT JSON
    const m = html.match(/var\s+EVENT\s*=\s*(\{[\s\S]*?\});/);
    if (m && m[1]) {
      try {
        const obj = JSON.parse(m[1]);
        const desc = obj?.description || "";
        if (desc) {
          // quick parse as text
          const cleaned = desc.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"');
          // Look for italic/strong phrases that often hold show title
          const m1 = cleaned.match(/"([^"]{3,})"/);
          if (m1 && m1[1]) return norm(m1[1]);
          // Or a line with ALL CAPS artist followed by a line with title case words
          const lines = cleaned.split(/\n|\r/).map(norm).filter(Boolean);
          for (const ln of lines) {
            if (/[A-Z]/.test(ln) && !/[a-z]/.test(ln)) continue; // skip all-caps artist
            if (ln.length >= 3) return ln;
          }
        }
      } catch {}
    }
    // Fallback: twitter:description often contains quoted show name
    const tdesc = html.match(/<meta[^>]+name=[\"']twitter:description[\"'][^>]+content=[\"']([^\"']+)[\"']/i);
    if (tdesc && tdesc[1]) {
      const text = norm(tdesc[1]).replace(/&quot;/g, '"');
      const mq = text.match(/"([^"]{3,})"/);
      if (mq && mq[1]) return norm(mq[1]);
    }
  } catch {}
  return null;
}

function looksLikeSoloName(title, artist) {
  const t = norm(title);
  const a = norm(artist || "");
  if (!t) return false;
  if (a && t.toLowerCase() !== a.toLowerCase()) return false;
  if (/[:"\d]/.test(t)) return false;
  const bad = /( at | with | presents | show\b| band\b| trio\b| quartet\b| orchestra\b| comedy\b| cabaret\b)/i;
  if (bad.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w));
}

async function run() {
  const venueId = await getVenueId("beechman");
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("id,title,artist,url")
    .eq("venue_id", venueId)
    .ilike("url", "%showclix.com%")
    .limit(2000);
  if (error) throw error;

  let updated = 0;
  for (const r of data || []) {
    if (!looksLikeSoloName(r.title, r.artist)) continue;
    if (!r.url) continue;
    const show = await fetchShowTitleFromShowClix(r.url);
    if (show && show.length >= 3) {
      const newTitle = smartTitleCase(show);
      if (newTitle !== r.title) {
        const { error: updErr } = await supabaseAdmin
          .from("events")
          .update({ title: newTitle, last_modified_at: new Date().toISOString(), tz: "America/New_York" })
          .eq("id", r.id);
        if (updErr) throw updErr;
        updated++;
      }
    }
  }
  console.log(`Beechman show-title backfill updated ${updated} rows.`);
}

run().catch((e) => {
  console.error("Backfill Beechman titles error:", e?.message || e);
  process.exit(1);
});

