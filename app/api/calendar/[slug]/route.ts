import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildIcs, type DbEvent } from "@/lib/db";

// Route params type (App Router)
type RouteParams = { slug: string };

// Build a server-side Supabase client (reads public data)
function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

export async function GET(
  _req: Request,
  context: { params: RouteParams }
) {
  const slug = context.params.slug;
  const supa = supabaseServer();

  // Calendar name (for ICS header)
  let calendarName = "NYC Cabaret — All Venues";

  // Load events (upcoming only)
  const nowIso = new Date().toISOString();
  let rows: DbEvent[] = [];

  if (slug === "all") {
    const { data, error } = await supa
      .from("events")
      .select(
        "id,title,artist,start_at,end_at,url,status,tz,venue_id"
      )
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
    // Find venue by slug to get its id & name
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
      .select(
        "id,title,artist,start_at,end_at,url,status,tz,venue_id"
      )
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

  // Build ICS
  const ics = buildIcs(rows, calendarName);

  // Name the file (e.g., "54-below.ics" or "all.ics")
  const fileName = `${slug}.ics`;

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "public, max-age=300", // 5 min
    },
  });
}
