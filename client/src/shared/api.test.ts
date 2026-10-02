import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How `request()` reports a failure (ADR-0020).
 *
 * What these tests guarantee:
 * - a 401 from the server ends the session only when the browser sent a
 *   session. A wrong PIN is also a 401, and before this the sign-in page
 *   reloaded itself and the worker never saw "Wrong PIN";
 * - every failure is an ApiError with a fixed `code`, so the page can show
 *   its own text in the reader's language: the server's code when there is
 *   one, NETWORK when the request never reached the server, SERVER when the
 *   answer was not the JSON the server sends (the API down behind a proxy);
 * - extra fields such as `minutesLeft` reach the page.
 */

vi.mock("./leave", () => ({ leaveTo: vi.fn() }));

import { api, ApiError, storeSession } from "./api";
import { leaveTo } from "./leave";

const realFetch = globalThis.fetch;

function answer(status: number, body: string, type = "application/json") {
  globalThis.fetch = vi.fn(async () => new Response(body, { status, headers: { "Content-Type": type } }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(leaveTo).mockReset();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

describe("a wrong PIN", () => {
  it("is reported to the page, and does not reload the sign-in page", async () => {
    answer(401, JSON.stringify({ error: "Wrong phone number or PIN", code: "WRONG_PIN" }));
    const e = await failure(api.login("9880030001", "0000"));
    expect(e.code).toBe("WRONG_PIN");
    expect(e.status).toBe(401);
    expect(leaveTo).not.toHaveBeenCalled();
  });
});

describe("an ended session", () => {
  it("still clears the session and goes to the sign-in page", async () => {
    storeSession("old-token", { id: "u", name: "A", phone: "9880030001", role: "WORKER" });
    answer(401, JSON.stringify({ error: "Your session has expired. Please sign in again." }));
    const e = await failure(api.offers());
    expect(e.code).toBe("SESSION_ENDED");
    expect(leaveTo).toHaveBeenCalledWith("/");
    expect(localStorage.getItem("wage-ledger-token")).toBeNull();
  });
});

describe("a refusal from the server", () => {
  it("carries the server's code and its English message", async () => {
    answer(409, JSON.stringify({ error: "That number already has an account.", code: "PHONE_REGISTERED" }));
    const e = await failure(api.sendPhoneCode({ phone: "9880030001", purpose: "REGISTER" }));
    expect(e.code).toBe("PHONE_REGISTERED");
    expect(e.message).toBe("That number already has an account.");
  });

  it("keeps extra fields, such as the minutes left on a lock", async () => {
    answer(429, JSON.stringify({ error: "Too many wrong PINs.", code: "PIN_LOCKED", minutesLeft: 7 }));
    const e = await failure(api.login("9880030001", "0000"));
    expect(e.code).toBe("PIN_LOCKED");
    expect(e.details.minutesLeft).toBe(7);
  });

  it("is UNKNOWN when the server gave no code, with the server's message kept", async () => {
    answer(400, JSON.stringify({ error: "Daily rate must be a number" }));
    const e = await failure(api.offers());
    expect(e.code).toBe("UNKNOWN");
    expect(e.message).toBe("Daily rate must be a number");
  });
});

describe("no answer from the server", () => {
  it("is NETWORK when the request never left the phone", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const e = await failure(api.states());
    expect(e.code).toBe("NETWORK");
    expect(e.message).not.toMatch(/failed to fetch/i);
  });

  it("is SERVER when the answer is not JSON, such as a proxy's error page", async () => {
    answer(502, "<html><body>Bad Gateway</body></html>", "text/html");
    const e = await failure(api.states());
    expect(e.code).toBe("SERVER");
    expect(e.message).not.toMatch(/unexpected token/i);
  });

  it("is SERVER when the proxy answers with an empty body", async () => {
    answer(502, "", "text/plain");
    const e = await failure(api.states());
    expect(e.code).toBe("SERVER");
  });
});
