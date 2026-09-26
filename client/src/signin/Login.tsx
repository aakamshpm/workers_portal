import { useEffect, useState } from "react";
import { api, storeSession } from "../shared/api";
import type { AuthUser } from "../shared/types";
import { Button, ErrorNote, Field, InfoNote, inputClass } from "../shared/components/ui";

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
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [homeState, setHomeState] = useState("West Bengal");

  const [states, setStates] = useState<{ state: string; language: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.states().then(setStates).catch(() => setStates([]));
  }, []);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const { token, user } = await api.login(phone, pin);
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Worker Pay Record
          </h1>
        </header>

        <div>
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
                  void signIn();
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
                    placeholder="10-digit phone number"
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
                <InfoNote>Contractors and labour officers: ask the labour office for an account.</InfoNote>
                <Field label="Your name">
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
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
                    placeholder="10-digit phone number"
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

        </div>

      </div>
    </div>
  );
}
