import { useEffect, useState } from "react";
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
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      <Card
        title="Ask the labour office for help"
        description="Your work records are sent with this."
      >
        <form
          className="space-y-4 px-5 py-4"
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
                <option key={b.offerId} value={b.offerId}>
                  {b.siteName} · {b.contractor.name} · began {formatDate(b.startDate)}
                </option>
              ))}
            </select>
          </Field>

          {chosen && (
            <div className="rounded-md bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              <p className="font-medium text-slate-800">What the records say about this work</p>
              <p className="mt-1">
                {formatRupees(chosen.dailyRate)} a day, which you agreed to on{" "}
                {chosen.acceptedAt ? formatDate(chosen.acceptedAt) : "—"} ·{" "}
                {formatDays(chosen.daysWorked)} days written down · you earned{" "}
                {formatRupees(chosen.earned)} · you were paid {formatRupees(chosen.paid)} ·{" "}
                <span className="font-semibold text-slate-900">
                  {formatRupees(Math.max(0, chosen.balance))} still owed to you
                </span>
              </p>
              {chosen.awaitingConfirmation > 0 && (
                <p className="mt-1 text-amber-700">
                  There {chosen.awaitingConfirmation === 1 ? "is" : "are"}{" "}
                  {chosen.awaitingConfirmation} thing
                  {chosen.awaitingConfirmation === 1 ? "" : "s"} you have not checked yet. Check{" "}
                  {chosen.awaitingConfirmation === 1 ? "it" : "them"} first, and your complaint
                  becomes stronger.
                </p>
              )}
              {chosen.disputedRecords > 0 && (
                <p className="mt-1 text-rose-700">
                  You have already said {chosen.disputedRecords} thing
                  {chosen.disputedRecords === 1 ? "" : "s"} here{" "}
                  {chosen.disputedRecords === 1 ? "is" : "are"} wrong. The officer can see that.
                </p>
              )}
            </div>
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How much do you think you are owed? (₹)" hint="Change this number if it is not what you mean.">
              <input
                className={inputClass}
                type="number"
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

          <Button type="submit" disabled={busy || description.trim().length < 10 || !category}>
            {busy ? "Sending…" : "Send to the labour office"}
          </Button>
        </form>
      </Card>

      <Card title="Complaints you have made">
        {mine.length === 0 ? (
          <EmptyState>You have not made any complaints.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200">
            {mine.map((c) => (
              <li key={c.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {categories.find((x) => x.id === c.category)?.label ?? c.category}
                    {c.claimedAmount ? ` · ${formatRupees(c.claimedAmount)}` : ""}
                  </p>
                  <ComplaintBadge status={c.status} />
                </div>
                <p className="mt-1 text-xs text-slate-600">{c.description}</p>
                <p className="mt-1 text-xs text-slate-400">You sent this on {formatDate(c.createdAt)}</p>

                {c.actions.length > 0 && (
                  <ol className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
                    {c.actions.map((a) => (
                      <li key={a.id} className="text-xs">
                        <span className="font-medium text-slate-700">{actionLabel(a.kind)}</span>
                        {a.escalatedTo && (
                          <span className="text-slate-600">
                            {" "}
                            →{" "}
                            {a.escalatedTo === "POLICE"
                              ? "the Police"
                              : "the Labour Commissioner, who can order your money to be paid"}
                          </span>
                        )}
                        <span className="text-slate-400"> · {formatDate(a.createdAt)}</span>
                        {a.note && <p className="text-slate-600">{a.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}

                {c.outcomeNote && (
                  <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
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
