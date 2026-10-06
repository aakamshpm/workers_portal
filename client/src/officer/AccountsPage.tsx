import { useEffect, useState } from "react";
import { api } from "../shared/api";
import type { Account } from "../shared/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  formatDate,
  formatPhone,
  inputClass,
  Note,
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
    <div className="flex max-w-5xl flex-col gap-space-lg">
      <header className="flex flex-col gap-space-xs">
        <h1 className="font-headline-lg text-headline-lg text-on-surface">Accounts</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant">
          Contractors and labour officers are made here, by the labour office.
        </p>
      </header>

      <Card
        title="Create an account"
        description="For a contractor or a labour officer. Workers make their own account on the sign-in page."
      >
        <form className="flex max-w-2xl flex-col gap-space-md px-space-lg py-space-md" onSubmit={(e) => void create(e)}>
          <fieldset role="radiogroup" className="flex flex-col gap-space-sm">
            <legend className="mb-space-xs font-body-lg-medium text-body-lg-medium text-on-surface">Role</legend>
            <div className="flex flex-wrap gap-space-sm">
              {(Object.keys(ROLE_LABEL) as NewRole[]).map((r) => (
                <label
                  key={r}
                  className={`flex min-h-[var(--size-touch)] cursor-pointer items-center gap-space-sm rounded-xl px-space-md font-body-lg text-body-lg text-on-surface ring-1 ring-inset focus-within:ring-2 focus-within:ring-primary ${
                    role === r ? "bg-secondary-container ring-primary" : "ring-outline"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="size-5 accent-primary"
                  />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-space-md sm:grid-cols-2">
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

          {error && <Note tone="error">{error}</Note>}
          {created && (
            <Note tone="success">
              Account made for {created.name}. There is no PIN yet. Ask {created.name} to open the
              sign-in page, tap “Forgot PIN?” and type the code that comes by SMS to{" "}
              {formatPhone(created.phone)}.
            </Note>
          )}

          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Contractor and officer accounts">
        {loadError ? (
          <div className="px-space-lg py-space-md">
            <Note tone="error">{loadError}</Note>
          </div>
        ) : accounts === null ? (
          <EmptyState>Loading accounts…</EmptyState>
        ) : accounts.length === 0 ? (
          <EmptyState>No contractor or officer accounts yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex flex-col items-start gap-space-sm px-space-lg py-space-md sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-body-lg-medium text-body-lg-medium text-on-surface">{a.name}</p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {ROLE_LABEL[a.role]} · {formatPhone(a.phone)} · added {formatDate(a.createdAt)}
                  </p>
                  {a.company && (
                    <p className="font-label-md text-label-md text-on-surface-variant">{a.company}</p>
                  )}
                </div>
                {a.hasPin ? <Badge tone="good">Can sign in</Badge> : <Badge tone="waiting">No PIN yet</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
