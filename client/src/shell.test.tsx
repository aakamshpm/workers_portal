import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, Role } from "./shared/types";

/**
 * The frame around a signed-in app (ADR-0012, ADR-0019, design W1).
 *
 * What these tests guarantee, for the worker app on a phone:
 * - the header holds three things only: the app name, the language list and
 *   one button for his own account, so it fits a 320px phone in every
 *   language instead of wrapping into four lines;
 * - his name, his role, his home state and "Sign out" are behind that one
 *   button, and nowhere else, so "Sign out" is never tapped by mistake;
 * - the four sections are a bar at the foot of the screen, where a thumb
 *   reaches, each with an icon and a name, and none is cut off;
 * - the current section is marked for a screen reader, not only by colour.
 *
 * The contractor app has the same frame (header of two things and one account
 * button, three sections at the foot), without a language list. The officer
 * website keeps its header with the name and a visible "Sign out", because
 * it is a desktop site and waits for its sidebar ADR.
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

import { clearSession, getStoredUser } from "./shared/api";
import { leaveTo } from "./shared/leave";
import { DICTIONARIES } from "./shared/i18n";
import WorkerApp from "./worker/App";
import ContractorApp from "./contractor/App";
import OfficerApp from "./officer/App";

const WORKER: AuthUser = {
  id: "w1",
  name: "Bijoy Das",
  phone: "9880030001",
  role: "WORKER" as Role,
  language: "en",
  homeState: "West Bengal",
};

function openWorker(user: AuthUser = WORKER, at = "/work") {
  vi.mocked(getStoredUser).mockReturnValue(user);
  render(
    <MemoryRouter initialEntries={[at]}>
      <WorkerApp />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.resetAllMocks());

describe("worker app header", () => {
  it("holds the app name, the language list and one account button, and nothing else", () => {
    openWorker();
    const header = screen.getByRole("banner");
    expect(header.textContent).toContain("Worker Pay Record");
    expect(within(header).getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(within(header).getAllByRole("button")).toHaveLength(1);
    expect(within(header).getByRole("button", { name: /your account/i })).toBeTruthy();
    // The long tagline and the name block were what made it wrap on a phone.
    expect(header.textContent).not.toContain("Bijoy Das");
    expect(header.textContent).not.toContain(DICTIONARIES.en.appTagline);
  });

  it("shows his name, role, home state and Sign out only after he opens his account", () => {
    openWorker();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();

    const account = screen.getByRole("button", { name: /your account/i });
    expect(account.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(account);
    expect(account.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("dialog", { name: /your account/i });
    expect(menu.textContent).toContain("Bijoy Das");
    expect(menu.textContent).toContain("Worker");
    expect(menu.textContent).toContain("West Bengal");
    expect(menu.textContent).toContain("98800\u00a030001");
  });

  it("closes the account panel with Escape, and gives focus back to the button", () => {
    openWorker();
    const account = screen.getByRole("button", { name: /your account/i });
    fireEvent.click(account);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(account);
  });

  it("signs out from the account panel", () => {
    openWorker();
    fireEvent.click(screen.getByRole("button", { name: /your account/i }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(clearSession).toHaveBeenCalledOnce();
    expect(leaveTo).toHaveBeenCalledWith("/");
  });

  it("is in his language, home state included", () => {
    const ml = DICTIONARIES.ml;
    openWorker({ ...WORKER, language: "ml" });
    fireEvent.click(screen.getByRole("button", { name: ml.yourAccount }));
    const menu = screen.getByRole("dialog");
    expect(menu.textContent).toContain(ml.roleWorker);
    expect(menu.textContent).toContain(ml.stateWestBengal);
    expect(within(menu).getByRole("button", { name: ml.signOut })).toBeTruthy();
  });
});

describe("worker app sections", () => {
  it("are one bar of four, each with its name, after the page", () => {
    openWorker();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["My work", "Find work", "Ask for help", "Records"]);
    // After <main> in the page, so a screen reader reads the screen first.
    const main = screen.getByRole("main");
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.className).toContain("fixed");
    expect(nav.className).toContain("bottom-0");
  });

  it("mark the open section for a screen reader", () => {
    openWorker(WORKER, "/find-work");
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "Find work" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "My work" }).getAttribute("aria-current")).toBeNull();
  });

  it("leave room under the page, so the bar never covers the last button", () => {
    openWorker();
    expect(screen.getByRole("main").className).toContain("pb-[calc(var(--size-bottom-nav)+var(--spacing-space-xl))]");
  });
});

const CONTRACTOR: AuthUser = {
  ...WORKER,
  id: "c1",
  name: "Ramesh Pillai",
  phone: "9000010001",
  role: "CONTRACTOR" as Role,
  homeState: "Kerala",
  company: "Ramesh Builders",
};

function openContractor(at = "/workers") {
  vi.mocked(getStoredUser).mockReturnValue(CONTRACTOR);
  render(
    <MemoryRouter initialEntries={[at]}>
      <ContractorApp />
    </MemoryRouter>,
  );
}

describe("contractor app header", () => {
  it("holds the app name and one account button, like the worker app, so it fits a 320px phone", () => {
    openContractor();
    const header = screen.getByRole("banner");
    expect(header.textContent).toContain("Worker Pay Record");
    expect(within(header).getAllByRole("button")).toHaveLength(1);
    expect(within(header).getByRole("button", { name: /your account/i })).toBeTruthy();
    // The name block, the tagline and a bare "Sign out" are what wrapped into four lines.
    expect(header.textContent).not.toContain("Ramesh Pillai");
    expect(header.textContent).not.toContain(DICTIONARIES.en.appTagline);
    expect(within(header).queryByRole("navigation")).toBeNull();
  });

  it("shows his name, role, state, business, phone and Sign out only behind the account button", () => {
    openContractor();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /your account/i }));
    const menu = screen.getByRole("dialog", { name: /your account/i });
    expect(menu.textContent).toContain("Ramesh Pillai");
    expect(menu.textContent).toContain("Contractor");
    expect(menu.textContent).toContain("Kerala");
    expect(menu.textContent).toContain("Ramesh Builders");
    expect(menu.textContent).toContain("90000\u00a010001");
    fireEvent.click(within(menu).getByRole("button", { name: "Sign out" }));
    expect(clearSession).toHaveBeenCalledOnce();
    expect(leaveTo).toHaveBeenCalledWith("/");
  });

  it("has no language list, because the contractor app is English", () => {
    openContractor();
    expect(within(screen.getByRole("banner")).queryByRole("combobox")).toBeNull();
  });
});

describe("contractor app sections", () => {
  it("are one bar of three at the foot of the screen, each with an icon, none cut off", () => {
    openContractor();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["My workers", "Pay a worker", "All records"]);
    expect(nav.className).toContain("fixed");
    expect(nav.className).toContain("bottom-0");
    for (const a of links) expect(a.querySelector("svg")).not.toBeNull();
    // Three columns, not the worker's four: the tabs share the width equally.
    expect(nav.querySelector("ul")!.getAttribute("style")).toContain("repeat(3");
    const main = screen.getByRole("main");
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.className).toContain("pb-[calc(var(--size-bottom-nav)+var(--spacing-space-xl))]");
  });

  it("mark the open section for a screen reader", () => {
    openContractor("/pay");
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "Pay a worker" }).getAttribute("aria-current")).toBe("page");
  });
});

const OFFICER: AuthUser = {
  ...WORKER,
  id: "o1",
  name: "Anita Joseph",
  phone: "9000020001",
  role: "AUTHORITY" as Role,
  homeState: "Kerala",
  company: "District Labour Office, Ernakulam",
};

function openOfficer(at = "/complaints") {
  vi.mocked(getStoredUser).mockReturnValue(OFFICER);
  render(
    <MemoryRouter initialEntries={[at]}>
      <OfficerApp />
    </MemoryRouter>,
  );
}

describe("officer website top bar", () => {
  it("holds the app name, his name and office, and a visible Sign out, with no account button", () => {
    openOfficer();
    const header = screen.getByRole("banner");
    expect(header.textContent).toContain("Worker Pay Record");
    expect(header.textContent).toContain("Anita Joseph");
    expect(header.textContent).toContain("Labour Officer");
    expect(header.textContent).toContain("District Labour Office, Ernakulam");
    // He uses a mouse and has the room, so Sign out is not hidden behind a button.
    expect(within(header).getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(within(header).queryByRole("button", { name: /your account/i })).toBeNull();
    // The sections are in the sidebar, not in the top bar.
    expect(within(header).queryByRole("navigation")).toBeNull();
    expect(header.textContent).not.toContain(DICTIONARIES.en.appTagline);
  });

  it("signs out from the top bar", () => {
    openOfficer();
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Sign out" }));
    expect(clearSession).toHaveBeenCalledOnce();
    expect(leaveTo).toHaveBeenCalledWith("/");
  });

  it("has no language list, because the officer website is English", () => {
    openOfficer();
    expect(within(screen.getByRole("banner")).queryByRole("combobox")).toBeNull();
  });
});

describe("officer website sidebar", () => {
  it("is one list of four sections, each with an icon, outside the top bar", () => {
    openOfficer();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Complaints",
      "Disputed records",
      "All records",
      "Accounts",
    ]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/complaints",
      "/disputes",
      "/records",
      "/accounts",
    ]);
    for (const a of links) expect(a.querySelector("svg")).not.toBeNull();
    expect(within(screen.getByRole("banner")).queryByRole("navigation")).toBeNull();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("stands beside the page from 1024px up and stays in view, and is a row below that", () => {
    openOfficer();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const main = screen.getByRole("main");
    const frame = nav.parentElement!;
    expect(frame.contains(main)).toBe(true);
    expect(frame.className).toContain("lg:flex-row");
    expect(nav.className).toContain("lg:sticky");
    expect(nav.className).toContain("lg:w-64");
    expect(nav.querySelector("ul")!.className).toContain("lg:flex-col");
    // A row that scrolls inside itself on a narrow tablet, never the whole page.
    expect(nav.className).toContain("overflow-x-auto");
    // The page may shrink, so a wide table never pushes the sidebar off the screen.
    expect(main.className).toContain("min-w-0");
    expect(main.className).toContain("flex-1");
  });

  it("marks the open section for a screen reader", () => {
    openOfficer("/disputes");
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "Disputed records" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Complaints" }).getAttribute("aria-current")).toBeNull();
  });
});
