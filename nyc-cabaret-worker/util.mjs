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
  const s = (input || "").trim();
  if (!s) return s;
  // If already has lowercase letters, leave as-is
  if (/[a-z]/.test(s)) return s;

  const small = new Set([
    "a","an","the","and","but","or","nor","as","at","by","for","in","of","on","to","up","via","per","from","with","vs","vs.","de","la"
  ]);
  const acronyms = new Set([
    "nyc","usa","uk","eu","tv","dj","mc","bbq","r&b","rnb","lgbt","lgbtq","u.s.","u.k.","l.a.","d.c.","ny","la"
  ]);

  const titleWord = (word, isFirst, isLast) => {
    if (!word) return word;
    const raw = word;
    const lower = raw.toLowerCase();

    // Preserve acronyms
    const alnumLower = lower.replace(/[^a-z.&]/g, "");
    if (acronyms.has(alnumLower)) return raw.toUpperCase();

    // Small words (unless first/last)
    if (!isFirst && !isLast && small.has(lower)) return lower;

    // Hyphenated: title-case each segment
    return lower
      .split("-")
      .map(seg => (seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg))
      .join("-");
  };

  const parts = s.split(/\s+/);
  const lastIdx = parts.length - 1;
  return parts.map((w, i) => titleWord(w, i === 0, i === lastIdx)).join(" ");
}
