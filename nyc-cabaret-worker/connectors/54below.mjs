import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { uidHash } from "../util.mjs";

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

function splitTitleAndArtist(title) {
  const t = (title || "").trim();
  if (!t) return { title: t, artist: null };
  // Prefer colon pattern: "Artist: Show Title"
  const colonIdx = t.indexOf(":");
  if (colonIdx > 0) {
    const left = t.slice(0, colonIdx).trim();
    const right = t.slice(colonIdx + 1).trim();
    const extracted = extractArtistFromTitle(t);
    if (left && right && extracted && extracted.toLowerCase() === left.toLowerCase()) {
      return { title: right, artist: left };
    }
  }
  // Fallback: try other heuristics (e.g., "Artist at 54 Below") but keep full title
  return { title: t, artist: extractArtistFromTitle(t) };
}

function eventRow(venueSlug, rawTitle, startISO, url, sourceUrl) {
  const { title, artist } = splitTitleAndArtist(rawTitle);
  return {
    // Keep uid_hash stable by hashing the rawTitle (pre-split)
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

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const isUnwantedTitle = (t) => {
  const s = (t || "").toString();
  return (
    /live\s*stream/i.test(s) ||
    /livestream/i.test(s) ||
    /private\s*event/i.test(s) ||
    /\bclosed\b/i.test(s) ||
    /no\s*shows?/i.test(s) ||
    /no\s*performances?/i.test(s) ||
    /\bdark\b/i.test(s)
  );
};
const monthMap = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

function scrapeOneCalendarPage($, pageUrl, year) {
  const out = [];
  $("div.date.day").each((_, dayEl) => {
    const $day = $(dayEl);
    const monthText = norm($day.find("span.day__month").first().text());
    const dayNumberText = norm($day.find("span.day__number").first().text());
    if (!monthText || !dayNumberText) return;

    const month = monthMap[monthText] || null;
    const dayNum = parseInt(dayNumberText, 10);
    if (!month || Number.isNaN(dayNum)) return;

    $day.find("ul.events > li").each((__, li) => {
      const $li = $(li);
      const titleText = norm($li.find("span.title").first().text());
      if (!titleText || isUnwantedTitle(titleText)) return;

      let href =
        $li.find("a:has(span.title)").first().attr("href") ||
        $li.find("a").first().attr("href") ||
        "";
      if (href && !/^https?:\/\//i.test(href)) {
        try {
          href = new URL(href, pageUrl).toString();
        } catch {}
      }

      const times = $li
        .find(".performance-time")
        .map((___, tEl) => norm($(tEl).text()))
        .get();
      if (times.length === 0) return;

      for (const timeText of times) {
        const base = `${year}-${String(month).padStart(2, "0")}-${String(
          dayNum
        ).padStart(2, "0")}`;
        const normTime = timeText.toUpperCase().replace(/\s+/g, "");

        let dt = DateTime.fromFormat(`${base} ${normTime}`, "yyyy-MM-dd h:mma", {
          zone: "America/New_York",
        });
        if (!dt.isValid) {
          dt = DateTime.fromFormat(`${base} ${normTime}`, "yyyy-MM-dd ha", {
            zone: "America/New_York",
          });
        }
        if (!dt.isValid) continue;

        const startISO = dt.toUTC().toISO();
        out.push(eventRow("54-below", titleText, startISO, href, pageUrl));
      }
    });
  });
  return out;
}

/**
 * Build month URLs like: https://54below.org/calendar/?month=October+2025
 * and scrape multiple months ahead.
 */
export async function fetch54BelowMonths(baseUrl, monthsAhead = 6) {
  const out = [];
  const start = DateTime.now()
    .setZone("America/New_York")
    .startOf("month");

  for (let i = 0; i < monthsAhead; i++) {
    const dt = start.plus({ months: i });
    // "October 2025" -> "October+2025"
    const monthParam = `${dt.toFormat("LLLL")}+${dt.toFormat("yyyy")}`;
    const url = `${baseUrl}?month=${monthParam}`;

    const res = await fetch(url, {
      headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    out.push(...scrapeOneCalendarPage($, url, dt.year));
  }

  return out;
}
