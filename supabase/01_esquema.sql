-- =========================================================
-- HabitFlow · Fase 2 · Etapa 1: base de datos
-- Cópialo completo en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar más de una vez sin romper nada.
-- =========================================================


-- ---------- 1. Tablas ----------

-- Tu perfil: nombre, zona horaria y preferencias de avisos
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 24),
  timezone    text not null default 'UTC',
  start_date  date,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Tus hábitos (el id es el mismo que ya usa la app en el iPhone)
create table if not exists public.habits (
  user_id      uuid not null references auth.users (id) on delete cascade,
  id           text not null,
  title        text not null check (char_length(title) between 1 and 60),
  emoji        text not null default '✨',
  color        text not null default '#5AA9FF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  time_of_day  text not null default '' check (time_of_day = '' or time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days         smallint[] not null default '{0,1,2,3,4,5,6}' check (days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  created_on   date not null,
  deleted_on   date,
  sort_order   bigint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

-- Registro de cada día: qué hábitos tocaban y cuáles completaste
create table if not exists public.day_logs (
  user_id     uuid not null references auth.users (id) on delete cascade,
  day         date not null,
  scheduled   text[] not null default '{}',
  done        text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

-- Dispositivos que aceptaron notificaciones
create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Avisos ya enviados, para no repetirlos (solo lo usa el servidor)
create table if not exists public.notification_log (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  kind     text not null check (kind in ('habit', 'summary', 'streak')),
  ref      text not null default '',
  sent_at  timestamptz not null default now(),
  primary key (user_id, day, kind, ref)
);


-- ---------- 2. Gana el cambio más reciente ----------
-- Si llega una versión más vieja de un dato (por ejemplo, de un teléfono
-- que estuvo sin internet), se ignora y se conserva la más nueva.

create or replace function public.keep_newest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_newest on public.profiles;
create trigger keep_newest before update on public.profiles
  for each row execute function public.keep_newest();

drop trigger if exists keep_newest on public.habits;
create trigger keep_newest before update on public.habits
  for each row execute function public.keep_newest();

drop trigger if exists keep_newest on public.day_logs;
create trigger keep_newest before update on public.day_logs
  for each row execute function public.keep_newest();


-- ---------- 3. Seguridad: cada quien solo ve lo suyo ----------

alter table public.profiles           enable row level security;
alter table public.habits             enable row level security;
alter table public.day_logs           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log   enable row level security; -- sin reglas: nadie desde la app

drop policy if exists "solo mi perfil" on public.profiles;
create policy "solo mi perfil" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "solo mis habitos" on public.habits;
create policy "solo mis habitos" on public.habits
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "solo mis dias" on public.day_logs;
create policy "solo mis dias" on public.day_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "solo mis dispositivos" on public.push_subscriptions;
create policy "solo mis dispositivos" on public.push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete
  on public.profiles, public.habits, public.day_logs, public.push_subscriptions
  to authenticated;
revoke all on public.profiles, public.habits, public.day_logs, public.push_subscriptions from anon;
revoke all on public.notification_log from anon, authenticated;
