import crypto from "node:crypto";

// Stable unique ID so updates overwrite instead of duplicating
export function uidHash(venueSlug, title, startISO) {
  return crypto
    .createHash("sha1")
    .update(`${venueSlug}|${title}|${startISO}`)
    .digest("hex");
}
