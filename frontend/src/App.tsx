import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  UserRound,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { createDebt, deleteDebt, getSummary, updateDebt } from "./api";
import type { Debt, DebtPayload, PayerMode, ProjectionMonth, SummaryResponse } from "./types";

type FilterKey = "todos" | "alan" | "mairon" | "compartidas";

interface EditorState {
  mode: "create" | "edit";
  id?: number;
  draft: DebtPayload;
}

const currency = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0
});

const filters: { key: FilterKey; label: string }[] = [
  { key: "todos", label: "Todas" },
  { key: "alan", label: "Alan" },
  { key: "mairon", label: "Mairon" },
  { key: "compartidas", label: "Ambos" }
];

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number) {
  return currency.format(value || 0);
}

function formatMonth(value: string | null) {
  if (!value) return "Sin pagos";
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("es-CL", { month: "short", year: "numeric" }).format(date);
}

function monthNumber(value: string) {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month;
}

function isDebtInMonth(debt: Debt, month: string) {
  const selected = monthNumber(month);
  return monthNumber(debt.start_month) <= selected && selected <= monthNumber(debt.end_month);
}

function installmentLabel(debt: Debt, month: string) {
  const selected = monthNumber(month);
  const start = monthNumber(debt.start_month);
  if (selected < start) return "Por iniciar";
  if (selected > monthNumber(debt.end_month)) return "Pagada";
  return `Cuota ${selected - start + 1} de ${debt.installments_total}`;
}

function defaultDraft(fromMonth: string): DebtPayload {
  return {
    title: "",
    category: "Manual",
    total_amount: 0,
    monthly_installment: 0,
    installments_total: 1,
    start_month: fromMonth,
    alan_monthly: 0,
    mairon_monthly: 0,
    payer_mode: "ambos",
    source: "Manual",
    notes: ""
  };
}

function syncShares(draft: DebtPayload, mode: PayerMode, monthly = draft.monthly_installment) {
  if (mode === "alan") {
    return { ...draft, payer_mode: mode, alan_monthly: monthly, mairon_monthly: 0 };
  }
  if (mode === "mairon") {
    return { ...draft, payer_mode: mode, alan_monthly: 0, mairon_monthly: monthly };
  }
  if (mode === "ambos") {
    const half = Math.round(monthly / 2);
    return { ...draft, payer_mode: mode, alan_monthly: half, mairon_monthly: monthly - half };
  }
  return { ...draft, payer_mode: mode };
}

function debtToDraft(debt: Debt): DebtPayload {
  return {
    title: debt.title,
    category: debt.category,
    total_amount: debt.total_amount,
    monthly_installment: debt.monthly_installment,
    installments_total: debt.installments_total,
    start_month: debt.start_month,
    alan_monthly: debt.alan_monthly,
    mairon_monthly: debt.mairon_monthly,
    payer_mode: debt.payer_mode,
    source: debt.source,
    notes: debt.notes
  };
}

function statusLabel(debt: Debt) {
  if (debt.status === "finished") return "Pagada";
  if (debt.status === "upcoming") return "Próxima";
  return `Cuota ${debt.paid_installments_as_of} de ${debt.installments_total}`;
}

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

