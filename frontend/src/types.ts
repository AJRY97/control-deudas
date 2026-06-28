export type PayerMode = "alan" | "mairon" | "ambos" | "personalizado";
export type DebtStatus = "active" | "finished" | "upcoming";

export interface DebtPayload {
  title: string;
  category: string;
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
  id: number;
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
