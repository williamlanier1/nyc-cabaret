export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { buildIcs, type DbEvent } from "@/lib/db";
import { getSupabasePublic } from "@/lib/server/supabasePublic";
import { fetchSubscriberByToken, touchSubscriber } from "@/lib/server/subscribers";

export async function GET(req: Request, context: { params: { token?: string } }) {
  const rawToken = context?.params?.token || "";
  const token = rawToken.replace(/\.ics$/i, "");

  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const subscriber = await fetchSubscriberByToken(token);
  if (!subscriber) {
    return new Response("Subscription not found", { status: 404 });
  }

  const supa = getSupabasePublic();
  const nowIso = new Date().toISOString();
  const { data, error } = await supa
    .from("events")
    .select("id,title,artist,start_at,end_at,url,status,tz,venue_id, venue:venues (slug,name)")
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true });

  if (error) {
    return new Response("Failed to build calendar", { status: 500 });
  }

  const rows = (data ?? []) as DbEvent[];
  const ics = buildIcs(rows, `NYC Cabaret — All Venues`);

  // Fire-and-forget access tracking.
  touchSubscriber(token).catch(() => undefined);

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="nyc-cabaret-${token}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
