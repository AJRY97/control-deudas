import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Banknote,
  Bot,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Home,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Repeat2,
  ReceiptText,
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
  getBudget,
  getSummary,
  paymentMonthFromPurchaseDate,
  createExternalExpense,
  deleteExternalExpense,
  updateExternalExpense,
  updateExternalExpensePayment,
  updateDebt,
  updateMonthPayment,
  updateMonthlyIncome
} from "./api";
import { SiIcloud, SiNetflix, SiParamountplus, SiSpotify, SiYoutube } from "react-icons/si";
import type {
  BudgetResponse,
  Debt,
  DebtPayload,
  ExternalExpense,
  ExternalExpenseCategory,
  ExternalExpenseKind,
  ExternalExpenseMonthItem,
  ExternalExpensePayload,
  ExpensePerson,
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
type MobileView = "budget" | "projection" | "month" | "control" | "external";
type DesktopScope = MobilePerson | "both";

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  draft: DebtPayload;
}

interface ExternalEditorState {
  mode: "create" | "edit";
  id?: string;
  draft: ExternalExpensePayload;
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

const externalCategories: Array<{
  key: ExternalExpenseCategory;
  label: string;
  description: string;
  icon: ReactNode;
  tone: "teal" | "amber" | "rose" | "indigo" | "slate";
}> = [
  { key: "subscriptions", label: "Suscripciones", description: "Apps y servicios", icon: <Repeat2 size={18} />, tone: "teal" },
  { key: "home", label: "Hogar", description: "Internet, luz, agua", icon: <Home size={18} />, tone: "amber" },
  { key: "other_cards", label: "Otras tarjetas", description: "Pagos fuera de Cencosud", icon: <CreditCard size={18} />, tone: "indigo" },
  { key: "external_debts", label: "Deudas externas", description: "Cuotas directas", icon: <ReceiptText size={18} />, tone: "rose" },
  { key: "other", label: "Otros gastos", description: "Bolsillo y varios", icon: <MoreHorizontal size={18} />, tone: "slate" }
];

const subscriptionServices: Array<{ key: string; label: string; icon: ReactNode; tone: string }> = [
  { key: "youtube", label: "YouTube Premium", icon: <SiYoutube size={18} />, tone: "bg-red-500/15 text-red-300" },
  { key: "netflix", label: "Netflix", icon: <SiNetflix size={18} />, tone: "bg-red-600/15 text-red-300" },
  { key: "paramount", label: "Paramount+", icon: <SiParamountplus size={18} />, tone: "bg-blue-500/15 text-blue-300" },
  { key: "icloud", label: "iCloud", icon: <SiIcloud size={18} />, tone: "bg-sky-400/15 text-sky-200" },
  { key: "spotify", label: "Spotify", icon: <SiSpotify size={18} />, tone: "bg-green-500/15 text-green-300" },
  { key: "chatgpt", label: "ChatGPT", icon: <Bot size={18} />, tone: "bg-teal-500/15 text-teal-200" }
];

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatCurrency(value: number) {
  return currency.format(value || 0);
}

function numberFieldValue(value: number, emptyWhenZero = true) {
  return emptyWhenZero && value === 0 ? "" : String(value);
}

function moneyFieldValue(value: number) {
  return value === 0 ? "" : formatCurrency(value);
}

function numericInputValue(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function formatMonth(value: string | null) {
  if (!value) return "Sin pagos";
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("es-CL", { month: "short", year: "numeric" }).format(date);
}

function monthDate(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function addMonthsToKey(value: string, months: number) {
  const date = monthDate(value);
  return `${date.getFullYear() + Math.floor((date.getMonth() + months) / 12)}-${String((((date.getMonth() + months) % 12) + 12) % 12 + 1).padStart(2, "0")}`;
}

function statementMonthFromPaymentMonth(paymentMonth: string) {
  return addMonthsToKey(paymentMonth, -1);
}

function formatExpenseMonth(paymentMonth: string) {
  return `Gastos de ${formatMonth(statementMonthFromPaymentMonth(paymentMonth))}`;
}

function formatSalaryMonth(paymentMonth: string) {
  return `Se paga con sueldo de ${formatMonth(paymentMonth)}`;
}

function formatBillingMonthOption(paymentMonth: string) {
  return `${formatMonth(statementMonthFromPaymentMonth(paymentMonth))} · sueldo ${formatMonth(paymentMonth)}`;
}

function billingPeriodLabel(paymentMonth: string) {
  const statementDate = monthDate(statementMonthFromPaymentMonth(paymentMonth));
  const from = new Date(statementDate.getFullYear(), statementDate.getMonth() - 1, 26);
  const to = new Date(statementDate.getFullYear(), statementDate.getMonth(), 25);
  return `${formatDate(dateKey(from))} - ${formatDate(dateKey(to))}`;
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function categoryInfo(category: ExternalExpenseCategory) {
  return externalCategories.find((item) => item.key === category) ?? externalCategories[externalCategories.length - 1];
}

function serviceInfo(serviceKey: string, title = "") {
  const normalized = `${serviceKey} ${title}`.toLowerCase();
  return (
    subscriptionServices.find((item) => normalized.includes(item.key)) ?? {
      key: serviceKey || "custom",
      label: title || "Servicio",
      icon: <Repeat2 size={18} />,
      tone: "bg-slate-700 text-slate-200"
    }
  );
}

function expensePersonLabel(person: ExpensePerson | "BOTH") {
  if (person === "ALAN") return "Alan";
  if (person === "MAIRON") return "Mairon";
  return "ambos";
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

function defaultDraft(fromMonth: string, person?: MobilePerson | null): DebtPayload {
  const purchaseDate = currentDateKey();
  const paymentMonth = paymentMonthFromPurchaseDate(purchaseDate) || fromMonth;
  const draft: DebtPayload = {
    title: "",
    category: person ? "Tarjeta Cencosud" : "Manual",
    purchase_date: purchaseDate,
    total_amount: 0,
    monthly_installment: 0,
    installments_total: 1,
    start_month: paymentMonth,
    alan_monthly: 0,
    mairon_monthly: 0,
    payer_mode: "ambos",
    source: person ? "Tarjeta Cencosud" : "Manual",
    notes: ""
  };

  return person ? syncShares(draft, person) : draft;
}

function defaultExternalDraft(month: string, person: MobilePerson | null, category: ExternalExpenseCategory = "subscriptions"): ExternalExpensePayload {
  return {
    title: "",
    category,
    service_key: "",
    person: person === "alan" ? "ALAN" : person === "mairon" ? "MAIRON" : "AMBOS",
    amount: 0,
    start_month: month,
    due_day: 1,
    kind: "recurrent",
    installments_total: 1,
    notes: ""
  };
}

function externalToDraft(expense: ExternalExpense): ExternalExpensePayload {
  return {
    title: expense.title,
    category: expense.category,
    service_key: expense.service_key,
    person: expense.person,
    amount: expense.amount,
    start_month: expense.start_month,
    due_day: expense.due_day,
    kind: expense.kind,
    installments_total: expense.installments_total,
    notes: expense.notes
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
    purchase_date: debt.purchase_date || "",
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
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [mobilePerson, setMobilePerson] = useState<MobilePerson | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("budget");
  const [desktopScope, setDesktopScope] = useState<DesktopScope>("both");
  const [selectedExternalCategory, setSelectedExternalCategory] = useState<ExternalExpenseCategory>("subscriptions");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [externalEditor, setExternalEditor] = useState<ExternalEditorState | null>(null);

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

  async function loadBudget(month = debtMonth) {
    try {
      setBudget(await getBudget(month));
    } catch (err) {
      setBudget({
        month,
        schema_ready: false,
        message: err instanceof Error ? err.message : "No se pudo cargar sueldo y gastos externos.",
        incomes: [],
        expenses: [],
        month_items: []
      });
    }
  }

  async function refreshAll() {
    setRefreshing(true);
    setRefreshDone(false);
    await Promise.all([load(), loadMonthDetail(debtMonth), loadMonthPayments(debtMonth), loadBudget(debtMonth)]);
    setRefreshing(false);
    setRefreshDone(true);
    window.setTimeout(() => setRefreshDone(false), 900);
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
    void loadBudget(debtMonth);
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
  const selectedBudget = budget?.month === debtMonth ? budget : null;
  const externalMonthItems = selectedBudget?.month_items ?? [];
  const incomeFor = (person: "ALAN" | "MAIRON") => selectedBudget?.incomes.find((item) => item.person === person)?.amount ?? 0;
  const externalFor = (person: "ALAN" | "MAIRON") =>
    externalMonthItems.reduce((sum, item) => sum + (person === "ALAN" ? item.alan_amount : item.mairon_amount), 0);
  const paidExternalFor = (person: "ALAN" | "MAIRON") =>
    externalMonthItems.reduce((sum, item) => sum + (item.paid ? (person === "ALAN" ? item.alan_amount : item.mairon_amount) : 0), 0);
  const alanBudget = {
    income: incomeFor("ALAN"),
    credit: monthTotals.alan,
    external: externalFor("ALAN"),
    externalPaid: paidExternalFor("ALAN")
  };
  const maironBudget = {
    income: incomeFor("MAIRON"),
    credit: monthTotals.mairon,
    external: externalFor("MAIRON"),
    externalPaid: paidExternalFor("MAIRON")
  };
  const mobileBudget = mobilePerson === "alan" ? alanBudget : maironBudget;
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
  const desktopBudget = desktopPerson === "alan" ? alanBudget : maironBudget;
  const externalEditorExistingItems = externalEditor
    ? externalMonthItems
        .filter((item) => {
          if (item.id === externalEditor.id) return false;
          if (item.category !== externalEditor.draft.category) return false;
          if (externalEditor.draft.person === "AMBOS") return item.person === "AMBOS";
          return personAmount(item, externalEditor.draft.person) > 0;
        })
        .slice(0, 4)
    : [];

  function openCreate(person?: MobilePerson | null) {
    const scopedPerson = person ?? (desktopScope === "both" ? null : desktopScope);
    setEditor({ mode: "create", draft: defaultDraft(fromMonth, scopedPerson) });
  }

  function openEdit(debt: Debt) {
    setEditor({ mode: "edit", id: debt.id, draft: debtToDraft(debt) });
  }

  function openExternalCreate(category: ExternalExpenseCategory = selectedExternalCategory) {
    setSelectedExternalCategory(category);
    setExternalEditor({ mode: "create", draft: defaultExternalDraft(debtMonth, mobilePerson, category) });
  }

  function openExternalEdit(expense: ExternalExpense) {
    setSelectedExternalCategory(expense.category);
    setExternalEditor({ mode: "edit", id: expense.id, draft: externalToDraft(expense) });
  }

  async function removeDebt(debt: Debt) {
    if (!window.confirm(`Eliminar ${debt.title}?`)) return;
    await deleteDebt(debt.id);
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

  async function saveIncome(person: "ALAN" | "MAIRON", amount: number) {
    setError("");
    try {
      await updateMonthlyIncome({ month: debtMonth, person, amount });
      await loadBudget(debtMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el sueldo.");
    }
  }

  async function saveExternalExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!externalEditor) return;
    setError("");
    try {
      if (externalEditor.mode === "create") {
        await createExternalExpense(externalEditor.draft);
      } else if (externalEditor.id) {
        await updateExternalExpense(externalEditor.id, externalEditor.draft);
      }
      setExternalEditor(null);
      await loadBudget(debtMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el gasto externo.");
    }
  }

  async function removeExternalExpense(expense: ExternalExpense) {
    if (!window.confirm(`Eliminar ${expense.title}?`)) return;
    setError("");
    try {
      await deleteExternalExpense(expense.id);
      await loadBudget(debtMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el gasto externo.");
    }
  }

  async function toggleExternalPayment(expense: ExternalExpenseMonthItem, paid: boolean) {
    setError("");
    try {
      await updateExternalExpensePayment({ expense_id: expense.id, month: debtMonth, paid });
      await loadBudget(debtMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el pago.");
    }
  }

  function updateDraft(next: DebtPayload) {
    setEditor((current) => (current ? { ...current, draft: next } : current));
  }

  function updateDraftText(key: keyof DebtPayload, value: string) {
    if (!editor) return;
    if (key === "purchase_date") {
      updatePurchaseDate(value);
      return;
    }
    updateDraft({ ...editor.draft, [key]: value });
  }

  function updatePurchaseDate(value: string) {
    if (!editor) return;
    const paymentMonth = paymentMonthFromPurchaseDate(value) || editor.draft.start_month;
    updateDraft({ ...editor.draft, purchase_date: value, start_month: paymentMonth });
  }

  function updateDraftNumber(key: keyof DebtPayload, value: string) {
    if (!editor) return;
    const rawNumeric = numericInputValue(value);
    const numeric = key === "installments_total" ? Math.max(1, Math.min(24, rawNumeric || 1)) : Math.max(0, rawNumeric);
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

  function updateExternalDraft(next: ExternalExpensePayload) {
    setExternalEditor((current) => (current ? { ...current, draft: next } : current));
  }

  function updateExternalText(key: keyof ExternalExpensePayload, value: string) {
    if (!externalEditor) return;
    updateExternalDraft({ ...externalEditor.draft, [key]: value });
  }

  function updateExternalNumber(key: keyof ExternalExpensePayload, value: string) {
    if (!externalEditor) return;
    const numeric = numericInputValue(value);
    updateExternalDraft({
      ...externalEditor.draft,
      [key]: key === "due_day" ? Math.max(1, Math.min(31, numeric || 1)) : Math.max(0, numeric)
    });
  }

  async function toggleMonthPayment(person: "ALAN" | "MAIRON", paid: boolean) {
    const currentPayment = person === "ALAN" ? alanPayment : maironPayment;
    const amount = currentPayment?.amount ?? currentPayment?.expected_amount ?? 0;
    const updatedPayments = await updateMonthPayment({
      month: debtMonth,
      person,
      paid,
      amount,
      note: currentPayment?.note || (paid ? `${formatExpenseMonth(debtMonth)} confirmados con sueldo de ${formatMonth(debtMonth)}.` : "")
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
    <main className="theme-dark min-h-screen overflow-x-hidden bg-[#070b13] text-slate-100">
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
        budget={selectedBudget}
        mobileBudget={mobileBudget}
        externalMonthItems={externalMonthItems}
        selectedExternalCategory={selectedExternalCategory}
        setSelectedExternalCategory={setSelectedExternalCategory}
        selectedMonthDetail={selectedMonthDetail}
        alanProjected={summary?.stats.alan_projected ?? 0}
        maironProjected={summary?.stats.mairon_projected ?? 0}
        alanMonthTotal={monthTotals.alan}
        maironMonthTotal={monthTotals.mairon}
        alanPayment={alanPayment}
        maironPayment={maironPayment}
        refreshing={refreshing}
        refreshDone={refreshDone}
        onRefresh={() => void refreshAll()}
        onCreate={openCreate}
        onSaveIncome={saveIncome}
        onOpenExternalCreate={openExternalCreate}
        onOpenExternalEdit={openExternalEdit}
        onDeleteExternal={(item) => void removeExternalExpense(item)}
        onToggleExternalPaid={(item, paid) => void toggleExternalPayment(item, paid)}
        onTogglePayment={toggleMonthPayment}
        onEdit={openEdit}
        onDelete={(item) => void removeDebt(item)}
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
              Desde sueldo
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
            <RefreshButton refreshing={refreshing} done={refreshDone} onClick={() => void refreshAll()} />
            <button
              type="button"
              onClick={() => openCreate()}
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
        <BudgetDesktopOverview
          month={debtMonth}
          schemaReady={selectedBudget?.schema_ready ?? false}
          message={selectedBudget?.message ?? ""}
          alanBudget={alanBudget}
          maironBudget={maironBudget}
          externalItems={externalMonthItems}
          onSaveIncome={saveIncome}
          onOpenExternalCreate={openExternalCreate}
        />

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
            detail={summary?.stats.peak_month?.month ? formatExpenseMonth(summary.stats.peak_month.month) : "Sin pagos"}
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
              <h2 className="text-xl font-semibold text-slate-950">{formatExpenseMonth(debtMonth)}</h2>
              <p className="text-sm text-slate-500">
                {loading ? "Cargando..." : `${monthlyPaymentCount} pagos · ${formatSalaryMonth(debtMonth)}`}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Cartola
                <select
                  value={debtMonth}
                  onChange={(event) => setDebtMonth(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                >
                  {debtMonthOptions.map((month) => (
                    <option key={month} value={month}>
                      {formatBillingMonthOption(month)}
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
            <MonthTotal label="Alan gastos" value={monthTotals.alan} tone="teal" />
            <MonthTotal label="Mairon gastos" value={monthTotals.mairon} tone="amber" />
            <MonthTotal label="Total gastos" value={monthTotals.alan + monthTotals.mairon} tone="slate" />
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
            budget={desktopBudget}
            budgetSchemaReady={selectedBudget?.schema_ready ?? false}
            budgetMessage={selectedBudget?.message ?? ""}
            externalItems={externalMonthItems}
            selectedExternalCategory={selectedExternalCategory}
            setSelectedExternalCategory={setSelectedExternalCategory}
            selectedMonthDetail={selectedMonthDetail}
            onTogglePayment={(paid) => void toggleMonthPayment(desktopScope === "alan" ? "ALAN" : "MAIRON", paid)}
            onSaveIncome={(person, amount) => void saveIncome(person, amount)}
            onOpenExternalCreate={openExternalCreate}
            onOpenExternalEdit={openExternalEdit}
            onDeleteExternal={(item) => void removeExternalExpense(item)}
            onToggleExternalPaid={(item, paid) => void toggleExternalPayment(item, paid)}
            onEdit={openEdit}
            onDelete={(item) => void removeDebt(item)}
          />
        )}
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form
            onSubmit={(event) => void saveDebt(event)}
            className="max-h-[94vh] w-full max-w-full overflow-y-auto rounded-t-lg bg-white p-4 shadow-soft animate-fade-up sm:mx-auto sm:max-w-2xl sm:rounded-lg sm:p-5"
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
              <Field label="Fecha compra">
                <input
                  type="date"
                  value={editor.draft.purchase_date}
                  onInput={(event) => updatePurchaseDate(event.currentTarget.value)}
                  onChange={(event) => updatePurchaseDate(event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Primer pago">
                <input
                  type="month"
                  value={editor.draft.start_month}
                  readOnly
                  className="input"
                  required
                />
              </Field>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
                <span className="font-semibold text-slate-950">{formatExpenseMonth(editor.draft.start_month)}</span>
                <span className="mx-2 text-slate-400">·</span>
                <span>{formatSalaryMonth(editor.draft.start_month)}</span>
                <span className="mt-1 block text-xs text-slate-500">Cartola {billingPeriodLabel(editor.draft.start_month)}</span>
              </div>
              <Field label="Total deuda">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="$0"
                  value={moneyFieldValue(editor.draft.total_amount)}
                  onChange={(event) => updateDraftNumber("total_amount", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Cuotas">
                <select
                  value={numberFieldValue(editor.draft.installments_total, false)}
                  onChange={(event) => updateDraftNumber("installments_total", event.target.value)}
                  className="input"
                >
                  {Array.from({ length: 24 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cuota total">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={numberFieldValue(editor.draft.monthly_installment)}
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
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={numberFieldValue(editor.draft.alan_monthly)}
                  onChange={(event) => updateDraftNumber("alan_monthly", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Mairon paga">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={numberFieldValue(editor.draft.mairon_monthly)}
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

      {externalEditor && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form
            onSubmit={(event) => void saveExternalExpense(event)}
            className="max-h-[94vh] w-full max-w-full overflow-y-auto rounded-t-lg bg-white p-4 shadow-soft animate-fade-up sm:mx-auto sm:max-w-2xl sm:rounded-lg sm:p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  {externalEditor.mode === "create" ? "Nuevo gasto externo" : "Editar gasto externo"}
                </h2>
                <p className="text-sm text-slate-500">{categoryInfo(externalEditor.draft.category).label}</p>
              </div>
              <button
                type="button"
                onClick={() => setExternalEditor(null)}
                title="Cerrar"
                aria-label="Cerrar"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre" className="sm:col-span-2">
                <input
                  value={externalEditor.draft.title}
                  onChange={(event) => updateExternalText("title", event.target.value)}
                  className="input"
                  required
                />
              </Field>
              <Field label="Categoría">
                <select
                  value={externalEditor.draft.category}
                  onChange={(event) => updateExternalText("category", event.target.value as ExternalExpenseCategory)}
                  className="input"
                >
                  {externalCategories.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Icono / servicio">
                <select
                  value={externalEditor.draft.service_key}
                  onChange={(event) => updateExternalText("service_key", event.target.value)}
                  className="input"
                >
                  <option value="">Automático</option>
                  {subscriptionServices.map((service) => (
                    <option key={service.key} value={service.key}>
                      {service.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Responsable">
                <select
                  value={externalEditor.draft.person}
                  onChange={(event) => updateExternalText("person", event.target.value as ExpensePerson)}
                  className="input"
                >
                  <option value="ALAN">Alan</option>
                  <option value="MAIRON">Mairon</option>
                  <option value="AMBOS">Ambos</option>
                </select>
              </Field>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
                <div className="font-semibold text-slate-950">
                  Ya registrados para {expensePersonLabel(externalEditor.draft.person)}
                </div>
                {externalEditorExistingItems.length > 0 ? (
                  <div className="mt-2 grid gap-2">
                    {externalEditorExistingItems.map((item) => {
                      const amount =
                        externalEditor.draft.person === "AMBOS"
                          ? item.alan_amount + item.mairon_amount
                          : personAmount(item, externalEditor.draft.person);
                      const itemService = item.category === "subscriptions" ? serviceInfo(item.service_key, item.title) : categoryInfo(item.category);
                      return (
                        <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-white px-2 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={classNames("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md", itemService.tone)}>
                              {itemService.icon}
                            </span>
                            <span className="min-w-0 truncate font-medium text-slate-800">{item.title}</span>
                          </div>
                          <span className="shrink-0 font-semibold text-slate-950">{formatCurrency(amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-slate-500">No hay registros previos en esta categorÃ­a para este responsable.</div>
                )}
              </div>
              <Field label="Monto">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="$0"
                  value={moneyFieldValue(externalEditor.draft.amount)}
                  onChange={(event) => updateExternalNumber("amount", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Desde">
                <input
                  type="month"
                  value={externalEditor.draft.start_month}
                  onChange={(event) => updateExternalText("start_month", event.target.value)}
                  className="input"
                  required
                />
              </Field>
              <Field label="Vence día">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  value={numberFieldValue(externalEditor.draft.due_day, false)}
                  onChange={(event) => updateExternalNumber("due_day", event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Tipo">
                <select
                  value={externalEditor.draft.kind}
                  onChange={(event) => updateExternalText("kind", event.target.value as ExternalExpenseKind)}
                  className="input"
                >
                  <option value="recurrent">Mensual</option>
                  <option value="installments">Cuotas</option>
                  <option value="single">Único</option>
                </select>
              </Field>
              <Field label="Cuotas">
                <select
                  value={numberFieldValue(externalEditor.draft.installments_total, false)}
                  onChange={(event) => updateExternalNumber("installments_total", event.target.value)}
                  className="input"
                  disabled={externalEditor.draft.kind !== "installments"}
                >
                  {Array.from({ length: 24 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Observación" className="sm:col-span-2">
                <textarea
                  value={externalEditor.draft.notes}
                  onChange={(event) => updateExternalText("notes", event.target.value)}
                  className="input min-h-24 resize-y py-2"
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span
                  className={classNames(
                    "inline-flex h-8 w-8 items-center justify-center rounded-md",
                    serviceInfo(externalEditor.draft.service_key, externalEditor.draft.title).tone
                  )}
                >
                  {serviceInfo(externalEditor.draft.service_key, externalEditor.draft.title).icon}
                </span>
                {externalEditor.draft.person === "AMBOS" ? "Se divide entre ambos" : externalEditor.draft.person === "ALAN" ? "Lo paga Alan" : "Lo paga Mairon"}
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

function RefreshButton({
  refreshing,
  done,
  onClick,
  square = false
}: {
  refreshing: boolean;
  done: boolean;
  onClick: () => void;
  square?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      title="Actualizar"
      aria-label="Actualizar"
      className={classNames(
        "inline-flex h-10 items-center justify-center rounded-md border bg-white text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-80",
        square ? "w-10 px-0" : "px-3",
        done ? "refresh-done border-teal-300 text-teal-700" : "border-slate-300"
      )}
    >
      <RefreshCcw size={18} className={classNames(refreshing && "animate-spin", done && "refresh-icon-pop")} />
    </button>
  );
}

function personAmount(item: ExternalExpenseMonthItem, person: "ALAN" | "MAIRON" | "BOTH") {
  if (person === "BOTH") return item.alan_amount + item.mairon_amount;
  return person === "ALAN" ? item.alan_amount : item.mairon_amount;
}

function budgetTotals(budget: { income: number; credit: number; external: number }) {
  const discounts = budget.credit + budget.external;
  return {
    discounts,
    available: budget.income - discounts
  };
}

function BudgetDesktopOverview({
  month,
  schemaReady,
  message,
  alanBudget,
  maironBudget,
  externalItems,
  onSaveIncome,
  onOpenExternalCreate
}: {
  month: string;
  schemaReady: boolean;
  message: string;
  alanBudget: { income: number; credit: number; external: number; externalPaid: number };
  maironBudget: { income: number; credit: number; external: number; externalPaid: number };
  externalItems: ExternalExpenseMonthItem[];
  onSaveIncome: (person: "ALAN" | "MAIRON", amount: number) => void;
  onOpenExternalCreate: (category?: ExternalExpenseCategory) => void;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="grid gap-3 md:grid-cols-2">
        <PersonBudgetCard person="ALAN" name="Alan" month={month} budget={alanBudget} onSaveIncome={onSaveIncome} />
        <PersonBudgetCard person="MAIRON" name="Mairon" month={month} budget={maironBudget} onSaveIncome={onSaveIncome} />
      </div>
      <BudgetModuleGrid
        person="BOTH"
        creditTotal={alanBudget.credit + maironBudget.credit}
        externalItems={externalItems}
        schemaReady={schemaReady}
        message={message}
        onSelectCategory={onOpenExternalCreate}
      />
    </section>
  );
}

function PersonBudgetDashboard({
  person,
  personName,
  month,
  budget,
  schemaReady,
  message,
  externalItems,
  selectedCategory,
  onSelectCategory,
  onSaveIncome,
  onOpenExternalCreate,
  onOpenExternalEdit,
  onDeleteExternal,
  onToggleExternalPaid
}: {
  person: "ALAN" | "MAIRON";
  personName: string;
  month: string;
  budget: { income: number; credit: number; external: number; externalPaid: number };
  schemaReady: boolean;
  message: string;
  externalItems: ExternalExpenseMonthItem[];
  selectedCategory: ExternalExpenseCategory;
  onSelectCategory: (category: ExternalExpenseCategory) => void;
  onSaveIncome: (person: "ALAN" | "MAIRON", amount: number) => void;
  onOpenExternalCreate: (category?: ExternalExpenseCategory) => void;
  onOpenExternalEdit: (expense: ExternalExpense) => void;
  onDeleteExternal: (expense: ExternalExpense) => void;
  onToggleExternalPaid: (expense: ExternalExpenseMonthItem, paid: boolean) => void;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-3">
        <PersonBudgetCard person={person} name={personName} month={month} budget={budget} onSaveIncome={onSaveIncome} />
        <BudgetModuleGrid
          person={person}
          creditTotal={budget.credit}
          externalItems={externalItems}
          schemaReady={schemaReady}
          message={message}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          onCreate={onOpenExternalCreate}
        />
      </div>
      <ExternalExpensePanel
        person={person}
        category={selectedCategory}
        items={externalItems}
        onCreate={() => onOpenExternalCreate(selectedCategory)}
        onEdit={onOpenExternalEdit}
        onDelete={onDeleteExternal}
        onTogglePaid={onToggleExternalPaid}
      />
    </section>
  );
}

function MobileBudgetHome({
  person,
  personName,
  month,
  budget,
  schemaReady,
  message,
  externalItems,
  selectedCategory,
  onSelectCategory,
  onSaveIncome,
  onOpenExternalCreate
}: {
  person: "ALAN" | "MAIRON";
  personName: string;
  month: string;
  budget: { income: number; credit: number; external: number; externalPaid: number };
  schemaReady: boolean;
  message: string;
  externalItems: ExternalExpenseMonthItem[];
  selectedCategory: ExternalExpenseCategory;
  onSelectCategory: (category: ExternalExpenseCategory) => void;
  onSaveIncome: (person: "ALAN" | "MAIRON", amount: number) => void;
  onOpenExternalCreate: (category?: ExternalExpenseCategory) => void;
}) {
  return (
    <div className="grid gap-4 animate-fade-up">
      <PersonBudgetCard person={person} name={personName} month={month} budget={budget} onSaveIncome={onSaveIncome} compact />
      <BudgetModuleGrid
        person={person}
        creditTotal={budget.credit}
        externalItems={externalItems}
        schemaReady={schemaReady}
        message={message}
        selectedCategory={selectedCategory}
        onSelectCategory={onSelectCategory}
        onCreate={onOpenExternalCreate}
      />
    </div>
  );
}

function PersonBudgetCard({
  person,
  name,
  month,
  budget,
  compact = false,
  onSaveIncome
}: {
  person: "ALAN" | "MAIRON";
  name: string;
  month: string;
  budget: { income: number; credit: number; external: number; externalPaid: number };
  compact?: boolean;
  onSaveIncome: (person: "ALAN" | "MAIRON", amount: number) => void;
}) {
  const totals = budgetTotals(budget);
  const [incomeDraft, setIncomeDraft] = useState(moneyFieldValue(budget.income));

  useEffect(() => {
    setIncomeDraft(moneyFieldValue(budget.income));
  }, [budget.income]);

  const save = () => onSaveIncome(person, numericInputValue(incomeDraft));

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">Presupuesto {formatMonth(month)}</div>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{name}</h2>
        </div>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          <Banknote size={18} />
        </span>
      </div>

      <label className="mt-4 flex flex-col gap-1 text-sm font-semibold text-slate-700">
        Sueldo del mes
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={incomeDraft}
            placeholder="$0"
            onChange={(event) => setIncomeDraft(moneyFieldValue(numericInputValue(event.target.value)))}
            className="input flex-1"
          />
          <button
            type="button"
            onClick={save}
            className="inline-flex h-10 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800"
          >
            <Save size={16} />
          </button>
        </div>
      </label>

      <div className={classNames("mt-4 grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-3")}>
        <BudgetStat label="Descuentos" value={totals.discounts} tone="rose" />
        <BudgetStat label="Disponible" value={totals.available} tone={totals.available >= 0 ? "teal" : "rose"} />
        <BudgetStat label="Externos" value={budget.external} tone="indigo" />
      </div>
    </article>
  );
}

function BudgetStat({ label, value, tone }: { label: string; value: number; tone: "teal" | "rose" | "indigo" }) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-900",
    rose: "bg-rose-50 text-rose-700",
    indigo: "bg-indigo-50 text-indigo-700"
  }[tone];

  return (
    <div className={classNames("rounded-md px-3 py-2", toneClass)}>
      <div className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">{label}</div>
      <div className="mt-1 text-lg font-semibold">{formatCurrency(value)}</div>
    </div>
  );
}

function BudgetModuleGrid({
  person,
  creditTotal,
  externalItems,
  schemaReady,
  message,
  selectedCategory,
  onSelectCategory,
  onCreate
}: {
  person: "ALAN" | "MAIRON" | "BOTH";
  creditTotal: number;
  externalItems: ExternalExpenseMonthItem[];
  schemaReady: boolean;
  message: string;
  selectedCategory?: ExternalExpenseCategory;
  onSelectCategory?: (category: ExternalExpenseCategory) => void;
  onCreate?: (category?: ExternalExpenseCategory) => void;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Registros del mes</h2>
          <p className="text-sm text-slate-500">Tarjeta, servicios y gastos externos</p>
        </div>
        {onCreate && (
          <button
            type="button"
            onClick={() => onCreate(selectedCategory)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800"
          >
            <Plus size={16} />
            Agregar
          </button>
        )}
      </div>

      {!schemaReady && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {message || "Ejecuta el SQL nuevo para activar estos registros."}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <BudgetModuleCard
          label="Tarjeta Cencosud"
          description="Cartola actual"
          amount={creditTotal}
          icon={<CreditCard size={18} />}
          tone="teal"
        />
        {externalCategories.map((category) => {
          const total = externalItems.reduce((sum, item) => (item.category === category.key ? sum + personAmount(item, person) : sum), 0);
          const count = externalItems.filter((item) => item.category === category.key && personAmount(item, person) > 0).length;
          return (
            <BudgetModuleCard
              key={category.key}
              label={category.label}
              description={count ? `${count} registros` : category.description}
              amount={total}
              icon={category.icon}
              tone={category.tone}
              active={selectedCategory === category.key}
              onClick={onSelectCategory ? () => onSelectCategory(category.key) : undefined}
            />
          );
        })}
      </div>
    </article>
  );
}

function BudgetModuleCard({
  label,
  description,
  amount,
  icon,
  tone,
  active = false,
  onClick
}: {
  label: string;
  description: string;
  amount: number;
  icon: ReactNode;
  tone: "teal" | "amber" | "rose" | "indigo" | "slate";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass = {
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    indigo: "bg-indigo-50 text-indigo-700",
    slate: "bg-slate-100 text-slate-700"
  }[tone];
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={classNames(
        "rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition",
        onClick && "hover:border-slate-400 hover:bg-slate-100",
        active && "border-teal-300"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={classNames("inline-flex h-9 w-9 items-center justify-center rounded-md", toneClass)}>{icon}</span>
        <span className="text-right text-sm font-semibold text-slate-950">{formatCurrency(amount)}</span>
      </div>
      <div className="mt-3 text-sm font-semibold text-slate-950">{label}</div>
      <div className="mt-1 text-xs text-slate-500">{description}</div>
    </Tag>
  );
}

function ExternalExpensePanel({
  person,
  category,
  items,
  onBack,
  onCreate,
  onEdit,
  onDelete,
  onTogglePaid
}: {
  person: "ALAN" | "MAIRON";
  category: ExternalExpenseCategory;
  items: ExternalExpenseMonthItem[];
  onBack?: () => void;
  onCreate: () => void;
  onEdit: (expense: ExternalExpense) => void;
  onDelete: (expense: ExternalExpense) => void;
  onTogglePaid: (expense: ExternalExpenseMonthItem, paid: boolean) => void;
}) {
  const info = categoryInfo(category);
  const visibleItems = items.filter((item) => item.category === category && personAmount(item, person) > 0);
  const total = visibleItems.reduce((sum, item) => sum + personAmount(item, person), 0);

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft animate-fade-up">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex items-start gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              title="Volver"
              aria-label="Volver"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft size={17} />
            </button>
          )}
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{info.label}</h2>
            <p className="text-sm text-slate-500">{visibleItems.length} registros · {formatCurrency(total)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCreate()}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800"
        >
          <Plus size={16} />
          Nuevo
        </button>
      </div>

      <div className="divide-y divide-slate-100">
        {visibleItems.length === 0 ? (
          <div className="px-4 py-5 text-sm text-slate-500">Sin gastos en esta categoría.</div>
        ) : (
          visibleItems.map((item) => (
            <ExternalExpenseRow
              key={`${item.id}-${item.month}`}
              item={item}
              amount={personAmount(item, person)}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
              onTogglePaid={() => onTogglePaid(item, !item.paid)}
            />
          ))
        )}
      </div>
    </article>
  );
}

function ExternalExpenseRow({
  item,
  amount,
  onEdit,
  onDelete,
  onTogglePaid
}: {
  item: ExternalExpenseMonthItem;
  amount: number;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePaid: () => void;
}) {
  const service = item.category === "subscriptions" ? serviceInfo(item.service_key, item.title) : null;
  const category = categoryInfo(item.category);

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_8.5rem] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className={classNames("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md", service?.tone ?? "bg-slate-100 text-slate-700")}>
          {service?.icon ?? category.icon}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold text-slate-950">{item.title}</h3>
            <PaymentBadge paid={item.paid} compact />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>Vence día {item.due_day}</span>
            <span>{item.installment_label}</span>
            {item.person === "AMBOS" && <span>Compartido</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 sm:hidden">Monto</span>
        <span className="text-sm font-semibold text-slate-950">{formatCurrency(amount)}</span>
      </div>

      <div className="flex justify-end gap-1">
        <button
          type="button"
          title={item.paid ? "Marcar pendiente" : "Marcar pagado"}
          aria-label={`${item.paid ? "Marcar pendiente" : "Marcar pagado"} ${item.title}`}
          onClick={onTogglePaid}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-teal-200 text-teal-700 transition hover:bg-slate-50"
        >
          <CheckCircle2 size={16} />
        </button>
        <button
          type="button"
          title="Editar"
          aria-label={`Editar ${item.title}`}
          onClick={onEdit}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          title="Eliminar"
          aria-label={`Eliminar ${item.title}`}
          onClick={onDelete}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
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
  budget,
  budgetSchemaReady,
  budgetMessage,
  externalItems,
  selectedExternalCategory,
  setSelectedExternalCategory,
  selectedMonthDetail,
  onTogglePayment,
  onSaveIncome,
  onOpenExternalCreate,
  onOpenExternalEdit,
  onDeleteExternal,
  onToggleExternalPaid,
  onEdit,
  onDelete
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
  budget: { income: number; credit: number; external: number; externalPaid: number };
  budgetSchemaReady: boolean;
  budgetMessage: string;
  externalItems: ExternalExpenseMonthItem[];
  selectedExternalCategory: ExternalExpenseCategory;
  setSelectedExternalCategory: (value: ExternalExpenseCategory) => void;
  selectedMonthDetail: MonthlyDetailResponse | null;
  onTogglePayment: (paid: boolean) => void;
  onSaveIncome: (person: "ALAN" | "MAIRON", amount: number) => void;
  onOpenExternalCreate: (category?: ExternalExpenseCategory) => void;
  onOpenExternalEdit: (expense: ExternalExpense) => void;
  onDeleteExternal: (expense: ExternalExpense) => void;
  onToggleExternalPaid: (expense: ExternalExpenseMonthItem, paid: boolean) => void;
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
}) {
  const projected = projection.reduce((sum, item) => sum + item[person], 0);
  const remaining = debts.reduce((sum, debt) => sum + debt[remainingKey], 0);
  const active = debts.filter((debt) => debt.status !== "finished").length;
  const payNow = statementPerson?.pay_now ?? monthlyTotal;

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PersonBudgetDashboard
        person={person === "alan" ? "ALAN" : "MAIRON"}
        personName={personName}
        month={debtMonth}
        budget={budget}
        schemaReady={budgetSchemaReady}
        message={budgetMessage}
        externalItems={externalItems}
        selectedCategory={selectedExternalCategory}
        onSelectCategory={setSelectedExternalCategory}
        onSaveIncome={onSaveIncome}
        onOpenExternalCreate={onOpenExternalCreate}
        onOpenExternalEdit={onOpenExternalEdit}
        onDeleteExternal={onDeleteExternal}
        onToggleExternalPaid={onToggleExternalPaid}
      />

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
          label={`${personName} gastos`}
          value={formatCurrency(monthlyTotal)}
          tone={accent}
          detail={formatSalaryMonth(debtMonth)}
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
            <h2 className="text-xl font-semibold text-slate-950">{personName}: {formatExpenseMonth(debtMonth)}</h2>
            <p className="text-sm text-slate-500">{formatSalaryMonth(debtMonth)}</p>
          </div>
          <label className="flex w-fit flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Cartola
            <select
              value={debtMonth}
              onChange={(event) => setDebtMonth(event.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            >
              {debtMonthOptions.map((month) => (
                <option key={month} value={month}>
                  {formatBillingMonthOption(month)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <MonthTotal label={`${personName} gastos`} value={monthlyTotal} tone={accent} />
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
  budget,
  mobileBudget,
  externalMonthItems,
  selectedExternalCategory,
  setSelectedExternalCategory,
  selectedMonthDetail,
  alanProjected,
  maironProjected,
  alanMonthTotal,
  maironMonthTotal,
  alanPayment,
  maironPayment,
  refreshing,
  refreshDone,
  onRefresh,
  onCreate,
  onSaveIncome,
  onOpenExternalCreate,
  onOpenExternalEdit,
  onDeleteExternal,
  onToggleExternalPaid,
  onTogglePayment,
  onEdit,
  onDelete
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
  budget: BudgetResponse | null;
  mobileBudget: { income: number; credit: number; external: number; externalPaid: number };
  externalMonthItems: ExternalExpenseMonthItem[];
  selectedExternalCategory: ExternalExpenseCategory;
  setSelectedExternalCategory: (value: ExternalExpenseCategory) => void;
  selectedMonthDetail: MonthlyDetailResponse | null;
  alanProjected: number;
  maironProjected: number;
  alanMonthTotal: number;
  maironMonthTotal: number;
  alanPayment?: PaymentPersonStatus;
  maironPayment?: PaymentPersonStatus;
  refreshing: boolean;
  refreshDone: boolean;
  onRefresh: () => void;
  onCreate: (person?: MobilePerson | null) => void;
  onSaveIncome: (person: "ALAN" | "MAIRON", amount: number) => void;
  onOpenExternalCreate: (category?: ExternalExpenseCategory) => void;
  onOpenExternalEdit: (expense: ExternalExpense) => void;
  onDeleteExternal: (expense: ExternalExpense) => void;
  onToggleExternalPaid: (expense: ExternalExpenseMonthItem, paid: boolean) => void;
  onTogglePayment: (person: "ALAN" | "MAIRON", paid: boolean) => Promise<void>;
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
}) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 overflow-x-hidden px-4 pb-28 pt-4 lg:hidden">
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
        <RefreshButton refreshing={refreshing} done={refreshDone} onClick={onRefresh} square />
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      )}

      {!mobilePerson ? (
        <MobilePersonMenu
          loading={loading}
          month={debtMonth}
          alanProjected={alanProjected}
          maironProjected={maironProjected}
          alanMonthTotal={alanMonthTotal}
          maironMonthTotal={maironMonthTotal}
          alanPayment={alanPayment}
          maironPayment={maironPayment}
          onSelect={(person) => {
            setMobilePerson(person);
            setMobileView("budget");
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
              Desde sueldo
              <input
                type="month"
                value={fromMonth}
                onChange={(event) => setFromMonth(event.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Cartola
              <select
                value={debtMonth}
                onChange={(event) => setDebtMonth(event.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              >
                {debtMonthOptions.map((month) => (
                  <option key={month} value={month}>
                    {formatBillingMonthOption(month)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <MobileViewButton
              active={mobileView === "budget"}
              icon={<Banknote size={17} />}
              label="Resumen"
              onClick={() => setMobileView("budget")}
            />
            <MobileViewButton
              active={mobileView === "projection"}
              icon={<ChartNoAxesColumnIncreasing size={17} />}
              label="Proy."
              onClick={() => setMobileView("projection")}
            />
            <MobileViewButton
              active={mobileView === "month"}
              icon={<CalendarDays size={17} />}
              label="Tarjeta"
              onClick={() => setMobileView("month")}
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <MobileViewButton
              active={mobileView === "control"}
              icon={<ListChecks size={17} />}
              label="Control de cuotas"
              onClick={() => setMobileView("control")}
            />
          </div>

          {mobileView === "budget" && (
            <MobileBudgetHome
              person={mobilePerson === "alan" ? "ALAN" : "MAIRON"}
              personName={mobilePersonName}
              month={debtMonth}
              budget={mobileBudget}
              schemaReady={budget?.schema_ready ?? false}
              message={budget?.message ?? ""}
              externalItems={externalMonthItems}
              selectedCategory={selectedExternalCategory}
              onSelectCategory={(category) => {
                setSelectedExternalCategory(category);
                setMobileView("external");
              }}
              onSaveIncome={onSaveIncome}
              onOpenExternalCreate={onOpenExternalCreate}
            />
          )}

          {mobileView === "external" && (
            <ExternalExpensePanel
              person={mobilePerson === "alan" ? "ALAN" : "MAIRON"}
              category={selectedExternalCategory}
              items={externalMonthItems}
              onBack={() => setMobileView("budget")}
              onCreate={() => onOpenExternalCreate(selectedExternalCategory)}
              onEdit={onOpenExternalEdit}
              onDelete={onDeleteExternal}
              onTogglePaid={onToggleExternalPaid}
            />
          )}

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
            />
          )}
        </>
      )}

      {mobilePerson && (
        <>
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            title={`Agregar registro para ${mobilePersonName}`}
            aria-label={`Agregar registro para ${mobilePersonName}`}
            className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-soft transition hover:bg-teal-700"
          >
            <Plus size={24} />
          </button>

          {quickAddOpen && (
            <MobileQuickAddSheet
              person={mobilePerson}
              personName={mobilePersonName}
              externalItems={externalMonthItems}
              onClose={() => setQuickAddOpen(false)}
              onCardCreate={() => {
                setQuickAddOpen(false);
                onCreate(mobilePerson);
              }}
              onExternalCreate={(category) => {
                setQuickAddOpen(false);
                setSelectedExternalCategory(category);
                onOpenExternalCreate(category);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function MobileQuickAddSheet({
  person,
  personName,
  externalItems,
  onClose,
  onCardCreate,
  onExternalCreate
}: {
  person: MobilePerson;
  personName: string;
  externalItems: ExternalExpenseMonthItem[];
  onClose: () => void;
  onCardCreate: () => void;
  onExternalCreate: (category: ExternalExpenseCategory) => void;
}) {
  const personKey = person === "alan" ? "ALAN" : "MAIRON";

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-0 backdrop-blur-sm">
      <div className="max-h-[86vh] w-full max-w-full overflow-y-auto rounded-t-lg border border-slate-200 bg-white p-4 shadow-soft animate-fade-up">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">Agregar para</div>
            <h2 className="truncate text-xl font-semibold text-slate-950">{personName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-3">
          <button
            type="button"
            onClick={onCardCreate}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-teal-300 hover:bg-slate-100"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                <CreditCard size={18} />
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-slate-950">Tarjeta Cencosud</div>
                <div className="text-sm text-slate-500">Compra en cuotas de la cartola</div>
              </div>
            </div>
            <Plus size={18} className="shrink-0 text-slate-500" />
          </button>

          {externalCategories.map((category) => {
            const categoryItems = externalItems.filter((item) => item.category === category.key && personAmount(item, personKey) > 0);
            const total = categoryItems.reduce((sum, item) => sum + personAmount(item, personKey), 0);
            return (
              <button
                key={category.key}
                type="button"
                onClick={() => onExternalCreate(category.key)}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-teal-300 hover:bg-slate-100"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={classNames(
                      "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                      category.tone === "teal"
                        ? "bg-teal-50 text-teal-700"
                        : category.tone === "amber"
                          ? "bg-amber-50 text-amber-700"
                          : category.tone === "rose"
                            ? "bg-rose-50 text-rose-700"
                            : category.tone === "indigo"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-slate-100 text-slate-700"
                    )}
                  >
                    {category.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-950">{category.label}</div>
                    <div className="text-sm text-slate-500">
                      {categoryItems.length ? `${categoryItems.length} activos Â· ${formatCurrency(total)}` : category.description}
                    </div>
                  </div>
                </div>
                <Plus size={18} className="shrink-0 text-slate-500" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MobilePersonMenu({
  loading,
  month,
  alanProjected,
  maironProjected,
  alanMonthTotal,
  maironMonthTotal,
  alanPayment,
  maironPayment,
  onSelect
}: {
  loading: boolean;
  month: string;
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
        month={month}
        projected={alanProjected}
        monthTotal={alanMonthTotal}
        payment={alanPayment}
        onClick={() => onSelect("alan")}
      />
      <MobilePersonButton
        name="Mairon"
        accent="amber"
        month={month}
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
  month,
  projected,
  monthTotal,
  payment,
  onClick
}: {
  name: string;
  accent: "teal" | "amber";
  month: string;
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
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{formatExpenseMonth(month)}</div>
          <div className="mt-0.5 text-xs text-slate-500">Sueldo {formatMonth(month)}</div>
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
          <h2 className="text-lg font-semibold text-slate-950">Proyección {personName}</h2>
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
    <div className="grid grid-cols-[6.4rem_1fr] items-center gap-3">
      <div>
        <div className="text-sm font-semibold capitalize text-slate-700">{formatMonth(statementMonthFromPaymentMonth(item.month))}</div>
        <div className="text-[11px] font-medium text-slate-500">Sueldo {formatMonth(item.month)}</div>
      </div>
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
  onDelete
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
}) {
  return (
    <div className="flex flex-col gap-4 animate-fade-up">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{formatExpenseMonth(month)}</h2>
        <p className="text-sm text-slate-500">{formatSalaryMonth(month)}</p>
      </div>
      <MonthTotal label={`${personName} gastos`} value={monthlyTotal} tone={accent} />

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
  onDelete
}: {
  personName: string;
  accent: "teal" | "amber";
  debts: Debt[];
  monthlyKey: "alan_monthly" | "mairon_monthly";
  remainingKey: "alan_remaining" | "mairon_remaining";
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
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
  onDelete
}: {
  debt: Debt;
  monthlyKey: "alan_monthly" | "mairon_monthly";
  remainingKey: "alan_remaining" | "mairon_remaining";
  accent: "teal" | "amber";
  onEdit: (debt: Debt) => void;
  onDelete: (debt: Debt) => void;
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
          <span>Sueldo {formatMonth(debt.start_month)} a {formatMonth(debt.end_month)}</span>
          {debt.purchase_date && <span>Compra {formatDate(debt.purchase_date)}</span>}
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
    <div className="grid grid-cols-[6.4rem_1fr] items-center gap-3 sm:grid-cols-[8.2rem_1fr_8.4rem]">
      <div>
        <div className="text-sm font-semibold capitalize text-slate-700">{formatMonth(statementMonthFromPaymentMonth(item.month))}</div>
        <div className="text-[11px] font-medium text-slate-500">Sueldo {formatMonth(item.month)}</div>
      </div>
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
            Pago con sueldo
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">{formatMonth(month)}</h3>
          <p className="text-sm text-slate-500">{formatExpenseMonth(month)}</p>
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
          <h3 className="text-lg font-semibold text-slate-950">Cartola {formatExpenseMonth(detail.month)}</h3>
          <p className="text-sm text-slate-500">
            {formatSalaryMonth(detail.month)} · Vence {formatDate(statement.due_date)} · Total cartola {formatCurrency(statement.statement_total_to_pay)}
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
            {currentItems.length} cobran en {formatExpenseMonth(month).toLowerCase()} - {futureItems.length} futuras
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
              Próximas cuotas detectadas
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
            {debts.length} pagos · {formatExpenseMonth(month).toLowerCase()}
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
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_7rem] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-sm font-semibold text-slate-950">{debt.title}</h4>
          {isCustom && (
            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Manual</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>Sueldo {formatMonth(debt.start_month)} a {formatMonth(debt.end_month)}</span>
          {debt.purchase_date && <span>Compra {formatDate(debt.purchase_date)}</span>}
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
