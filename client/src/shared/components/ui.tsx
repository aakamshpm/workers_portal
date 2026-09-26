import type { ReactNode } from "react";
import type { Evidence } from "../types";

/** Money, as an Indian wage slip would show it. */
export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Money without paise, for headline figures. */
export function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Days as a site register would write them: 23 or 22.5, never 23.00. */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

export function formatPhone(digits: string): string {
  if (!digits || digits.length !== 10) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** A full record code is 64 characters, too wide for a table cell. */
export function shortCode(hash: string, chars = 8): string {
  if (hash === "0") return "0 (nothing before it)";
  return `${hash.slice(0, chars)}…`;
}

export function Card({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const variants = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
    secondary:
      "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-300",
    success: "bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-300",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  };
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm" };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-slate-900";

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-slate-500">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200"
    >
      {message}
    </div>
  );
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
      {children}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
      {children}
    </div>
  );
}

/** The state of an offer. */
export function OfferBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: { label: "Waiting for your answer", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    ACCEPTED: { label: "You said yes", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    DECLINED: { label: "You said no", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
    CANCELLED: { label: "Taken back", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  };
  const it = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${it.cls}`}
    >
      {it.label}
    </span>
  );
}

/**
 * Whether the worker has agreed to a record.
 *
 * The wording matters. "Waiting" is not a neutral state - it means one person
 * wrote a number and nobody has checked it - so the label says so.
 */
export function ConfirmBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    CONFIRMED: {
      label: "Both agree",
      cls: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    },
    WAITING: {
      label: "Worker has not checked this",
      cls: "bg-amber-50 text-amber-700 ring-amber-200",
    },
    DISPUTED: { label: "Worker says it is wrong", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  };
  const it = map[state] ?? { label: state, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${it.cls}`}
    >
      {it.label}
    </span>
  );
}

/**
 * How strongly a payment can be shown to have happened.
 *
 * Five honest levels rather than a tick or a cross, because the difference
 * between "the bank has a record" and "the contractor says so" is the difference
 * between a provable and an unprovable dispute.
 */
export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  const map: Record<Evidence, { label: string; cls: string; title: string }> = {
    strong: {
      label: "Bank has a record",
      cls: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      title: "Paid by UPI or bank. The bank has a record.",
    },
    good: {
      label: "Code used when paid",
      cls: "bg-sky-50 text-sky-800 ring-sky-200",
      title: "The worker read out a code when he was paid.",
    },
    weak: {
      label: "Worker agreed later",
      cls: "bg-amber-50 text-amber-800 ring-amber-200",
      title: "The worker agreed some days later.",
    },
    none: {
      label: "Nothing to show",
      cls: "bg-slate-100 text-slate-600 ring-slate-300",
      title: "Only the contractor says this was paid.",
    },
    disputed: {
      label: "Worker says he got nothing",
      cls: "bg-rose-50 text-rose-800 ring-rose-200",
      title: "The worker says this money never reached him.",
    },
  };
  const it = map[evidence];
  return (
    <span
      title={it.title}
      className={`inline-flex cursor-help items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${it.cls}`}
    >
      {it.label}
    </span>
  );
}

/**
 * The same complaint status, worded for two different readers.
 *
 * A migrant worker reading his own complaint needs the shortest true sentence.
 * A labour officer is a government professional working a caseload, and
 * worker-level wording on her screen reads as if the software does not take her
 * job seriously. So the status carries two labels and the caller says which
 * reader it is for.
 */
const COMPLAINT_STATUS: Record<string, { plain: string; official: string; cls: string }> = {
  OPEN: {
    plain: "Waiting for the officer",
    official: "Awaiting review",
    cls: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  AWAITING_EMPLOYER: {
    plain: "Contractor asked to answer",
    official: "Awaiting contractor's response",
    cls: "bg-sky-50 text-sky-700 ring-sky-200",
  },
  RESOLVED: {
    plain: "Worker was right",
    official: "Upheld",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  REJECTED: {
    plain: "Records do not agree",
    official: "Rejected",
    cls: "bg-rose-50 text-rose-700 ring-rose-200",
  },
  ESCALATED: {
    plain: "Sent to a higher office",
    official: "Escalated",
    cls: "bg-violet-50 text-violet-700 ring-violet-200",
  },
  CLOSED_UNPROVEN: {
    plain: "Nobody could prove it",
    official: "Closed, unproven",
    cls: "bg-slate-100 text-slate-600 ring-slate-300",
  },
};

export function ComplaintBadge({
  status,
  audience = "plain",
}: {
  status: string;
  audience?: "plain" | "official";
}) {
  const found = COMPLAINT_STATUS[status];
  const it = found
    ? { label: audience === "official" ? found.official : found.plain, cls: found.cls }
    : { label: status, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${it.cls}`}
    >
      {it.label}
    </span>
  );
}

/** Colour-coded label for the six kinds of record in the chain. */
export function RecordTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    OFFER: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    ACCEPT: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    WORK: "bg-sky-50 text-sky-700 ring-sky-200",
    PAYMENT: "bg-teal-50 text-teal-700 ring-teal-200",
    CONFIRM: "bg-lime-50 text-lime-700 ring-lime-200",
    DISPUTE: "bg-rose-50 text-rose-700 ring-rose-200",
    EMPLOYER_NOTE: "bg-slate-100 text-slate-700 ring-slate-300",
  };
  const labels: Record<string, string> = {
    OFFER: "Work offered",
    ACCEPT: "Worker said yes",
    WORK: "Work done",
    PAYMENT: "Money paid",
    CONFIRM: "Worker agreed",
    DISPUTE: "Worker said wrong",
    EMPLOYER_NOTE: "Employer answered",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        styles[type] ?? "bg-slate-50 text-slate-600 ring-slate-200"
      }`}
    >
      {labels[type] ?? type}
    </span>
  );
}

/** A tap-to-dial link. The system never places calls; it opens the officer's dialler. */
export function PhoneLink({ phone, children }: { phone: string; children?: ReactNode }) {
  return (
    <a
      href={`tel:+91${phone}`}
      className="font-medium text-sky-700 underline decoration-sky-300 hover:text-sky-900"
    >
      {children ?? formatPhone(phone)}
    </a>
  );
}
