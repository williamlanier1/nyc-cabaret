import * as cheerio from "cheerio";
import { DateTime } from "luxon";
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
  // strip trailing date suffixes like " 9/2/25" from title portion
  const stripDateSuffix = (s) => s.replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}$/,'').trim();

  // 1) Preferred: Artist: Show
  const colonIdx = t0.indexOf(":");
  if (colonIdx > 0) {
    const left = t0.slice(0, colonIdx).trim();
    let right = t0.slice(colonIdx + 1).trim();
    const extracted = extractArtistFromTitle(t0);
    if (left && right && extracted && extracted.toLowerCase() === left.toLowerCase()) {
      right = stripDateSuffix(right);
      return { title: right, artist: left };
    }
  }

  // 2) Artist "Show Title" — capture inner quotes as title, prefix as artist (if reasonable)
  const mq = t0.match(/^(.+?)\s*[“\"]([^\"]+)[”\"]/);
  if (mq) {
    const pre = norm(mq[1] || "");
    const inner = norm(mq[2] || "");
    if (inner) {
      const artist = pre && pre.length >= 3 ? pre : null;
      return { title: stripDateSuffix(inner.replace(/[“”\"]/g, "").trim()), artist };
    }
  }

  // 3) Title only in quotes: "Just Me"
  const mq2 = t0.match(/[“\"]([^\"]+)[”\"]/);
  if (mq2) {
    const inner = norm(mq2[1] || "");
    if (inner) return { title: stripDateSuffix(inner.replace(/[“”\"]/g, "").trim()), artist: null };
  }

  return { title: stripDateSuffix(t0), artist: extractArtistFromTitle(t0) };
}

function eventRow(venueSlug, rawTitle, startISO, url, sourceUrl) {
  // Normalize quotes first, then split
  let cleaned = smartTitleCase(rawTitle); // strips quotes + handles casing
  let { title, artist } = splitTitleAndArtist(cleaned);
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

function parseMonthHtml($, pageUrl, year) {
  const out = [];
  $("li.eb-calendarDay").each((_, li) => {
    const $li = $(li);
    const header = norm($li.find("div.date.day_cell").first().text());
    // Header like: "Tuesday, September 2"
    let monthIndex = null, dayNum = null;
    const mh = header.match(/([A-Za-z]+)\s+(\d{1,2})$/);
    if (mh) {
      const monthName = mh[1];
      dayNum = parseInt(mh[2], 10);
      try { monthIndex = DateTime.fromFormat(monthName, "LLLL").month; } catch {}
    }
    if (!monthIndex || !dayNum) return;

    $li.find("a.eb_event_link").each((__, aEl) => {
      const $a = $(aEl);
      const titleText = norm($a.attr("title") || $a.text());
      const wholeText = norm($li.text());
      if (!titleText || isUnwantedText(titleText) || isUnwantedText(wholeText)) return;

      let href = $a.attr("href") || "";
      if (href && !/^https?:\/\//i.test(href)) {
        try { href = new URL(href, pageUrl).toString(); } catch {}
      }
      if (isUnwantedText(href)) return;

      const timeText = norm($a.find(".eb-calendar-event-time").first().text()); // e.g., 7:00 pm
      if (!timeText) return;

      const base = `${year}-${String(monthIndex).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      let dt = DateTime.fromFormat(`${base} ${timeText}`, "yyyy-MM-dd h:mm a", { zone: TZ });
      if (!dt.isValid) dt = DateTime.fromFormat(`${base} ${timeText}`, "yyyy-MM-dd h a", { zone: TZ });
      if (!dt.isValid) return;

      const startISO = dt.toUTC().toISO();
      out.push(eventRow("dont-tell-mama", titleText, startISO, href, pageUrl));
    });
  });
  return out;
}

export async function fetchDontTellMamaMonths(baseUrl = "https://shows.donttellmamanyc.com/", monthsAhead = 6) {
  const out = [];
  const start = DateTime.now().setZone(TZ).startOf("month");

  for (let i = 0; i < monthsAhead; i++) {
    const dt = start.plus({ months: i });
    const url = `${baseUrl}?month=${dt.month}&year=${dt.year}`;
    const res = await fetch(url, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" }});
    const html = await res.text();
    const $ = cheerio.load(html);
    const monthEvents = parseMonthHtml($, url, dt.year);
    out.push(...monthEvents);
  }

  return out;
}
