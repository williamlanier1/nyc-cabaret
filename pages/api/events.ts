import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const supa = createClient(supabaseUrl, supabaseAnon);

    const nowIso = new Date().toISOString();
    const { data, error } = await supa
      .from("events")
      .select("id,title,artist,start_at,end_at,url,status,venue_id")
      .gte("start_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(10);

    if (error) {
      return res.status(500).json({ error: String(error.message ?? error) });
    }

    return res.status(200).json({ count: data?.length ?? 0, rows: data ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
}
