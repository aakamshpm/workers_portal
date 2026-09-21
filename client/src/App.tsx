import { useState } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { clearSession, getStoredUser } from "./api";
import type { AuthUser, Role } from "./types";
import Login from "./pages/Login";
import WorkerDashboard from "./pages/WorkerDashboard";
import ContractorDashboard from "./pages/ContractorDashboard";
import AuthorityDashboard from "./pages/AuthorityDashboard";
import PaymentProofPage from "./pages/PaymentProofPage";
import ComplaintPage from "./pages/ComplaintPage";
import LedgerView from "./pages/LedgerView";
import SmsView from "./pages/SmsView";

const ROLE_LABEL: Record<Role, string> = {
  CONTRACTOR: "Contractor",
  WORKER: "Worker",
  AUTHORITY: "Labour Officer",
};

/**
 * Tabs per role, each one a real URL.
 *
 * A worker never sees the page for paying someone, because only a contractor can
 * write down a payment. A contractor never sees the complaint page, because only a
 * worker can file one. Hiding what a role cannot use keeps the app short and
 * stops anyone opening a screen that would only refuse them.
 *
 * The `path` values are also the list of addresses a role is allowed to open. A
 * worker who types /pay by hand is sent back to their own first page, so the
 * address bar cannot reach further than the tabs can.
 */
const TABS: Record<Role, { path: string; label: string }[]> = {
  WORKER: [
    { path: "/work", label: "My work" },
    { path: "/help", label: "Ask for help" },
    { path: "/phone", label: "My phone" },
    { path: "/records", label: "All records" },
  ],
  CONTRACTOR: [
    { path: "/workers", label: "My workers" },
    { path: "/pay", label: "Pay a worker" },
    { path: "/messages", label: "Messages" },
    { path: "/records", label: "All records" },
  ],
  AUTHORITY: [
    { path: "/complaints", label: "Complaints" },
    { path: "/records", label: "All records" },
  ],
};

/** Where each role lands after signing in, and where a wrong address falls back to. */
const HOME: Record<Role, string> = {
  WORKER: "/work",
  CONTRACTOR: "/workers",
  AUTHORITY: "/complaints",
};

export default function App() {
  // Session is read from localStorage on first render, so a refresh during the
  // demo does not throw you back to the login screen.
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  return (
    <Routes>
      <Route path="/login" element={<LoginRoute user={user} onSignedIn={setUser} />} />

      <Route element={<Shell user={user} onSignedOut={() => setUser(null)} />}>
        <Route path="/work" element={<Guard user={user} role="WORKER" />}>
          <Route index element={<WorkerRoute user={user!} />} />
        </Route>
        <Route path="/help" element={<Guard user={user} role="WORKER" />}>
          <Route index element={<ComplaintPage user={user!} />} />
        </Route>
        <Route path="/phone" element={<Guard user={user} role="WORKER" />}>
          <Route index element={<SmsView user={user!} />} />
        </Route>

        <Route path="/workers" element={<Guard user={user} role="CONTRACTOR" />}>
          <Route index element={<ContractorRoute user={user!} />} />
        </Route>
        <Route path="/pay" element={<Guard user={user} role="CONTRACTOR" />}>
          <Route index element={<PaymentRoute />} />
        </Route>
        <Route path="/messages" element={<Guard user={user} role="CONTRACTOR" />}>
          <Route index element={<SmsView user={user!} />} />
        </Route>

        <Route path="/complaints" element={<Guard user={user} role="AUTHORITY" />}>
          <Route index element={<AuthorityDashboard user={user!} />} />
        </Route>

        {/* The only page every role shares. */}
        <Route path="/records" element={<Guard user={user} />}>
          <Route index element={<LedgerView />} />
        </Route>
      </Route>

      {/* "/" and any address that does not exist. Signed in, it becomes the
       * role's own first page; signed out, the login screen. */}
      <Route path="*" element={<Navigate to={user ? HOME[user.role] : "/login"} replace />} />
    </Routes>
  );
}

/**
 * Blocks a page when nobody is signed in, and when the signed-in role does not
 * own it.
 *
 * `replace` matters on the signed-out redirect: without it, pressing Back from
 * the login screen would return to the address that just rejected you, which
 * bounces you to login again and traps the Back button.
 */
function Guard({ user, role }: { user: AuthUser | null; role?: Role }) {
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return <Outlet />;
}

/** Already signed in? Then the login screen is not the page you wanted. */
function LoginRoute({
  user,
  onSignedIn,
}: {
  user: AuthUser | null;
  onSignedIn: (u: AuthUser) => void;
}) {
  const navigate = useNavigate();
  if (user) return <Navigate to={HOME[user.role]} replace />;
  return (
    <Login
      onSignedIn={(u) => {
        onSignedIn(u);
        navigate(HOME[u.role], { replace: true });
      }}
    />
  );
}

function WorkerRoute({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  return <WorkerDashboard user={user} onFileComplaint={() => navigate("/help")} />;
}

function ContractorRoute({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  return (
    <ContractorDashboard
      user={user}
      // The contract travels in the address, so this page can be reopened later
      // or shared, and Back returns to the worker list rather than leaving the app.
      onGoToPayment={(offerId) => navigate(`/pay?offer=${encodeURIComponent(offerId)}`)}
    />
  );
}

function PaymentRoute() {
  const [params] = useSearchParams();
  return <PaymentProofPage initialOfferId={params.get("offer") ?? undefined} />;
}

/** The header, the tabs and the frame around every signed-in page. */
function Shell({ user, onSignedOut }: { user: AuthUser | null; onSignedOut: () => void }) {
  const navigate = useNavigate();
  if (!user) return <Navigate to="/login" replace />;

  function signOut() {
    clearSession();
    onSignedOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">
              Worker Pay Record
            </h1>
            <p className="text-xs text-slate-500">
              The pay that was promised, the days worked, and the money paid
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">
                {ROLE_LABEL[user.role]}
                {user.homeState ? ` · ${user.homeState}` : ""}
                {user.company ? ` · ${user.company}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6" aria-label="Sections">
          {TABS[user.role].map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              className={({ isActive }) =>
                `-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
