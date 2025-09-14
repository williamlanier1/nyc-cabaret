import crypto from "node:crypto";

// Stable unique ID so updates overwrite instead of duplicating
export function uidHash(venueSlug, title, startISO) {
  return crypto
    .createHash("sha1")
    .update(`${venueSlug}|${title}|${startISO}`)
    .digest("hex");
}

// Convert ALL-CAPS strings to Title Case while preserving acronyms.
export function smartTitleCase(input) {
  let s = (input || "").trim();
  if (!s) return s;

  // Strip surrounding straight/smart quotes
  s = s.replace(/^["'“”‘’`\s]+/, "").replace(/["'“”‘’`\s]+$/, "");
  if (!s) return s;

  const small = new Set([
    "a","an","the","and","but","or","nor","as","at","by","for","in","of","on","to","up","via","per","from","with","vs","vs.","de","la"
  ]);
  const acronyms = new Set([
    "nyc","usa","uk","eu","tv","dj","mc","bbq","r&b","rnb","lgbt","lgbtq","u.s.","u.k.","l.a.","d.c.","ny","la"
  ]);

  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);

  // Helper to title-case a single word (handles hyphens)
  const titleWord = (word, isFirst, isLast) => {
    if (!word) return word;
    const raw = word;
    const lower = raw.toLowerCase();
    const alnumLower = lower.replace(/[^a-z.&]/g, "");
    if (acronyms.has(alnumLower)) return raw.toUpperCase();
    if (!isFirst && !isLast && small.has(lower)) return lower;
    return lower
      .split("-")
      .map((seg) => (seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg))
      .join("-");
  };

  // ALL-CAPS -> full title case
  if (!hasLower && hasUpper) {
    const parts = s.split(/\s+/);
    const lastIdx = parts.length - 1;
    return parts.map((w, i) => titleWord(w, i === 0, i === lastIdx)).join(" ");
  }

  // Otherwise, preserve existing casing but ensure the first alphabetical char is uppercase
  const idx = s.search(/[A-Za-z]/);
  if (idx === -1) return s; // no letters
  return s.slice(0, idx) + s.charAt(idx).toUpperCase() + s.slice(idx + 1);
}

// Heuristic: detect if a title looks like a solo person name (useful to set artist when title has only the name)
function isLikelySoloName(title) {
  const t = (title || "").trim();
  if (!t) return false;
  if (/\d/.test(t)) return false; // no digits
  if (/[":]/.test(t)) return false; // skip if quotes/colon present
  const bad = /( at | with | presents | show\b| band\b| trio\b| quartet\b| orchestra\b| comedy\b| cabaret\b)/i;
  if (bad.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  // All words mostly alphabetic/apostrophes/periods, and start with a letter
  for (const w of words) {
    if (!/^[A-Za-z][A-Za-z'.-]*$/.test(w)) return false;
  }
  return true;
}

// If artist is missing and title looks like a solo name, use the title as artist.
export function ensureArtistFromTitle(title, artist) {
  if (artist && String(artist).trim().length > 0) return artist;
  return isLikelySoloName(title) ? title : null;
}
