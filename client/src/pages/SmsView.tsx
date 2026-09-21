import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AuthUser, SmsInbox, SmsMessage } from "../types";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  formatDateTime,
  formatPhone,
  InfoNote,
} from "../components/ui";

/**
 * The worker's phone, as it would look.
 *
 * Every message here is real text built from real records by the server. What is
 * simulated is only the delivery: there is no SMS gateway, so nothing leaves the
 * machine. The banner says so, because a demo that implies working delivery is
 * claiming something it cannot do.
 *
 * The reply box is not decoration. Typing YES here runs the same code path as the
 * accept button on the dashboard, which is the point: a worker with a basic phone
 * and no internet can still answer.
 */
export default function SmsView({ user }: { user: AuthUser }) {
  const [inbox, setInbox] = useState<SmsInbox | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<string>("");
  const endRef = useRef<HTMLDivElement>(null);

  // Which messages are currently being read in English. A set of ids rather than
  // one flag, so switching every message at once and switching a single message
  // are the same mechanism.
  const [showEnglish, setShowEnglish] = useState<Set<string>>(new Set());

  function toggleOne(id: string) {
    setShowEnglish((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function load(scroll = false) {
    setError("");
    try {
      const data = await api.sms();
      setInbox(data);
      if (scroll) {
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your messages. Please try again.");
    }
  }

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setBusy(true);
    setError("");
    try {
      const r = await api.smsReply(reply);
      setLastResult(
        r.understood
          ? `We read that as ${intentLabel(r.intent)}${r.ref ? ` for code ${r.ref}` : ""}.`
          : "We did not understand that. Instead of guessing, the app has sent you a message listing the words it knows.",
      );
      setReply("");
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!inbox) return <EmptyState>Please wait…</EmptyState>;

  const isWorker = user.role === "WORKER";

  // A worker's own replies are typed as Latin keywords, so they have no English
  // copy and need no control.
  const translatable = inbox.messages.filter((m) => m.bodyEn !== null);
  const allShown = translatable.length > 0 && translatable.every((m) => showEnglish.has(m.id));

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <InfoNote>
        These messages are not really sent. The words come from the real records, but this project has
        no connection to a phone company, so nothing leaves this computer.
      </InfoNote>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* The phone */}
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-[1.75rem] border-4 border-slate-800 bg-slate-800 shadow-lg">
          <div className="flex items-center justify-between px-4 py-1.5 text-[10px] text-slate-300">
            <span>{formatPhone(inbox.phone)}</span>
            <span>not really sent</span>
          </div>

          {/* Only offered when at least one message is in another language. */}
          {translatable.length > 0 && (
            <div className="flex items-center justify-between gap-2 bg-slate-700 px-3 py-1.5">
              <p className="text-[10px] text-slate-300">
                {allShown
                  ? "Reading in English"
                  : `Written in ${languageName(inbox.messages)}`}
              </p>
              <button
                type="button"
                onClick={() =>
                  setShowEnglish(allShown ? new Set() : new Set(translatable.map((m) => m.id)))
                }
                className="rounded-full bg-slate-600 px-2.5 py-0.5 text-[10px] font-medium text-white transition hover:bg-slate-500"
              >
                {allShown ? "Show the worker's language" : "Read in English"}
              </button>
            </div>
          )}

          <div className="h-[28rem] space-y-2.5 overflow-y-auto bg-slate-50 px-3 py-3">
            {inbox.messages.length === 0 ? (
              <p className="pt-20 text-center text-xs text-slate-400">No messages yet.</p>
            ) : (
              inbox.messages.map((m) => (
                <Bubble
                  key={m.id}
                  message={m}
                  showEnglish={showEnglish}
                  onToggle={() => toggleOne(m.id)}
                />
              ))
            )}
            <div ref={endRef} />
          </div>

          {isWorker ? (
            <form
              className="flex gap-2 bg-slate-800 px-3 py-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {/* `bg-white` is required, not decoration. Without it the input
                * inherits the dark phone body behind it while the text stays
                * near-black, so whatever is typed cannot be read. */}
              <input
                className="flex-1 rounded-full border-0 bg-white px-3 py-1.5 text-xs text-slate-900 ring-1 ring-slate-600 placeholder:text-slate-400 focus:ring-2 focus:ring-white"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="YES 1234"
                aria-label="Type a message to send"
              />
              <Button type="submit" size="sm" variant="success" disabled={busy || !reply.trim()}>
                {busy ? "…" : "Send"}
              </Button>
            </form>
          ) : (
            <p className="bg-slate-800 px-3 py-2.5 text-center text-[10px] text-slate-400">
              Only workers can answer by message. Sign in as a worker to try it.
            </p>
          )}
        </div>

        {/* What the phone can do */}
        <div className="space-y-4">
          {lastResult && (
            <div className="rounded-md bg-slate-900 px-4 py-3 text-sm text-white">{lastResult}</div>
          )}

          <Card
            title="Words you can send"
            description="A worker with a simple phone and no internet uses these. Each one does exactly the same thing as the buttons on his page."
          >
            <ul className="divide-y divide-slate-200 text-sm">
              <Keyword word="YES" arg="code" what="Take the job. Your daily pay is then fixed." />
              <Keyword word="NO" arg="code" what="Refuse the job." />
              <Keyword
                word="OK"
                arg="code"
                what="Say that a line about your work or your pay is correct."
              />
              <Keyword
                word="WRONG"
                arg="code"
                what="Say it is not correct. An officer will phone you to ask for your number."
              />
              <Keyword word="BAL" what="Ask how much money you are owed right now." />
            </ul>
          </Card>

          <Card title="Why OK and YES are different words">
            <p className="px-5 py-4 text-sm text-slate-700">
              YES takes a job and fixes your daily pay. OK only says that one line about your work or
              your pay is correct. If the same word did both, a worker answering about one day's work
              could take a whole job by mistake, without having read it. We keep them apart on
              purpose, and there is a test that fails if anyone ever joins them together.
            </p>
          </Card>

          {inbox.awaitingReply.length > 0 && (
            <Card title="Codes waiting for an answer">
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {inbox.awaitingReply.map((ref) => (
                  <button
                    key={ref}
                    type="button"
                    onClick={() => setReply(`YES ${ref}`)}
                    className="rounded-md bg-amber-50 px-2.5 py-1.5 font-mono text-xs text-amber-800 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-100"
                  >
                    {ref}
                  </button>
                ))}
              </div>
              <p className="px-5 pb-4 text-xs text-slate-500">
                Press a code and the message box below fills in with YES for that job.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One message.
 *
 * The English copy is not a machine translation. The server built it by calling
 * the same message function a second time with "en", so the two versions cannot
 * drift apart. When a message is being read in English it is marked as such,
 * because a reader must never mistake it for what the worker actually received.
 */
function Bubble({
  message: m,
  showEnglish,
  onToggle,
}: {
  message: SmsMessage;
  showEnglish: Set<string>;
  onToggle: () => void;
}) {
  const incoming = m.direction === "IN";
  const english = showEnglish.has(m.id) && m.bodyEn !== null;

  return (
    <div className={`flex ${incoming ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
          incoming
            ? "rounded-br-sm bg-emerald-600 text-white"
            : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200"
        }`}
      >
        <p className="whitespace-pre-wrap">{english ? m.bodyEn : m.body}</p>

        <div className={`mt-1 flex items-center gap-2 text-[10px] ${incoming ? "text-emerald-100" : "text-slate-400"}`}>
          <span>{formatDateTime(m.createdAt)}</span>
          {m.bodyEn !== null && (
            <button
              type="button"
              onClick={onToggle}
              className="underline decoration-dotted underline-offset-2 transition hover:opacity-70"
            >
              {english ? "show original" : "in English"}
            </button>
          )}
          {english && <span className="italic">translated</span>}
        </div>
      </div>
    </div>
  );
}

/** The language the worker's messages are written in, for the banner. */
function languageName(messages: SmsMessage[]): string {
  const names: Record<string, string> = {
    hi: "Hindi",
    bn: "Bengali",
    ml: "Malayalam",
    or: "Odia",
    en: "English",
  };
  const code = messages.find((m) => m.bodyEn !== null)?.language;
  return code ? (names[code] ?? code) : "another language";
}

function Keyword({ word, arg, what }: { word: string; arg?: string; what: string }) {
  return (
    <li className="flex gap-3 px-5 py-2.5">
      <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
        {word}
        {arg ? ` ${arg}` : ""}
      </code>
      <span className="text-slate-600">{what}</span>
    </li>
  );
}

function intentLabel(intent?: string): string {
  const map: Record<string, string> = {
    ACCEPT: "taking the job",
    DECLINE: "refusing the job",
    CONFIRM: "saying it is correct",
    REJECT: "saying it is wrong",
    BALANCE: "asking how much you are owed",
  };
  return intent ? (map[intent] ?? intent) : "an answer";
}
