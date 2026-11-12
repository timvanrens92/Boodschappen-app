-- Boodschappen App — database-opzet voor Supabase
-- Plak dit hele bestand in Supabase → SQL Editor → New query → Run.
-- Het is veilig om het later nog eens te draaien.

-- 1. Wie mag de app gebruiken: alleen e-mailadressen in deze tabel.
create table if not exists public.members (
  email text primary key
);
alter table public.members enable row level security;

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "leden zien leden" on public.members;
create policy "leden zien leden" on public.members for select using (public.is_member());

-- 2. Gegevens van de app. Elke tabel bewaart documenten als JSON,
--    precies zoals de app ze gebruikt.
do $$
declare t text;
begin
  foreach t in array array['items','lists','templates','trips','prices','offers','meta'] loop
    execute format('create table if not exists public.%I (
      id text primary key,
      data jsonb not null default ''{}''::jsonb,
      updated_at timestamptz not null default now()
    )', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "leden lezen" on public.%I', t);
    execute format('create policy "leden lezen" on public.%I for select using (public.is_member())', t);
    execute format('drop policy if exists "leden schrijven" on public.%I', t);
    -- aanbiedingen en meta worden alleen door de wekelijkse workflow geschreven
    if t not in ('offers','meta') then
      execute format('create policy "leden schrijven" on public.%I for all using (public.is_member()) with check (public.is_member())', t);
    end if;
  end loop;
end $$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['items','lists','templates','trips','prices'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- 3. Namen van gebruikers (voor "door Hilde" en meldingen).
create table if not exists public.profiles (
  id uuid primary key default auth.uid(),
  name text not null default ''
);
alter table public.profiles enable row level security;
drop policy if exists "leden lezen profielen" on public.profiles;
create policy "leden lezen profielen" on public.profiles for select using (public.is_member());
drop policy if exists "eigen profiel" on public.profiles;
create policy "eigen profiel" on public.profiles for all using (id = auth.uid() and public.is_member()) with check (id = auth.uid() and public.is_member());

-- 4. Pushmeldingen: één rij per telefoon/browser.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid(),
  subscription jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "eigen abonnementen" on public.push_subscriptions;
create policy "eigen abonnementen" on public.push_subscriptions for all
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- 5. Live bijwerken aanzetten voor de app-tabellen.
do $$
declare t text;
begin
  foreach t in array array['items','lists','templates','trips','prices','offers','meta','profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
