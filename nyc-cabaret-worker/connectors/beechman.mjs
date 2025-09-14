import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { uidHash } from "../util.mjs";

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

function monthYearFromText(text) {
  const t = norm(text);
  if (!t) return null;
  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  const lower = t.toLowerCase();
  const month = months.find((m) => lower.includes(m.toLowerCase()));
  const yearMatch = t.match(new RegExp("\\b(\\d{4})\\b"));
  if (!month || !yearMatch) return null;
  const year = parseInt(yearMatch[1], 10);
  return { month, year };
}

function findCalendarMonthYear($) {
  // Try common places a month-year appears
  const selectors = [
    "h1", "h2", "header h1", ".calendar-title", ".CalendarTitle", ".page-title",
  ];
  for (const sel of selectors) {
    const txt = norm($(sel).first().text());
    const my = monthYearFromText(txt);
    if (my) return my;
  }
  return null;
}

function eventRow(venueSlug, title, startISO, url, sourceUrl, artist = null) {
  return {
    uid_hash: uidHash(venueSlug, title, startISO),
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

async function fetchArtistFromDetail(detailUrl) {
  try {
    const res = await fetch(detailUrl, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" }});
    const html = await res.text();
    const $ = cheerio.load(html);

    // Heuristics: try specific fields first, then fallback to title patterns
    const candidates = [
      ".artist", ".event-artist", "[itemprop=performer]",
      "meta[name='author']", "meta[property='og:title']",
      ".tribe-events-single-event-title", ".event-header .artist",
    ];
    for (const sel of candidates) {
      const el = $(sel).first();
      if (!el.length) continue;
      const val = el.attr("content") || el.text();
      if (val && norm(val).length >= 2) return norm(val);
    }

    // Fallback: sometimes page title includes artist — e.g. "Jane Doe: Show Title"
    const title = norm($("title").first().text());
    let m = title.match(/^(.{3,}?)\s*[:\-\u2014]\s+.+/);
    if (m && m[1]) return norm(m[1]);
    const h1 = norm($("h1").first().text());
    m = h1.match(/^(.{3,}?)\s*[:\-\u2014]\s+.+/);
    if (m && m[1]) return norm(m[1]);
  } catch {}
  return null;
}

function parseTimeToISO(baseY, baseM, baseD, timeText) {
  const normTime = norm(timeText).toUpperCase();
  const base = `${baseY}-${String(baseM).padStart(2, "0")}-${String(baseD).padStart(2, "0")}`;
  let dt = DateTime.fromFormat(`${base} ${normTime}`, "yyyy-MM-dd h:mma", { zone: "America/New_York" });
  if (!dt.isValid) dt = DateTime.fromFormat(`${base} ${normTime}`, "yyyy-MM-dd ha", { zone: "America/New_York" });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
}

function scrapeMonthPage($, pageUrl, fallbackMY) {
  const out = [];
  const monthYear = findCalendarMonthYear($) || fallbackMY; // { month, year }
  const monthIndex = monthYear ? DateTime.fromFormat(monthYear.month, "LLLL").month : null;
  const yearNum = monthYear ? monthYear.year : null;

  // Try to find day groupings with dates
  let dayCells = 0;
  $("[data-day],[data-date], .day, .calendar-day, .fc-daygrid-day, .tribe-events-calendar-month__day").each((_, dayEl) => {
    dayCells++;
    const $day = $(dayEl);
    // Extract a day number (1-31)
    let dayNum = null;
    const dataDate = $day.attr("data-date") || ""; // e.g., 2025-09-14
    const dayText = norm($day.attr("data-day") || dataDate || $day.find(".day-number, .date, .daynum").first().text());
    const m = dayText.match(/\b(\d{1,2})\b/);
    if (m) dayNum = parseInt(m[1], 10);
    let baseY = null, baseM = null, baseD = null;
    const mYMD = (dataDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mYMD) {
      baseY = parseInt(mYMD[1], 10);
      baseM = parseInt(mYMD[2], 10);
      baseD = parseInt(mYMD[3], 10);
    }

    // Fallback: look for a time tag with full datetime
    const $events = $day.find("a, article, li, .event, .event-item, .fc-event");
    $events.each((__, ev) => {
      const $ev = $(ev);
      // Link + title
      const a = $ev.is("a") ? $ev : $ev.find("a[href]").first();
      let href = a.attr("href") || "";
      if (href && !/^https?:\/\//i.test(href)) {
        try { href = new URL(href, pageUrl).toString(); } catch {}
      }
      const title = norm($ev.find(".event-title, .title, h3, h2, .fc-event-title").first().text() || a.text());
      if (!href || !title) return;

      // Datetime via <time datetime="...">
      const t = $ev.find("time[datetime]").attr("datetime") || $ev.attr("datetime") || a.find("time[datetime]").attr("datetime");
      let startISO = null;
      if (t) {
        const d = new Date(t);
        if (!isNaN(d.getTime())) startISO = d.toISOString();
      }

      // If we only have a textual time on the card, combine with day/month/year
      if (!startISO) {
        // Pull time text from common locations or from the full element text
        let timeText = $ev.find("time").first().text() || $ev.find(".time, .event-time, .fc-event-time").first().text() || a.find("time").first().text();
        if (!timeText) {
          const txt = norm($ev.text());
          const mt = txt.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
          if (mt) timeText = mt[0];
        }

        if (timeText) {
          // Prefer exact Y-M-D from data-date; else use month/year + day number
          if (baseY && baseM && baseD) {
            startISO = parseTimeToISO(baseY, baseM, baseD, timeText);
          } else if (monthIndex && yearNum && dayNum) {
            startISO = parseTimeToISO(yearNum, monthIndex, dayNum, timeText);
          }
        }
      }

      if (!startISO) return; // can't schedule without a datetime

      out.push({ title, href, startISO });
    });
  });

  console.log(`[Beechman] scrapeMonthPage: dayCells=${dayCells}, items=${out.length}, url=${pageUrl}`);

  // If the above found nothing, try a flat list approach as a fallback
  if (out.length === 0) {
    $("article, li, .event, .event-card, .fc-event").each((_, el) => {
      const $el = $(el);
      const a = $el.is("a") ? $el : $el.find("a[href]").first();
      let href = a.attr("href") || "";
      if (href && !/^https?:\/\//i.test(href)) {
        try { href = new URL(href, pageUrl).toString(); } catch {}
      }
      const title = norm($el.find(".event-title, .title, h3, h2, .fc-event-title").first().text() || a.text());
      const dt = $el.find("time[datetime]").attr("datetime");
      if (!href || !title || !dt) return;
      const d = new Date(dt);
      if (isNaN(d.getTime())) return;
      out.push({ title, href, startISO: d.toISOString() });
    });
    console.log(`[Beechman] fallback flat list: items=${out.length}, url=${pageUrl}`);
  }

  return out;
}

export async function fetchBeechmanMonths(baseUrl, monthsAhead = 3) {
  const venueSlug = "the-beechman"; // Update if your venues.slug differs
  const out = [];

  let url = baseUrl;
  let fallbackMY = null;

  for (let i = 0; i < monthsAhead; i++) {
    const res = await fetch(url, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" }});
    const html = await res.text();
    const $ = cheerio.load(html);

    const monthEvents = scrapeMonthPage($, url, fallbackMY);

    for (const ev of monthEvents) {
      const artist = await fetchArtistFromDetail(ev.href);
      out.push(
        eventRow(venueSlug, ev.title, ev.startISO, ev.href, url, artist)
      );
    }

    // Find "next month" link, try common patterns; stop if none
    const nextSel = [
      "a[rel=next]", "a[aria-label*='Next']", "a.next", "a:contains('Next')"
    ];
    let nextUrl = null;
    for (const sel of nextSel) {
      const a = $(sel).first();
      if (a && a.attr("href")) { nextUrl = a.attr("href"); break; }
    }
    if (nextUrl) {
      try { url = new URL(nextUrl, url).toString(); }
      catch { url = nextUrl; }
    } else {
      break;
    }

    // Provide a fallback month/year for the next page if headings are sparse
    if (!fallbackMY) fallbackMY = findCalendarMonthYear($);
  }

  if (out.length > 0) return out;

  // Fallback 1: try list view at /events/ (server-rendered for many WP sites)
  try {
    const origin = new URL(baseUrl).origin;
    const listUrl = new URL("/events/", origin).toString();
    const res = await fetch(listUrl, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" }});
    const html = await res.text();
    const $ = cheerio.load(html);

    const items = new Set();
    $("a[href*='/events/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const title = norm($(a).text());
      const dt = $(a).find("time[datetime]").attr("datetime") || $(a).closest("article,li,div").find("time[datetime]").attr("datetime");
      if (!href || !title || !dt) return;
      const d = new Date(dt);
      if (isNaN(d.getTime())) return;
      let abs = href;
      if (abs && !/^https?:\/\//i.test(abs)) {
        try { abs = new URL(abs, listUrl).toString(); } catch {}
      }
      items.add(JSON.stringify({ title, href: abs, startISO: d.toISOString() }));
    });

    for (const s of items) {
      const ev = JSON.parse(s);
      const artist = await fetchArtistFromDetail(ev.href);
      out.push(eventRow(venueSlug, ev.title, ev.startISO, ev.href, listUrl, artist));
    }
    console.log(`[Beechman] list view items=${out.length}, url=${listUrl}`);
  } catch (e) {
    console.warn("[Beechman] list view fetch failed", e?.message || e);
  }

  if (out.length > 0) return out;

  // Fallback 2: try common ICS endpoints
  try {
    const origin = new URL(baseUrl).origin;
    const candidates = [
      new URL("/events/?ical=1", origin).toString(),
      new URL("/calendar/?ical=1", origin).toString(),
      new URL("/?ical=1", origin).toString(),
      new URL("/calendar.ics", origin).toString(),
    ];
    for (const icsUrl of candidates) {
      try {
        const res = await fetch(icsUrl, { headers: { "user-agent": "nyc-cabaret-bot/1.0 (+contact)" }});
        const text = await res.text();
        if (text && /BEGIN:VCALENDAR/i.test(text)) {
          // Lazy import to avoid circular import; duplicate small ICS logic inline
          const { default: ical } = await import("node-ical");
          const data = await ical.async.fromURL(icsUrl);
          for (const key of Object.keys(data)) {
            const v = data[key];
            if (v.type !== "VEVENT") continue;
            const title = (v.summary || "Untitled").toString().trim();
            const startISO = new Date(v.start).toISOString();
            const endISO = v.end ? new Date(v.end).toISOString() : null;
            out.push({
              uid_hash: uidHash(venueSlug, title, startISO),
              title,
              artist: null,
              venue_slug: venueSlug,
              start_at: startISO,
              end_at: endISO,
              url: v.url || icsUrl,
              status: (v.status || "confirmed").toLowerCase(),
              source_type: "ics",
              source_ref: icsUrl,
            });
          }
          console.log(`[Beechman] ICS import via ${icsUrl}: ${out.length} events`);
          break;
        }
      } catch {}
    }
  } catch {}

  return out;
}
