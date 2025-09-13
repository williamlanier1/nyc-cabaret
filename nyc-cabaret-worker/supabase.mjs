import { createClient } from "@supabase/supabase-js";

// Named export: supabaseAdmin
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);
