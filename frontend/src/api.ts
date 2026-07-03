import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  BudgetPerson,
  BudgetResponse,
  Debt,
  DebtPayload,
  ExternalExpense,
  ExternalExpenseMonthItem,
  ExternalExpensePaymentPayload,
  ExternalExpensePayload,
  MonthPaymentPayload,
  MonthPaymentsResponse,
  MonthlyIncome,
  MonthlyIncomePayload,
  MonthlyDetailItem,
  MonthlyDetailResponse,
  MonthlyStatement,
  PaymentPersonStatus,
  ProjectionMonth,
  StatementPerson,
  SummaryResponse
} from "./types";

type DebtRow = Omit<DebtPayload, "purchase_date"> & {
  id: string;
  purchase_date?: string | null;
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

type ExternalExpenseRow = ExternalExpensePayload & {
  id: string;
  created_at: string;
  updated_at: string;
};

type ExternalExpensePaymentRow = {
  expense_id: string;
  month: string;
  paid: boolean;
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

type DebtNoteData = {
  kind?: "debt-note-v1";
  text?: string;
  purchase_date?: string;
};

type DebtDbPayload = Omit<DebtPayload, "purchase_date">;

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

function isMissingBudgetTable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  const message = candidate.message?.toLowerCase() ?? "";
  return (
    candidate.code === "42P01" ||
    candidate.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

function budgetTableErrorMessage(error: { message: string }) {
  return isMissingBudgetTable(error) ? "Falta ejecutar el SQL nuevo para activar sueldo y gastos externos." : error.message;
}

function isDateKey(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function parseDebtNote(value: string | null | undefined) {
  if (!value) return { text: "", purchase_date: "" };
  try {
    const parsed = JSON.parse(value) as DebtNoteData;
    if (parsed?.kind === "debt-note-v1") {
      return {
        text: parsed.text ?? "",
        purchase_date: isDateKey(parsed.purchase_date) ? parsed.purchase_date ?? "" : ""
      };
    }
  } catch {
    // Existing notes are plain text; keep them readable.
  }
  return { text: value, purchase_date: "" };
}

function encodeDebtNote(text: string, purchaseDate: string) {
  if (!purchaseDate) return text;
  return JSON.stringify({
    kind: "debt-note-v1",
    text,
    purchase_date: purchaseDate
  } satisfies DebtNoteData);
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

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addMonths(value: Date, months: number) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}

export function defaultPurchaseDateFromPaymentMonth(paymentMonth: string) {
  const paymentStart = monthStart(paymentMonth);
  return dateKey(new Date(paymentStart.getFullYear(), paymentStart.getMonth() - 2, 26));
}

export function paymentMonthFromPurchaseDate(purchaseDate: string) {
  if (!isDateKey(purchaseDate)) return "";
  const [year, month, day] = purchaseDate.split("-").map(Number);
  const statementMonth = new Date(year, month - 1 + (day >= 26 ? 1 : 0), 1);
  return monthKey(addMonths(statementMonth, 1));
}

function monthDiff(start: Date, end: Date) {
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function computedDebt(row: DebtRow, asOfMonth: string): Debt {
  const debtNote = parseDebtNote(row.notes);
  const purchaseDate = (isDateKey(row.purchase_date) ? row.purchase_date ?? "" : "") || debtNote.purchase_date;
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
    notes: debtNote.text,
    purchase_date: purchaseDate,
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

function normalizeDebtPayload(payload: DebtPayload): DebtDbPayload {
  const purchaseMonth = paymentMonthFromPurchaseDate(payload.purchase_date);
  const { purchase_date: purchaseDate, ...dbPayload } = payload;

  return {
    ...dbPayload,
    start_month: purchaseMonth || payload.start_month,
    notes: encodeDebtNote(payload.notes, purchaseDate)
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
  const dbPayload = normalizeDebtPayload(payload);
  const { data, error } = await getSupabase()
    .from("debts")
    .insert({ ...dbPayload, is_paid: false, paid_at: null, updated_at: now })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return computedDebt(data as DebtRow, dbPayload.start_month);
}

export async function updateDebt(id: string, payload: DebtPayload) {
  const dbPayload = normalizeDebtPayload(payload);
  const { data, error } = await getSupabase()
    .from("debts")
    .update({ ...dbPayload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return computedDebt(data as DebtRow, dbPayload.start_month);
}

export async function deleteDebt(id: string) {
  const { error } = await getSupabase().from("debts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

function normalizeExternalExpense(payload: ExternalExpensePayload): ExternalExpensePayload {
  return {
    ...payload,
    title: payload.title.trim(),
    service_key: payload.service_key.trim().toLowerCase(),
    amount: Math.max(0, Math.round(payload.amount || 0)),
    due_day: Math.max(1, Math.min(31, Math.round(payload.due_day || 1))),
    installments_total: payload.kind === "installments" ? Math.max(1, Math.round(payload.installments_total || 1)) : 1,
    notes: payload.notes ?? ""
  };
}

function externalExpenseInMonth(expense: ExternalExpenseRow, month: string) {
  const diff = monthDiff(monthStart(expense.start_month), monthStart(month));
  if (diff < 0) return false;
  if (expense.kind === "single") return diff === 0;
  if (expense.kind === "installments") return diff < expense.installments_total;
  return true;
}

function externalInstallmentLabel(expense: ExternalExpenseRow, month: string) {
  const diff = monthDiff(monthStart(expense.start_month), monthStart(month));
  if (expense.kind === "installments") return `Cuota ${diff + 1} de ${expense.installments_total}`;
  if (expense.kind === "single") return "Pago único";
  return "Mensual";
}

function buildExternalMonthItem(
  expense: ExternalExpenseRow,
  month: string,
  payment: ExternalExpensePaymentRow | undefined
): ExternalExpenseMonthItem {
  const half = Math.round(expense.amount / 2);
  return {
    ...expense,
    month,
    paid: payment?.paid ?? false,
    paid_at: payment?.paid_at ?? null,
    effective_amount: expense.amount,
    alan_amount: expense.person === "ALAN" ? expense.amount : expense.person === "AMBOS" ? half : 0,
    mairon_amount: expense.person === "MAIRON" ? expense.amount : expense.person === "AMBOS" ? expense.amount - half : 0,
    installment_label: externalInstallmentLabel(expense, month)
  };
}

export async function getBudget(month: string): Promise<BudgetResponse> {
  monthStart(month);
  const expensesResult = await getSupabase()
    .from("external_expenses")
    .select("*")
    .order("category", { ascending: true })
    .order("title", { ascending: true });

  if (expensesResult.error) {
    if (isMissingBudgetTable(expensesResult.error)) {
      return {
        month,
        schema_ready: false,
        message: "Falta ejecutar el SQL nuevo para activar sueldo y gastos externos.",
        incomes: [],
        expenses: [],
        month_items: []
      };
    }
    throw new Error(expensesResult.error.message);
  }

  const [incomeResult, paymentsResult] = await Promise.all([
    getSupabase().from("monthly_incomes").select("*").eq("month", month),
    getSupabase().from("external_expense_payments").select("*").eq("month", month)
  ]);

  const missingResult = incomeResult.error ?? paymentsResult.error;
  if (missingResult) {
    if (isMissingBudgetTable(missingResult)) {
      return {
        month,
        schema_ready: false,
        message: "Falta ejecutar el SQL nuevo para activar sueldo y gastos externos.",
        incomes: [],
        expenses: [],
        month_items: []
      };
    }
    throw new Error(missingResult.message);
  }

  const expenses = (expensesResult.data ?? []) as ExternalExpenseRow[];
  const payments = ((paymentsResult.data ?? []) as ExternalExpensePaymentRow[]).reduce<Record<string, ExternalExpensePaymentRow>>((acc, row) => {
    acc[row.expense_id] = row;
    return acc;
  }, {});

  return {
    month,
    schema_ready: true,
    message: "",
    incomes: (incomeResult.data ?? []) as MonthlyIncome[],
    expenses,
    month_items: expenses
      .filter((expense) => externalExpenseInMonth(expense, month))
      .map((expense) => buildExternalMonthItem(expense, month, payments[expense.id]))
  };
}

export async function updateMonthlyIncome(payload: MonthlyIncomePayload) {
  monthStart(payload.month);
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("monthly_incomes")
    .upsert(
      {
        month: payload.month,
        person: payload.person,
        amount: Math.max(0, Math.round(payload.amount || 0)),
        note: payload.note ?? "",
        updated_at: now
      },
      { onConflict: "month,person" }
    )
    .select("*")
    .single();

  if (error) throw new Error(budgetTableErrorMessage(error));
  return data as MonthlyIncome;
}

export async function createExternalExpense(payload: ExternalExpensePayload) {
  monthStart(payload.start_month);
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("external_expenses")
    .insert({ ...normalizeExternalExpense(payload), created_at: now, updated_at: now })
    .select("*")
    .single();

  if (error) throw new Error(budgetTableErrorMessage(error));
  return data as ExternalExpense;
}

export async function updateExternalExpense(id: string, payload: ExternalExpensePayload) {
  monthStart(payload.start_month);
  const { data, error } = await getSupabase()
    .from("external_expenses")
    .update({ ...normalizeExternalExpense(payload), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(budgetTableErrorMessage(error));
  return data as ExternalExpense;
}

export async function deleteExternalExpense(id: string) {
  const { error } = await getSupabase().from("external_expenses").delete().eq("id", id);
  if (error) throw new Error(budgetTableErrorMessage(error));
  return { ok: true };
}

export async function updateExternalExpensePayment(payload: ExternalExpensePaymentPayload) {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("external_expense_payments")
    .upsert(
      {
        expense_id: payload.expense_id,
        month: payload.month,
        paid: payload.paid,
        paid_at: payload.paid ? now : null,
        updated_at: now
      },
      { onConflict: "expense_id,month" }
    );

  if (error) throw new Error(budgetTableErrorMessage(error));
  return { ok: true };
}
