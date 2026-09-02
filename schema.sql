-- Supabase SQL Editorで実行してください。
create extension if not exists pgcrypto;

create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  category text not null default 'その他',
  expiry_date date not null,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  days_7 boolean not null default true,
  days_3 boolean not null default true,
  days_1 boolean not null default true,
  same_day boolean not null default true,
  expired boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Web Push購読情報。1ユーザーが複数端末を使えるよう複数行。
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  food_item_id uuid references public.food_items(id) on delete cascade,
  notice_key text not null,
  notice_date date not null,
  created_at timestamptz not null default now(),
  unique(food_item_id, notice_key, notice_date)
);

alter table public.food_items enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_logs enable row level security;

drop policy if exists "food own select" on public.food_items;
drop policy if exists "food own insert" on public.food_items;
drop policy if exists "food own update" on public.food_items;
drop policy if exists "food own delete" on public.food_items;

create policy "food own select" on public.food_items for select using (auth.uid() = user_id);
create policy "food own insert" on public.food_items for insert with check (auth.uid() = user_id);
create policy "food own update" on public.food_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "food own delete" on public.food_items for delete using (auth.uid() = user_id);

drop policy if exists "prefs own all" on public.notification_preferences;
create policy "prefs own all" on public.notification_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push own all" on public.push_subscriptions;
create policy "push own all" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "logs own select" on public.notification_logs;
create policy "logs own select" on public.notification_logs for select using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notification_preferences(user_id) values(new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists food_items_updated_at on public.food_items;
create trigger food_items_updated_at before update on public.food_items
for each row execute procedure public.set_updated_at();

drop trigger if exists prefs_updated_at on public.notification_preferences;
create trigger prefs_updated_at before update on public.notification_preferences
for each row execute procedure public.set_updated_at();

drop trigger if exists push_updated_at on public.push_subscriptions;
create trigger push_updated_at before update on public.push_subscriptions
for each row execute procedure public.set_updated_at();

-- 通知関数がService Roleで扱えるよう、Edge Functionからのみ実行する想定。
