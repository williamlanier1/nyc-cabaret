import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin";

export type CalendarSubscriber = {
  id: string;
  email: string;
  token: string;
  is_active: boolean;
  created_at: string;
  last_accessed_at: string | null;
  unsubscribed_at: string | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function newToken() {
  return randomUUID().replace(/-/g, "");
}

export async function createOrReuseSubscriber(email: string) {
  const supabase = getSupabaseAdmin();
  const normalized = normalizeEmail(email);

  const { data: existing, error: selectErr } = await supabase
    .from("calendar_subscribers")
    .select("id, email, token, is_active, unsubscribed_at")
    .eq("email", normalized)
    .maybeSingle();

  if (selectErr) {
    throw new Error(selectErr.message || "Failed to check subscriber");
  }

  if (existing && existing.is_active && !existing.unsubscribed_at) {
    return existing.token as string;
  }

  const token = newToken();
  const { error: upsertErr } = existing
    ? await supabase
        .from("calendar_subscribers")
        .update({ token, is_active: true, unsubscribed_at: null })
        .eq("id", existing.id)
    : await supabase.from("calendar_subscribers").insert({ email: normalized, token });

  if (upsertErr) {
    throw new Error(upsertErr.message || "Failed to create subscriber");
  }

  return token;
}

export async function fetchSubscriberByToken(token: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("calendar_subscribers")
    .select("id, email, token, is_active, unsubscribed_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load subscriber");
  }
  if (!data || !data.is_active || data.unsubscribed_at) {
    return null;
  }
  return data as CalendarSubscriber;
}

export async function touchSubscriber(token: string) {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("calendar_subscribers")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("token", token);
}
