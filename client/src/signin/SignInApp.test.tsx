import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AuthUser, Role } from "../shared/types";

/**
 * The sign-in page at "/". ADR-0012, ADR-0013, ADR-0014.
 *
 * What these tests guarantee:
 * - one question per screen: the phone number first, then only what that
 *   step needs;
 * - PIN and code are typed in separate boxes, one digit each, on the number
 *   keypad, and moving between boxes happens by itself;
 * - after sign-in each role goes to its own app;
 * - a new worker proves he holds the phone with the SMS code before he gives
 *   his name or chooses a PIN;
 * - "Forgot PIN" sets a new PIN only with the code;
 * - an already signed-in user goes straight to his app;
 * - nothing from the demo: no account list, no shared PIN, no seeded names.
 *
 * The API module is mocked. No test reaches the server or textbee.dev.
 */

vi.mock("../shared/api", () => ({
  getStoredUser: vi.fn(),
  storeSession: vi.fn(),
  api: {
    login: vi.fn(),
    sendPhoneCode: vi.fn(),
    register: vi.fn(),
    resetPin: vi.fn(),
    states: vi.fn(),
  },
}));

vi.mock("../shared/leave", () => ({ leaveTo: vi.fn() }));

import { api, getStoredUser, storeSession } from "../shared/api";
import { leaveTo } from "../shared/leave";
import SignInApp from "./App";
import { DICTIONARIES } from "../shared/i18n";

const mocked = vi.mocked(api);
const person = (role: Role): AuthUser => ({ id: `u-${role}`, name: role, phone: "9845687924", role });

beforeEach(() => {
  vi.resetAllMocks();
  // The reader chose English. Without a choice, picking Assam below would turn
  // the page into Bengali (tested in "language").
  localStorage.setItem("wage-ledger-language", "en");
  vi.mocked(getStoredUser).mockReturnValue(null);
  mocked.states.mockResolvedValue([
    { state: "West Bengal", language: "bn" },
    { state: "Assam", language: "bn" },
  ]);
  mocked.sendPhoneCode.mockResolvedValue({ sent: true, expiresInMinutes: 10 });
});

/**
 * Type digits into a row of one-digit boxes named "<label> digit 1", "digit 2", …
 * Waits for the boxes, because some steps appear only after a request answers.
 */
async function typeDigits(label: RegExp, digits: string) {
  const boxes = (await screen.findAllByLabelText(label)) as HTMLInputElement[];
  expect(boxes.length).toBe(digits.length);
  digits.split("").forEach((d, i) => fireEvent.change(boxes[i]!, { target: { value: d } }));
}

function typePhone(phone: string) {
  fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
}

describe("sign in", () => {
  it("asks only for the phone number first", () => {
    render(<SignInApp />);
    expect(screen.getByLabelText(/phone number/i)).toBeTruthy();
    expect(screen.queryAllByLabelText(/pin digit/i)).toHaveLength(0);
  });

  it("shows four one-digit PIN boxes on the number keypad after the phone", () => {
    render(<SignInApp />);
    typePhone("9845687924");
    const boxes = screen.getAllByLabelText(/pin digit/i) as HTMLInputElement[];
    expect(boxes).toHaveLength(4);
    for (const b of boxes) {
      expect(b.getAttribute("inputmode")).toBe("numeric");
      expect(b.maxLength).toBe(1);
      expect(b.value).toBe("");
    }
  });

  it("moves to the next box by itself after each digit", () => {
    render(<SignInApp />);
    typePhone("9845687924");
    const boxes = screen.getAllByLabelText(/pin digit/i) as HTMLInputElement[];
    boxes[0]!.focus();
    fireEvent.change(boxes[0]!, { target: { value: "5" } });
    expect(document.activeElement).toBe(boxes[1]);
  });

  it("does not accept a phone number that is not 10 digits", () => {
    render(<SignInApp />);
    typePhone("98456");
    expect(screen.getByRole("alert").textContent).toMatch(/10-digit/i);
    expect(screen.queryAllByLabelText(/pin digit/i)).toHaveLength(0);
  });

  it.each([
    ["WORKER", "/worker/"],
    ["CONTRACTOR", "/contractor/"],
    ["AUTHORITY", "/officer/"],
  ] as const)("sends a %s to %s once the fourth digit is typed", async (role, app) => {
    mocked.login.mockResolvedValue({ token: "t", user: person(role) });
    render(<SignInApp />);
    typePhone("9845687924");
    await typeDigits(/pin digit/i, "5739");
    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith(app));
    expect(mocked.login).toHaveBeenCalledWith("9845687924", "5739");
    expect(storeSession).toHaveBeenCalled();
  });

  it("shows the server's message and empties the PIN boxes when the PIN is wrong", async () => {
    mocked.login.mockRejectedValue(new Error("Wrong phone number or PIN"));
    render(<SignInApp />);
    typePhone("9845687924");
    await typeDigits(/pin digit/i, "0000");
    expect((await screen.findByRole("alert")).textContent).toMatch(/wrong phone number or pin/i);
    for (const b of screen.getAllByLabelText(/pin digit/i) as HTMLInputElement[]) expect(b.value).toBe("");
  });

  it("sends someone already signed in straight to their app", () => {
    vi.mocked(getStoredUser).mockReturnValue(person("CONTRACTOR"));
    render(<SignInApp />);
    expect(leaveTo).toHaveBeenCalledWith("/contractor/");
  });
});

