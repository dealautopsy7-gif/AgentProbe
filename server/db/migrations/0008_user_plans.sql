-- Screen 11 (billing) needs somewhere to record which plan a user is on.
-- Every user is 'free' until Stripe billing exists to move them off it —
-- no row here at all is treated as 'free' by the API (see routes/billing.ts),
-- so this table only ever gains a row once someone actually upgrades.
-- stripe_customer_id/stripe_subscription_id are here now so the real
-- Stripe wiring later is an UPDATE, not another migration; both stay null
-- until that's built.
create type public.plan_tier as enum ('free', 'pro', 'agency');

create table if not exists public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan public.plan_tier not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;

create policy "user_plans_select_own" on public.user_plans
  for select using (auth.uid() = user_id);
