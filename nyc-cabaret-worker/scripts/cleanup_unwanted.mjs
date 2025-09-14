import { supabaseAdmin } from "../supabase.mjs";

const PATTERNS = [
  "%live%stream%",
  "%livestream%",
  "%virtual%",
  "%on demand%",
  "%cancel%",
  "%canceled%",
  "%cancelled%",
  "%private event%",
  "%closed%",
  "%no show%",
  "%no shows%",
  "%no performance%",
  "%no performances%",
  "%dark%",
];

async function run() {
  for (const pat of PATTERNS) {
    const { error } = await supabaseAdmin
      .from("events")
      .delete()
      .or([
        `title.ilike.${pat}`,
        `url.ilike.${pat}`,
        `source_ref.ilike.${pat}`,
      ].join(","));
    if (error) throw error;
  }
  console.log("Cleanup completed");
}

run().catch((e) => {
  console.error("Cleanup error:", e?.message || e);
  process.exit(1);
});
