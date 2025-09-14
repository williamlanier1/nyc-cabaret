import * as cheerio from "cheerio";
import { uidHash, smartTitleCase } from "../util.mjs";

const TZ = "America/New_York";
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

const isUnwantedText = (s) => {
  const txt = (s || "").toString();
  return (
    /live\s*stream/i.test(txt) ||
    /livestream/i.test(txt) ||
    /virtual/i.test(txt) ||
    /on\s*demand/i.test(txt) ||
    /private\s*event/i.test(txt) ||
    /\bclosed\b/i.test(txt) ||
    /no\s*shows?/i.test(txt) ||
    /no\s*performances?/i.test(txt) ||
    /\bdark\b/i.test(txt)
  );
};

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
  return null;
}

function splitTitleAndArtist(raw) {
  const t0 = norm(raw);
  if (!t0) return { title: t0, artist: null };
  const colonIdx = t0.indexOf(":");
  if (colonIdx > 0) {
    const left = t0.slice(0, colonIdx).trim();
    const right = t0.slice(colonIdx + 1).trim();
    const extracted = extractArtistFromTitle(t0);
    if (left && right && extracted && extracted.toLowerCase() === left.toLowerCase()) {
      return { title: right, artist: left };
    }
  }
  return { title: t0, artist: extractArtistFromTitle(t0) };
}

function eventRow(venueSlug, rawTitle, startISO, url, sourceUrl) {
  let { title, artist } = splitTitleAndArtist(rawTitle);
  title = smartTitleCase(title);
  if (artist) artist = smartTitleCase(artist);
  return {
    uid_hash: uidHash(venueSlug, rawTitle, startISO),
    title,
    artist,
    venue_slug: venueSlug,
    start_at: startISO,
    end_at: null,
    url: url || sourceUrl,
    status: "confirmed",
    source_type: "html",
    source_ref: sourceUrl,
  };
}

export async function fetchJoesPubFromDoNYC(venueUrl = "https://donyc.com/venues/joes-pub") {
  const res = await fetch(venueUrl, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" }});
  const html = await res.text();
  const $ = cheerio.load(html);
  const out = [];

  $(".ds-listing[itemtype='http://schema.org/Event']").each((_, el) => {
    const $el = $(el);
    const title = norm($el.find(".ds-listing-event-title-text").first().text());
    if (!title || isUnwantedText(title)) return;

    // Prefer official ticket URL if present in meta offers url; else use DONYC event link
    let href = $el.find("a.ds-btn.ds-btn-large.ds-buy-tix").attr("href") ||
      $el.find("meta[itemprop='url']").attr("content") ||
      $el.find("a.ds-listing-event-title").attr("href") || "";
    if (href && !/^https?:\/\//i.test(href)) {
      try { href = new URL(href, venueUrl).toString(); } catch {}
    }
    if (isUnwantedText(href)) href = venueUrl;

    const dt = $el.find("meta[itemprop='startDate']").attr("content") ||
      $el.find("meta[itemprop='startDate']").attr("datetime") || "";
    if (!dt) return;
    const d = new Date(dt);
    if (isNaN(d.getTime())) return;
    const startISO = d.toISOString();

    out.push(eventRow("joes-pub", title, startISO, href, venueUrl));
  });

  return out;
}