export default function App() {
  const [fromMonth, setFromMonth] = useState(currentMonth());
  const [debtMonth, setDebtMonth] = useState(currentMonth());
  const [months, setMonths] = useState(24);
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setSummary(await getSummary(fromMonth, months));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [fromMonth, months]);

  useEffect(() => {
    setDebtMonth(fromMonth);
  }, [fromMonth]);

  const allDebts = summary?.debts ?? [];
  const monthlyDebts = useMemo(() => allDebts.filter((debt) => isDebtInMonth(debt, debtMonth)), [allDebts, debtMonth]);

  const debts = useMemo(() => {
    if (filter === "alan") return monthlyDebts.filter((debt) => debt.alan_monthly > 0);
    if (filter === "mairon") return monthlyDebts.filter((debt) => debt.mairon_monthly > 0);
    if (filter === "compartidas") {
      return monthlyDebts.filter((debt) => debt.alan_monthly > 0 && debt.mairon_monthly > 0);
    }
    return monthlyDebts;
  }, [monthlyDebts, filter]);

  const maxProjection = Math.max(1, ...(summary?.projection.map((item) => item.total) ?? [1]));
  const alanDebts = summary?.debts.filter((debt) => debt.alan_monthly > 0) ?? [];
  const maironDebts = summary?.debts.filter((debt) => debt.mairon_monthly > 0) ?? [];
  const alanMonthDebts = debts.filter((debt) => debt.alan_monthly > 0);
  const maironMonthDebts = debts.filter((debt) => debt.mairon_monthly > 0);
  const debtMonthOptions = Array.from(new Set([debtMonth, ...(summary?.projection.map((item) => item.month) ?? [])])).sort(
    (a, b) => monthNumber(a) - monthNumber(b)
  );
  const monthTotals = {
    alan: monthlyDebts.reduce((sum, debt) => sum + debt.alan_monthly, 0),
    mairon: monthlyDebts.reduce((sum, debt) => sum + debt.mairon_monthly, 0)
  };
  const showAlanList = filter !== "mairon";
  const showMaironList = filter !== "alan";

  function openCreate() {
    setEditor({ mode: "create", draft: defaultDraft(fromMonth) });
  }

  function openEdit(debt: Debt) {
    setEditor({ mode: "edit", id: debt.id, draft: debtToDraft(debt) });
  }

  async function removeDebt(debt: Debt) {
    if (!window.confirm(`Eliminar ${debt.title}?`)) return;
    await deleteDebt(debt.id);
    await load();
  }

  async function saveDebt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    if (editor.mode === "create") {
      await createDebt(editor.draft);
    } else if (editor.id) {
      await updateDebt(editor.id, editor.draft);
    }
    setEditor(null);
    await load();
  }

  function updateDraft(next: DebtPayload) {
    setEditor((current) => (current ? { ...current, draft: next } : current));
  }

  function updateDraftText(key: keyof DebtPayload, value: string) {
    if (!editor) return;
    updateDraft({ ...editor.draft, [key]: value });
  }

  function updateDraftNumber(key: keyof DebtPayload, value: string) {
    if (!editor) return;
    const numeric = Math.max(0, Number(value) || 0);
    let next = { ...editor.draft, [key]: numeric };

    if (key === "total_amount" || key === "installments_total") {
      const installments = Math.max(1, key === "installments_total" ? numeric : next.installments_total);
      const total = key === "total_amount" ? numeric : next.total_amount;
      const monthly = Math.round(total / installments);
      next = { ...next, installments_total: installments, monthly_installment: monthly };
      if (next.payer_mode !== "personalizado") {
        next = syncShares(next, next.payer_mode, monthly);
      }
    }

    if (key === "monthly_installment" && next.payer_mode !== "personalizado") {
      next = syncShares(next, next.payer_mode, numeric);
    }

    updateDraft(next);
  }

  function updateMode(mode: PayerMode) {
    if (!editor) return;
    updateDraft(syncShares(editor.draft, mode));
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
              <WalletCards size={18} />
              Deudas Alan y Mairon
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">
              Control de cuotas
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Desde
              <input
                type="month"
                value={fromMonth}
                onChange={(event) => setFromMonth(event.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Meses
              <input
                type="number"
                min={1}
                max={60}
                value={months}
                onChange={(event) => setMonths(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              title="Actualizar"
              aria-label="Actualizar"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              <RefreshCcw size={18} />
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-slate-800"
            >
              <Plus size={18} />
              Nueva
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<UserRound size={18} />}
            label="Alan proyectado"
            value={formatCurrency(summary?.stats.alan_projected ?? 0)}
            tone="teal"
            detail={`Termina ${formatMonth(summary?.stats.alan_end_month ?? null)}`}
          />
          <MetricCard
            icon={<UserRound size={18} />}
            label="Mairon proyectado"
            value={formatCurrency(summary?.stats.mairon_projected ?? 0)}
            tone="amber"
            detail={`Termina ${formatMonth(summary?.stats.mairon_end_month ?? null)}`}
          />
          <MetricCard
            icon={<Users size={18} />}
            label="Total ambos"
            value={formatCurrency(summary?.stats.total_projected ?? 0)}
            tone="rose"
            detail={`${summary?.stats.active_debts ?? 0} deudas por proyectar`}
          />
          <MetricCard
            icon={<CalendarDays size={18} />}
            label="Mes más alto"
            value={formatCurrency(summary?.stats.peak_month?.total ?? 0)}
            tone="indigo"
            detail={formatMonth(summary?.stats.peak_month?.month ?? null)}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ChartNoAxesColumnIncreasing size={19} className="text-teal-700" />
                <h2 className="text-lg font-semibold text-slate-950">Proyección mensual</h2>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                {months} meses
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {(summary?.projection ?? []).map((item) => (
                <ProjectionRow key={item.month} item={item} max={maxProjection} />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <PersonPanel name="Alan" debts={alanDebts} amountKey="alan_remaining" accent="teal" />
            <PersonPanel name="Mairon" debts={maironDebts} amountKey="mairon_remaining" accent="amber" />
          </div>
        </section>

        <section className="flex flex-col gap-4 pb-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Deudas del mes</h2>
              <p className="text-sm text-slate-500">
                {loading ? "Cargando..." : `${debts.length} pagos en ${formatMonth(debtMonth)}`}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Mes listado
                <select
                  value={debtMonth}
                  onChange={(event) => setDebtMonth(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                >
                  {debtMonthOptions.map((month) => (
                    <option key={month} value={month}>
                      {formatMonth(month)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
                {filters.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={classNames(
                      "h-9 shrink-0 rounded-md border px-3 text-sm font-semibold transition",
                      filter === item.key
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MonthTotal label="Alan en el mes" value={monthTotals.alan} tone="teal" />
            <MonthTotal label="Mairon en el mes" value={monthTotals.mairon} tone="amber" />
            <MonthTotal label="Total del mes" value={monthTotals.alan + monthTotals.mairon} tone="slate" />
          </div>

          <div className={classNames("grid gap-4", showAlanList && showMaironList ? "xl:grid-cols-2" : "")}>
            {showAlanList && (
              <DebtListPanel
                name="Alan"
                debts={alanMonthDebts}
                amountKey="alan_monthly"
                accent="teal"
                month={debtMonth}
                onEdit={openEdit}
                onDelete={(item) => void removeDebt(item)}
              />
            )}
            {showMaironList && (
              <DebtListPanel
                name="Mairon"
                debts={maironMonthDebts}
                amountKey="mairon_monthly"
                accent="amber"
                month={debtMonth}
                onEdit={openEdit}
                onDelete={(item) => void removeDebt(item)}
              />
            )}
          </div>
        </section>
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form
            onSubmit={(event) => void saveDebt(event)}
            className="max-h-[94vh] w-full overflow-y-auto rounded-t-lg bg-white p-4 shadow-soft animate-fade-up sm:mx-auto sm:max-w-2xl sm:rounded-lg sm:p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  {editor.mode === "create" ? "Nueva deuda" : "Editar deuda"}
                </h2>
                <p className="text-sm text-slate-500">{editor.draft.source || "Manual"}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                title="Cerrar"
                aria-label="Cerrar"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Concepto" className="sm:col-span-2">
                <input
                  value={editor.draft.title}
                  onChange={(event) => updateDraftText("title", event.target.value)}
                  className="input"
                  required
                />
              </Field>
              <Field label="Categoría">
                <input
                  value={editor.draft.category}
                  onChange={(event) => updateDraftText("category", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Mes inicio">
                <input
                  type="month"
                  value={editor.draft.start_month}
                  onChange={(event) => updateDraftText("start_month", event.target.value)}
                  className="input"
                  required
                />
              </Field>
              <Field label="Total deuda">
                <input
                  type="number"
                  min={0}
                  value={editor.draft.total_amount}
                  onChange={(event) => updateDraftNumber("total_amount", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Cuotas">
                <input
                  type="number"
                  min={1}
                  value={editor.draft.installments_total}
                  onChange={(event) => updateDraftNumber("installments_total", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Cuota total">
                <input
                  type="number"
                  min={0}
                  value={editor.draft.monthly_installment}
                  onChange={(event) => updateDraftNumber("monthly_installment", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Responsable">
                <div className="grid grid-cols-4 gap-1 rounded-md border border-slate-300 bg-slate-50 p-1">
                  {(["alan", "mairon", "ambos", "personalizado"] as PayerMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updateMode(mode)}
                      className={classNames(
                        "h-9 rounded-md text-xs font-semibold capitalize transition",
                        editor.draft.payer_mode === mode
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      )}
                    >
                      {mode === "personalizado" ? "Manual" : mode}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Alan paga">
                <input
                  type="number"
                  min={0}
                  value={editor.draft.alan_monthly}
                  onChange={(event) => updateDraftNumber("alan_monthly", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Mairon paga">
                <input
                  type="number"
                  min={0}
                  value={editor.draft.mairon_monthly}
                  onChange={(event) => updateDraftNumber("mairon_monthly", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Observación" className="sm:col-span-2">
                <textarea
                  value={editor.draft.notes}
                  onChange={(event) => updateDraftText("notes", event.target.value)}
                  className="input min-h-24 resize-y py-2"
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                Alan {formatCurrency(editor.draft.alan_monthly)} · Mairon {formatCurrency(editor.draft.mairon_monthly)}
              </div>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800"
              >
                <Save size={18} />
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "teal" | "amber" | "rose" | "indigo";
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    indigo: "bg-indigo-50 text-indigo-700"
  }[tone];

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
      <div className="flex items-center justify-between gap-3">
        <span className={classNames("inline-flex h-9 w-9 items-center justify-center rounded-md", toneClass)}>
          {icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      </div>
      <div className="mt-4 text-2xl font-semibold tracking-normal text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{detail}</div>
    </article>
  );
}

function ProjectionRow({ item, max }: { item: ProjectionMonth; max: number }) {
  const alanWidth = `${Math.max(0, (item.alan / max) * 100)}%`;
  const maironWidth = `${Math.max(0, (item.mairon / max) * 100)}%`;
  return (
    <div className="grid grid-cols-[5.8rem_1fr] items-center gap-3 sm:grid-cols-[6.6rem_1fr_8.4rem]">
      <div className="text-sm font-semibold capitalize text-slate-700">{formatMonth(item.month)}</div>
      <div className="relative h-8 overflow-hidden rounded-md bg-slate-100">
        <div
          className="absolute left-0 top-0 h-full origin-left bg-teal-500/80 animate-bar-grow"
          style={{ width: alanWidth }}
        />
        <div
          className="absolute left-0 top-0 h-full origin-left bg-amber-400/80 mix-blend-multiply animate-bar-grow"
          style={{ width: maironWidth, transform: `translateX(${alanWidth})` }}
        />
      </div>
      <div className="text-right text-sm font-semibold text-slate-900">{formatCurrency(item.total)}</div>
    </div>
  );
}

function PersonPanel({
  name,
  debts,
  amountKey,
  accent
}: {
  name: string;
  debts: Debt[];
  amountKey: "alan_remaining" | "mairon_remaining";
  accent: "teal" | "amber";
}) {
  const total = debts.reduce((sum, debt) => sum + debt[amountKey], 0);
  const active = debts.filter((debt) => debt.status !== "finished").length;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{name}</h2>
          <p className="text-sm text-slate-500">{active} activas</p>
        </div>
        <span
          className={classNames(
            "inline-flex h-9 w-9 items-center justify-center rounded-md",
            accent === "teal" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"
          )}
        >
          <UserRound size={18} />
        </span>
      </div>
      <div className="mt-4 text-2xl font-semibold tracking-normal text-slate-950">{formatCurrency(total)}</div>
      <div className="mt-3 flex flex-col gap-2">
        {debts
          .filter((debt) => debt.status !== "finished")
          .slice(0, 4)
          .map((debt) => (
            <div key={`${name}-${debt.id}`} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium text-slate-700">{debt.title}</span>
              <span className="font-semibold text-slate-950">{formatCurrency(debt[amountKey])}</span>
            </div>
          ))}
      </div>
    </article>
  );
}

function MonthTotal({ label, value, tone }: { label: string; value: number; tone: "teal" | "amber" | "slate" }) {
  const toneClass = {
    teal: "border-teal-200 bg-teal-50 text-teal-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    slate: "border-slate-200 bg-white text-slate-950"
  }[tone];

  return (
    <div className={classNames("rounded-lg border px-4 py-3 shadow-soft", toneClass)}>
      <div className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-normal">{formatCurrency(value)}</div>
    </div>
  );
}

function DebtListPanel({
  name,
  debts,
  amountKey,
  accent,
  month,
  onEdit,
  onDelete
}: {
  name: string;
  debts: Debt[];
  amountKey: "alan_monthly" | "mairon_monthly";
  accent: "teal" | "amber";
  month: string;
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
}) {
  const total = debts.reduce((sum, debt) => sum + debt[amountKey], 0);

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft animate-fade-up">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Lista {name}</h3>
          <p className="text-sm text-slate-500">
            {debts.length} pagos · {formatMonth(month)}
          </p>
        </div>
        <span
          className={classNames(
            "inline-flex w-fit rounded-md px-3 py-2 text-sm font-semibold",
            accent === "teal" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
          )}
        >
          {formatCurrency(total)}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {debts.length === 0 ? (
          <div className="px-4 py-5 text-sm text-slate-500">Sin pagos para este filtro.</div>
        ) : (
          debts.map((debt) => (
            <DebtListRow
              key={`${name}-${debt.id}`}
              debt={debt}
              amountKey={amountKey}
              month={month}
              accent={accent}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </article>
  );
}

function DebtListRow({
  debt,
  amountKey,
  month,
  accent,
  onEdit,
  onDelete
}: {
  debt: Debt;
  amountKey: "alan_monthly" | "mairon_monthly";
  month: string;
  accent: "teal" | "amber";
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
}) {
  const progress = Math.min(100, Math.max(0, ((monthNumber(month) - monthNumber(debt.start_month) + 1) / debt.installments_total) * 100));
  const isCustom = debt.payer_mode === "personalizado";

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7rem_4.75rem] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-sm font-semibold text-slate-950">{debt.title}</h4>
          {isCustom && (
            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Manual</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{formatMonth(debt.start_month)} a {formatMonth(debt.end_month)}</span>
          <span>Cuota total {formatCurrency(debt.monthly_installment)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-md bg-slate-100">
          <div
            className={classNames("h-full rounded-md", accent === "teal" ? "bg-teal-600" : "bg-amber-500")}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:block">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:hidden">Monto</span>
        <span className="text-sm font-semibold text-slate-950">{formatCurrency(debt[amountKey])}</span>
      </div>

      <div className="flex items-center justify-between gap-3 sm:block">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:hidden">Estado</span>
        <span className="text-sm font-medium text-slate-700">{installmentLabel(debt, month)}</span>
      </div>

      <div className="flex justify-end gap-1">
        <button
          type="button"
          title="Editar"
          aria-label={`Editar ${debt.title}`}
          onClick={() => onEdit(debt)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          title="Eliminar"
          aria-label={`Eliminar ${debt.title}`}
          onClick={() => onDelete(debt)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={classNames("flex flex-col gap-1 text-sm font-semibold text-slate-700", className)}>
      {label}
      {children}
    </label>
  );
}
