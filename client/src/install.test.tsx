import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, Role } from "./shared/types";

/**
 * The install button. ADR-0018.
 *
 * What these tests guarantee:
 * - the button appears only after the browser says the app can be installed
 *   (the beforeinstallprompt event), because a button that does nothing when
 *   pressed teaches a worker that buttons do not work;
 * - pressing it shows the browser's own install question, once;
 * - it goes away when the app is installed, or when the reader says no;
 * - it is in the worker's language;
 * - the officer app never shows it, even when a browser offers to install.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("./shared/api", () => ({
  getStoredUser: vi.fn(),
  getToken: vi.fn(() => "token"),
  clearSession: vi.fn(),
  storeSession: vi.fn(),
  api: new Proxy({}, { get: () => () => new Promise(() => {}) }),
}));
vi.mock("./shared/leave", () => ({ leaveTo: vi.fn() }));

import { getStoredUser } from "./shared/api";
import { captureInstallPrompt, resetInstallPromptForTests } from "./shared/install";
import WorkerApp from "./worker/App";
import ContractorApp from "./contractor/App";
import OfficerApp from "./officer/App";

const person = (role: Role, language = "en"): AuthUser => ({
  id: `u-${role}`,
  name: role,
  phone: "9880030001",
  role,
  language,
});

function open(App: () => React.ReactElement | null, user: AuthUser) {
  vi.mocked(getStoredUser).mockReturnValue(user);
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
}

/** What a browser sends when the app can be installed. */
function offerInstall(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

beforeEach(() => {
  resetInstallPromptForTests();
  captureInstallPrompt();
});
afterEach(() => resetInstallPromptForTests());

describe.each([
  { name: "worker", App: WorkerApp, role: "WORKER" as Role },
  { name: "contractor", App: ContractorApp, role: "CONTRACTOR" as Role },
])("install button in the $name app", ({ App, role }) => {
  it("is hidden until the browser says the app can be installed", () => {
    open(App, person(role));
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    offerInstall();
    expect(screen.getByRole("button", { name: /install/i })).toBeTruthy();
  });

  it("appears when the browser's offer came before the page loaded", () => {
    offerInstall();
    open(App, person(role));
    expect(screen.getByRole("button", { name: /install/i })).toBeTruthy();
  });

  it("stops the browser's own small banner, so there is one way to install", () => {
    open(App, person(role));
    const { event } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the browser's install question once, then goes away when installed", async () => {
    open(App, person(role));
    const { prompt } = offerInstall("accepted");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install/i }));
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("goes away when the reader says no, since the browser will not ask again now", async () => {
    open(App, person(role));
    offerInstall("dismissed");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install/i }));
    });
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("goes away when the app is installed some other way, from the browser menu", () => {
    open(App, person(role));
    offerInstall();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });
});

describe("install button in the worker's language", () => {
  it("is in Malayalam for a worker who reads Malayalam", async () => {
    const { ml } = await import("./shared/i18n/ml");
    open(WorkerApp, person("WORKER", "ml"));
    offerInstall();
    expect(screen.getByRole("button", { name: ml.installApp })).toBeTruthy();
  });
});

describe("the officer app", () => {
  it("never shows an install button, even when a browser offers to install", () => {
    open(OfficerApp, person("AUTHORITY"));
    offerInstall();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });
});
