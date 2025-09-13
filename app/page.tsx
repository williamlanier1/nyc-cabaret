"use client";

import { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";

// ---------- types ----------
type Venue = {
  id: string;
  slug: string;
  name: string;
};

type DbEvent = {
  id?: string;
  title: string;
  artist: string | null;
  start_at: string; // ISO (UTC from worker)
  end_at: string | null;
  url: string | null;
  status?: string | null;
  venue_id: string; // FK to venues.id
};

type FCEvent = {
  title: string;
  start: string;
  end?: string;
  url?: string;
  extendedProps: {
    artist?: string | null;
    venueSlug: string;
    venueName: string;
  };
};

// ---------- simple design config ----------
const VENUE_STYLES: Record<
  string,
  { color: string; bg: string; label?: string }
> = {
  // add new venues here as you scrape them
  "54-below": { color: "#9b2226", bg: "#fdecec", label: "54 Below" },

  // examples / placeholders for later:
  // "joes-pub": { color: "#005f73", bg: "#e6f2f4", label: "Joe’s Pub" },
  // "green-room-42": { color: "#5a189a", bg: "#f1e8fb", label: "The Green Room 42" },
};

// ---------- tiny ui helpers ----------
const button = {
  base: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 600 as const,
  },
  solid: { background: "black", color: "white" },
  outline: { background: "transparent", color: "black", border: "1px solid #000" },
};

const cardStyle: React.CSSProperties = {
  background: "#fafafa",
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 16,
};

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [events, setEvents] = useState<DbEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [venueFilter, setVenueFilter] = useState<string>("all");

  // Build ICS links
  const { icsAll, webcalAll } = useMemo(() => {
    const path = "/api/calendar/all.ics";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const httpUrl = origin ? `${origin}${path}` : path;
    return {
      icsAll: path,
      webcalAll: httpUrl.replace(/^https?:/, "webcal:"),
    };
  }, []);

  // Load venues + upcoming events (from today forward)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const supa = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // 1) venues
        const { data: vData, error: vErr } = await supa
          .from("venues")
          .select("id,slug,name")
          .order("name", { ascending: true });

        if (vErr) throw vErr;

        // 2) events (upcoming only)
        const { data: eData, error: eErr } = await supa
          .from("events")
          .select("id,title,artist,start_at,end_at,url,status,venue_id")
          .gte("start_at", new Date().toISOString())
          .order("start_at", { ascending: true });

        if (eErr) throw eErr;

        if (!cancelled) {
          setVenues(vData || []);
          setEvents(eData || []);
        }
      } catch (err) {
        console.error("Failed to load data", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Map: venue_id -> { slug, name }
  const venueMap = useMemo(() => {
    const m = new Map<string, { slug: string; name: string }>();
    for (const v of venues) m.set(v.id, { slug: v.slug, name: v.name });
    return m;
  }, [venues]);

  // Transform DB events -> FullCalendar events with nice labels
  const fcEvents: FCEvent[] = useMemo(() => {
    const filtered =
      venueFilter === "all"
        ? events
        : events.filter((e) => venueMap.get(e.venue_id)?.slug === venueFilter);

    return filtered.map((e) => {
      const v = venueMap.get(e.venue_id);
      const venueSlug = v?.slug || "unknown";
      const venueName = v?.name || "Venue";

      return {
        title: e.artist ? `${e.artist} — ${e.title}` : e.title,
        start: e.start_at,
        end: e.end_at || undefined,
        url: e.url || undefined,
        extendedProps: {
          artist: e.artist,
          venueSlug,
          venueName,
        },
      };
    });
  }, [events, venueFilter, venueMap]);

  // Custom renderer for each list item
  function renderEventContent(arg: any) {
    const { event } = arg;
    const { venueSlug, venueName } = event.extendedProps as {
      venueSlug: string;
      venueName: string;
    };
    const styles = VENUE_STYLES[venueSlug] || {
      color: "#444",
      bg: "#f3f3f3",
      label: venueName,
    };
    const label = styles.label || venueName;

    // FullCalendar list view already shows the time in a left column.
    // Here we render a clean line with a venue badge + title.
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 700,
            padding: "4px 8px",
            borderRadius: 999,
            color: styles.color,
            background: styles.bg,
            border: `1px solid ${styles.color}20`,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            whiteSpace: "nowrap",
          }}
        >
          {/* little dot */}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: styles.color,
              display: "inline-block",
            }}
          />
          {label}
        </span>

        <span style={{ fontWeight: 600 }}>
          {event.title}
        </span>
      </div>
    );
  }

  // Build the venue filter choices (optional, can ignore for now)
  const venueOptions = useMemo(() => {
    const known = venues
      .map((v) => ({
        slug: v.slug,
        name: v.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [{ slug: "all", name: "All venues" }, ...known];
  }, [venues]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>NYC Cabaret — Upcoming</h1>
          <p style={{ margin: "6px 0 0 0", color: "#666" }}>
            Unified list across venues. Click any item to open details/tickets.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a
            href={icsAll}
            style={{ ...button.base, ...button.solid }}
            title="Download an ICS file with all venues"
          >
            Download .ics (All)
          </a>
          <a
            href={webcalAll}
            style={{ ...button.base, ...button.outline }}
            title="Subscribe in Apple Calendar or other calendar apps"
          >
            Subscribe (All)
          </a>
        </div>
      </div>

      {/* Controls row (optional) */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: 14, color: "#444" }}>
          Venue:
          <select
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
            style={{
              marginLeft: 8,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
            }}
          >
            {venueOptions.map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Calendar */}
      {loading ? (
        <div style={cardStyle}>Loading events…</div>
      ) : fcEvents.length === 0 ? (
        <div style={cardStyle}>No upcoming events yet.</div>
      ) : (
        <FullCalendar
          plugins={[listPlugin, interactionPlugin]}
          initialView="listMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "listMonth", // we stick to List for clarity; you can add "dayGridMonth"
          }}
          height="auto"
          events={fcEvents}
          eventContent={renderEventContent}
          eventTimeFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
          noEventsContent="No events for this period."
          eventClick={(info) => {
            // Allow link to open in new tab
            if (info.event.url) window.open(info.event.url, "_blank");
          }}
        />
      )}
    </div>
  );
}
