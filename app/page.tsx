"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import listPlugin from "@fullcalendar/list";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { supabase } from "../lib/supabase-client";

type Row = {
  title: string;
  start_at: string;
  end_at?: string | null;
  url?: string | null;
  venue?: { name?: string | null } | null;
};

export default function HomePage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("events")
        .select(`
          title, start_at, end_at, url,
          venue:venues(name)
        `)
        .gte("start_at", new Date().toISOString())
        .order("start_at", { ascending: true });

      if (!error && data) {
        const mapped = (data as Row[]).map((r) => ({
          title: `${r.title}${r.venue?.name ? " @ " + r.venue.name : ""}`,
          start: r.start_at,
          end: r.end_at ?? undefined,
          url: r.url ?? undefined,
        }));
        setEvents(mapped);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p style={{ padding: 16 }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>NYC Cabaret Calendar</h1>
      {/* ===== Subscribe section ===== */}
<div style={{ margin: "8px 0" }}>
  <strong>Subscribe:</strong>{" "}
  <a href="/api/calendar/all.ics">All venues (.ics)</a>
</div>

<div style={{ margin: "4px 0" }}>
  <span>Per-venue feeds:</span>{" "}
  <a href="/api/calendar/54-below.ics">54 Below</a> ·{" "}
  <a href="/api/calendar/green-room-42.ics">The Green Room 42</a> ·{" "}
  <a href="/api/calendar/joes-pub.ics">Joe’s Pub</a>
</div>
{/* ===== End subscribe section ===== */}

      <p>
        Subscribe to everything:{" "}
        <a href="/api/calendar/all.ics">All venues (.ics)</a>
      </p>
      <FullCalendar
        plugins={[listPlugin, dayGridPlugin, interactionPlugin]}
        initialView="listWeek"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "listWeek,dayGridMonth",
        }}
        events={events}
        eventClick={(info) => {
          if (info.event.url) {
            info.jsEvent.preventDefault();
            window.open(info.event.url, "_blank");
          }
        }}
      />a
    </div>
  );
}