describe("new worker", () => {
  async function startRegistration() {
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await vi.waitFor(() =>
      expect(mocked.sendPhoneCode).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "9845687924", purpose: "REGISTER" }),
      ),
    );
  }

  it("sends the SMS code first, before asking for anything else", async () => {
    await startRegistration();
    expect(await screen.findAllByLabelText(/code digit/i)).toHaveLength(6);
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
    expect(screen.queryAllByLabelText(/pin digit/i)).toHaveLength(0);
  });

  it("registers with the code, name, home state and a PIN typed twice, then opens the worker app", async () => {
    mocked.register.mockResolvedValue({ token: "t", user: person("WORKER") });
    await startRegistration();

    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));

    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "5739");

    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/worker/"));
    expect(mocked.register).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "9845687924",
        code: "482913",
        name: "Ramu",
        homeState: "Assam",
        pin: "5739",
      }),
    );
  });

  it("asks again when the two PINs do not match, and does not register", async () => {
    await startRegistration();
    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "1111");
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not match/i);
    expect(mocked.register).not.toHaveBeenCalled();
  });

  it("shows the server's message when the code is refused", async () => {
    mocked.register.mockRejectedValue(new Error("That code is wrong or has expired. Ask for a new code."));
    await startRegistration();
    await typeDigits(/code digit/i, "000000");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "5739");
    expect((await screen.findByRole("alert")).textContent).toMatch(/wrong or has expired/i);
    expect(leaveTo).not.toHaveBeenCalled();
  });
});

describe("forgot PIN", () => {
  it("sets a new PIN with the SMS code, then opens the user's own app", async () => {
    mocked.resetPin.mockResolvedValue({ token: "t", user: person("CONTRACTOR") });
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /forgot pin/i }));
    typePhone("9000010001");
    await vi.waitFor(() =>
      expect(mocked.sendPhoneCode).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "9000010001", purpose: "RESET_PIN" }),
      ),
    );

    await typeDigits(/code digit/i, "482913");
    await typeDigits(/pin digit/i, "8642");
    await typeDigits(/again digit/i, "8642");

    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/contractor/"));
    expect(mocked.resetPin).toHaveBeenCalledWith({ phone: "9000010001", code: "482913", pin: "8642" });
  });

  it("shows the server's wait message when a code was asked for too recently", async () => {
    mocked.sendPhoneCode.mockRejectedValue(new Error("Wait a minute before asking for another code."));
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /forgot pin/i }));
    typePhone("9000010001");
    expect((await screen.findByRole("alert")).textContent).toMatch(/wait a minute/i);
    expect(screen.queryAllByLabelText(/code digit/i)).toHaveLength(0);
  });
});

