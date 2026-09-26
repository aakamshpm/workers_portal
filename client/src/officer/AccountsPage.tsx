import { useEffect, useState } from "react";
import { api } from "../shared/api";
import type { Account } from "../shared/types";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  formatDate,
  formatPhone,
  inputClass,
  SuccessNote,
} from "../shared/components/ui";

/**
 * Contractor and officer accounts. ADR-0014, docs/contracts/auth.md.
 *
 * Workers register themselves. Contractors and officers cannot, because a
 * contractor account writes records that bind a worker, so the labour office
 * creates them here.
 *
 * There is no PIN field. A new account has no PIN and cannot sign in until
 * its owner opens the sign-in page, taps "Forgot PIN" and types the code sent
 * to his own phone. So the officer never knows another person's PIN.
 */

type NewRole = Account["role"];

const ROLE_LABEL: Record<NewRole, string> = {
  CONTRACTOR: "Contractor",
  AUTHORITY: "Labour officer",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const [role, setRole] = useState<NewRole>("CONTRACTOR");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Account | null>(null);

  useEffect(() => {
    api
      .accounts()
      .then(setAccounts)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Could not load accounts."));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setCreated(null);
    try {
      const account = await api.createAccount({
        role,
        name: name.trim(),
        phone: phone.trim(),
        // A labour officer has no company, and the server refuses one.
        ...(role === "CONTRACTOR" ? { company: company.trim() } : {}),
      });
      setAccounts((list) => [account, ...(list ?? [])]);
      setCreated(account);
      setName("");
      setPhone("");
      setCompany("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="Create an account"
        description="For a contractor or a labour officer. Workers make their own account on the sign-in page."
      >
        <form className="space-y-4 px-5 py-4" onSubmit={(e) => void create(e)}>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-700">Role</legend>
            <div className="flex gap-4">
              {(Object.keys(ROLE_LABEL) as NewRole[]).map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                  />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Phone number" hint="Their own phone. The code to set the PIN goes to it.">
              <input
                className={inputClass}
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            {role === "CONTRACTOR" && (
              <Field label="Company">
                <input
                  className={inputClass}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                />
              </Field>
            )}
          </div>

          {error && <ErrorNote message={error} />}
          {created && (
            <div role="status">
              <SuccessNote>
                Account made for {created.name}. There is no PIN yet. Ask {created.name} to open the
                sign-in page, tap “Forgot PIN?” and type the code that comes by SMS to{" "}
                {formatPhone(created.phone)}.
              </SuccessNote>
            </div>
          )}

          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
      </Card>

      <Card title="Contractor and officer accounts">
        {loadError ? (
          <div className="px-5 py-4">
            <ErrorNote message={loadError} />
          </div>
        ) : accounts === null ? (
          <EmptyState>Loading accounts…</EmptyState>
        ) : accounts.length === 0 ? (
          <EmptyState>No contractor or officer accounts yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{a.name}</p>
                  <p className="text-xs text-slate-500">
                    {ROLE_LABEL[a.role]} · {formatPhone(a.phone)} · added {formatDate(a.createdAt)}
                  </p>
                  {a.company && <p className="text-xs text-slate-600">{a.company}</p>}
                </div>
                {a.hasPin ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Can sign in
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                    No PIN yet
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
