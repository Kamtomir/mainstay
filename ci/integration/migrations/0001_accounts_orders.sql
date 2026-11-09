-- Example schema for the integration templates: two tables and their checks.
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.orders (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  amount     numeric(12, 2) not null check (amount > 0),
  status     text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  created_at timestamptz not null default now()
);
