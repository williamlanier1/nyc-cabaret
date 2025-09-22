import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase admin environment variables. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE."
    );
  }

  return createClient(url, serviceKey);
}
