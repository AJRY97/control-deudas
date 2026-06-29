import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ListChecks,
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
import {
  createDebt,
  deleteDebt,
  getMonthDetail,
  getMonthPayments,
  getNextPendingMonth,
  getSummary,
  markDebtPaid,
  updateDebt,
  updateMonthPayment
} from "./api";
import type {
  Debt,
  DebtPayload,
  MonthPaymentsResponse,
  MonthlyDetailItem,
  MonthlyDetailResponse,
  PaymentPersonStatus,
  PayerMode,
  ProjectionMonth,
  SummaryResponse
} from "./types";

type FilterKey = "todos" | "alan" | "mairon" | "compartidas";
type MobilePerson = "alan" | "mairon";
type MobileView = "projection" | "month" | "control";
type DesktopScope = MobilePerson | "both";

interface EditorState {
  mode: "create" | "edit";
  id?: string;
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

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return "Sin confirmar";
  const date = new Date(value);
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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
  const [monthDetail, setMonthDetail] = useState<MonthlyDetailResponse | null>(null);
  const [monthPayments, setMonthPayments] = useState<MonthPaymentsResponse | null>(null);
  const [mobilePerson, setMobilePerson] = useState<MobilePerson | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("month");
  const [desktopScope, setDesktopScope] = useState<DesktopScope>("both");
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

  async function loadMonthDetail(month = debtMonth) {
    try {
      const detail = await getMonthDetail(month);
      setMonthDetail(detail.statement ? detail : null);
    } catch {
      setMonthDetail(null);
    }
  }

  async function loadMonthPayments(month = debtMonth) {
    try {
      setMonthPayments(await getMonthPayments(month));
    } catch {
      setMonthPayments(null);
    }
  }

  useEffect(() => {
    void load();
  }, [fromMonth, months]);

  useEffect(() => {
    let active = true;

    async function syncInitialPendingMonth() {
      try {
        const pendingMonth = await getNextPendingMonth(currentMonth(), 60);
        if (!active) return;
        setFromMonth(pendingMonth);
        setDebtMonth(pendingMonth);
      } catch {
        // The regular loaders will surface connection errors in the page.
      }
    }

    void syncInitialPendingMonth();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setDebtMonth(fromMonth);
  }, [fromMonth]);

