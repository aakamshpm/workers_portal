import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AuthUser, Role } from "../shared/types";

/**
 * The sign-in page at "/". ADR-0012.
 *
 * What these tests guarantee:
 * - after sign-in, each role is sent to its own app, not to a shared one;
 * - a worker who registers himself goes to the worker app;
 * - someone who is already signed in and opens "/" goes straight to their app.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("../shared/api", () => ({
  getStoredUser: vi.fn(),
  storeSession: vi.fn(),
  api: {
    login: vi.fn(),
    register: vi.fn(),
    demoAccounts: vi.fn(),
    states: vi.fn(),
  },
}));

vi.mock("../shared/leave", () => ({ leaveTo: vi.fn() }));

import { api, getStoredUser, storeSession } from "../shared/api";
import { leaveTo } from "../shared/leave";
import SignInApp from "./App";

const mocked = vi.mocked(api);

const person = (role: Role): AuthUser => ({ id: `u-${role}`, name: role, phone: "9880030001", role });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getStoredUser).mockReturnValue(null);
  mocked.demoAccounts.mockResolvedValue([]);
  mocked.states.mockResolvedValue([{ state: "West Bengal", language: "bn" }]);
});

async function signInAs(role: Role) {
  mocked.login.mockResolvedValue({ token: "t", user: person(role) });
  render(<SignInApp />);
  fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "9880030001" } });
  // The page has a "Sign in" tab and a "Sign in" submit button. Submit the form.
  fireEvent.submit(screen.getByLabelText(/phone number/i).closest("form")!);
  await vi.waitFor(() => expect(leaveTo).toHaveBeenCalled());
}

describe("sign-in", () => {
  it.each([
    ["WORKER", "/worker/"],
    ["CONTRACTOR", "/contractor/"],
    ["AUTHORITY", "/officer/"],
  ] as const)("sends a %s to %s", async (role, app) => {
    await signInAs(role);
    expect(storeSession).toHaveBeenCalled();
    expect(leaveTo).toHaveBeenCalledWith(app);
  });

  it("sends a worker who registers himself to the worker app", async () => {
    mocked.register.mockResolvedValue({ token: "t", user: person("WORKER") });
    render(<SignInApp />);

    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.change(screen.getByLabelText(/your phone number/i), { target: { value: "9845687924" } });
    fireEvent.click(screen.getByRole("button", { name: /make my account/i }));

    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/worker/"));
  });

  it("sends someone already signed in straight to their app", () => {
    vi.mocked(getStoredUser).mockReturnValue(person("CONTRACTOR"));
    render(<SignInApp />);
    expect(leaveTo).toHaveBeenCalledWith("/contractor/");
  });
});
