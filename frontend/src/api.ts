import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Debt,
  DebtPayload,
  MonthPaymentPayload,
  MonthPaymentsResponse,
  MonthlyDetailItem,
  MonthlyDetailResponse,
  MonthlyStatement,
  PaymentPersonStatus,
  ProjectionMonth,
  StatementPerson,
  SummaryResponse
} from "./types";

type DebtRow = DebtPayload & {
  id: string;
  is_paid: boolean | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

type MonthlyPaymentRow = {
  month: string;
  person: "ALAN" | "MAIRON";
  paid: boolean;
  amount: number;
  note: string;
  paid_at: string | null;
  updated_at: string | null;
};

type PaymentNoteData = {
  display_note?: string;
  settlement?: {
    excel_current_charges?: number;
    excel_future_detected?: number;
    cartola_adjustment?: number;
    settlement_charges: number;
    credit_discount: number;
    pay_now: number;
  };
  statement?: Partial<Omit<MonthlyStatement, "month" | "people">>;
  items?: MonthlyDetailItem[];
};

let supabase: SupabaseClient | null = null;

function normalizeSupabaseUrl(value: string) {
  const trimmed = value.trim();
  const domainOnly = trimmed.match(/[\w-]+\.supabase\.co\S*/)?.[0];
  const extracted = trimmed.match(/https?:\/\/\S+/)?.[0] ?? domainOnly ?? trimmed;
  const withProtocol = domainOnly && !extracted.startsWith("http") ? `https://${extracted}` : extracted;
  return withProtocol.replace(/\/+$/, "").replace(/\/(rest|auth|storage)\/v1$/, "");
}

function isHttpUrl(value: string) {
  return /^https?:\/\/\S+/.test(value);
}

function extractJwt(value: string) {
  return value.trim().match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] ?? "";
}

function parsePaymentNote(value: string | null | undefined): PaymentNoteData | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as PaymentNoteData;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getSupabase() {
  if (supabase) return supabase;

  const rawUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  let url = normalizeSupabaseUrl(rawUrl);
  let anonKey = extractJwt(rawAnonKey) || rawAnonKey.trim();

  const urlFromKeyField = normalizeSupabaseUrl(rawAnonKey);
  const keyFromUrlField = extractJwt(rawUrl);

  if (!isHttpUrl(url) && isHttpUrl(urlFromKeyField)) {
    url = urlFromKeyField;
  }

  if (!extractJwt(anonKey) && keyFromUrlField) {
    anonKey = keyFromUrlField;
  }

  if (!url || !anonKey) {
    throw new Error("Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.");
  }

  if (!isHttpUrl(url)) {
    throw new Error("VITE_SUPABASE_URL debe ser la Project URL de Supabase, por ejemplo https://tu-proyecto.supabase.co.");
  }

  supabase = createClient(url, anonKey);
  return supabase;
}

function monthStart(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) throw new Error("Mes invalido. Usa formato YYYY-MM.");
  return new Date(year, month - 1, 1);
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(value: Date, months: number) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}

