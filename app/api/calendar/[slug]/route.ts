export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildIcs, type DbEvent } from "@/lib/db"; // using tsconfig alias

function supabaseServer() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase envs: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL and SUPABASE_ANON_KEY)"
    );
  }
  return createClient(url, key);
}

export async function GET(req: Request, context: any) {
  const supa = supabaseServer();
  const slug = context?.params?.slug as string;
  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "ics").toLowerCase();

  const nowIso = new Date().toISOString();
  let calendarName = "NYC Cabaret — All Venues";
  let rows: DbEvent[] = [];

  if (slug === "all") {
    const { data, error } = await supa
      .from("events")
      .select("id,title,artist,start_at,end_at,url,status,tz,venue_id, venue:venues (slug,name)")
      .gte("start_at", nowIso)
      .order("start_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to load events", details: String(error.message ?? error) },
        { status: 500 }
      );
    }
    rows = (data ?? []) as DbEvent[];
  } else {
    const { data: venue, error: vErr } = await supa
      .from("venues")
      .select("id,name,slug")
      .eq("slug", slug)
      .single();

    if (vErr || !venue) {
      return NextResponse.json(
        { error: `Unknown venue slug: ${slug}` },
        { status: 404 }
      );
    }

    calendarName = `NYC Cabaret — ${venue.name}`;

    const { data, error } = await supa
      .from("events")
      .select("id,title,artist,start_at,end_at,url,status,tz,venue_id, venue:venues (slug,name)")
      .eq("venue_id", venue.id)
      .gte("start_at", nowIso)
      .order("start_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to load events", details: String(error.message ?? error) },
        { status: 500 }
      );
    }
    rows = (data ?? []) as DbEvent[];
  }

  // 👇 Debug helper: return JSON if format=json
  if (format === "json") {
    return NextResponse.json({ count: rows.length, rows }, { status: 200 });
  }

  // Default: return ICS
  const ics = buildIcs(rows, calendarName);
  const fileName = `${slug}.ics`;
  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
