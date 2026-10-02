import { useEffect, useId, useState } from "react";
import { api } from "../shared/api";
import type { AuthUser, Complaint, ContractBalance } from "../shared/types";
import {
  Button,
  Card,
  ComplaintBadge,
  EmptyState,
  ErrorNote,
  Field,
  formatDate,
  formatDays,
  formatRupees,
  InfoNote,
  inputClass,
  Note,
  SuccessNote,
} from "../shared/components/ui";

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "bn", label: "বাংলা" },
  { id: "or", label: "ଓଡ଼ିଆ" },
  { id: "ml", label: "മലയാളം" },
];

/**
 * The worker asks the labour office for help.
 *
 * The form starts from the contracts the worker actually has, so the complaint
 * arrives attached to a specific job with its rate, days and payments already
 * known. A free-text helpline message needs an officer to reconstruct all of
 * that by phone before anything can be decided.
 */
export default function ComplaintPage({ user }: { user: AuthUser }) {
  const [balances, setBalances] = useState<ContractBalance[]>([]);
  const [mine, setMine] = useState<Complaint[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const [offerId, setOfferId] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState(user.language ?? "en");
  const [claimedAmount, setClaimedAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const [b, c, cats] = await Promise.all([
        api.balances(),
        api.complaints(),
        api.complaintCategories(),
      ]);
      setBalances(b);
      setMine(c);
      setCategories(cats);
      if (!offerId && b.length > 0) {
        // Start on the job with the largest unpaid amount, because that is the
        // one most likely to be the reason the worker opened this page.
        const worst = [...b].sort((x, y) => y.balance - x.balance)[0];
        setOfferId(worst.offerId);
        if (worst.balance > 0) setClaimedAmount(String(Math.round(worst.balance)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your work. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = balances.find((b) => b.offerId === offerId);
  const factsId = useId();

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api.fileComplaint({
        offerId,
        category,
        description,
        language,
        claimedAmount: claimedAmount ? Number(claimedAmount) : undefined,
      });
      setFlash(
        "The District Labour Office has your complaint. All your work records went with it.",
      );
      setDescription("");
      setCategory("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <EmptyState>Please wait…</EmptyState>;

  if (balances.length === 0) {
    return (
      <Card>
        <EmptyState>You have no jobs yet.</EmptyState>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-space-lg">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      <Card
        title="Ask the labour office for help"
        description="Your work records are sent with this."
      >
        <form
          className="flex flex-col gap-space-lg px-space-lg py-space-md"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Which work is this about?">
            <select
              className={inputClass}
              value={offerId}
              onChange={(e) => {
                setOfferId(e.target.value);
                const b = balances.find((x) => x.offerId === e.target.value);
                if (b && b.balance > 0) setClaimedAmount(String(Math.round(b.balance)));
              }}
              required
            >
              {balances.map((b) => (
                // The site alone, because a phone's select box shows one short
                // line. Who and when are under it, for the job that is chosen.
                <option key={b.offerId} value={b.offerId}>
                  {b.siteName}
                </option>
              ))}
            </select>
          </Field>

          {chosen && (
            <section
              aria-labelledby={factsId}
              className="flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-md"
            >
              <p className="font-label-md text-label-md text-on-surface-variant">
                {chosen.contractor.name} · began {formatDate(chosen.startDate)}
              </p>
              <h3 id={factsId} className="font-body-lg-bold text-body-lg-bold text-on-surface">
                What the records say about this work
              </h3>
              <dl className="grid grid-cols-2 gap-x-space-lg gap-y-space-sm">
                <Fact label="Pay for one day" value={formatRupees(chosen.dailyRate)} />
                <Fact label="Days written down" value={formatDays(chosen.daysWorked)} />
                <Fact label="You earned" value={formatRupees(chosen.earned)} />
                <Fact label="You were paid" value={formatRupees(chosen.paid)} />
              </dl>
              <p className="font-body-lg text-body-lg text-on-surface">
                Still owed to you:{" "}
                <span className="font-body-lg-bold text-body-lg-bold tabular-nums whitespace-nowrap text-error">
                  {formatRupees(Math.max(0, chosen.balance))}
                </span>
              </p>
              <p className="font-label-md text-label-md text-on-surface-variant">
                You agreed to this pay on {chosen.acceptedAt ? formatDate(chosen.acceptedAt) : "—"}.
              </p>
              {chosen.awaitingConfirmation > 0 && (
                <Note tone="warning">
                  There {chosen.awaitingConfirmation === 1 ? "is" : "are"} {chosen.awaitingConfirmation} thing
                  {chosen.awaitingConfirmation === 1 ? "" : "s"} you have not checked yet. Check{" "}
                  {chosen.awaitingConfirmation === 1 ? "it" : "them"} first, and your complaint becomes stronger.
                </Note>
              )}
              {chosen.disputedRecords > 0 && (
                <Note tone="info">
                  You have already said {chosen.disputedRecords} thing
                  {chosen.disputedRecords === 1 ? "" : "s"} here {chosen.disputedRecords === 1 ? "is" : "are"} wrong.
                  The officer can see that.
                </Note>
              )}
            </section>
          )}

          <Field label="What is wrong?">
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
            >
              <option value="">Choose one…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-space-lg sm:grid-cols-2">
            <Field label="How much do you think you are owed? (₹)" hint="Change this number if it is not what you mean.">
              <input
                className={inputClass}
                type="number"
                inputMode="numeric"
                min="1"
                value={claimedAmount}
                onChange={(e) => setClaimedAmount(e.target.value)}
              />
            </Field>
            <Field label="Which language are you writing in?">
              <select
                className={inputClass}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Tell the officer what happened"
            hint="Write in your own language. The officer will see which language you used."
          >
            <textarea
              className={inputClass}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened?"
              required
            />
          </Field>

          <InfoNote>This does not change your records. The officer will see both sides.</InfoNote>

          <Button type="submit" size="page" icon="send" busy={busy} disabled={description.trim().length < 10 || !category}>
            {busy ? "Sending…" : "Send to the labour office"}
          </Button>
        </form>
      </Card>

      <Card title="Complaints you have made">
        {mine.length === 0 ? (
          <EmptyState>You have not made any complaints.</EmptyState>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {mine.map((c) => (
              <li key={c.id} className="flex flex-col gap-space-xs px-space-lg py-space-md">
                <div className="flex flex-wrap items-center justify-between gap-space-sm">
                  <p className="font-body-lg-bold text-body-lg-bold text-on-surface">
                    {categories.find((x) => x.id === c.category)?.label ?? c.category}
                    {c.claimedAmount ? ` · ${formatRupees(c.claimedAmount)}` : ""}
                  </p>
                  <ComplaintBadge status={c.status} />
                </div>
                <p className="font-body-lg text-body-lg break-words text-on-surface">{c.description}</p>
                <p className="font-label-md text-label-md text-on-surface-variant">You sent this on {formatDate(c.createdAt)}</p>

                {c.actions.length > 0 && (
                  <ol className="mt-space-sm flex flex-col gap-space-sm border-l-2 border-outline-variant pl-space-md">
                    {c.actions.map((a) => (
                      <li key={a.id} className="font-label-md text-label-md">
                        <span className="font-semibold text-on-surface">{actionLabel(a.kind)}</span>
                        {a.escalatedTo && (
                          <span className="text-on-surface">
                            {" "}
                            →{" "}
                            {a.escalatedTo === "POLICE"
                              ? "the Police"
                              : "the Labour Commissioner, who can order your money to be paid"}
                          </span>
                        )}
                        <span className="text-on-surface-variant"> · {formatDate(a.createdAt)}</span>
                        {a.note && <p className="break-words text-on-surface">{a.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}

                {c.outcomeNote && (
                  <p className="mt-space-sm rounded-lg bg-surface-container-low px-space-md py-space-sm font-body-lg text-body-lg text-on-surface">
                    What the officer decided: {c.outcomeNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function actionLabel(kind: string): string {
  const map: Record<string, string> = {
    ASK_EMPLOYER: "The office asked the contractor to answer",
    EMPLOYER_REPLY: "The contractor answered",
    CALLED_WORKER: "The officer phoned you",
    CALLED_EMPLOYER: "The officer phoned the contractor",
    MESSAGED_WORKER: "The officer sent you a message",
    DECIDED: "The officer decided",
    ESCALATED: "Sent to a higher office",
  };
  return map[kind] ?? kind;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-label-sm text-label-sm text-on-surface-variant">{label}</dt>
      <dd className="font-body-lg-bold text-body-lg-bold tabular-nums whitespace-nowrap text-on-surface">{value}</dd>
    </div>
  );
}
