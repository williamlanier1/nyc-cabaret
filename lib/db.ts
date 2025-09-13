import { supabase } from './supabase-client';

export async function fetchUpcomingEvents() {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id, uid_hash, title, artist, start_at, end_at, url, status,
      venue:venues(name, slug)
    `)
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((e: any) => ({
    ...e,
    venue_name: e.venue?.name ?? '',
    venue_slug: e.venue?.slug ?? ''
  }));
}