function monthDiff(start: Date, end: Date) {
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function computedDebt(row: DebtRow, asOfMonth: string): Debt {
  const start = monthStart(row.start_month);
  const end = addMonths(start, row.installments_total - 1);
  const asOf = monthStart(asOfMonth);
  const diff = monthDiff(start, asOf);
  const isPaid = Boolean(row.is_paid);

  const paidInstallments = isPaid
    ? row.installments_total
    : Math.min(Math.max(diff + 1, 0), row.installments_total);
  const remainingStart = Math.max(diff, 0);
  const remainingInstallments = isPaid ? 0 : Math.max(row.installments_total - remainingStart, 0);

  let status: Debt["status"];
  if (isPaid || asOf > end) {
    status = "finished";
  } else if (asOf < start) {
    status = "upcoming";
  } else {
    status = "active";
  }

  return {
    ...row,
    is_paid: isPaid,
    end_month: monthKey(end),
    status,
    paid_installments_as_of: paidInstallments,
    remaining_installments_as_of: remainingInstallments,
    alan_total: row.alan_monthly * row.installments_total,
    mairon_total: row.mairon_monthly * row.installments_total,
    alan_remaining: row.alan_monthly * remainingInstallments,
    mairon_remaining: row.mairon_monthly * remainingInstallments,
    people_monthly_total: row.alan_monthly + row.mairon_monthly
  };
}

async function fetchDebtRows() {
  const { data, error } = await getSupabase()
    .from("debts")
    .select("*")
    .order("start_month", { ascending: false })
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as DebtRow[];
}

function buildProjection(rows: DebtRow[], fromMonth: string, months: number) {
  const fromStart = monthStart(fromMonth);
  const safeMonths = Math.max(1, Math.min(months, 60));
  const projection: ProjectionMonth[] = [];

  for (let offset = 0; offset < safeMonths; offset += 1) {
    const month = addMonths(fromStart, offset);
    let alan = 0;
    let mairon = 0;
    let activeDebts = 0;

    for (const row of rows) {
      if (row.is_paid) continue;
      const start = monthStart(row.start_month);
      const end = addMonths(start, row.installments_total - 1);
      if (start <= month && month <= end) {
        alan += row.alan_monthly;
        mairon += row.mairon_monthly;
        activeDebts += 1;
      }
    }

    projection.push({
      month: monthKey(month),
      alan,
      mairon,
      total: alan + mairon,
      active_debts: activeDebts
    });
  }

  return projection;
}

export async function getSummary(fromMonth: string, months: number): Promise<SummaryResponse> {
  const rows = await fetchDebtRows();
  const debts = rows.map((row) => computedDebt(row, fromMonth));
  const projection = buildProjection(rows, fromMonth, months);
  const fromStart = monthStart(fromMonth);

  let alanEnd: Date | null = null;
  let maironEnd: Date | null = null;

  for (const row of rows) {
    if (row.is_paid) continue;
    const end = addMonths(monthStart(row.start_month), row.installments_total - 1);
    if (row.alan_monthly > 0 && end >= fromStart) {
      alanEnd = !alanEnd || end.getTime() > alanEnd.getTime() ? end : alanEnd;
    }
    if (row.mairon_monthly > 0 && end >= fromStart) {
      maironEnd = !maironEnd || end.getTime() > maironEnd.getTime() ? end : maironEnd;
    }
  }

  const peakMonth = projection.reduce<ProjectionMonth | null>((peak, item) => {
    if (!peak || item.total > peak.total) return item;
    return peak;
  }, null);

  return {
    from_month: fromMonth,
    months: Math.max(1, Math.min(months, 60)),
    debts,
    projection,
    stats: {
      alan_projected: projection.reduce((sum, item) => sum + item.alan, 0),
      mairon_projected: projection.reduce((sum, item) => sum + item.mairon, 0),
      total_projected: projection.reduce((sum, item) => sum + item.total, 0),
      active_debts: debts.filter((debt) => debt.status !== "finished").length,
      finished_debts: debts.filter((debt) => debt.status === "finished").length,
      alan_end_month: alanEnd ? monthKey(alanEnd) : null,
      mairon_end_month: maironEnd ? monthKey(maironEnd) : null,
      peak_month: peakMonth
    }
  };
}

export async function getMonthDetail(month: string): Promise<MonthlyDetailResponse> {
  monthStart(month);
  const { data, error } = await getSupabase()
    .from("monthly_payments")
    .select("*")
    .eq("month", month)
    .order("person", { ascending: true });

  if (error) throw new Error(error.message);

  const settlementRows = ((data ?? []) as MonthlyPaymentRow[])
    .map((row) => ({ row, note: parsePaymentNote(row.note) }))
    .filter((item) => item.note?.settlement);

  if (settlementRows.length > 0) {
    const people = settlementRows
      .map<StatementPerson>(({ row, note }) => {
        const settlement = note?.settlement;
        return {
          person: row.person,
          excel_current_charges: settlement?.excel_current_charges ?? settlement?.settlement_charges ?? 0,
          excel_future_detected: settlement?.excel_future_detected ?? 0,
          cartola_adjustment: settlement?.cartola_adjustment ?? 0,
          settlement_charges: settlement?.settlement_charges ?? 0,
          credit_discount: settlement?.credit_discount ?? 0,
          pay_now: settlement?.pay_now ?? row.amount
        };
      })
      .sort((a, b) => (a.person === "ALAN" ? -1 : 1) - (b.person === "ALAN" ? -1 : 1));

    const totals = people.reduce(
      (acc, person) => ({
        charges: acc.charges + person.settlement_charges,
        discount: acc.discount + person.credit_discount,
        payNow: acc.payNow + person.pay_now
      }),
      { charges: 0, discount: 0, payNow: 0 }
    );
    const statementData = settlementRows.find((item) => item.note?.statement)?.note?.statement ?? {};
    const items = settlementRows.find((item) => item.note?.items?.length)?.note?.items ?? [];
    const statement: MonthlyStatement = {
      month,
      label: statementData.label ?? month,
      source_excel: statementData.source_excel ?? "",
      source_pdf: statementData.source_pdf ?? "",
      due_date: statementData.due_date ?? "",
      statement_total_to_pay: statementData.statement_total_to_pay ?? totals.payNow,
      statement_minimum_to_pay: statementData.statement_minimum_to_pay ?? 0,
      current_charges_total: statementData.current_charges_total ?? totals.charges,
      previous_credit: statementData.previous_credit ?? totals.discount,
      previous_period_billed: statementData.previous_period_billed ?? 0,
      previous_period_paid: statementData.previous_period_paid ?? 0,
      notes: statementData.notes ?? "",
      people
    };

    return {
      month,
      statement,
      items,
      totals: {
        current: items.length ? items.filter((item) => item.is_current).reduce((sum, item) => sum + item.person_amount, 0) : totals.charges,
        future: items.filter((item) => item.is_future).reduce((sum, item) => sum + item.person_amount, 0),
        all: items.length ? items.reduce((sum, item) => sum + item.person_amount, 0) : totals.charges
      }
    };
  }

  return {
    month,
    statement: null,
    items: [],
    totals: {
      current: 0,
      future: 0,
      all: 0
    }
  };
}

function expectedPaymentAmount(rows: DebtRow[], month: string, person: "ALAN" | "MAIRON") {
  const target = monthStart(month);
  const amountKey = person === "ALAN" ? "alan_monthly" : "mairon_monthly";

  return rows.reduce((sum, row) => {
    if (row.is_paid) return sum;
    const start = monthStart(row.start_month);
    const end = addMonths(start, row.installments_total - 1);
    return start <= target && target <= end ? sum + row[amountKey] : sum;
  }, 0);
}

export async function getNextPendingMonth(fromMonth: string, months = 60) {
  const rows = await fetchDebtRows();
  const start = monthStart(fromMonth);
  const safeMonths = Math.max(1, Math.min(months, 60));
  const endMonth = monthKey(addMonths(start, safeMonths - 1));
  const { data, error } = await getSupabase()
    .from("monthly_payments")
    .select("*")
    .gte("month", fromMonth)
    .lte("month", endMonth);

  if (error) throw new Error(error.message);

  const paymentsByMonth = ((data ?? []) as MonthlyPaymentRow[]).reduce<Record<string, Partial<Record<"ALAN" | "MAIRON", MonthlyPaymentRow>>>>(
    (acc, row) => {
      acc[row.month] = { ...(acc[row.month] ?? {}), [row.person]: row };
      return acc;
    },
    {}
  );

  for (let offset = 0; offset < safeMonths; offset += 1) {
    const month = monthKey(addMonths(start, offset));
    const expectedAlan = expectedPaymentAmount(rows, month, "ALAN");
    const expectedMairon = expectedPaymentAmount(rows, month, "MAIRON");

    if (expectedAlan <= 0 && expectedMairon <= 0) continue;

    const payments = paymentsByMonth[month] ?? {};
    const alanSettled = expectedAlan <= 0 || payments.ALAN?.paid === true;
    const maironSettled = expectedMairon <= 0 || payments.MAIRON?.paid === true;

    if (!alanSettled || !maironSettled) {
      return month;
    }
  }

  return fromMonth;
}

function normalizePayment(row: MonthlyPaymentRow | undefined, month: string, person: "ALAN" | "MAIRON", expected: number): PaymentPersonStatus {
  if (!row) {
    return {
      month,
      person,
      paid: false,
      amount: expected,
      expected_amount: expected,
      note: "",
      paid_at: null,
      updated_at: null
    };
  }

  return {
    month,
    person,
    paid: row.paid,
    amount: row.paid ? row.amount || expected : expected,
    expected_amount: expected,
    note: row.note ?? "",
    paid_at: row.paid_at,
    updated_at: row.updated_at
  };
}

export async function getMonthPayments(month: string): Promise<MonthPaymentsResponse> {
  monthStart(month);
  const [rowsResult, debts] = await Promise.all([
    getSupabase().from("monthly_payments").select("*").eq("month", month),
    fetchDebtRows()
  ]);

  if (rowsResult.error) throw new Error(rowsResult.error.message);

  const paymentRows = ((rowsResult.data ?? []) as MonthlyPaymentRow[]).reduce<Record<string, MonthlyPaymentRow>>((acc, row) => {
    acc[row.person] = row;
    return acc;
  }, {});

  const people = (["ALAN", "MAIRON"] as const).map((person) =>
    normalizePayment(paymentRows[person], month, person, expectedPaymentAmount(debts, month, person))
  );
  const paidTotal = people.reduce((sum, item) => sum + (item.paid ? item.amount : 0), 0);
  const expectedTotal = people.reduce((sum, item) => sum + item.expected_amount, 0);

  return {
    month,
    people,
    all_paid: people.every((item) => item.paid),
    paid_total: paidTotal,
    pending_total: expectedTotal - paidTotal,
    expected_total: expectedTotal
  };
}

export async function updateMonthPayment(payload: MonthPaymentPayload) {
  const now = new Date().toISOString();
  const debts = await fetchDebtRows();
  const expected = expectedPaymentAmount(debts, payload.month, payload.person);
  const amount = payload.amount && payload.amount > 0 ? payload.amount : expected;

  const { error } = await getSupabase()
    .from("monthly_payments")
    .upsert(
      {
        month: payload.month,
        person: payload.person,
        paid: payload.paid,
        amount,
        note: payload.note ?? "",
        paid_at: payload.paid ? now : null,
        updated_at: now
      },
      { onConflict: "month,person" }
    );

  if (error) throw new Error(error.message);
  return getMonthPayments(payload.month);
}

export async function createDebt(payload: DebtPayload) {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("debts")
    .insert({ ...payload, is_paid: false, paid_at: null, updated_at: now })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return computedDebt(data as DebtRow, payload.start_month);
}

export async function updateDebt(id: string, payload: DebtPayload) {
  const { data, error } = await getSupabase()
    .from("debts")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return computedDebt(data as DebtRow, payload.start_month);
}

export async function markDebtPaid(id: string, paid: boolean) {
  const { data, error } = await getSupabase()
    .from("debts")
    .update({
      is_paid: paid,
      paid_at: paid ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return computedDebt(data as DebtRow, monthKey(new Date()));
}

export async function deleteDebt(id: string) {
  const { error } = await getSupabase().from("debts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
