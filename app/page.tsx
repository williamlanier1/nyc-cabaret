<ul className="space-y-3">
  {events.map((event) => {
    const starts = new Date(event.start_at || event.start_time || event.start); // tolerate different field names
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
        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">{dateStr} • {timeStr}</div>
            <h3 className="mt-1 text-lg font-semibold leading-snug">
              {event.title}
            </h3>
            {event.artist ? (
              <div className="mt-1 text-gray-600">{event.artist}</div>
            ) : null}
            {event.status && event.status.toLowerCase() !== "confirmed" ? (
              <div className="mt-1 text-xs uppercase tracking-wide text-amber-700 bg-amber-100 inline-block px-2 py-0.5 rounded">
                {event.status}
              </div>
            ) : null}
          </div>

          <span
            className={[
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
              venue === "54-below"
                ? "bg-fuchsia-100 text-fuchsia-800"
                : "bg-gray-100 text-gray-800",
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
              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              Tickets / Details
            </a>
          ) : null}
        </div>
      </li>
    );
  })}
</ul>
