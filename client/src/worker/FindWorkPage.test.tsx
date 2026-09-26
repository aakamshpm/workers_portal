import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DiscoveryProfile, NearbyWork, Place } from "../shared/types";

/**
 * Find Work page. Contract: docs/contracts/discovery.md. ADR-0006, 0010, 0011.
 *
 * What these tests guarantee:
 * - a worker can set his place without typing: one tap on "Use my location",
 *   then he confirms the town name before anything happens;
 * - the phone's reading is rounded before it leaves the page, and only the
 *   town, never the reading, is sent to the server as his location;
 * - typing a few letters offers Kerala towns to tap, and there is never a box
 *   for coordinates;
 * - choosing a town only searches. Being visible to contractors is a separate
 *   button, because the directory is opt-in (ADR-0006);
 * - when place search is running on the fallback list, the page says so;
 * - loading, empty and error states each say something, never a blank area;
 * - contractors and public listings stay apart, and listings are labelled as
 *   businesses, not jobs.
 *
 * The API module is mocked, so no test reaches the server, Photon or textbee.dev.
 */

vi.mock("../shared/api", () => ({
  api: {
    discoveryMe: vi.fn(),
    nearbyWork: vi.fn(),
    discoveryToggle: vi.fn(),
    searchPlaces: vi.fn(),
    nearestPlace: vi.fn(),
  },
}));

import { api } from "../shared/api";
import FindWorkPage from "./FindWorkPage";

const mocked = vi.mocked(api);

const PERUMBAVOOR: Place = {
  name: "Perumbavoor",
  area: "Kunnathunad",
  latitude: 10.1148,
  longitude: 76.4778,
};

const OPTED_IN: DiscoveryProfile = {
  looking: true,
  latitude: 9.9816,
  longitude: 76.2999,
  locationName: "Ernakulam",
  preferredWorkType: "Painting",
};

const NEVER_OPTED_IN: DiscoveryProfile = {
  looking: false,
  latitude: null,
  longitude: null,
  locationName: null,
  preferredWorkType: null,
};

const EMPTY: NearbyWork = { contractors: [], businesses: [] };

const RESULTS: NearbyWork = {
  contractors: [
    {
      id: "c1",
      name: "Ramesh Pillai",
      phone: "9000010001",
      company: "Ramesh Builders",
      preferredWorkType: "Painting",
      distanceKm: 4.2,
    },
  ],
  businesses: [
    {
      id: "p1",
      name: "Example Interlock Works",
      category: "interlock",
      phone: "0484234567",
      distanceKm: 6.1,
      source: "public_listing",
    },
  ],
};

/** A phone that answers the location request once, with this position. */
function phoneAt(latitude: number, longitude: number) {
  const getCurrentPosition = vi.fn((ok: PositionCallback) =>
    ok({ coords: { latitude, longitude } } as GeolocationPosition),
  );
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

/** A phone where the worker said no to the location request. */
function phoneRefuses() {
  Object.defineProperty(navigator, "geolocation", {
    value: {
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1, message: "denied" } as GeolocationPositionError),
    },
    configurable: true,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.nearbyWork.mockResolvedValue(EMPTY);
});

