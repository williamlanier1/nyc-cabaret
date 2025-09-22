import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { uidHash, smartTitleCase, ensureArtistFromTitle } from "../util.mjs";

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};

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

function eventRow(titleRaw, startISO, href, sourceUrl) {
  // Normalize artist/title
  let cleaned = smartTitleCase(titleRaw);
  // Split simple colon or quoted form
  let artist = null;
  let title = cleaned;
  const ci = cleaned.indexOf(":");
  if (ci > 0) {
    const left = cleaned.slice(0, ci).trim();
    const right = cleaned.slice(ci + 1).trim();
    if (left && right) {
      artist = smartTitleCase(left);
      title = smartTitleCase(right);
    }
  }
  if (!artist) artist = ensureArtistFromTitle(title, null);

  return {
    uid_hash: uidHash("joes-pub", titleRaw, startISO),
    title,
    artist,
    venue_slug: "joes-pub",
    start_at: startISO,
    end_at: null,
    url: href || sourceUrl,
    status: "confirmed",
    source_type: "html",
    source_ref: sourceUrl,
  };
}

export async function fetchJoesPubOfficial(baseUrl = "https://publictheater.org/joes-pub") {
  const out = [];
  const candidates = [
    baseUrl,
    "https://publictheater.org/joes-pub/events",
    "https://publictheater.org/joes-pub/season",
    "https://publictheater.org/joes-pub#events",
    // Calendar list view (provided)
    "https://publictheater.org/calendar?programs=2,9",
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      const html = await res.text();
      if (/Just a moment/i.test(html) || /cf-browser-verification/i.test(html)) continue;
      const $ = cheerio.load(html);

      // 1) JSON-LD graph
      $("script[type='application/ld+json']").each((_, el) => {
        try {
          const json = JSON.parse($(el).contents().text());
          const items = Array.isArray(json) ? json : (json?.["@graph"] || [json]);
          for (const node of items) {
            if (!node) continue;
            if ((node['@type'] || node.type) === 'Event' || (Array.isArray(node['@type']) && node['@type'].includes('Event'))) {
              const name = norm(node.name || node.headline || "");
              const start = node.startDate || node.start_date || "";
              let href = node.url || node.mainEntityOfPage || url;
              if (href && !/^https?:\/\//i.test(href)) {
                try { href = new URL(href, url).toString(); } catch {}
              }
              if (name && start && !isUnwanted(name)) {
                const d = new Date(start);
                if (!isNaN(d.getTime())) {
                  out.push(eventRow(name, d.toISOString(), href, url));
                }
              }
            }
          }
        } catch {}
      });

      // 2) Visible schema.org Event items
      $("[itemtype='http://schema.org/Event'], [itemtype='https://schema.org/Event']").each((_, el) => {
        const $el = $(el);
        const name = norm($el.find("[itemprop='name']").first().text() || $el.find(".event-title, h2, h3").first().text());
        const start = $el.find("[itemprop='startDate']").attr("content") || $el.find("[itemprop='startDate']").attr("datetime") || "";
        let href = $el.find("a[href]").first().attr("href") || "";
        if (href && !/^https?:\/\//i.test(href)) {
          try { href = new URL(href, url).toString(); } catch {}
        }
        if (name && start && !isUnwanted(name)) {
          const d = new Date(start);
          if (!isNaN(d.getTime())) out.push(eventRow(name, d.toISOString(), href, url));
        }
      });

      // 3) Generic cards with time text if microdata/JSON-LD missing
      if (out.length === 0) {
        $("article, .event-card, .event, li").each((_, el) => {
          const $el = $(el);
          const name = norm($el.find(".event-title, h2, h3").first().text());
          if (!name || isUnwanted(name)) return;
          // Look for <time datetime> or a time string next to the card
          const dt = $el.find("time[datetime]").attr("datetime") || $el.find("time").attr("datetime") || "";
          let href = $el.find("a[href]").first().attr("href") || "";
          if (href && !/^https?:\/\//i.test(href)) {
            try { href = new URL(href, url).toString(); } catch {}
          }
          if (dt) {
            const d = new Date(dt);
            if (!isNaN(d.getTime())) out.push(eventRow(name, d.toISOString(), href, url));
          }
        });
      }

      // 4) Joe's Pub list view rows (cal-list-event)
      if (out.length === 0) {
        $(".cal-list-event").each((_, el) => {
          const $ev = $(el);
          // Title
          const name = norm($ev.find(".list-event-details h5").first().text());
          if (!name || isUnwanted(name)) return;
          // Href
          let href = $ev.find("a[href]").first().attr("href") || "";
          if (href && !/^https?:\/\//i.test(href)) {
            try { href = new URL(href, url).toString(); } catch {}
          }
          // Year from URL path if present
          const mYear = (href || "").match(/\/(\d{4})\//);
          const year = mYear ? parseInt(mYear[1], 10) : new Date().getFullYear();
          // Date + time text, e.g., "Fri, September 19 | 7:00PM"
          const dtText = norm($ev.find(".list-event-details .cal-list-details-text").first().text());
          // Extract month/day
          const md = dtText.match(/([A-Za-z]+)\s+(\d{1,2})/);
          // Extract time after a pipe or in bold span
          let timeText = null;
          const pipeParts = dtText.split("|");
          if (pipeParts.length > 1) timeText = norm(pipeParts[1]);
          if (!timeText) {
            const bold = $ev.find(".list-event-details .cal-list-details-text .fw-bold").first().text();
            if (bold) timeText = norm(bold.replace(/^\|\s*/, ""));
          }
          if (!md || !timeText) return;
          const monthName = md[1];
          const dayNum = parseInt(md[2], 10);
          if (!monthName || !dayNum) return;
          // Compose datetime in America/New_York
          const dt = DateTime.fromFormat(`${monthName} ${dayNum}, ${year} ${timeText.toUpperCase()}`, "LLLL d, yyyy h:mma", { zone: "America/New_York" });
          if (!dt.isValid) return;
          const startISO = dt.toUTC().toISO();
          out.push(eventRow(name, startISO, href, url));
        });
      }

      // If nothing yet, try list rows common to calendar pages
      if (out.length === 0) {
        $("li, .list-item, .event-list-item").each((_, el) => {
          const $el = $(el);
          const name = norm($el.find("[itemprop='name'], .event-title, h3, h2, a").first().text());
          if (!name || isUnwanted(name)) return;
          const dt = $el.find("time[datetime]").attr("datetime") || "";
          let href = $el.find("a[href]").first().attr("href") || "";
          if (href && !/^https?:\/\//i.test(href)) {
            try { href = new URL(href, url).toString(); } catch {}
          }
          if (dt) {
            const d = new Date(dt);
            if (!isNaN(d.getTime())) out.push(eventRow(name, d.toISOString(), href, url));
          }
        });
      }

      if (out.length > 0) break;
    } catch {}
  }

  return out;
}
