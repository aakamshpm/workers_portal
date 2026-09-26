import { useEffect, useState } from "react";
import { api, storeSession } from "../shared/api";
import type { AuthUser, DirectoryAccount } from "../shared/types";
import { Button, ErrorNote, Field, InfoNote, formatPhone, inputClass } from "../shared/components/ui";

const ROLE_LABEL: Record<string, string> = {
  WORKER: "Workers",
  CONTRACTOR: "Contractors",
  AUTHORITY: "Labour office",
};

const ROLE_NOTE: Record<string, string> = {
  WORKER: "See your pay, say yes or no to each record, ask for help",
  CONTRACTOR: "Offer work, write down days worked and money paid",
  AUTHORITY: "Read complaints and use the records to decide them",
};

/**
 * Sign in with a phone number and a 4-digit PIN.
 *
 * Not email and password. A migrant worker has a phone number; many have no email
 * address, and asking for one would exclude the people the system is for. The
 * phone number is also where the messages go, so the thing they sign in with and
 * the thing they receive on are the same.
 */
export default function Login({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"signin" | "register">("signin");

  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("1234");
  const [name, setName] = useState("");
  const [homeState, setHomeState] = useState("West Bengal");

  const [states, setStates] = useState<{ state: string; language: string }[]>([]);
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.demoAccounts().then(setAccounts).catch(() => setAccounts([]));
    api.states().then(setStates).catch(() => setStates([]));
  }, []);

  async function signIn(withPhone: string, withPin = pin) {
    setBusy(true);
    setError("");
    try {
      const { token, user } = await api.login(withPhone, withPin);
      storeSession(token, user);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError("");
    try {
      const { token, user } = await api.register({ name, phone, pin, homeState });
      storeSession(token, user);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register");
    } finally {
      setBusy(false);
    }
  }

  // Seeded accounts share the PIN 1234, so clicking one signs straight in. A
  // worker who registered himself picked his own PIN, which this screen was
  // never told, so his row only fills the phone number in and waits for him to
  // type it - listed to save hunting for the number, not to skip the PIN.
  const seeded = accounts.filter((a) => !a.selfRegistered);
  const registered = accounts.filter((a) => a.selfRegistered);

  const grouped = ["WORKER", "CONTRACTOR", "AUTHORITY"].map((role) => ({
    role,
    users: seeded.filter((a) => a.role === role),
  }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-5xl">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Worker Pay Record
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">
            In Kerala, workers are hired by word of mouth. Nothing is written down, so a worker
            cannot show what pay he was promised or how much is still owed to him. This app writes
            it down, and both the worker and the contractor must agree to every line.
          </p>
        </header>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
              {(
                [
                  { id: "signin", label: "Sign in" },
                  { id: "register", label: "New worker? Sign up" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setMode(t.id);
                    setError("");
                  }}
                  className={`flex-1 rounded px-3 py-1.5 font-medium transition ${
                    mode === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {mode === "signin" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void signIn(phone);
                }}
                className="space-y-3"
              >
                <Field label="Phone number" hint="The number your work messages come to.">
                  <input
                    className={inputClass}
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98800 30001"
                    required
                  />
                </Field>
                <Field label="Your 4-number PIN">
                  <input
                    className={inputClass}
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    required
                  />
                </Field>
                {error && <ErrorNote message={error} />}
                <Button type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void register();
                }}
                className="space-y-3"
              >
                <InfoNote>
                  Only workers can make their own account here. Contractor and labour office
                  accounts are made by the labour department, because a contractor can write records
                  that a worker is then tied to.
                </InfoNote>
                <Field label="Your name">
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Bijoy Das"
                    required
                  />
                </Field>
                <Field label="Your phone number" hint="This will be your account name.">
                  <input
                    className={inputClass}
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98800 30001"
                    required
                  />
                </Field>
                <Field label="Pick a 4-number PIN" hint="Never tell this to a contractor.">
                  <input
                    className={inputClass}
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    required
                  />
                </Field>
                <Field
                  label="Which state are you from?"
                  hint="This decides which language your messages come in."
                >
                  <select
                    className={inputClass}
                    value={homeState}
                    onChange={(e) => setHomeState(e.target.value)}
                  >
                    {states.map((s) => (
                      <option key={s.state} value={s.state}>
                        {s.state}
                      </option>
                    ))}
                  </select>
                </Field>
                {error && <ErrorNote message={error} />}
                <Button type="submit" disabled={busy}>
                  {busy ? "Making your account…" : "Make my account"}
                </Button>
              </form>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Accounts to try</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Click any name to sign in. The PIN for all of them is{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">1234</code>
            </p>

            <div className="mt-4 space-y-4">
              {grouped.map(({ role, users }) =>
                users.length === 0 ? null : (
                  <div key={role}>
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      {ROLE_LABEL[role]}
                    </p>
                    <p className="text-xs text-slate-400">{ROLE_NOTE[role]}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {users.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setPhone(u.phone);
                              setPin("1234");
                              void signIn(u.phone, "1234");
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            <span>
                              <span className="font-medium text-slate-800">{u.name}</span>
                              {u.homeState && (
                                <span className="ml-1.5 text-xs text-slate-400">{u.homeState}</span>
                              )}
                            </span>
                            <span className="font-mono text-xs text-slate-500">
                              {formatPhone(u.phone)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}

              {/* Workers who made their own account. Their PIN was never seeded,
                * so clicking here only fills in the phone number - it saves
                * hunting for what you typed earlier, but still asks for the
                * PIN, unlike the group above. */}
              {registered.length > 0 && (
                <div>
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Workers you registered
                  </p>
                  <p className="text-xs text-slate-400">
                    These made their own PIN, so you still have to type it.
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {registered.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setMode("signin");
                            setPhone(u.phone);
                            setPin("");
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          <span>
                            <span className="font-medium text-slate-800">{u.name}</span>
                            {u.homeState && (
                              <span className="ml-1.5 text-xs text-slate-400">{u.homeState}</span>
                            )}
                          </span>
                          <span className="font-mono text-xs text-slate-500">
                            {formatPhone(u.phone)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Start with <span className="font-medium">Pramod Nayak</span>. He worked 15 days and has
          been paid nothing.
        </p>
      </div>
    </div>
  );
}
