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

create table if not exists public.monthly_incomes (
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  person text not null check (person in ('ALAN', 'MAIRON')),
  amount integer not null default 0 check (amount >= 0),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (month, person)
);

create table if not exists public.external_expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (category in ('subscriptions', 'home', 'other_cards', 'external_debts', 'other')),
  service_key text not null default '',
  person text not null default 'AMBOS'
    check (person in ('ALAN', 'MAIRON', 'AMBOS')),
  amount integer not null default 0 check (amount >= 0),
  start_month text not null check (start_month ~ '^[0-9]{4}-[0-9]{2}$'),
  due_day integer not null default 1 check (due_day between 1 and 31),
  kind text not null default 'recurrent'
    check (kind in ('recurrent', 'installments', 'single')),
  installments_total integer not null default 1 check (installments_total > 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.external_expense_payments (
  expense_id uuid not null references public.external_expenses(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  paid boolean not null default false,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (expense_id, month)
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

drop trigger if exists monthly_incomes_set_updated_at on public.monthly_incomes;
create trigger monthly_incomes_set_updated_at
before update on public.monthly_incomes
for each row execute function public.set_updated_at();

drop trigger if exists external_expenses_set_updated_at on public.external_expenses;
create trigger external_expenses_set_updated_at
before update on public.external_expenses
for each row execute function public.set_updated_at();

drop trigger if exists external_expense_payments_set_updated_at on public.external_expense_payments;
create trigger external_expense_payments_set_updated_at
before update on public.external_expense_payments
for each row execute function public.set_updated_at();

create index if not exists debts_start_month_idx on public.debts (start_month);
create index if not exists debts_is_paid_idx on public.debts (is_paid);
create index if not exists monthly_payments_month_idx on public.monthly_payments (month);
create index if not exists monthly_incomes_month_idx on public.monthly_incomes (month);
create index if not exists external_expenses_start_month_idx on public.external_expenses (start_month);
create index if not exists external_expenses_category_idx on public.external_expenses (category);
create index if not exists external_expense_payments_month_idx on public.external_expense_payments (month);

alter table public.debts enable row level security;
alter table public.monthly_payments enable row level security;
alter table public.monthly_incomes enable row level security;
alter table public.external_expenses enable row level security;
alter table public.external_expense_payments enable row level security;

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

drop policy if exists "monthly incomes anon read" on public.monthly_incomes;
create policy "monthly incomes anon read"
on public.monthly_incomes for select
to anon
using (true);

drop policy if exists "monthly incomes anon insert" on public.monthly_incomes;
create policy "monthly incomes anon insert"
on public.monthly_incomes for insert
to anon
with check (true);

drop policy if exists "monthly incomes anon update" on public.monthly_incomes;
create policy "monthly incomes anon update"
on public.monthly_incomes for update
to anon
using (true)
with check (true);

drop policy if exists "external expenses anon read" on public.external_expenses;
create policy "external expenses anon read"
on public.external_expenses for select
to anon
using (true);

drop policy if exists "external expenses anon insert" on public.external_expenses;
create policy "external expenses anon insert"
on public.external_expenses for insert
to anon
with check (true);

drop policy if exists "external expenses anon update" on public.external_expenses;
create policy "external expenses anon update"
on public.external_expenses for update
to anon
using (true)
with check (true);

drop policy if exists "external expenses anon delete" on public.external_expenses;
create policy "external expenses anon delete"
on public.external_expenses for delete
to anon
using (true);

drop policy if exists "external expense payments anon read" on public.external_expense_payments;
create policy "external expense payments anon read"
on public.external_expense_payments for select
to anon
using (true);

drop policy if exists "external expense payments anon insert" on public.external_expense_payments;
create policy "external expense payments anon insert"
on public.external_expense_payments for insert
to anon
with check (true);

drop policy if exists "external expense payments anon update" on public.external_expense_payments;
create policy "external expense payments anon update"
on public.external_expense_payments for update
to anon
using (true)
with check (true);