/**
 * ADR-0015: the sign-in page in the worker's language.
 *
 * - the language list is on every screen, named in each language's own script;
 * - the choice changes the page at once, tells the browser (<html lang>), and
 *   is kept for the next visit;
 * - a new worker who never touched the list gets the language of the home
 *   state he picks, for the rest of the page;
 * - the chosen language goes with the code request and the registration, so
 *   his SMS come in the language he read the page in.
 */
describe("language", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
  });

  const picker = () => screen.getByRole("combobox");
  const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** The one-digit boxes named `label`, in a dictionary's own "digit N of M" words. */
  const boxes = (lang: keyof typeof DICTIONARIES, label: string) =>
    new RegExp(
      "^" +
        esc(DICTIONARIES[lang].digitOf)
          .replace("\\{label\\}", esc(label))
          .replace("\\{n\\}", "\\d+")
          .replace("\\{total\\}", "\\d+") +
        "$",
    );

  it("is on every screen and changes the page at once", async () => {
    render(<SignInApp />);
    fireEvent.change(picker(), { target: { value: "bn" } });
    expect(document.documentElement.lang).toBe("bn");
    expect(screen.getByRole("button", { name: DICTIONARIES.bn.next })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(DICTIONARIES.bn.phoneNumber), { target: { value: "9845687924" } });
    fireEvent.click(screen.getByRole("button", { name: DICTIONARIES.bn.next }));
    expect(await screen.findAllByLabelText(boxes("bn", DICTIONARIES.bn.pinLabel))).toHaveLength(4);
    expect(picker()).toBeTruthy();
  });

  it("names each language in its own script", () => {
    render(<SignInApp />);
    const names = Array.from(picker().querySelectorAll("option")).map((o) => o.textContent);
    expect(names).toEqual(["English", "हिन्दी", "বাংলা", "മലയാളം", "ଓଡ଼ିଆ"]);
  });

  it("keeps the choice for the next visit", () => {
    const first = render(<SignInApp />);
    fireEvent.change(picker(), { target: { value: "or" } });
    first.unmount();
    render(<SignInApp />);
    expect((picker() as HTMLSelectElement).value).toBe("or");
    expect(screen.getByRole("button", { name: DICTIONARIES.or.next })).toBeTruthy();
  });

  it("sends the chosen language with the code request and the registration", async () => {
    mocked.register.mockResolvedValue({ token: "t", user: person("WORKER") });
    render(<SignInApp />);
    fireEvent.change(picker(), { target: { value: "hi" } });
    const hi = DICTIONARIES.hi;
    fireEvent.click(screen.getByRole("button", { name: hi.makeAccount }));
    fireEvent.change(screen.getByLabelText(hi.phoneNumber), { target: { value: "9845687924" } });
    fireEvent.click(screen.getByRole("button", { name: hi.next }));
    await vi.waitFor(() =>
      expect(mocked.sendPhoneCode).toHaveBeenCalledWith(expect.objectContaining({ language: "hi" })),
    );
    await typeDigits(boxes("hi", hi.codeLabel), "482913");
    fireEvent.change(await screen.findByLabelText(hi.yourName), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: hi.next }));
    // West Bengal would mean Bengali, but he chose Hindi himself, so Hindi stays.
    fireEvent.click(await screen.findByRole("button", { name: hi.stateWestBengal }));
    expect(document.documentElement.lang).toBe("hi");
    await typeDigits(boxes("hi", hi.pinLabel), "5739");
    await typeDigits(boxes("hi", hi.pinAgainLabel), "5739");
    await vi.waitFor(() =>
      expect(mocked.register).toHaveBeenCalledWith(expect.objectContaining({ language: "hi", homeState: "West Bengal" })),
    );
  });

  it("uses the home state's language when the worker never chose one", async () => {
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    expect(document.documentElement.lang).toBe("bn");
    expect(screen.getByText(DICTIONARIES.bn.choosePin)).toBeTruthy();
  });
});

/** ADR-0013: nothing from the demo on the real sign-in page. */
describe("no demo parts", () => {
  it("lists no accounts and mentions no shared PIN or seeded person", () => {
    render(<SignInApp />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/accounts to try/i);
    expect(text).not.toMatch(/1234/);
    expect(text).not.toMatch(/pramod|bijoy|98800/i);
  });
});
