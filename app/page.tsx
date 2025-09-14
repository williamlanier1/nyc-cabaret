"use client";

import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import listPlugin from "@fullcalendar/list";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventContentArg } from "@fullcalendar/core";

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
  venue?: { slug?: string; name?: string };
};

type CalendarExtendedProps = {
  url?: string;
  artist?: string | null;
  venue_slug?: string;
  venue_name?: string;
  status?: string | null;
};

function normalizeUrl(input?: string | null): string | undefined {
  const u = (input ?? "").trim();
  if (!u) return undefined;
  // If URL lacks a scheme, default to https
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`; // protocol-relative
  return `https://${u}`;
}

export default function Home() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/calendar/all?format=json", { cache: "no-store" });
        const data = await res.json();
        if (mounted && data?.rows) setEvents(data.rows);
      } catch (e) {
        console.error("Error loading events", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Custom renderer: guarantees we show a visible, clickable <a>
  const eventContent = (arg: EventContentArg) => {
    const props = arg.event.extendedProps as CalendarExtendedProps;
    const venue =
      props.venue_name ||
      (props as unknown as { venue?: string }).venue ||
      props.venue_slug ||
      "unknown";
    const status = props.status ?? null;
    const url = (arg.event.url || props.url) as string | undefined;

    const title = arg.event.title || "";

    return (
      <div className="flex items-start justify-between gap-3">
        <div>
          {url ? (
            <button
              type="button"
              className="mt-1 block text-left text-lg font-semibold leading-snug text-indigo-700 hover:underline dark:text-indigo-300"
              title={url}
              onClick={(e) => {
                e.stopPropagation();
                window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              {title}
            </button>
          ) : (
            <div className="mt-1 text-lg font-semibold leading-snug text-gray-900 dark:text-white">
              {title}
            </div>
          )}

          {props.artist ? (
            <div className="mt-1 font-semibold text-gray-800 dark:text-neutral-100">
              {props.artist}
            </div>
          ) : null}

          {status && status.toLowerCase() !== "confirmed" ? (
            <div className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              {status}
            </div>
          ) : null}
        </div>

        {venue && venue !== "unknown" ? (
          <span
            className={[
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
              venue === "54-below"
                ? "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-200"
                : "bg-gray-100 text-gray-800 dark:bg-neutral-800 dark:text-neutral-200",
            ].join(" ")}
            title={venue}
          >
            {venue}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <main className="mx-auto max-w-5xl p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">NYC Cabaret — Upcoming</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-neutral-300">
            Unified list across venues. Click a title to open tickets/details.
          </p>
        </header>

        {loading ? (
          <p className="text-gray-600 dark:text-neutral-300">Loading…</p>
        ) : (
          <FullCalendar
            plugins={[listPlugin, dayGridPlugin, interactionPlugin]}
            initialView="listMonth"
            headerToolbar={{ left: "prev,next today", center: "title", right: "listMonth" }}
            events={events.map((e) => {
              const link = normalizeUrl(e.url);
              return {
                id: e.id,
                // Keep title as the event title only; render artist separately below.
                title: e.title,
                start: e.start_at ?? e.start_time ?? e.start,
                // FullCalendar types do not accept null; use undefined when absent
                end: e.end_at ?? undefined,
                url: link, // FullCalendar native url prop
                extendedProps: {
                  url: link,
                  artist: e.artist,
                  venue_slug: e.venue?.slug ?? e.venue_slug,
                  venue_name: e.venue?.name,
                  status: e.status ?? null,
                },
              };
            })}
            // Ensure clicking anywhere on the row (not just the link) opens a tab
            eventClick={(info) => {
              const ep = info.event.extendedProps as CalendarExtendedProps;
              const url = info.event.url || ep?.url;
              if (typeof url === "string" && url) {
                info.jsEvent.preventDefault();
                window.open(url, "_blank", "noopener,noreferrer");
              }
            }}
            eventContent={eventContent}
            eventDidMount={undefined}
            // list styling polish (rows are not editable/draggy)
            editable={false}
            selectable={false}
            navLinks={false}
          />
        )}
      </main>
    </div>
  );
}
