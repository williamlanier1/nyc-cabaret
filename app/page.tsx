"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import listPlugin from "@fullcalendar/list";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

type EventRow = {
  id: string;
  title: string;
  artist: string | null;
  start_at?: string;
  start_time?: string;
  start?: string;
  end_at?: string;
  url?: string | null; // from Supabase
  status?: string | null;
  venue_slug?: string;
  venue?: { slug?: string };
};

function normalizeUrl(input?: string | null): string | undefined {
  const u = (input ?? "").trim();
  if (!u) return undefined;
  // Accept absolute URLs; if someone ever stored a bare domain, you could add a scheme here.
  return u;
}

export default function Home() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/calendar/all?format=json", {
          cache: "no-store",
        });
        const data = await res.json();
        if (mounted && data?.rows) setEvents(data.rows);
      } catch (e) {
        console.error("Error loading events", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <main className="mx-auto max-w-5xl p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">NYC Cabaret — Upcoming</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-neutral-300">
            Unified list across venues. Click any item to open details/tickets.
          </p>
        </header>

        {loading ? (
          <p className="text-gray-600 dark:text-neutral-300">Loading…</p>
        ) : (
          <FullCalendar
            plugins={[listPlugin, dayGridPlugin, interactionPlugin]}
            initialView="listMonth"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "listMonth",
            }}
            events={events.map((e) => {
              const link = normalizeUrl(e.url);
              return {
                id: e.id,
                title: e.artist ? `${e.title} — ${e.artist}` : e.title,
                start: e.start_at ?? e.start_time ?? e.start,
                end: e.end_at ?? null,
                url: link, // FC will render an <a> when this is defined & non-empty
                extendedProps: {
                  url: link, // fallback for eventClick
                  venue: e.venue_slug ?? e.venue?.slug ?? "unknown",
                  status: e.status ?? null,
                },
              };
            })}
            // Open in a new tab on click
            eventClick={(info) => {
              const url =
                info.event.url ||
                (info.event.extendedProps as Record<string, unknown>)?.url;
              if (typeof url === "string" && url) {
                // Don’t let FC try to navigate the same page
                info.jsEvent.preventDefault();
                window.open(url, "_blank", "noopener,noreferrer");
              }
            }}
            // Force the anchor that FC renders to open in a new tab (helps Safari)
            eventDidMount={(arg) => {
              const a = arg.el.querySelector("a") as HTMLAnchorElement | null;
              if (a && a.href) {
                a.target = "_blank";
                a.rel = "noopener noreferrer";
              }
            }}
            editable={false}
            selectable={false}
            navLinks={false}
          />
        )}
      </main>
    </div>
  );
}
