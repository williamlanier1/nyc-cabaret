"use client";

import { useEffect, useState } from "react";

type EventRow = {
  id: string;
  title: string;
  artist: string | null;
  start_at?: string;
  start_time?: string;
  start?: string;
  url?: string | null;
  status?: string | null;
  venue_slug?: string;
  venue?: { slug?: string };
};

export default function Home() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  // If you already fetch elsewhere, you can remove this effect.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/calendar/all?format=json", { cache: "no-store" });
        const data = await res.json();
        if (mounted && data?.rows) setEvents(data.rows);
      } catch (e) {
        console.error(e);
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
      <main className="mx-auto max-w-3xl p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">NYC Cabaret Calendar</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-neutral-300">
            Upcoming shows across venues.
          </p>
        </header>

        {loading ? (
          <p className="text-gray-600 dark:text-neutral-300">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-gray-700 dark:text-neutral-200">No upcoming events yet.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((event) => {
              const starts = new Date(event.start_at || event.start_time || (event.start as string));
              const dateStr = new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              }).format(starts);
              const timeStr = new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
              }).format(starts);

              const venue =
                (event.venue_slug as string) ||
                (event.venue?.slug as string) ||
                "unknown";

              return (
                <li
                  key={event.id}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-neutral-300">
                        {dateStr} • {timeStr}
                      </div>
                      <h3 className="mt-1 text-lg font-semibold leading-snug text-gray-900 dark:text-white">
                        {event.title}
                      </h3>
                      {event.artist ? (
                        <div className="mt-1 text-gray-700 dark:text-neutral-200">
                          {event.artist}
                        </div>
                      ) : null}
                      {event.status && event.status.toLowerCase() !== "confirmed" ? (
                        <div className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          {event.status}
                        </div>
                      ) : null}
                    </div>

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
                  </div>

                  <div className="mt-3 flex gap-2">
                    {event.url ? (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
                      >
                        Tickets / Details
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
