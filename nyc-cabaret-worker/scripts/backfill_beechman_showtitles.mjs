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
          // Prefer first <strong>…</strong> in description
          const mStrong = desc.match(/<strong[^>]*>([^<]{3,})<\/strong>/i);
          if (mStrong && mStrong[1]) return norm(mStrong[1].replace(/&quot;/g, '"'));
          // Quoted phrase
          const mQuote = desc.replace(/<[^>]+>/g, " ").match(/"([^"]{3,})"/);
          if (mQuote && mQuote[1]) return norm(mQuote[1]);
          // First non-empty line of plain text
          const cleaned = desc.replace(/<br\s*\/?>(?=.)/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"');
          const ln = cleaned.split(/\n|\r/).map(norm).find((x) => x && x.length >= 3);
          if (ln) return ln;
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

function shouldEnrichTitle(title, artist) {
  const t = norm(title);
  const a = norm(artist || "");
  if (!t) return false;
  // Solo-name style
  if (a && t.toLowerCase() === a.toLowerCase()) return true;
  // Marketing or overly long
  if (t.length > 90) return true;
  if (/(brings|presents|debut|theatre|laurie beechman)/i.test(t)) return true;
  return false;
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
    if (!shouldEnrichTitle(r.title, r.artist)) continue;
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
