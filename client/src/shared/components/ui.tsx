import { useId, type ReactNode } from "react";
import type { Evidence } from "../types";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n/en";
import Icon, { type IconName } from "./Icon";

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

/**
 * A 10-digit number as two groups of five, joined by a no-break space
 * (U+00A0). With an ordinary space the browser may put the two halves on two
 * lines, which reads as two numbers.
 */
export function formatPhone(digits: string): string {
  if (!digits || digits.length !== 10) return digits;
  return `${digits.slice(0, 5)}\u00a0${digits.slice(5)}`;
}

/** A full record code is 64 characters, too wide for a table cell. */
export function shortCode(hash: string, chars = 8): string {
  if (hash === "0") return "0 (nothing before it)";
  return `${hash.slice(0, chars)}…`;
}

/**
 * A panel holding one subject: a job, a balance, a list of records.
 *
 * A card with a title becomes a landmark a screen reader can jump between, but
 * only if the title names it, which is why `aria-labelledby` points at the
 * heading rather than the heading simply sitting inside.
 */
export function Card({
  title,
  description,
  actions,
  level = 2,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /**
   * Which heading level the title is. A card placed under a section that
   * already has an `h2` passes 3, so the order a screen reader reads out has no
   * hole in it.
   */
  level?: 2 | 3 | 4;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = `h${level}` as "h2";

  return (
    <section
      className="rounded-xl bg-surface-container-lowest shadow-sm"
      {...(title ? { "aria-labelledby": id } : {})}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-space-md border-b border-outline-variant px-space-lg py-space-md">
          <div>
            {title && (
              <Heading id={id} className="font-headline-sm text-headline-sm text-on-surface">
                {title}
              </Heading>
            )}
            {description && (
              <p className="mt-space-xs max-w-2xl font-label-md text-label-md text-on-surface-variant">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-space-sm">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Anything a reader taps or clicks.
 *
 * ## Which variant
 *
 * `primary` is the one action that finishes the screen, filled so the eye lands
 * on it. `secondary` is an alternative the reader may take instead, tonal
 * rather than filled so two buttons side by side are not equally loud. `danger`
 * is for refusing an offer or saying a row is wrong, which cannot be undone
 * afterwards (principle 1), so it must not look like an ordinary action.
 * `ghost` is a link-like action inside a row.
 *
 * ## Which size
 *
 * `page` is the wide button at the bottom of a worker screen. `md` is the
 * default, 48px, which is the smallest a finger can be asked to hit. `dense` is
 * 40px and belongs to the officer website only, where a table of complaints is
 * read with a mouse and cannot give every row a 48px control.
 *
 * ## While the server answers
 *
 * `busy` both disables the button and says so with `aria-busy`. A worker on a
 * slow connection taps again when nothing happens, and a second tap would write
 * the same record twice, which the ledger cannot take back.
 */
export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  icon,
  disabled,
  busy = false,
  full = false,
  expanded,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "danger-tonal" | "ghost";
  size?: "page" | "md" | "dense";
  /** A mark beside the label. Decoration, because the label already says it. */
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /**
   * Fill the width it is given. Two answers side by side in a two-column grid
   * are then the same size, so neither looks like the one to choose.
   */
  full?: boolean;
  /**
   * Set on a button that opens or closes a panel, so a screen reader says
   * whether the panel is open. Left out on every other button, which must not
   * claim to open anything.
   */
  expanded?: boolean;
  type?: "button" | "submit";
}) {
  const variants = {
    primary:
      "bg-primary-container text-on-primary hover:bg-primary disabled:bg-outline-variant disabled:text-on-surface-variant",
    secondary:
      "bg-surface-container-high text-primary hover:bg-surface-container-highest disabled:text-on-surface-variant",
    danger: "bg-error text-on-error hover:bg-on-error-container disabled:bg-outline-variant",
    // Saying a record is wrong, before the answer is sent (design W1). Tonal,
    // so it sits beside "Yes, correct" at the same weight.
    "danger-tonal":
      "bg-error-container text-on-error-container hover:bg-error-container/80 disabled:text-on-surface-variant",
    ghost: "text-primary hover:bg-surface-container disabled:text-on-surface-variant",
  };
  const sizes = {
    // Fills the width, so a worker does not have to aim.
    page: "w-full min-h-[var(--size-button)] px-space-lg font-body-lg-bold text-body-lg-bold",
    md: "min-h-[var(--size-control)] px-space-lg font-body-lg-medium text-body-lg-medium",
    dense: "min-h-[var(--size-control-sm)] px-space-md font-label-md text-label-md",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      {...(busy ? { "aria-busy": true } : {})}
      {...(expanded !== undefined ? { "aria-expanded": expanded } : {})}
      className={`inline-flex items-center justify-center gap-space-sm rounded-xl py-space-xs text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${full ? "w-full" : ""}`}
    >
      {busy ? (
        <Icon name="progress_activity" spin />
      ) : (
        icon && <Icon name={icon} />
      )}
      {children}
    </button>
  );
}

/**
 * A label tied to whatever control the caller puts inside: a select, a date, a
 * row of digit boxes. For an ordinary text box use `TextField`, which also
 * handles the hint and the error.
 */
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
      <span className="mb-space-xs block font-body-lg-medium text-body-lg-medium text-on-surface">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-space-xs block font-label-sm text-label-sm text-on-surface-variant">
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * One line of typing, with its label, its hint and its error.
 *
 * The hint and the error are tied to the box by id, so a screen reader reads
 * them as part of the field. Left loose they would be read as stray lines
 * somewhere else on the page, which is how a worker ends up not knowing which
 * box the message is about.
 *
 * `numeric` opens the phone's own number keypad (ADR-0019). The design draws its
 * own keypad on four screens; we do not, because the system keyboard opens
 * anyway, it is the one the worker already knows, and Android's SMS-code
 * autofill needs a real input.
 */
export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  numeric = false,
  placeholder,
  autoComplete,
  autoFocus = false,
  disabled = false,
  hideLabel = false,
  prefix,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** What is wrong with what was typed. Shown instead of the hint. */
  error?: string;
  numeric?: boolean;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /**
   * Hide the label from sight, for a screen whose heading already asks the
   * question. A screen reader still reads it on the box.
   */
  hideLabel?: boolean;
  /** Fixed text before the box, such as "+91". Shown, never part of the value. */
  prefix?: string;
  type?: "text" | "tel" | "date" | "number";
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;

  return (
    <div>
      <label
        htmlFor={id}
        className={
          hideLabel
            ? "sr-only"
            : "mb-space-xs block font-body-lg-medium text-body-lg-medium text-on-surface"
        }
      >
        {label}
      </label>
      <div className="flex items-stretch gap-space-sm">
        {prefix && (
          // aria-hidden because the label already says what the box is for,
          // and "+91" read before every phone number adds nothing.
          <span
            aria-hidden="true"
            className="flex items-center rounded-xl bg-surface-container px-space-md font-body-lg-bold text-body-lg-bold text-on-surface"
          >
            {prefix}
          </span>
        )}
        <input
        id={id}
        type={type}
        {...(numeric ? { inputMode: "numeric" as const } : {})}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        {...(error ? { "aria-invalid": true } : {})}
        {...(note ? { "aria-describedby": noteId } : {})}
        // `ring-outline` and not `ring-outline-variant`: WCAG 1.4.11 asks for
        // 3:1 on a control's edge, and only `outline` reaches it on the white
        // card and on the page (theme.test.ts).
        className={`w-full min-w-0 flex-1 min-h-[var(--size-control)] rounded-xl border-0 bg-surface-container-lowest px-space-md font-body-lg text-body-lg text-on-surface ring-1 ring-inset placeholder:text-on-surface-variant focus:ring-2 focus:ring-primary focus:outline-none disabled:text-on-surface-variant ${
          error ? "ring-2 ring-error" : "ring-outline"
        }`}
        />
      </div>
      {note && (
        <p
          id={noteId}
          className={`mt-space-xs font-label-sm text-label-sm ${
            error ? "text-on-error-container" : "text-on-surface-variant"
          }`}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The class string the screens written before ADR-0019 put on a bare `<input>`.
 * Kept, on the theme's tokens, so those pages still look right while they are
 * rebuilt one at a time.
 *
 * @deprecated Use `TextField`, which also ties the label, hint and error to the
 * box for a screen reader.
 */
export const inputClass =
  "w-full min-w-0 min-h-[var(--size-control)] rounded-xl border-0 bg-surface-container-lowest px-space-md py-space-sm font-body-lg text-body-lg text-on-surface ring-1 ring-inset ring-outline placeholder:text-on-surface-variant focus:ring-2 focus:ring-primary focus:outline-none";

/**
 * One answer in a short list, such as the home states on the sign-in page.
 *
 * Tapping the row is the answer, so there is no "Next" button to find after
 * choosing. That is why the row is taller than an ordinary control and as wide
 * as the screen: it is the whole action, and a worker should not have to aim.
 *
 * `aria-pressed` says which row is chosen, for a screen that shows the answer
 * before moving on.
 */
export function ChoiceRow({
  label,
  detail,
  selected = false,
  disabled = false,
  onChoose,
}: {
  label: string;
  /** A second line, such as the state's name in its own script. */
  detail?: string;
  selected?: boolean;
  disabled?: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex w-full min-h-16 items-center justify-between gap-space-md rounded-xl px-space-lg py-space-md text-left shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed ${
        selected
          ? "bg-secondary-container text-on-secondary-container"
          : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-low"
      }`}
    >
      <span className="flex flex-col">
        <span className="font-headline-sm text-headline-sm">{label}</span>
        {detail && (
          <span className="font-label-md text-label-md text-on-surface-variant">{detail}</span>
        )}
      </span>
      <Icon
        name={selected ? "check_circle" : "chevron_right"}
        filled={selected}
        size={22}
        className={selected ? "text-primary" : "text-outline"}
      />
    </button>
  );
}

/**
 * A list with nothing in it yet.
 *
 * This is not an error, so it is not announced as one. It says what is missing
 * and what will put something there, because "No records" on its own leaves a
 * worker wondering whether the app is broken or his contractor has written
 * nothing.
 */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: IconName;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-space-sm px-space-lg py-space-2xl text-center">
      {icon && <Icon name={icon} size={32} className="text-outline" />}
      {title && (
        <p className="font-headline-sm text-headline-sm text-on-surface">{title}</p>
      )}
      <p className="max-w-sm font-body-lg text-body-lg text-on-surface-variant">{children}</p>
    </div>
  );
}

/**
 * A short message about what just happened, or about what a reader should know.
 *
 * ## How loudly it speaks
 *
 * `error` is announced the moment it appears, because a worker who has just
 * tapped "Send" has to learn that the record did not go in without having to
 * look for the reason. `success` waits for a pause in what the screen reader is
 * saying, since a record that went in needs no interruption. `info` and
 * `warning` are read in place, as part of the page.
 *
 * Every tone carries an icon as well as a colour, so a reader who cannot tell
 * red from green still knows which kind of note this is.
 */
export function Note({
  tone,
  children,
}: {
  tone: "error" | "warning" | "info" | "success";
  children: ReactNode;
}) {
  const tones: Record<string, { cls: string; icon: IconName; live?: "alert" | "status" }> = {
    error: {
      cls: "bg-error-container text-on-error-container",
      icon: "error",
      live: "alert",
    },
    // Warning uses a strong neutral fill rather than amber. The design's amber
    // is outside the Material palette, and a fifth colour for "be careful"
    // would compete with `error` for the reader's attention.
    warning: { cls: "bg-surface-container-high text-on-surface", icon: "warning" },
    info: { cls: "bg-surface-container-low text-on-surface-variant", icon: "info" },
    success: {
      cls: "bg-secondary-container text-on-secondary-container",
      icon: "check_circle",
      live: "status",
    },
  };
  const it = tones[tone]!;

  return (
    <div
      {...(it.live ? { role: it.live } : {})}
      className={`flex items-start gap-space-sm rounded-xl px-space-md py-space-sm font-body-lg text-body-lg ${it.cls}`}
    >
      <Icon name={it.icon} filled={tone === "error" || tone === "success"} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * The four note shapes the existing screens call. Each one is `Note` with its
 * tone fixed, kept so that a page written before ADR-0019 goes on working while
 * the screens are rebuilt one at a time.
 *
 * @deprecated Use `Note` with a tone.
 */
export function ErrorNote({ message }: { message: string }) {
  return <Note tone="error">{message}</Note>;
}

/** @deprecated Use `Note tone="success"`. */
export function SuccessNote({ children }: { children: ReactNode }) {
  return <Note tone="success">{children}</Note>;
}

/** @deprecated Use `Note tone="info"`. */
export function InfoNote({ children }: { children: ReactNode }) {
  return <Note tone="info">{children}</Note>;
}

/** The state of an offer. */
/**
 * The five colours a badge may take. Every badge in the three apps uses one of
 * these, so "agreed" and "disputed" look the same on every screen.
 */
const TONE = {
  good: "bg-secondary-container text-on-secondary-container",
  waiting: "bg-surface-container-high text-on-surface",
  bad: "bg-error-container text-on-error-container",
  neutral: "bg-surface-container text-on-surface-variant",
  info: "bg-tertiary-container text-on-tertiary-container",
} as const;
type Tone = keyof typeof TONE;

/** A short status word. It never wraps, because a badge broken over two lines reads as two badges. */
function Badge({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return (
    <span
      {...(title ? { title } : {})}
      className={`inline-flex items-center rounded-full px-space-sm py-0.5 whitespace-nowrap font-label-md text-label-md ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function OfferBadge({ status, viewer = "WORKER" }: { status: string; viewer?: "WORKER" | "CONTRACTOR" }) {
  const { t } = useT();
  // The words are the reader's own side of the offer. "Waiting for your answer"
  // is right for the worker and wrong for the contractor, who is the one
  // waiting. The contractor app is English (ADR-0015), so its words are literal.
  const map: Record<string, { label: string; tone: Tone }> =
    viewer === "CONTRACTOR"
      ? {
          PENDING: { label: "Waiting for the worker", tone: "waiting" },
          ACCEPTED: { label: "Worker said yes", tone: "good" },
          DECLINED: { label: "Worker said no", tone: "neutral" },
          CANCELLED: { label: "You took it back", tone: "neutral" },
        }
      : {
          PENDING: { label: t("offerPending"), tone: "waiting" },
          ACCEPTED: { label: t("offerAccepted"), tone: "good" },
          DECLINED: { label: t("offerDeclined"), tone: "neutral" },
          CANCELLED: { label: t("offerCancelled"), tone: "neutral" },
        };
  const it = map[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={it.tone}>{it.label}</Badge>;
}

export function ConfirmBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    CONFIRMED: { label: "Both agree", tone: "good" },
    WAITING: { label: "Worker has not checked this", tone: "waiting" },
    DISPUTED: { label: "Worker says it is wrong", tone: "bad" },
  };
  const it = map[state] ?? { label: state, tone: "neutral" as Tone };
  return <Badge tone={it.tone}>{it.label}</Badge>;
}

export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  const map: Record<Evidence, { label: string; tone: Tone; title: string }> = {
    strong: { label: "Bank has a record", tone: "good", title: "Paid by UPI or bank. The bank has a record." },
    good: { label: "Code used when paid", tone: "info", title: "The worker read out a code when he was paid." },
    weak: { label: "Worker agreed later", tone: "waiting", title: "The worker agreed some days later." },
    none: { label: "Nothing to show", tone: "neutral", title: "Only the contractor says this was paid." },
    disputed: { label: "Worker says he got nothing", tone: "bad", title: "The worker says this money never reached him." },
  };
  const it = map[evidence];
  return (
    <Badge tone={it.tone} title={it.title}>
      {it.label}
    </Badge>
  );
}

const COMPLAINT_STATUS: Record<string, { plain: string; official: string; tone: Tone }> = {
  OPEN: { plain: "Waiting for the officer", official: "Awaiting review", tone: "waiting" },
  AWAITING_EMPLOYER: {
    plain: "Contractor asked to answer",
    official: "Awaiting contractor's response",
    tone: "info",
  },
  RESOLVED: { plain: "Worker was right", official: "Upheld", tone: "good" },
  REJECTED: { plain: "Records do not agree", official: "Rejected", tone: "bad" },
  ESCALATED: { plain: "Sent to a higher office", official: "Escalated", tone: "info" },
  CLOSED_UNPROVEN: { plain: "Nobody could prove it", official: "Closed, unproven", tone: "neutral" },
};

export function ComplaintBadge({
  status,
  audience = "plain",
}: {
  status: string;
  audience?: "plain" | "official";
}) {
  const found = COMPLAINT_STATUS[status];
  if (!found) return <Badge tone="neutral">{status}</Badge>;
  return <Badge tone={found.tone}>{audience === "official" ? found.official : found.plain}</Badge>;
}

const RECORD_TONE: Record<string, Tone> = {
  OFFER: "info",
  ACCEPT: "good",
  WORK: "waiting",
  PAYMENT: "waiting",
  CONFIRM: "good",
  DISPUTE: "bad",
  EMPLOYER_NOTE: "neutral",
};

const RECORD_KEY: Record<string, MessageKey> = {
  OFFER: "recOffer",
  ACCEPT: "recAccept",
  WORK: "recWork",
  PAYMENT: "recPayment",
  CONFIRM: "recConfirm",
  DISPUTE: "recDispute",
  EMPLOYER_NOTE: "recEmployerNote",
};

/** The contractor and officer apps read about the worker, so their labels name him. */
const RECORD_ENGLISH: Record<string, string> = {
  OFFER: "Work offered",
  ACCEPT: "Worker said yes",
  WORK: "Work done",
  PAYMENT: "Money paid",
  CONFIRM: "Worker agreed",
  DISPUTE: "Worker said wrong",
  EMPLOYER_NOTE: "Employer answered",
};

/**
 * What kind of record a line is. In the worker app it is in his language,
 * with the same words as the filters above the list (ADR-0015). Elsewhere it
 * is English. `setLanguage` exists only inside the worker's language provider.
 */
export function RecordTypeBadge({ type }: { type: string }) {
  const { t, setLanguage } = useT();
  const key = RECORD_KEY[type];
  const label = setLanguage && key ? t(key) : (RECORD_ENGLISH[type] ?? type);
  return <Badge tone={RECORD_TONE[type] ?? "neutral"}>{label}</Badge>;
}

/**
 * A phone number the reader can tap to call.
 *
 * A mobile number is dialled with +91. `asWritten` is for a business listing,
 * whose number is often a landline with its own area code, so it is shown and
 * dialled exactly as it is stored.
 *
 * The link is a finger's height, and the number never breaks over two lines.
 */
export function PhoneLink({
  phone,
  asWritten = false,
  children,
}: {
  phone: string;
  asWritten?: boolean;
  children?: ReactNode;
}) {
  return (
    <a
      href={asWritten ? `tel:${phone}` : `tel:+91${phone}`}
      className="inline-flex min-h-[var(--size-touch)] items-center gap-space-xs whitespace-nowrap font-body-lg-medium text-body-lg-medium text-primary underline decoration-outline-variant underline-offset-4 hover:decoration-primary"
    >
      <Icon name="call" size={18} />
      {children ?? (asWritten ? phone : formatPhone(phone))}
    </a>
  );
}
