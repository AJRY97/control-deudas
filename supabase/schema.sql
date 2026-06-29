create extension if not exists pgcrypto;

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default '',
  total_amount integer not null default 0 check (total_amount >= 0),
  monthly_installment integer not null default 0 check (monthly_installment >= 0),
  installments_total integer not null default 1 check (installments_total > 0),
  start_month text not null check (start_month ~ '^[0-9]{4}-[0-9]{2}$'),
  alan_monthly integer not null default 0 check (alan_monthly >= 0),
  mairon_monthly integer not null default 0 check (mairon_monthly >= 0),
  payer_mode text not null default 'personalizado'
    check (payer_mode in ('alan', 'mairon', 'ambos', 'personalizado')),
  source text not null default '',
  notes text not null default '',
  is_paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monthly_payments (
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  person text not null check (person in ('ALAN', 'MAIRON')),
  paid boolean not null default false,
  amount integer not null default 0 check (amount >= 0),
  note text not null default '',
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (month, person)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists debts_set_updated_at on public.debts;
create trigger debts_set_updated_at
before update on public.debts
for each row execute function public.set_updated_at();

drop trigger if exists monthly_payments_set_updated_at on public.monthly_payments;
create trigger monthly_payments_set_updated_at
before update on public.monthly_payments
for each row execute function public.set_updated_at();

create index if not exists debts_start_month_idx on public.debts (start_month);
create index if not exists debts_is_paid_idx on public.debts (is_paid);
create index if not exists monthly_payments_month_idx on public.monthly_payments (month);

alter table public.debts enable row level security;
alter table public.monthly_payments enable row level security;

drop policy if exists "debts anon read" on public.debts;
create policy "debts anon read"
on public.debts for select
to anon
using (true);

drop policy if exists "debts anon insert" on public.debts;
create policy "debts anon insert"
on public.debts for insert
to anon
with check (true);

drop policy if exists "debts anon update" on public.debts;
create policy "debts anon update"
on public.debts for update
to anon
using (true)
with check (true);

drop policy if exists "debts anon delete" on public.debts;
create policy "debts anon delete"
on public.debts for delete
to anon
using (true);

drop policy if exists "monthly payments anon read" on public.monthly_payments;
create policy "monthly payments anon read"
on public.monthly_payments for select
to anon
using (true);

drop policy if exists "monthly payments anon insert" on public.monthly_payments;
create policy "monthly payments anon insert"
on public.monthly_payments for insert
to anon
with check (true);

drop policy if exists "monthly payments anon update" on public.monthly_payments;
create policy "monthly payments anon update"
on public.monthly_payments for update
to anon
using (true)
with check (true);
