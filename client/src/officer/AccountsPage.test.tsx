import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Account } from "../shared/types";

/**
 * Officer "Accounts" page. ADR-0014, docs/contracts/auth.md.
 *
 * What these tests guarantee:
 * - the officer never types or sees a PIN, because only the owner of the
 *   account sets it, with a code sent to his own phone;
 * - an account without a PIN is marked, and the page tells the officer what
 *   the owner must do next ("Forgot PIN" on the sign-in page);
 * - a contractor needs a company, a labour officer has no company field,
 *   the same rules the server applies;
 * - the server's own message is shown when it refuses (for example, the
 *   number already has an account);
 * - loading, empty and error states each say something, never a blank area.
 *
 * The API module is mocked. No test reaches the server or textbee.dev.
 */

vi.mock("../shared/api", () => ({
  api: {
    accounts: vi.fn(),
    createAccount: vi.fn(),
  },
}));

import { api } from "../shared/api";
import AccountsPage from "./AccountsPage";

const mocked = vi.mocked(api);

const CONTRACTOR: Account = {
  id: "a1",
  name: "Joseph Varghese",
  phone: "9447012345",
  role: "CONTRACTOR",
  company: "Varghese Builders",
  hasPin: true,
  createdAt: "2026-09-20T10:00:00.000Z",
};

const NEW_OFFICER: Account = {
  id: "a2",
  name: "Latha Nair",
  phone: "9447098765",
  role: "AUTHORITY",
  company: null,
  hasPin: false,
  createdAt: "2026-09-25T10:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
});

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("the list", () => {
  it("says it is loading before the answer arrives", () => {
    mocked.accounts.mockReturnValue(new Promise(() => {}));
    render(<AccountsPage />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("says so when there are no accounts yet", async () => {
    mocked.accounts.mockResolvedValue([]);
    render(<AccountsPage />);
    expect(await screen.findByText(/no contractor or officer accounts yet/i)).toBeTruthy();
  });

  it("shows the server's message when the list cannot load", async () => {
    mocked.accounts.mockRejectedValue(new Error("Only a labour officer can do this"));
    render(<AccountsPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/only a labour officer/i);
  });

  it("shows each account with its role, and marks the one that has no PIN yet", async () => {
    mocked.accounts.mockResolvedValue([NEW_OFFICER, CONTRACTOR]);
    render(<AccountsPage />);

    const contractorRow = (await screen.findByText("Joseph Varghese")).closest("li")!;
    expect(within(contractorRow).getByText(/contractor/i)).toBeTruthy();
    expect(within(contractorRow).getByText("Varghese Builders")).toBeTruthy();
    expect(within(contractorRow).getByText(/can sign in/i)).toBeTruthy();

    const officerRow = screen.getByText("Latha Nair").closest("li")!;
    expect(within(officerRow).getByText(/labour officer/i)).toBeTruthy();
    expect(within(officerRow).getByText(/no pin yet/i)).toBeTruthy();
  });
});

describe("creating an account", () => {
  beforeEach(() => {
    mocked.accounts.mockResolvedValue([CONTRACTOR]);
  });

  // A field *labelled* PIN, or any password box. The phone field's hint may
  // mention the PIN (it tells where the code goes), so /pin/ anywhere is too wide.
  function pinFields(container: HTMLElement) {
    return [
      ...screen.queryAllByLabelText(/^\s*(new )?pin\b/i),
      ...container.querySelectorAll('input[type="password"]'),
    ];
  }

  it("never asks the officer for a PIN", async () => {
    const { container } = render(<AccountsPage />);
    await screen.findByText("Joseph Varghese");
    expect(pinFields(container)).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: /labour officer/i }));
    expect(pinFields(container)).toHaveLength(0);
  });

  it("asks for a company only for a contractor", async () => {
    render(<AccountsPage />);
    await screen.findByText("Joseph Varghese");
    expect(screen.getByLabelText(/company/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /labour officer/i }));
    expect(screen.queryByLabelText(/company/i)).toBeNull();
  });

  it("creates a contractor, adds him to the list, and says the owner must use Forgot PIN", async () => {
    const created: Account = {
      ...CONTRACTOR,
      id: "a3",
      name: "Ravi Thomas",
      phone: "9447055555",
      company: "Thomas Works",
      hasPin: false,
    };
    mocked.createAccount.mockResolvedValue(created);
    render(<AccountsPage />);
    await screen.findByText("Joseph Varghese");

    fill(/^name/i, "Ravi Thomas");
    fill(/phone number/i, "9447055555");
    fill(/company/i, "Thomas Works");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("Ravi Thomas")).toBeTruthy();
    expect(mocked.createAccount).toHaveBeenCalledWith({
      role: "CONTRACTOR",
      name: "Ravi Thomas",
      phone: "9447055555",
      company: "Thomas Works",
    });
    expect(screen.getByRole("status").textContent).toMatch(/forgot pin/i);
  });

  it("creates a labour officer without sending any company", async () => {
    mocked.createAccount.mockResolvedValue(NEW_OFFICER);
    render(<AccountsPage />);
    await screen.findByText("Joseph Varghese");

    fireEvent.click(screen.getByRole("radio", { name: /labour officer/i }));
    fill(/^name/i, "Latha Nair");
    fill(/phone number/i, "9447098765");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByText("Latha Nair");
    expect(mocked.createAccount).toHaveBeenCalledWith({
      role: "AUTHORITY",
      name: "Latha Nair",
      phone: "9447098765",
    });
  });

  it("shows the server's message when the number already has an account", async () => {
    mocked.createAccount.mockRejectedValue(new Error("That number already has an account"));
    render(<AccountsPage />);
    await screen.findByText("Joseph Varghese");

    fill(/^name/i, "Ravi Thomas");
    fill(/phone number/i, "9447012345");
    fill(/company/i, "Thomas Works");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/already has an account/i);
  });
});
