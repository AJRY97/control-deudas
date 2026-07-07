export type PayerMode = "alan" | "mairon" | "ambos" | "personalizado";
export type DebtStatus = "active" | "finished" | "upcoming";

export interface DebtPayload {
  title: string;
  category: string;
  purchase_date: string;
  total_amount: number;
  monthly_installment: number;
  installments_total: number;
  start_month: string;
  alan_monthly: number;
  mairon_monthly: number;
  payer_mode: PayerMode;
  source: string;
  notes: string;
}

export interface Debt extends DebtPayload {
  id: string;
  is_paid: boolean;
  paid_at: string | null;
  end_month: string;
  status: DebtStatus;
  paid_installments_as_of: number;
  remaining_installments_as_of: number;
  alan_total: number;
  mairon_total: number;
  alan_remaining: number;
  mairon_remaining: number;
  people_monthly_total: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectionMonth {
  month: string;
  alan: number;
  mairon: number;
  total: number;
  active_debts: number;
}

export interface SummaryStats {
  alan_projected: number;
  mairon_projected: number;
  total_projected: number;
  active_debts: number;
  finished_debts: number;
  alan_end_month: string | null;
  mairon_end_month: string | null;
  peak_month: ProjectionMonth | null;
}

export interface SummaryResponse {
  from_month: string;
  months: number;
  debts: Debt[];
  projection: ProjectionMonth[];
  stats: SummaryStats;
}

export interface StatementPerson {
  person: "ALAN" | "MAIRON";
  excel_current_charges: number;
  excel_future_detected: number;
  cartola_adjustment?: number;
  settlement_charges: number;
  credit_discount: number;
  pay_now: number;
}

export interface MonthlyStatement {
  month: string;
  label: string;
  source_excel: string;
  source_pdf: string;
  due_date: string;
  statement_total_to_pay: number;
  statement_minimum_to_pay: number;
  current_charges_total: number;
  previous_credit: number;
  previous_period_billed: number;
  previous_period_paid: number;
  notes: string;
  people: StatementPerson[];
}

export interface MonthlyDetailItem {
  month: string;
  person: "ALAN" | "MAIRON";
  code: string;
  concept: string;
  total_amount: number;
  statement_monthly: number;
  first_installment_month: string;
  person_amount: number;
  payer_text: string;
  installment: string;
  end_text: string;
  is_future: boolean;
  is_current: boolean;
  is_adjustment: boolean;
  shared: boolean;
  source_row: number | null;
  note: string;
}

export interface MonthlyDetailResponse {
  month: string;
  statement: MonthlyStatement | null;
  items: MonthlyDetailItem[];
  totals: {
    current: number;
    future: number;
    all: number;
  };
}

export interface PaymentPersonStatus {
  month: string;
  person: "ALAN" | "MAIRON";
  paid: boolean;
  amount: number;
  expected_amount: number;
  note: string;
  paid_at: string | null;
  updated_at: string | null;
}

export interface MonthPaymentsResponse {
  month: string;
  people: PaymentPersonStatus[];
  all_paid: boolean;
  paid_total: number;
  pending_total: number;
  expected_total: number;
}

export interface MonthPaymentPayload {
  month: string;
  person: "ALAN" | "MAIRON";
  paid: boolean;
  amount?: number;
  note?: string;
}

export type BudgetPerson = "ALAN" | "MAIRON";
export type ExpensePerson = BudgetPerson | "AMBOS";
export type ExternalExpenseCategory = "subscriptions" | "home" | "custom" | "other_cards" | "external_debts" | "other";
export type ExternalExpenseKind = "recurrent" | "installments" | "single";

export interface MonthlyIncome {
  month: string;
  person: BudgetPerson;
  amount: number;
  note: string;
  updated_at: string | null;
}

export interface ExternalExpensePayload {
  title: string;
  category: ExternalExpenseCategory;
  category_name: string;
  service_key: string;
  person: ExpensePerson;
  amount: number;
  start_month: string;
  due_day: number;
  kind: ExternalExpenseKind;
  installments_total: number;
  notes: string;
}

export interface ExternalExpense extends ExternalExpensePayload {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface ExternalExpenseMonthItem extends ExternalExpense {
  month: string;
  paid: boolean;
  paid_at: string | null;
  effective_amount: number;
  alan_amount: number;
  mairon_amount: number;
  installment_label: string;
}

export interface BudgetResponse {
  month: string;
  schema_ready: boolean;
  message: string;
  incomes: MonthlyIncome[];
  expenses: ExternalExpense[];
  month_items: ExternalExpenseMonthItem[];
  category_payments: ExternalCategoryPaymentStatus[];
}

export interface MonthlyIncomePayload {
  month: string;
  person: BudgetPerson;
  amount: number;
  note?: string;
}

export interface ExternalExpensePaymentPayload {
  expense_id: string;
  month: string;
  paid: boolean;
}

export interface ExternalCategoryPaymentStatus {
  month: string;
  person: BudgetPerson;
  category_key: string;
  category_label: string;
  paid: boolean;
  amount: number;
  note: string;
  paid_at: string | null;
  updated_at: string | null;
}

export interface ExternalCategoryPaymentPayload {
  month: string;
  person: BudgetPerson;
  category_key: string;
  category_label: string;
  paid: boolean;
  amount?: number;
  note?: string;
}