  useEffect(() => {
    void loadMonthDetail(debtMonth);
    void loadMonthPayments(debtMonth);
  }, [debtMonth]);

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
  const selectedMonthDetail = monthDetail?.month === debtMonth ? monthDetail : null;
  const statement = selectedMonthDetail?.statement ?? null;
  const alanStatement = statement?.people.find((person) => person.person === "ALAN");
  const maironStatement = statement?.people.find((person) => person.person === "MAIRON");
  const statementItems = selectedMonthDetail?.items ?? [];
  const hasStatementItems = statementItems.length > 0;
  const filteredStatementItems = statementItems.filter((item) => {
    if (filter === "alan") return item.person === "ALAN";
    if (filter === "mairon") return item.person === "MAIRON";
    if (filter === "compartidas") return item.shared;
    return true;
  });
  const alanStatementItems = filteredStatementItems.filter((item) => item.person === "ALAN");
  const maironStatementItems = filteredStatementItems.filter((item) => item.person === "MAIRON");
  const alanMobileStatementItems = statementItems.filter((item) => item.person === "ALAN");
  const maironMobileStatementItems = statementItems.filter((item) => item.person === "MAIRON");
  const debtMonthOptions = Array.from(new Set([debtMonth, ...(summary?.projection.map((item) => item.month) ?? [])])).sort(
    (a, b) => monthNumber(a) - monthNumber(b)
  );
  const monthTotals = statement
    ? {
        alan: alanStatement?.settlement_charges ?? 0,
        mairon: maironStatement?.settlement_charges ?? 0
      }
    : {
        alan: monthlyDebts.reduce((sum, debt) => sum + debt.alan_monthly, 0),
        mairon: monthlyDebts.reduce((sum, debt) => sum + debt.mairon_monthly, 0)
      };
  const monthlyPaymentCount = hasStatementItems ? filteredStatementItems.length : debts.length;
  const showAlanList = filter !== "mairon";
  const showMaironList = filter !== "alan";
  const mobilePersonName = mobilePerson === "alan" ? "Alan" : "Mairon";
  const mobileAccent = mobilePerson === "alan" ? "teal" : "amber";
  const mobileDebts = mobilePerson === "alan" ? alanDebts : maironDebts;
  const mobileMonthDebts = mobilePerson === "alan" ? alanMonthDebts : maironMonthDebts;
  const mobileStatementItems = mobilePerson === "alan" ? alanMobileStatementItems : maironMobileStatementItems;
  const mobileAmountKey = mobilePerson === "alan" ? "alan_monthly" : "mairon_monthly";
  const mobileRemainingKey = mobilePerson === "alan" ? "alan_remaining" : "mairon_remaining";
  const mobileMonthlyTotal = mobilePerson === "alan" ? monthTotals.alan : monthTotals.mairon;
  const mobileStatementPerson = mobilePerson === "alan" ? alanStatement : maironStatement;
  const selectedMonthPayments = monthPayments?.month === debtMonth ? monthPayments : null;
  const alanPayment = selectedMonthPayments?.people.find((person) => person.person === "ALAN");
  const maironPayment = selectedMonthPayments?.people.find((person) => person.person === "MAIRON");
  const mobilePayment = mobilePerson === "alan" ? alanPayment : maironPayment;
  const desktopPerson = desktopScope === "both" ? null : desktopScope;
  const desktopPersonName = desktopPerson === "alan" ? "Alan" : "Mairon";
  const desktopAccent = desktopPerson === "alan" ? "teal" : "amber";
  const desktopDebts = desktopPerson === "alan" ? alanDebts : maironDebts;
  const desktopMonthDebts = desktopPerson === "alan" ? alanMonthDebts : maironMonthDebts;
  const desktopStatementItems = desktopPerson === "alan" ? alanMobileStatementItems : maironMobileStatementItems;
  const desktopAmountKey = desktopPerson === "alan" ? "alan_monthly" : "mairon_monthly";
  const desktopRemainingKey = desktopPerson === "alan" ? "alan_remaining" : "mairon_remaining";
  const desktopMonthlyTotal = desktopPerson === "alan" ? monthTotals.alan : monthTotals.mairon;
  const desktopStatementPerson = desktopPerson === "alan" ? alanStatement : maironStatement;
  const desktopPayment = desktopPerson === "alan" ? alanPayment : maironPayment;

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
    await loadMonthPayments(debtMonth);
  }

  async function toggleDebtPaid(debt: Debt) {
    await markDebtPaid(debt.id, !debt.is_paid);
    await load();
    await loadMonthPayments(debtMonth);
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
    await loadMonthPayments(debtMonth);
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

  async function toggleMonthPayment(person: "ALAN" | "MAIRON", paid: boolean) {
    const currentPayment = person === "ALAN" ? alanPayment : maironPayment;
    const amount = currentPayment?.amount ?? currentPayment?.expected_amount ?? 0;
    const updatedPayments = await updateMonthPayment({
      month: debtMonth,
      person,
      paid,
      amount,
      note: currentPayment?.note || (paid ? `Pago de ${formatMonth(debtMonth)} confirmado.` : "")
    });
    setMonthPayments(updatedPayments);

    if (paid) {
      const pendingMonth = await getNextPendingMonth(debtMonth, 60);
      if (pendingMonth !== debtMonth) {
        setFromMonth(pendingMonth);
        setDebtMonth(pendingMonth);
      }
    }
  }

  return (
    <main className="theme-dark min-h-screen bg-[#070b13] text-slate-100">
      <MobileShell
        loading={loading}
        error={error}
        fromMonth={fromMonth}
        setFromMonth={setFromMonth}
        months={months}
        setMonths={setMonths}
        debtMonth={debtMonth}
        setDebtMonth={setDebtMonth}
        debtMonthOptions={debtMonthOptions}
        projection={summary?.projection ?? []}
        mobilePerson={mobilePerson}
        setMobilePerson={setMobilePerson}
        mobileView={mobileView}
        setMobileView={setMobileView}
        mobilePersonName={mobilePersonName}
        mobileAccent={mobileAccent}
        mobileDebts={mobileDebts}
        mobileMonthDebts={mobileMonthDebts}
        mobileStatementItems={mobileStatementItems}
        mobileAmountKey={mobileAmountKey}
        mobileRemainingKey={mobileRemainingKey}
        mobileMonthlyTotal={mobileMonthlyTotal}
        mobileStatementPerson={mobileStatementPerson}
        mobilePayment={mobilePayment}
        selectedMonthDetail={selectedMonthDetail}
        alanProjected={summary?.stats.alan_projected ?? 0}
        maironProjected={summary?.stats.mairon_projected ?? 0}
        alanMonthTotal={monthTotals.alan}
        maironMonthTotal={monthTotals.mairon}
        alanPayment={alanPayment}
        maironPayment={maironPayment}
        onRefresh={() => {
          void load();
          void loadMonthDetail(debtMonth);
          void loadMonthPayments(debtMonth);
        }}
        onCreate={openCreate}
        onTogglePayment={toggleMonthPayment}
        onEdit={openEdit}
        onDelete={(item) => void removeDebt(item)}
        onToggleDebtPaid={(item) => void toggleDebtPaid(item)}
      />

      <div className="mx-auto hidden w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:flex lg:px-8">
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
              onClick={() => {
                void load();
                void loadMonthDetail(debtMonth);
                void loadMonthPayments(debtMonth);
              }}
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

        <DesktopScopeTabs value={desktopScope} onChange={setDesktopScope} />

        {desktopScope === "both" ? (
          <>
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
                {loading ? "Cargando..." : `${monthlyPaymentCount} pagos en ${formatMonth(debtMonth)}`}
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

          <MonthPaymentPanel
            month={debtMonth}
            alan={alanPayment}
            mairon={maironPayment}
            onToggle={(person, paid) => void toggleMonthPayment(person, paid)}
          />

          {selectedMonthDetail && <StatementPanel detail={selectedMonthDetail} />}

          <div className={classNames("grid gap-4", showAlanList && showMaironList ? "xl:grid-cols-2" : "")}>
            {statement && hasStatementItems && showAlanList && (
              <StatementListPanel name="Alan" items={alanStatementItems} accent="teal" month={debtMonth} />
            )}
            {statement && hasStatementItems && showMaironList && (
              <StatementListPanel name="Mairon" items={maironStatementItems} accent="amber" month={debtMonth} />
            )}
            {!hasStatementItems && showAlanList && (
              <DebtListPanel
                name="Alan"
                debts={alanMonthDebts}
                amountKey="alan_monthly"
                accent="teal"
                month={debtMonth}
                onEdit={openEdit}
                onDelete={(item) => void removeDebt(item)}
                onTogglePaid={(item) => void toggleDebtPaid(item)}
              />
            )}
            {!hasStatementItems && showMaironList && (
              <DebtListPanel
                name="Mairon"
                debts={maironMonthDebts}
                amountKey="mairon_monthly"
                accent="amber"
                month={debtMonth}
                onEdit={openEdit}
                onDelete={(item) => void removeDebt(item)}
                onTogglePaid={(item) => void toggleDebtPaid(item)}
              />
            )}
          </div>
        </section>
          </>
        ) : (
          <DesktopPersonDashboard
            person={desktopScope}
            personName={desktopPersonName}
            accent={desktopAccent}
            projection={summary?.projection ?? []}
            months={months}
            setMonths={setMonths}
            debtMonth={debtMonth}
            setDebtMonth={setDebtMonth}
            debtMonthOptions={debtMonthOptions}
            debts={desktopDebts}
            monthDebts={desktopMonthDebts}
            statementItems={desktopStatementItems}
            amountKey={desktopAmountKey}
            remainingKey={desktopRemainingKey}
            monthlyTotal={desktopMonthlyTotal}
            statementPerson={desktopStatementPerson}
            payment={desktopPayment}
            selectedMonthDetail={selectedMonthDetail}
            onTogglePayment={(paid) => void toggleMonthPayment(desktopScope === "alan" ? "ALAN" : "MAIRON", paid)}
            onEdit={openEdit}
            onDelete={(item) => void removeDebt(item)}
            onToggleDebtPaid={(item) => void toggleDebtPaid(item)}
          />
        )}
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

function DesktopScopeTabs({ value, onChange }: { value: DesktopScope; onChange: (value: DesktopScope) => void }) {
  const options: Array<{ key: DesktopScope; label: string; icon: ReactNode }> = [
    { key: "alan", label: "Alan", icon: <UserRound size={17} /> },
    { key: "mairon", label: "Mairon", icon: <UserRound size={17} /> },
    { key: "both", label: "Ambos", icon: <Users size={17} /> }
  ];

  return (
    <nav className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-soft animate-fade-up">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={classNames(
            "inline-flex h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition",
            value === option.key
              ? "border-slate-950 bg-slate-950 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </nav>
  );
}

function DesktopPersonDashboard({
  person,
  personName,
  accent,
  projection,
  months,
  setMonths,
  debtMonth,
  setDebtMonth,
  debtMonthOptions,
  debts,
  monthDebts,
  statementItems,
  amountKey,
  remainingKey,
  monthlyTotal,
  statementPerson,
  payment,
  selectedMonthDetail,
  onTogglePayment,
  onEdit,
  onDelete,
  onToggleDebtPaid
}: {
  person: MobilePerson;
  personName: string;
  accent: "teal" | "amber";
  projection: ProjectionMonth[];
  months: number;
  setMonths: (value: number) => void;
  debtMonth: string;
  setDebtMonth: (value: string) => void;
  debtMonthOptions: string[];
  debts: Debt[];
  monthDebts: Debt[];
  statementItems: MonthlyDetailItem[];
  amountKey: "alan_monthly" | "mairon_monthly";
  remainingKey: "alan_remaining" | "mairon_remaining";
  monthlyTotal: number;
  statementPerson?: {
    settlement_charges: number;
    credit_discount: number;
    pay_now: number;
    cartola_adjustment?: number;
  };
  payment?: PaymentPersonStatus;
  selectedMonthDetail: MonthlyDetailResponse | null;
  onTogglePayment: (paid: boolean) => void;
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
  onToggleDebtPaid: (debt: Debt) => void;
}) {
  const projected = projection.reduce((sum, item) => sum + item[person], 0);
  const remaining = debts.reduce((sum, debt) => sum + debt[remainingKey], 0);
  const active = debts.filter((debt) => debt.status !== "finished").length;
  const payNow = statementPerson?.pay_now ?? monthlyTotal;

  return (
    <div className="flex flex-col gap-5 pb-8">
      <section className="grid gap-3 xl:grid-cols-4">
        <MetricCard
          icon={<UserRound size={18} />}
          label={`${personName} proyectado`}
          value={formatCurrency(projected)}
          tone={accent}
          detail={`${active} deudas activas`}
        />
        <MetricCard
          icon={<CalendarDays size={18} />}
          label={`${personName} en el mes`}
          value={formatCurrency(monthlyTotal)}
          tone={accent}
          detail={formatMonth(debtMonth)}
        />
        <MetricCard
          icon={<CircleDollarSign size={18} />}
          label="Paga ahora"
          value={formatCurrency(payNow)}
          tone={accent}
          detail={payment?.paid ? "Pago confirmado" : "Pendiente de confirmar"}
        />
        <MetricCard
          icon={<ListChecks size={18} />}
          label="Pendiente total"
          value={formatCurrency(remaining)}
          tone="indigo"
          detail="Control de cuotas"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <MobileProjectionView
          person={person}
          personName={personName}
          accent={accent}
          projection={projection}
          months={months}
          setMonths={setMonths}
        />
        <div className="grid gap-3">
          <PaymentPersonCard
            name={personName}
            person={person === "alan" ? "ALAN" : "MAIRON"}
            payment={payment}
            accent={accent}
            onToggle={(_, paid) => onTogglePayment(paid)}
          />
          <PersonPanel name={personName} debts={debts} amountKey={remainingKey} accent={accent} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{personName}: detalle del mes</h2>
            <p className="text-sm text-slate-500">{formatMonth(debtMonth)}</p>
          </div>
          <label className="flex w-fit flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
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
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <MonthTotal label={`${personName} en el mes`} value={monthlyTotal} tone={accent} />
          <MonthTotal label={payment?.paid ? "Pago confirmado" : "Pago pendiente"} value={payment?.amount ?? payNow} tone="slate" />
        </div>

        {statementPerson && (
          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">Paga ahora {personName}</h3>
                <p className="text-sm text-slate-500">
                  Vence {formatDate(selectedMonthDetail?.statement?.due_date ?? null)}
                </p>
              </div>
              <span
                className={classNames(
                  "inline-flex w-fit rounded-md px-3 py-2 text-sm font-semibold",
                  accent === "teal" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
                )}
              >
                {formatCurrency(statementPerson.pay_now)}
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <StatementCell label="Cargos" value={statementPerson.settlement_charges} />
              <StatementCell label="Descuento" value={-statementPerson.credit_discount} />
              <StatementCell label="Ajuste" value={statementPerson.cartola_adjustment ?? 0} />
            </div>
          </article>
        )}

        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          {statementItems.length > 0 ? (
            <StatementListPanel name={personName} items={statementItems} accent={accent} month={debtMonth} />
          ) : (
            <DebtListPanel
              name={personName}
              debts={monthDebts}
              amountKey={amountKey}
              accent={accent}
              month={debtMonth}
              onEdit={onEdit}
              onDelete={onDelete}
              onTogglePaid={onToggleDebtPaid}
            />
          )}
          <MobileControlView
            personName={personName}
            accent={accent}
            debts={debts}
            monthlyKey={amountKey}
            remainingKey={remainingKey}
            onEdit={onEdit}
            onDelete={onDelete}
            onTogglePaid={onToggleDebtPaid}
          />
        </div>
      </section>
    </div>
  );
}

function MobileShell({
  loading,
  error,
  fromMonth,
  setFromMonth,
  months,
  setMonths,
  debtMonth,
  setDebtMonth,
  debtMonthOptions,
  projection,
  mobilePerson,
  setMobilePerson,
  mobileView,
  setMobileView,
  mobilePersonName,
  mobileAccent,
  mobileDebts,
  mobileMonthDebts,
  mobileStatementItems,
  mobileAmountKey,
  mobileRemainingKey,
  mobileMonthlyTotal,
  mobileStatementPerson,
  mobilePayment,
  selectedMonthDetail,
  alanProjected,
  maironProjected,
  alanMonthTotal,
  maironMonthTotal,
  alanPayment,
  maironPayment,
  onRefresh,
  onCreate,
  onTogglePayment,
  onEdit,
  onDelete,
  onToggleDebtPaid
}: {
  loading: boolean;
  error: string;
  fromMonth: string;
  setFromMonth: (value: string) => void;
  months: number;
  setMonths: (value: number) => void;
  debtMonth: string;
  setDebtMonth: (value: string) => void;
  debtMonthOptions: string[];
  projection: ProjectionMonth[];
  mobilePerson: MobilePerson | null;
  setMobilePerson: (value: MobilePerson | null) => void;
  mobileView: MobileView;
  setMobileView: (value: MobileView) => void;
  mobilePersonName: string;
  mobileAccent: "teal" | "amber";
  mobileDebts: Debt[];
  mobileMonthDebts: Debt[];
  mobileStatementItems: MonthlyDetailItem[];
  mobileAmountKey: "alan_monthly" | "mairon_monthly";
  mobileRemainingKey: "alan_remaining" | "mairon_remaining";
  mobileMonthlyTotal: number;
  mobileStatementPerson?: {
    settlement_charges: number;
    credit_discount: number;
    pay_now: number;
    cartola_adjustment?: number;
  };
  mobilePayment?: PaymentPersonStatus;
  selectedMonthDetail: MonthlyDetailResponse | null;
  alanProjected: number;
  maironProjected: number;
  alanMonthTotal: number;
  maironMonthTotal: number;
  alanPayment?: PaymentPersonStatus;
  maironPayment?: PaymentPersonStatus;
  onRefresh: () => void;
  onCreate: () => void;
  onTogglePayment: (person: "ALAN" | "MAIRON", paid: boolean) => Promise<void>;
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
  onToggleDebtPaid: (debt: Debt) => void;
}) {
  return (
    <section className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 px-4 pb-28 pt-4 lg:hidden">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
            <WalletCards size={16} />
            Control de deudas
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            {mobilePerson ? mobilePersonName : "Alan y Mairon"}
          </h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          title="Actualizar"
          aria-label="Actualizar"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50"
        >
          <RefreshCcw size={18} />
        </button>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      )}

      {!mobilePerson ? (
        <MobilePersonMenu
          loading={loading}
          alanProjected={alanProjected}
          maironProjected={maironProjected}
          alanMonthTotal={alanMonthTotal}
          maironMonthTotal={maironMonthTotal}
          alanPayment={alanPayment}
          maironPayment={maironPayment}
          onSelect={(person) => {
            setMobilePerson(person);
            setMobileView("month");
          }}
        />
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-soft animate-fade-up">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setMobilePerson(null)}
                title="Volver"
                aria-label="Volver"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Vista personal</div>
                <div className="truncate text-lg font-semibold text-slate-950">{mobilePersonName}</div>
              </div>
              <span
                className={classNames(
                  "inline-flex rounded-md px-3 py-2 text-sm font-semibold",
                  mobileAccent === "teal" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
                )}
              >
                {formatCurrency(mobileStatementPerson?.pay_now ?? mobileMonthlyTotal)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
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
              Mes listado
              <select
                value={debtMonth}
                onChange={(event) => setDebtMonth(event.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              >
                {debtMonthOptions.map((month) => (
                  <option key={month} value={month}>
                    {formatMonth(month)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <MobileViewButton
              active={mobileView === "projection"}
              icon={<ChartNoAxesColumnIncreasing size={17} />}
              label="Proyeccion"
              onClick={() => setMobileView("projection")}
            />
            <MobileViewButton
              active={mobileView === "month"}
              icon={<CalendarDays size={17} />}
              label="Mes"
              onClick={() => setMobileView("month")}
            />
            <MobileViewButton
              active={mobileView === "control"}
              icon={<ListChecks size={17} />}
              label="Cuotas"
              onClick={() => setMobileView("control")}
            />
          </div>

          {mobileView === "projection" && (
            <MobileProjectionView
              person={mobilePerson}
              personName={mobilePersonName}
              accent={mobileAccent}
              projection={projection}
              months={months}
              setMonths={setMonths}
            />
          )}

          {mobileView === "month" && (
            <MobileMonthView
              personName={mobilePersonName}
              accent={mobileAccent}
              month={debtMonth}
              monthDebts={mobileMonthDebts}
              amountKey={mobileAmountKey}
              monthlyTotal={mobileMonthlyTotal}
              statementItems={mobileStatementItems}
              statementPerson={mobileStatementPerson}
              payment={mobilePayment}
              selectedMonthDetail={selectedMonthDetail}
              onTogglePayment={(paid) => onTogglePayment(mobilePerson === "alan" ? "ALAN" : "MAIRON", paid)}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleDebtPaid={onToggleDebtPaid}
            />
          )}

          {mobileView === "control" && (
            <MobileControlView
              personName={mobilePersonName}
              accent={mobileAccent}
              debts={mobileDebts}
              monthlyKey={mobileAmountKey}
              remainingKey={mobileRemainingKey}
              onEdit={onEdit}
              onDelete={onDelete}
              onTogglePaid={onToggleDebtPaid}
            />
          )}
        </>
      )}

      <button
        type="button"
        onClick={onCreate}
        title="Nueva deuda"
        aria-label="Nueva deuda"
        className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-soft transition hover:bg-teal-700"
      >
        <Plus size={24} />
      </button>
    </section>
  );
}

function MobilePersonMenu({
  loading,
  alanProjected,
  maironProjected,
  alanMonthTotal,
  maironMonthTotal,
  alanPayment,
  maironPayment,
  onSelect
}: {
  loading: boolean;
  alanProjected: number;
  maironProjected: number;
  alanMonthTotal: number;
  maironMonthTotal: number;
  alanPayment?: PaymentPersonStatus;
  maironPayment?: PaymentPersonStatus;
  onSelect: (person: MobilePerson) => void;
}) {
  return (
    <div className="flex flex-col gap-3 animate-fade-up">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
        <div className="text-sm font-semibold text-slate-950">Elige una persona</div>
        <div className="mt-1 text-sm text-slate-500">{loading ? "Cargando..." : "Entraras directo a sus deudas y cuotas."}</div>
      </div>
      <MobilePersonButton
        name="Alan"
        accent="teal"
        projected={alanProjected}
        monthTotal={alanMonthTotal}
        payment={alanPayment}
        onClick={() => onSelect("alan")}
      />
      <MobilePersonButton
        name="Mairon"
        accent="amber"
        projected={maironProjected}
        monthTotal={maironMonthTotal}
        payment={maironPayment}
        onClick={() => onSelect("mairon")}
      />
    </div>
  );
}

function MobilePersonButton({
  name,
  accent,
  projected,
  monthTotal,
  payment,
  onClick
}: {
  name: string;
  accent: "teal" | "amber";
  projected: number;
  monthTotal: number;
  payment?: PaymentPersonStatus;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-soft transition hover:border-slate-400 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className={classNames(
              "inline-flex h-9 w-9 items-center justify-center rounded-md",
              accent === "teal" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"
            )}
          >
            <UserRound size={18} />
          </div>
          <div className="mt-3 text-xl font-semibold text-slate-950">{name}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Mes</div>
          <div className="mt-1 text-base font-semibold text-slate-950">{formatCurrency(monthTotal)}</div>
          <PaymentBadge paid={payment?.paid ?? false} compact />
        </div>
      </div>
      <div className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
        Proyectado {formatCurrency(projected)}
      </div>
    </button>
  );
}

function MobileViewButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-xs font-semibold transition",
        active
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileProjectionView({
  person,
  personName,
  accent,
  projection,
  months,
  setMonths
}: {
  person: MobilePerson;
  personName: string;
  accent: "teal" | "amber";
  projection: ProjectionMonth[];
  months: number;
  setMonths: (value: number) => void;
}) {
  const key = person;
  const max = Math.max(1, ...projection.map((item) => item[key]));
  const total = projection.reduce((sum, item) => sum + item[key], 0);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Proyeccion {personName}</h2>
          <p className="text-sm text-slate-500">{formatCurrency(total)}</p>
        </div>
        <label className="flex w-24 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Meses
          <input
            type="number"
            min={1}
            max={60}
            value={months}
            onChange={(event) => setMonths(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
        </label>
      </div>
      <div className="flex flex-col gap-3">
        {projection.map((item) => (
          <MobileProjectionRow key={`${person}-${item.month}`} item={item} amount={item[key]} max={max} accent={accent} />
        ))}
      </div>
    </article>
  );
}

function MobileProjectionRow({
  item,
  amount,
  max,
  accent
}: {
  item: ProjectionMonth;
  amount: number;
  max: number;
  accent: "teal" | "amber";
}) {
  const width = `${Math.max(0, (amount / max) * 100)}%`;

  return (
    <div className="grid grid-cols-[5.6rem_1fr] items-center gap-3">
      <div className="text-sm font-semibold capitalize text-slate-700">{formatMonth(item.month)}</div>
      <div className="min-w-0">
        <div className="mb-1 text-right text-sm font-semibold text-slate-950">{formatCurrency(amount)}</div>
        <div className="h-2.5 overflow-hidden rounded-md bg-slate-100">
          <div
            className={classNames("h-full rounded-md", accent === "teal" ? "bg-teal-500" : "bg-amber-400")}
            style={{ width }}
          />
        </div>
      </div>
    </div>
  );
}

function MobileMonthView({
  personName,
  accent,
  month,
  monthDebts,
  amountKey,
  monthlyTotal,
  statementItems,
  statementPerson,
  payment,
  selectedMonthDetail,
  onTogglePayment,
  onEdit,
  onDelete,
  onToggleDebtPaid
}: {
  personName: string;
  accent: "teal" | "amber";
  month: string;
  monthDebts: Debt[];
  amountKey: "alan_monthly" | "mairon_monthly";
  monthlyTotal: number;
  statementItems: MonthlyDetailItem[];
  statementPerson?: {
    settlement_charges: number;
    credit_discount: number;
    pay_now: number;
    cartola_adjustment?: number;
  };
  payment?: PaymentPersonStatus;
  selectedMonthDetail: MonthlyDetailResponse | null;
  onTogglePayment: (paid: boolean) => void;
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
  onToggleDebtPaid: (debt: Debt) => void;
}) {
  return (
    <div className="flex flex-col gap-4 animate-fade-up">
      <MonthTotal label={`${personName} en el mes`} value={monthlyTotal} tone={accent} />

      <PaymentPersonCard
        name={personName}
        person={personName.toUpperCase() as "ALAN" | "MAIRON"}
        payment={payment}
        accent={accent}
        onToggle={(_, paid) => onTogglePayment(paid)}
      />

      {statementPerson && (
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Paga ahora</h2>
              <p className="text-sm text-slate-500">
                Vence {formatDate(selectedMonthDetail?.statement?.due_date ?? null)}
              </p>
            </div>
            <span
              className={classNames(
                "rounded-md px-3 py-2 text-sm font-semibold",
                accent === "teal" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
              )}
            >
              {formatCurrency(statementPerson.pay_now)}
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            <StatementCell label="Cargos" value={statementPerson.settlement_charges} />
            <StatementCell label="Descuento" value={-statementPerson.credit_discount} />
            {statementPerson.cartola_adjustment ? (
              <StatementCell label="Ajuste" value={statementPerson.cartola_adjustment} />
            ) : null}
          </div>
        </article>
      )}

      {statementItems.length > 0 ? (
        <StatementListPanel name={personName} items={statementItems} accent={accent} month={month} />
      ) : (
        <DebtListPanel
          name={personName}
          debts={monthDebts}
          amountKey={amountKey}
          accent={accent}
          month={month}
          onEdit={onEdit}
          onDelete={onDelete}
          onTogglePaid={onToggleDebtPaid}
        />
      )}
    </div>
  );
}

function MobileControlView({
  personName,
  accent,
  debts,
  monthlyKey,
  remainingKey,
  onEdit,
  onDelete,
  onTogglePaid
}: {
  personName: string;
  accent: "teal" | "amber";
  debts: Debt[];
  monthlyKey: "alan_monthly" | "mairon_monthly";
  remainingKey: "alan_remaining" | "mairon_remaining";
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
  onTogglePaid: (debt: Debt) => void;
}) {
  const total = debts.reduce((sum, debt) => sum + debt[remainingKey], 0);
  const active = debts.filter((debt) => debt.status !== "finished").length;

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft animate-fade-up">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Control {personName}</h2>
          <p className="text-sm text-slate-500">{active} cuotas activas</p>
        </div>
        <span
          className={classNames(
            "rounded-md px-3 py-2 text-sm font-semibold",
            accent === "teal" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
          )}
        >
          {formatCurrency(total)}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {debts.length === 0 ? (
          <div className="px-4 py-5 text-sm text-slate-500">Sin deudas registradas.</div>
        ) : (
          debts.map((debt) => (
            <MobileControlDebtRow
              key={`${personName}-control-${debt.id}`}
              debt={debt}
              monthlyKey={monthlyKey}
              remainingKey={remainingKey}
              accent={accent}
              onEdit={onEdit}
              onDelete={onDelete}
              onTogglePaid={onTogglePaid}
            />
          ))
        )}
      </div>
    </article>
  );
}

function MobileControlDebtRow({
  debt,
  monthlyKey,
  remainingKey,
  accent,
  onEdit,
  onDelete,
  onTogglePaid
}: {
  debt: Debt;
  monthlyKey: "alan_monthly" | "mairon_monthly";
  remainingKey: "alan_remaining" | "mairon_remaining";
  accent: "teal" | "amber";
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
  onTogglePaid: (debt: Debt) => void;
}) {
  return (
    <div className="grid gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-slate-950">{debt.title}</h3>
          <span
            className={classNames(
              "rounded-md px-2 py-0.5 text-xs font-semibold",
              debt.status === "finished" ? "bg-slate-100 text-slate-600" : accent === "teal" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"
            )}
          >
            {statusLabel(debt)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{formatMonth(debt.start_month)} a {formatMonth(debt.end_month)}</span>
          <span>Cuota {formatCurrency(debt[monthlyKey])}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Pendiente</div>
          <div className="text-base font-semibold text-slate-950">{formatCurrency(debt[remainingKey])}</div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            title={debt.is_paid ? "Reactivar" : "Marcar pagada"}
            aria-label={`${debt.is_paid ? "Reactivar" : "Marcar pagada"} ${debt.title}`}
            onClick={() => onTogglePaid(debt)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-teal-200 text-teal-700 transition hover:bg-slate-50"
          >
            <CheckCircle2 size={16} />
          </button>
          <button
            type="button"
            title="Editar"
            aria-label={`Editar ${debt.title}`}
            onClick={() => onEdit(debt)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            title="Eliminar"
            aria-label={`Eliminar ${debt.title}`}
            onClick={() => onDelete(debt)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
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
          className="absolute left-0 top-0 h-full origin-left bg-amber-400/85 animate-bar-grow"
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

function PaymentBadge({ paid, compact = false }: { paid: boolean; compact?: boolean }) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold",
        compact ? "mt-2 text-xs" : "text-sm",
        paid ? "bg-teal-50 text-teal-900" : "bg-rose-50 text-rose-700"
      )}
    >
      {paid ? <CheckCircle2 size={compact ? 13 : 15} /> : <Clock3 size={compact ? 13 : 15} />}
      {paid ? "Pagado" : "Pendiente"}
    </span>
  );
}

function MonthPaymentPanel({
  month,
  alan,
  mairon,
  onToggle
}: {
  month: string;
  alan?: PaymentPersonStatus;
  mairon?: PaymentPersonStatus;
  onToggle: (person: "ALAN" | "MAIRON", paid: boolean) => void;
}) {
  const paidTotal = [alan, mairon].reduce((sum, item) => sum + (item?.paid ? item.amount : 0), 0);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-teal-700">
            <CircleDollarSign size={17} />
            Pago del mes
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">{formatMonth(month)}</h3>
        </div>
        <span className="inline-flex w-fit rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
          Confirmado {formatCurrency(paidTotal)}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <PaymentPersonCard name="Alan" person="ALAN" payment={alan} accent="teal" onToggle={onToggle} />
        <PaymentPersonCard name="Mairon" person="MAIRON" payment={mairon} accent="amber" onToggle={onToggle} />
      </div>
    </article>
  );
}

function PaymentPersonCard({
  name,
  person,
  payment,
  accent,
  onToggle
}: {
  name: string;
  person: "ALAN" | "MAIRON";
  payment?: PaymentPersonStatus;
  accent: "teal" | "amber";
  onToggle: (person: "ALAN" | "MAIRON", paid: boolean) => void;
}) {
  const paid = payment?.paid ?? false;
  const amount = payment?.amount ?? payment?.expected_amount ?? 0;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className={classNames(
              "inline-flex rounded-md px-2 py-1 text-sm font-semibold",
              accent === "teal" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
            )}
          >
            {name}
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-950">{formatCurrency(amount)}</div>
          <div className="mt-1 text-xs text-slate-500">{paid ? formatDateTime(payment?.paid_at ?? null) : "Aun no confirmado"}</div>
        </div>
        <PaymentBadge paid={paid} />
      </div>
      <button
        type="button"
        onClick={() => onToggle(person, !paid)}
        className={classNames(
          "mt-3 inline-flex h-9 w-full items-center justify-center rounded-md border px-3 text-sm font-semibold transition",
          paid
            ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            : "border-slate-950 bg-slate-950 text-white hover:bg-slate-800"
        )}
      >
        {paid ? "Marcar pendiente" : "Confirmar pago"}
      </button>
    </div>
  );
}

function StatementPanel({ detail }: { detail: MonthlyDetailResponse }) {
  const statement = detail.statement;
  if (!statement) return null;

  const peopleTotal = statement.people.reduce(
    (acc, person) => ({
      charges: acc.charges + person.settlement_charges,
      discount: acc.discount + person.credit_discount,
      payNow: acc.payNow + person.pay_now
    }),
    { charges: 0, discount: 0, payNow: 0 }
  );

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">Cartola {statement.label}</h3>
          <p className="text-sm text-slate-500">
            Vence {formatDate(statement.due_date)} - Total cartola {formatCurrency(statement.statement_total_to_pay)}
          </p>
        </div>
        <span className="inline-flex w-fit rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
          Pagar {formatCurrency(peopleTotal.payNow)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatementMetric label="Cargos del mes" value={peopleTotal.charges} />
        <StatementMetric label="Saldo a favor usado" value={-peopleTotal.discount} />
        <StatementMetric label="Pago exacto ahora" value={peopleTotal.payNow} strong />
      </div>

      <div className="mt-4 grid gap-2">
        {statement.people.map((person) => (
          <StatementSettlementRow
            key={person.person}
            name={person.person === "ALAN" ? "Alan" : "Mairon"}
            charges={person.settlement_charges}
            discount={person.credit_discount}
            payNow={person.pay_now}
            adjustment={person.cartola_adjustment ?? 0}
            accent={person.person === "ALAN" ? "teal" : "amber"}
          />
        ))}
        <StatementSettlementRow
          name="Total"
          charges={peopleTotal.charges}
          discount={peopleTotal.discount}
          payNow={peopleTotal.payNow}
          adjustment={0}
          accent="slate"
        />
      </div>

      {statement.notes && <p className="mt-3 text-sm text-slate-500">{statement.notes}</p>}
    </article>
  );
}

function StatementMetric({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={classNames("rounded-md border px-3 py-3", strong ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50")}>
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-normal text-slate-950">{formatCurrency(value)}</div>
    </div>
  );
}

function StatementSettlementRow({
  name,
  charges,
  discount,
  payNow,
  adjustment,
  accent
}: {
  name: string;
  charges: number;
  discount: number;
  payNow: number;
  adjustment: number;
  accent: "teal" | "amber" | "slate";
}) {
  const accentClass = {
    teal: "bg-teal-50 text-teal-900",
    amber: "bg-amber-50 text-amber-900",
    slate: "bg-slate-100 text-slate-900"
  }[accent];

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_7.5rem] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={classNames("rounded-md px-2 py-1 text-sm font-semibold", accentClass)}>{name}</span>
          {adjustment > 0 && (
            <span className="rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
              Ajuste {formatCurrency(adjustment)}
            </span>
          )}
        </div>
      </div>
      <StatementCell label="Cargos" value={charges} />
      <StatementCell label="Descuento" value={-discount} />
      <StatementCell label="Paga ahora" value={payNow} strong />
    </div>
  );
}

function StatementCell({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:hidden">{label}</span>
      <span className={classNames("text-sm text-slate-950", strong ? "font-bold" : "font-semibold")}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function StatementListPanel({
  name,
  items,
  accent,
  month
}: {
  name: string;
  items: MonthlyDetailItem[];
  accent: "teal" | "amber";
  month: string;
}) {
  const currentItems = items.filter((item) => item.is_current);
  const futureItems = items.filter((item) => item.is_future);
  const currentTotal = currentItems.reduce((sum, item) => sum + item.person_amount, 0);
  const futureTotal = futureItems.reduce((sum, item) => sum + item.person_amount, 0);

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft animate-fade-up">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Lista {name}</h3>
          <p className="text-sm text-slate-500">
            {currentItems.length} cobran en {formatMonth(month)} - {futureItems.length} futuras
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={classNames(
              "inline-flex w-fit rounded-md px-3 py-2 text-sm font-semibold",
              accent === "teal" ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900"
            )}
          >
            {formatCurrency(currentTotal)}
          </span>
          {futureTotal > 0 && (
            <span className="inline-flex w-fit rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
              Futuro {formatCurrency(futureTotal)}
            </span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-5 text-sm text-slate-500">Sin pagos para este filtro.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {currentItems.map((item) => (
            <StatementItemRow key={`${name}-current-${item.source_row ?? item.code}-${item.person_amount}`} item={item} accent={accent} />
          ))}
          {futureItems.length > 0 && (
            <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Proximas cuotas detectadas
            </div>
          )}
          {futureItems.map((item) => (
            <StatementItemRow key={`${name}-future-${item.source_row ?? item.code}-${item.person_amount}`} item={item} accent={accent} />
          ))}
        </div>
      )}
    </article>
  );
}

function StatementItemRow({ item, accent }: { item: MonthlyDetailItem; accent: "teal" | "amber" }) {
  const statusLabel = item.is_adjustment ? "Ajuste" : item.is_future ? "Futura" : "Cartola";

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 break-words text-sm font-semibold text-slate-950">{item.code}</h4>
          <span
            className={classNames(
              "rounded-md px-2 py-0.5 text-xs font-semibold",
              accent === "teal" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"
            )}
          >
            {statusLabel}
          </span>
          {item.shared && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Ambos</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{item.concept}</span>
          <span>{item.installment}</span>
          <span>Termina {item.end_text}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">{item.payer_text}</div>
        {item.note && <div className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">{item.note}</div>}
      </div>

      <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:hidden">Persona</span>
        <span className="text-sm font-semibold text-slate-950">{formatCurrency(item.person_amount)}</span>
      </div>

      <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:hidden">Cuota</span>
        <span className="text-sm font-medium text-slate-700">{formatCurrency(item.statement_monthly)}</span>
      </div>
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
  onDelete,
  onTogglePaid
}: {
  name: string;
  debts: Debt[];
  amountKey: "alan_monthly" | "mairon_monthly";
  accent: "teal" | "amber";
  month: string;
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
  onTogglePaid: (debt: Debt) => void;
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
              onTogglePaid={onTogglePaid}
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
  onDelete,
  onTogglePaid
}: {
  debt: Debt;
  amountKey: "alan_monthly" | "mairon_monthly";
  month: string;
  accent: "teal" | "amber";
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
  onTogglePaid: (debt: Debt) => void;
}) {
  const progress = Math.min(100, Math.max(0, ((monthNumber(month) - monthNumber(debt.start_month) + 1) / debt.installments_total) * 100));
  const isCustom = debt.payer_mode === "personalizado";

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7rem_7rem] sm:items-center">
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
          title={debt.is_paid ? "Reactivar" : "Marcar pagada"}
          aria-label={`${debt.is_paid ? "Reactivar" : "Marcar pagada"} ${debt.title}`}
          onClick={() => onTogglePaid(debt)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-teal-200 text-teal-700 transition hover:bg-slate-50"
        >
          <CheckCircle2 size={16} />
        </button>
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
