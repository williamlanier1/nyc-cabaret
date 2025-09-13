import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
// filepath: /Users/willlanier/nyc-cabaret/app/api/calendar/[slug]/route.ts
import { buildIcs, type DbEvent } from "../../../../lib/db";

type RouteParams = { slug: string };

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

  const nowIso = new Date().toISOString();
  let calendarName = "NYC Cabaret — All Venues";
  let rows: DbEvent[] = [];

  if (slug === "all") {
    const { data, error } = await supa
      .from("events")
      .select("id,title,artist,start_at,end_at,url,status,tz,venue_id")
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
      .select("id,title,artist,start_at,end_at,url,status,tz,venue_id")
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

  const ics = buildIcs(rows, calendarName);
  const fileName = slug === "all" ? "all.ics" : `${slug}.ics`;

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
