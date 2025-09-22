-- Calendar subscribers capture ICS access tokens per email address.
-- Run inside the public schema (adjust schema name if you have customized Supabase defaults).

create table if not exists public.calendar_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  last_accessed_at timestamptz,
  unsubscribed_at timestamptz,
  metadata jsonb default '{}'::jsonb
);

-- Prevent duplicate emails (case-insensitive) and tokens.
create unique index if not exists calendar_subscribers_email_key on public.calendar_subscribers (lower(email));
create unique index if not exists calendar_subscribers_token_key on public.calendar_subscribers (token);

-- Helper trigger to keep last_accessed_at current when the feed is served.
create or replace function public.calendar_subscribers_touch()
returns trigger as $$
begin
  new.last_accessed_at := timezone('utc', now());
  return new;
end;
$$ language plpgsql;

create trigger calendar_subscribers_touch
before update on public.calendar_subscribers
for each row execute function public.calendar_subscribers_touch();
