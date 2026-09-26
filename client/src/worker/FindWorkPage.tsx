import { useEffect, useRef, useState } from "react";
import { api } from "../shared/api";
import type { DiscoveryProfile, NearbyWork, Place, PlaceSource } from "../shared/types";
import { Button, Card, EmptyState, ErrorNote, InfoNote, PhoneLink, inputClass } from "../shared/components/ui";

/**
 * Find Work. Contract: docs/contracts/discovery.md. ADR-0006, 0010, 0011.
 *
 * Written for a worker who is not comfortable with technology:
 *
 *   - The first choice is one button, "Use my location". It reads the phone's
 *     position once, the server turns it into a town name, and the worker
 *     confirms "You are near Perumbavoor" before anything happens.
 *   - The second choice is a box where he types a few letters of his town and
 *     taps it in the list. Misspellings are fine, because Photon tolerates them.
 *   - There is never a box for numbers.
 *   - Choosing a town only searches. Being seen by contractors is a separate
 *     button that says exactly what they will see, because the directory is
 *     opt-in (ADR-0006) and consent must be a choice he knowingly makes.
 *
 * Only the town is sent as his location, never the phone's reading. The
 * reading is rounded to about 100 metres before it even leaves the page.
 *
 * Results come in two groups, never merged: contractors in this system who
 * turned hiring on, and public business listings. A listing is a place where
 * work happens, not a job, so that group is labelled every time.
 */

const RADIUS_KM = 25;
/** Wait this long after the last key press, so a search is not sent for every letter. */
const TYPE_PAUSE_MS = 300;

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** About 100 metres. Enough to name a town, too coarse to find a house. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Read the phone's position once. Resolves null when the worker or the phone says no. */
function readPhoneOnce(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}

