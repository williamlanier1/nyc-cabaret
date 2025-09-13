export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { createEvents, EventAttributes } from "ics";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function toParts(d: Date) {
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ] as const;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const slug = params.slug || "all";

    let query = supabase
      .from("events")
      .select(
        `
        uid_hash, title, artist, start_at, end_at, url, status,
        venue:venues(name, slug)
      `
      )
      .gte("start_at", new Date().toISOString())
      .order("start_at", { ascending: true });

    if (slug !== "all") query = query.eq("venue.slug", slug);

    const { data, error } = await query;
    if (error) {
      console.error("Supabase error:", error);
      return new NextResponse("DB error", { status: 500 });
    }

    const rows = (data ?? []).map((e: any) => ({
      ...e,
      venue_name: e.venue?.name ?? "",
      venue_slug: e.venue?.slug ?? "",
    }));

    // Build ICS events defensively
    const icsEvents: EventAttributes[] = [];
    for (const e of rows) {
      // Validate & sanitize
      const start = new Date(e.start_at);
      if (isNaN(start.getTime())) {
        console.warn("Skipping event with bad start_at:", e);
        continue;
      }
      const end = e.end_at ? new Date(e.end_at) : new Date(start.getTime() + 90 * 60 * 1000);
      if (isNaN(end.getTime())) {
        console.warn("Fixing bad end_at by defaulting:", e);
      }

      const title = (e.title ?? "").toString().trim();
      if (!title) {
        console.warn("Skipping event with empty title:", e);
        continue;
      }

      const status =
        (e.status ?? "confirmed").toString().toUpperCase() === "CANCELED"
          ? "CANCELLED"
          : "CONFIRMED";

      icsEvents.push({
        uid: `${e.uid_hash || `${e.venue_slug}-${start.toISOString()}`}@nyc-cabaret`,
        title,
        description: [e.artist, e.url].filter(Boolean).join("\n"),
        location: e.venue_name || undefined,
        startInputType: "utc",
        start: toParts(start),
        end: toParts(end),
        status,
        url: e.url || undefined,
        productId: "nyc-cabaret-ics",
      });
    }

    // If no events, return a valid empty calendar
    if (icsEvents.length === 0) {
      // Minimal VCALENDAR when empty (ics lib can error on truly empty input)
      const empty =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//nyc-cabaret//NONSGML v1.0//EN\r\nEND:VCALENDAR\r\n";
      return new NextResponse(empty, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `inline; filename="${slug}.ics"`,
          "Cache-Control": "s-maxage=300, stale-while-revalidate",
        },
      });
    }

    const { error: icsError, value } = createEvents(icsEvents);
    if (icsError) {
      console.error("ICS generation error:", icsError);
      return new NextResponse("ICS generation error", { status: 500 });
    }

    return new NextResponse(value!, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${slug}.ics"`,
        "Cache-Control": "s-maxage=900, stale-while-revalidate",
      },
    });
  } catch (e) {
    console.error("Route error:", e);
    return new NextResponse("Internal error", { status: 500 });
  }
}
