import * as cheerio from "cheerio";
import { uidHash } from "../util.mjs";

export async function fetchHtmlForVenue(venueSlug, pageUrl) {
  const html = await (await fetch(pageUrl)).text();
  const $ = cheerio.load(html);
  const out = [];

  // TODO: Replace these selectors with the venue's real structure
  $(".event-card").each((_, el) => {
    const title = $(el).find(".event-title").text().trim();
    const iso = $(el).find("time").attr("datetime"); // ideally ISO
    const href = $(el).find("a").attr("href") || "";

    if (!title || !iso) return;
    const startISO = new Date(iso).toISOString();

    out.push({
      uid_hash: uidHash(venueSlug, title, startISO),
      title,
      artist: null,
      venue_slug: venueSlug,
      start_at: startISO,
      end_at: null,
      url: href.startsWith("http") ? href : pageUrl,
      status: "confirmed",
      source_type: "html",
      source_ref: pageUrl
    });
  });

  return out;
}