describe("FindWorkPage", () => {
  it("shows a loading state while the saved profile is on its way", () => {
    mocked.discoveryMe.mockReturnValue(new Promise(() => {}));
    render(<FindWorkPage />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("shows the server's message when loading fails", async () => {
    mocked.discoveryMe.mockRejectedValue(new Error("Server is not reachable"));
    render(<FindWorkPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Server is not reachable");
  });

  it("opens a saved town by name, searches there, and says when nobody is near", async () => {
    mocked.discoveryMe.mockResolvedValue(OPTED_IN);
    render(<FindWorkPage />);

    expect(await screen.findByText(/nobody near you is hiring/i)).toBeTruthy();
    expect(mocked.nearbyWork).toHaveBeenCalledWith(9.9816, 76.2999, 25);
    // The stored name, not coordinates and not a new lookup.
    expect(screen.getByRole("region", { name: /where you are/i }).textContent).toContain(
      "Ernakulam",
    );
    expect(mocked.nearestPlace).not.toHaveBeenCalled();
  });

  it("offers the location button first, and no box for numbers, when nothing is saved", async () => {
    mocked.discoveryMe.mockResolvedValue(NEVER_OPTED_IN);
    render(<FindWorkPage />);

    const button = await screen.findByRole("button", { name: /use my location/i });
    const search = screen.getByRole("searchbox", { name: /type the name of your town/i });
    // Button before the search box in reading order, so a worker meets the
    // easier choice first.
    expect(button.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText(/latitude|longitude/i)).toBeNull();
    expect(mocked.nearbyWork).not.toHaveBeenCalled();
  });

  it("rounds the phone reading and asks the worker to confirm the town before searching", async () => {
    mocked.discoveryMe.mockResolvedValue(NEVER_OPTED_IN);
    mocked.nearestPlace.mockResolvedValue({ place: PERUMBAVOOR, source: "photon" });
    phoneAt(10.1150494, 76.4780511);
    render(<FindWorkPage />);

    fireEvent.click(await screen.findByRole("button", { name: /use my location/i }));

    expect(await screen.findByText(/you are near/i)).toBeTruthy();
    expect(screen.getByText("Perumbavoor")).toBeTruthy();
    expect(mocked.nearestPlace).toHaveBeenCalledWith(10.115, 76.478);
    expect(mocked.nearbyWork).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /yes, this is right/i }));

    expect(await screen.findByText(/nobody near you is hiring/i)).toBeTruthy();
    // The town's coordinates, never the phone's reading.
    expect(mocked.nearbyWork).toHaveBeenCalledWith(10.1148, 76.4778, 25);
    expect(mocked.discoveryToggle).not.toHaveBeenCalled();
  });

  it("sends the worker to the search box when the phone refuses to share its location", async () => {
    mocked.discoveryMe.mockResolvedValue(NEVER_OPTED_IN);
    phoneRefuses();
    render(<FindWorkPage />);

    fireEvent.click(await screen.findByRole("button", { name: /use my location/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/type the name of your town/i);
    expect(mocked.nearestPlace).not.toHaveBeenCalled();
  });

  it("offers Kerala towns as the worker types, and searches the one he taps", async () => {
    mocked.discoveryMe.mockResolvedValue(NEVER_OPTED_IN);
    mocked.searchPlaces.mockResolvedValue({ places: [PERUMBAVOOR], source: "photon" });
    render(<FindWorkPage />);

    const box = await screen.findByRole("searchbox", { name: /type the name of your town/i });
    fireEvent.change(box, { target: { value: "perum" } });

    const option = await screen.findByRole("button", { name: /perumbavoor/i });
    expect(mocked.searchPlaces).toHaveBeenCalledWith("perum");
    fireEvent.click(option);

    expect(await screen.findByText(/nobody near you is hiring/i)).toBeTruthy();
    expect(mocked.nearbyWork).toHaveBeenCalledWith(10.1148, 76.4778, 25);
    expect(mocked.discoveryToggle).not.toHaveBeenCalled();
  });

  it("does not search for a single letter", async () => {
    mocked.discoveryMe.mockResolvedValue(NEVER_OPTED_IN);
    render(<FindWorkPage />);

    const box = await screen.findByRole("searchbox", { name: /type the name of your town/i });
    fireEvent.change(box, { target: { value: "p" } });

    await new Promise((r) => setTimeout(r, 400));
    expect(mocked.searchPlaces).not.toHaveBeenCalled();
  });

  it("says when town search is limited to district towns", async () => {
    mocked.discoveryMe.mockResolvedValue(NEVER_OPTED_IN);
    mocked.searchPlaces.mockResolvedValue({
      places: [{ name: "Kozhikode", area: "Kozhikode", latitude: 11.2451, longitude: 75.7755 }],
      source: "fallback",
    });
    render(<FindWorkPage />);

    const box = await screen.findByRole("searchbox", { name: /type the name of your town/i });
    fireEvent.change(box, { target: { value: "koz" } });

    expect(await screen.findByText(/only district towns/i)).toBeTruthy();
  });

  it("makes the worker visible only through the explicit button, with the town's name", async () => {
    mocked.discoveryMe.mockResolvedValue(NEVER_OPTED_IN);
    mocked.searchPlaces.mockResolvedValue({ places: [PERUMBAVOOR], source: "photon" });
    mocked.discoveryToggle.mockResolvedValue({
      looking: true,
      latitude: PERUMBAVOOR.latitude,
      longitude: PERUMBAVOOR.longitude,
      locationName: PERUMBAVOOR.name,
      preferredWorkType: null,
    });
    render(<FindWorkPage />);

    const box = await screen.findByRole("searchbox", { name: /type the name of your town/i });
    fireEvent.change(box, { target: { value: "perum" } });
    fireEvent.click(await screen.findByRole("button", { name: /perumbavoor/i }));
    fireEvent.click(await screen.findByRole("button", { name: /let contractors see me/i }));

    await screen.findByRole("button", { name: /stop showing me/i });
    expect(mocked.discoveryToggle).toHaveBeenCalledWith({
      looking: true,
      latitude: PERUMBAVOOR.latitude,
      longitude: PERUMBAVOOR.longitude,
      locationName: PERUMBAVOOR.name,
    });
  });

  it("keeps contractors and public listings apart, and labels listings as businesses", async () => {
    mocked.discoveryMe.mockResolvedValue(OPTED_IN);
    mocked.nearbyWork.mockResolvedValue(RESULTS);
    render(<FindWorkPage />);

    const hiring = await screen.findByRole("region", { name: /contractors hiring/i });
    const listings = screen.getByRole("region", { name: /public business listings/i });

    expect(hiring.textContent).toContain("Ramesh Pillai");
    expect(hiring.textContent).toContain("4.2 km");
    expect(hiring.textContent).not.toContain("Example Interlock Works");

    expect(listings.textContent).toContain("Example Interlock Works");
    expect(listings.textContent).not.toContain("Ramesh Pillai");
    // ADR-0006: a listing is a business on the map, not a confirmed job.
    expect(listings.textContent).toMatch(/not job offers/i);
  });
});
