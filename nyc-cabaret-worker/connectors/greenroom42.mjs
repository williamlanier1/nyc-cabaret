import { chromium } from "playwright";
import { DateTime } from "luxon";
import { uidHash, smartTitleCase, ensureArtistFromTitle } from "../util.mjs";

// The Green Room 42's calendar isn't a fetchable JSON/ICS feed like the other
// venues -- it's a Vue app (VenueTix ticketing platform) that streams event
// data out of Firestore over a real-time connection, so there's no plain
// HTTP request to grab. But the rendered page itself is stable, public HTML
// once the JS runs, so instead of reverse-engineering VenueTix's private
// Firestore schema, this connector opens the page in a headless browser and
// reads the event cards straight off the DOM.

const TZ = "America/New_York";
const EVENTS_URL = "https://thegreenroom42.venuetix.com/";

// Selectors confirmed against the live site (a Vuetify-based Vue app) —
// each event card is a ".v-card.custom-card" with a fixed internal layout:
// a date/time line, an optional "eyebrow" line, a title, a subtitle, and a
// price. The site renders two copies of each card (one per responsive
// breakpoint) and hides one with CSS, so results must be filtered to
// visible cards only.
const CARD_SEL = ".v-card.custom-card";
const DATE_SEL = ".fw-5.fs-16.fc-white.lh-24";
const TITLE_SEL = ".fc-black.fs-24.fw-6.lh-32.text-truncate";
const SUBTITLE_SEL = ".fs-14.fw-4.lh-20.text-truncate";

// Card dates come as "Jul 25, 7:00 PM" with no year. Assume the current
// year; if that lands the date more than ~2 months in the past relative to
// now, assume the feed actually meant next year (handles a scrape running
// in, say, December and seeing a January show).
function parseCardDateTime(raw, referenceNow) {
  if (!raw) return null;
  const ref = referenceNow || DateTime.now().setZone(TZ);
  let dt = DateTime.fromFormat(`${raw} ${ref.year}`, "MMM d, h:mm a yyyy", { zone: TZ });
  if (!dt.isValid) return null;
  if (dt < ref.minus({ months: 2 })) dt = dt.plus({ years: 1 });
  return dt;
}

// The card's "title" slot and its "eyebrow" line map onto (title, artist)
// inconsistently from show to show. Sometimes the title slot IS a person's
// name and the real show title is the subtitle underneath it (e.g.
// title="Adrianna Hicks", subtitle="Oh The Places You'll Go!"). Other times
// the title is already the show name and the eyebrow above it is a "NAME's"
// possessive attribution. Reuse the same solo-name heuristic every other
// connector uses (via ensureArtistFromTitle) to detect the first case, and
// fall back to parsing the eyebrow's possessive form for the second.
function deriveTitleArtist(eyebrowRaw, titleRaw, subtitleRaw) {
  const title0 = smartTitleCase(titleRaw || "Untitled");
  const maybeArtist = ensureArtistFromTitle(title0, null);
  if (maybeArtist === title0) {
    const realTitle = subtitleRaw ? smartTitleCase(subtitleRaw) : title0;
    return { title: realTitle, artist: title0 };
  }
  const m = (eyebrowRaw || "").trim().match(/^(.+?)[’'`]s$/);
  const artist = m ? smartTitleCase(m[1]) : null;
  return { title: title0, artist };
}

export async function fetchGreenRoom42(maxShowMoreClicks = 8) {
  const venueSlug = "green-room-42";
  const out = [];
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage({
      userAgent: "nyc-cabaret-bot/1.0 (+contact)",
    });
    await page.goto(EVENTS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(CARD_SEL, { timeout: 20000 });

    // The list starts with ~9 events and grows each time "Show more" is
    // clicked (client-side, backed by Firestore -- not a fetchable REST
    // endpoint). Keep clicking to pull in a few months forward, stopping
    // once the button disappears or the visible card count stops growing.
    let prevCount = 0;
    for (let i = 0; i < maxShowMoreClicks; i++) {
      const visibleNow = (await page.$$(CARD_SEL + ":visible")).length;
      if (i > 0 && visibleNow === prevCount) break;
      prevCount = visibleNow;

      const showMore = page.getByText("Show more", { exact: true }).first();
      const isVisible = await showMore.isVisible().catch(() => false);
      if (!isVisible) break;
      await showMore.click().catch(() => {});
      await page.waitForTimeout(1200);
    }

    const now = DateTime.now().setZone(TZ);
    const cardEls = await page.$$(CARD_SEL + ":visible");
    const seen = new Set();

    for (const card of cardEls) {
      const dateRaw = await card.$eval(DATE_SEL, (el) => el.textContent.trim()).catch(() => null);
      const titleRaw = await card.$eval(TITLE_SEL, (el) => el.textContent.trim()).catch(() => null);
      const subtitleRaw = await card
        .$eval(SUBTITLE_SEL, (el) => el.textContent.trim())
        .catch(() => null);
      // The eyebrow is the lone plain ".text-truncate" element that isn't
      // the title or subtitle (both of which carry extra sizing classes).
      const eyebrowRaw = await card
        .$$eval(
          ".text-truncate",
          (els, titleText, subtitleText) => {
            const el = els.find(
              (e) => e.textContent.trim() !== titleText && e.textContent.trim() !== subtitleText
            );
            return el ? el.textContent.trim() : null;
          },
          titleRaw,
          subtitleRaw
        )
        .catch(() => null);

      if (!dateRaw || !titleRaw) continue;
      const dt = parseCardDateTime(dateRaw, now);
      if (!dt) continue;
      const startISO = dt.toUTC().toISO();

      const dedupeKey = `${dateRaw}|${titleRaw}|${subtitleRaw || ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const { title, artist } = deriveTitleArtist(eyebrowRaw, titleRaw, subtitleRaw);

      out.push({
        // Hash the raw eyebrow+title text (not the derived display title),
        // same convention the ICS connector uses, so future refinements to
        // deriveTitleArtist don't orphan existing rows as new duplicates.
        uid_hash: uidHash(venueSlug, `${eyebrowRaw || ""}|${titleRaw}`, startISO),
        title,
        artist,
        venue_slug: venueSlug,
        start_at: startISO,
        end_at: null,
        url: EVENTS_URL,
        status: "confirmed",
        source_type: "headless-dom",
        source_ref: EVENTS_URL,
      });
    }
  } finally {
    await browser.close();
  }

  return out;
}
