import type { Debt, DebtPayload, MonthlyDetailResponse, SummaryResponse } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? "No se pudo completar la accion.");
  }
  return data as T;
}

export function getSummary(fromMonth: string, months: number) {
  return request<SummaryResponse>(`/api/summary?from_month=${fromMonth}&months=${months}`);
}

export function getMonthDetail(month: string) {
  return request<MonthlyDetailResponse>(`/api/month-detail?month=${month}`);
}

export function createDebt(payload: DebtPayload) {
  return request<Debt>("/api/debts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateDebt(id: number, payload: DebtPayload) {
  return request<Debt>(`/api/debts/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteDebt(id: number) {
  return request<{ ok: boolean }>(`/api/debts/${id}`, {
    method: "DELETE"
  });
}
