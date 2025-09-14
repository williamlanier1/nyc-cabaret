import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { uidHash, smartTitleCase, ensureArtistFromTitle } from "../util.mjs";

// Minimal, resilient connector for Laurie Beechman Theatre (slug: beechman)
// Strategy:
// 1) Try common ICS endpoints and parse with node-ical, applying basic normalization
// 2) Fallback to HTML list/calendar at /calendar and scrape time/title/links

const TZ = "America/New_York";
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

const isUnwanted = (s) => {
  const t = (s || "").toString();
  return (
    /live\s*stream/i.test(t) ||
    /livestream/i.test(t) ||
    /virtual/i.test(t) ||
    /on\s*demand/i.test(t) ||
    /cancel+ed?/i.test(t) ||
    /private\s*event/i.test(t) ||
    /\bclosed\b/i.test(t) ||
    /no\s*shows?/i.test(t) ||
    /no\s*performances?/i.test(t) ||
    /\bdark\b/i.test(t)
  );
};

function splitColonOrQuotes(raw) {
  const t0 = norm(raw);
  if (!t0) return { title: t0, artist: null };
  // Artist: Show
  const ci = t0.indexOf(":");
  if (ci > 0) {
    const left = t0.slice(0, ci).trim();
    const right = t0.slice(ci + 1).trim();
    if (left && right) return { title: right, artist: left };
  }
  // Artist "Show"
  const mq = t0.match(/^(.+?)\s*[“\"]([^\"]+)[”\"]/);
  if (mq) {
    const pre = norm(mq[1] || "");
    const inner = norm(mq[2] || "");
    if (inner) return { title: inner.replace(/[“”\"]/g, "").trim(), artist: pre || null };
  }
  // Title only in quotes
  const mq2 = t0.match(/[“\"]([^\"]+)[”\"]/);
  if (mq2) {
    const inner = norm(mq2[1] || "");
    if (inner) return { title: inner.replace(/[“”\"]/g, "").trim(), artist: null };
  }
  return { title: t0, artist: null };
}

function eventRow(venueSlug, rawTitle, startISO, url, sourceUrl) {
  // Normalize, split and infer artist when the title is a solo name
  let cleaned = smartTitleCase(rawTitle);
  let { title, artist } = splitColonOrQuotes(cleaned);
  title = smartTitleCase(title);
  artist = ensureArtistFromTitle(title, artist ? smartTitleCase(artist) : null);

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

async function tryIcs(venueSlug, origin) {
  const candidates = [
    new URL("/?ical=1", origin).toString(),
    new URL("/events/?ical=1", origin).toString(),
    new URL("/calendar/?ical=1", origin).toString(),
    new URL("/calendar.ics", origin).toString(),
  ];
  try {
    const { default: ical } = await import("node-ical");
    for (const icsUrl of candidates) {
      try {
        const text = await fetch(icsUrl).then((r) => r.text());
        if (!/BEGIN:VCALENDAR/i.test(text)) continue;
        const data = await ical.async.parseICS(text);
        const out = [];
        for (const key of Object.keys(data)) {
          const v = data[key];
          if (!v || v.type !== "VEVENT") continue;
          const titleRaw = (v.summary || "Untitled").toString().trim();
          const startISO = new Date(v.start).toISOString();
          if (isUnwanted(titleRaw)) continue;
          // Prefer v.url if present
          const url = v.url || null;
          out.push(eventRow(venueSlug, titleRaw, startISO, url, icsUrl));
        }
        if (out.length > 0) return out;
      } catch {}
    }
  } catch {}
  return [];
}

function parseHtmlList($, pageUrl) {
  const out = [];
  // Generic scan: look for elements that contain a time[datetime] and an anchor/title
  $("article, li, .event, .tribe-events, .tw-event, .artistevents__event").each((_, el) => {
    const $el = $(el);
    const tEl = $el.find("time[datetime]").first();
    const dtAttr = tEl.attr("datetime") || $el.attr("datetime") || "";
    let startISO = null;
    if (dtAttr) {
      const d = new Date(dtAttr);
      if (!isNaN(d.getTime())) startISO = d.toISOString();
    }
    if (!startISO) return;

    let href = $el.find("a[href]").first().attr("href") || "";
    if (href && !/^https?:\/\//i.test(href)) {
      try { href = new URL(href, pageUrl).toString(); } catch {}
    }
    const title = norm(
      $el.find(".event-title, .tribe-events-calendar-list__event-title, h3, h2, .title").first().text() ||
      $el.find("a[href]").first().text()
    );
    if (!title || isUnwanted(title)) return;
    out.push(eventRow("beechman", title, startISO, href, pageUrl));
  });
  return out;
}

export async function fetchBeechman(baseUrl = "https://www.thebeechman.com") {
  const venueSlug = "beechman";
  const origin = new URL(baseUrl).origin;

  // 1) ICS candidates
  const icsEvents = await tryIcs(venueSlug, origin);
  if (icsEvents.length > 0) return icsEvents;

  // 2) HTML calendar/list fallback
  const listUrls = [
    new URL("/calendar", origin).toString(),
    new URL("/events", origin).toString(),
    baseUrl,
  ];
  for (const url of listUrls) {
    try {
      const html = await fetch(url, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" } }).then((r) => r.text());
      const $ = cheerio.load(html);
      const items = parseHtmlList($, url);
      if (items.length > 0) return items;
    } catch {}
  }

  return [];
}