export default function FindWorkPage() {
  const [profile, setProfile] = useState<DiscoveryProfile | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [results, setResults] = useState<NearbyWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  // "Use my location": the town waiting for the worker to say "yes, this is right".
  const [locating, setLocating] = useState(false);
  const [proposed, setProposed] = useState<Place | null>(null);

  // Typing a town.
  const [typed, setTyped] = useState("");
  const [options, setOptions] = useState<Place[]>([]);
  const [optionsSource, setOptionsSource] = useState<PlaceSource>("photon");
  const [lookingUp, setLookingUp] = useState(false);

  // A worker may choose two towns quickly. Only the newest request may write
  // its answer, so a slow answer for the first town cannot replace the second.
  const newestSearch = useRef(0);
  const newestLookup = useRef(0);

  async function searchAt(next: Place) {
    const ticket = ++newestSearch.current;
    setPlace(next);
    setProposed(null);
    setOptions([]);
    setTyped("");
    setSearching(true);
    setError(null);
    try {
      const found = await api.nearbyWork(next.latitude, next.longitude, RADIUS_KM);
      if (ticket === newestSearch.current) setResults(found);
    } catch (e) {
      if (ticket === newestSearch.current) setError(errorText(e, "Search failed"));
    } finally {
      if (ticket === newestSearch.current) setSearching(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .discoveryMe()
      .then((me) => {
        if (cancelled) return;
        setProfile(me);
        if (me.latitude !== null && me.longitude !== null) {
          void searchAt({
            name: me.locationName ?? "your saved place",
            area: null,
            latitude: me.latitude,
            longitude: me.longitude,
          });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, "Could not load your saved place"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Town search as the worker types, after a short pause.
  useEffect(() => {
    const q = typed.trim();
    if (q.length < 2) {
      setOptions([]);
      setLookingUp(false);
      return;
    }
    const ticket = ++newestLookup.current;
    setLookingUp(true);
    const timer = setTimeout(() => {
      api
        .searchPlaces(q)
        .then((r) => {
          if (ticket !== newestLookup.current) return;
          setOptions(r.places);
          setOptionsSource(r.source);
        })
        .catch((e: unknown) => {
          if (ticket === newestLookup.current) setError(errorText(e, "Town search failed"));
        })
        .finally(() => {
          if (ticket === newestLookup.current) setLookingUp(false);
        });
    }, TYPE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  async function useMyLocation() {
    setLocating(true);
    setError(null);
    setProposed(null);
    try {
      const reading = await readPhoneOnce();
      if (!reading) {
        setError(
          "Your phone did not share its location. Type the name of your town in the box below instead.",
        );
        return;
      }
      const { place: near } = await api.nearestPlace(round3(reading.latitude), round3(reading.longitude));
      if (!near) {
        setError(
          "We could not find a Kerala town near you. Type the name of your town in the box below instead.",
        );
        return;
      }
      setProposed(near);
    } catch (e) {
      setError(errorText(e, "Could not find your town"));
    } finally {
      setLocating(false);
    }
  }

  async function showMeHere() {
    if (!place || !profile) return;
    setSaving(true);
    setError(null);
    try {
      setProfile(
        await api.discoveryToggle({
          looking: true,
          latitude: place.latitude,
          longitude: place.longitude,
          locationName: place.name,
        }),
      );
    } catch (e) {
      setError(errorText(e, "Could not save your place"));
    } finally {
      setSaving(false);
    }
  }

  async function stopShowingMe() {
    setSaving(true);
    setError(null);
    try {
      setProfile(await api.discoveryToggle({ looking: false }));
    } catch (e) {
      setError(errorText(e, "Could not turn this off"));
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return error ? (
      <ErrorNote message={error} />
    ) : (
      <p className="text-sm text-slate-500">Loading your saved place…</p>
    );
  }

  const savedName = profile.locationName ?? "your saved place";
  const placeName = place?.name ?? "this place";
  const choseSomewhereElse =
    profile.looking &&
    place !== null &&
    (place.latitude !== profile.latitude || place.longitude !== profile.longitude);

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      <section aria-label="Where you are">
        <Card title="Where are you?">
          <div className="space-y-5 px-5 py-4">
            {place && (
              <p className="text-sm text-slate-700">
                Showing work near <strong>{placeName}</strong>.
              </p>
            )}

            {proposed ? (
              <div className="space-y-3 rounded-lg bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
                <p className="text-sm text-slate-700">You are near</p>
                <p className="text-xl font-semibold text-slate-900">{proposed.name}</p>
                {proposed.area && <p className="text-xs text-slate-500">{proposed.area}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void searchAt(proposed)}>Yes, this is right</Button>
                  <Button variant="secondary" onClick={() => setProposed(null)}>
                    No, I will type it
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void useMyLocation()}
                disabled={locating}
                className="flex min-h-14 w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:bg-slate-400"
              >
                {locating ? "Finding your town…" : "Use my location"}
              </button>
            )}

            <div className="space-y-2">
              <label htmlFor="town-search" className="block text-sm font-medium text-slate-700">
                Or type the name of your town
              </label>
              <input
                id="town-search"
                type="search"
                autoComplete="off"
                placeholder="For example: Perumbavoor"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className={`${inputClass} min-h-12 text-base`}
              />

              {lookingUp && <p className="text-xs text-slate-500">Looking for towns…</p>}

              {optionsSource === "fallback" && options.length > 0 && (
                <InfoNote>
                  Town search is not working right now, so only district towns are shown. Choose
                  the one closest to you.
                </InfoNote>
              )}

              {!lookingUp && typed.trim().length >= 2 && options.length === 0 && (
                <p className="text-sm text-slate-500">No town found. Try fewer letters.</p>
              )}

              {options.length > 0 && (
                <ul className="space-y-2">
                  {options.map((o) => (
                    <li key={`${o.name}|${o.latitude}|${o.longitude}`}>
                      <button
                        type="button"
                        onClick={() => void searchAt(o)}
                        className="min-h-12 w-full rounded-lg bg-white px-4 py-3 text-left ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                      >
                        <span className="block text-base font-medium text-slate-900">{o.name}</span>
                        {o.area && <span className="block text-xs text-slate-500">{o.area}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </section>

      <Card title="Can contractors see you?">
        <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
          {profile.looking ? (
            <>
              <p>
                Yes. Contractors can see your name, your phone number and that you are near{" "}
                <strong>{savedName}</strong>.
              </p>
              <div className="flex flex-wrap gap-2">
                {choseSomewhereElse && (
                  <Button onClick={showMeHere} disabled={saving}>
                    Show me near {placeName} instead
                  </Button>
                )}
                <Button variant="secondary" onClick={stopShowingMe} disabled={saving}>
                  Stop showing me
                </Button>
              </div>
            </>
          ) : place ? (
            <>
              <p>
                No. If you want contractors to find you, they will see your name, your phone
                number and the town you chose. They will not see where your phone is.
              </p>
              <Button onClick={showMeHere} disabled={saving}>
                Let contractors see me near {placeName}
              </Button>
            </>
          ) : (
            <p>No. Choose your town first.</p>
          )}
        </div>
      </Card>

      {searching && <p className="text-sm text-slate-500">Searching near {placeName}…</p>}

      {results && !searching && (
        <>
          {results.contractors.length === 0 && results.businesses.length === 0 && (
            <Card>
              <EmptyState>Nobody near you is hiring within {RADIUS_KM} km right now.</EmptyState>
            </Card>
          )}

          {results.contractors.length > 0 && (
            <section aria-label="Contractors hiring">
              <Card
                title="Contractors hiring"
                description="These contractors use this system and turned hiring on. An offer from them is sealed when you say yes."
              >
                <ul className="divide-y divide-slate-100">
                  {results.contractors.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">
                          {[c.company, c.preferredWorkType].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="text-slate-700">{c.distanceKm} km</p>
                        <PhoneLink phone={c.phone} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {results.businesses.length > 0 && (
            <section aria-label="Public business listings">
              <Card
                title="Public business listings"
                description="Businesses on the public map. These are not job offers, and nothing here is recorded or sealed."
              >
                <ul className="divide-y divide-slate-100">
                  {results.businesses.map((b) => (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{b.name}</p>
                        <p className="text-xs text-slate-500">{b.category}</p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="text-slate-700">{b.distanceKm} km</p>
                        {/* A listing's number is often a landline with its own
                         * area code, so it is dialled as written, not as +91
                         * plus a mobile number. */}
                        {b.phone && (
                          <a
                            href={`tel:${b.phone}`}
                            className="font-medium text-sky-700 underline decoration-sky-300 hover:text-sky-900"
                          >
                            {b.phone}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
