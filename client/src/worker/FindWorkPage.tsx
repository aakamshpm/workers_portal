import { useEffect, useRef, useState } from "react";
import { api } from "../shared/api";
import type { DiscoveryProfile, NearbyWork, Place, PlaceSource } from "../shared/types";
import { Button, Card, EmptyState, ErrorNote, InfoNote, PhoneLink, inputClass } from "../shared/components/ui";
import Icon from "../shared/components/Icon";

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
      <p role="status" className="font-body-lg text-body-lg text-on-surface-variant">Loading your saved place…</p>
    );
  }

  const savedName = profile.locationName ?? "your saved place";
  const placeName = place?.name ?? "this place";
  const choseSomewhereElse =
    profile.looking &&
    place !== null &&
    (place.latitude !== profile.latitude || place.longitude !== profile.longitude);

  return (
    <div className="flex flex-col gap-space-lg">
      {error && <ErrorNote message={error} />}

      <Card title="Where are you?">
        <div className="flex flex-col gap-space-lg px-space-lg py-space-md">
          {place && (
            <p className="flex items-center gap-space-sm font-body-lg text-body-lg text-on-surface">
              <Icon name="location_on" filled className="shrink-0 text-primary" />
              <span>
              Showing work near <strong>{placeName}</strong>.
              </span>
            </p>
          )}

          {proposed ? (
            <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-lg">
              <p className="font-body-lg text-body-lg text-on-surface-variant">You are near</p>
              <p className="font-headline-md text-headline-md break-words text-on-surface">{proposed.name}</p>
              {proposed.area && <p className="font-label-md text-label-md text-on-surface-variant">{proposed.area}</p>}
              <div className="grid grid-cols-2 gap-space-sm">
                <Button full onClick={() => void searchAt(proposed)}>Yes, this is right</Button>
                <Button variant="secondary" full onClick={() => setProposed(null)}>
                  No, I will type it
                </Button>
              </div>
            </div>
          ) : (
            <Button size="page" icon="location_on" busy={locating} onClick={() => void useMyLocation()}>
              {locating ? "Finding your town…" : "Use my location"}
            </Button>
          )}

          <div className="flex flex-col gap-space-sm">
            <label htmlFor="town-search" className="font-body-lg-medium text-body-lg-medium text-on-surface">
              Or type the name of your town
            </label>
            <input
              id="town-search"
              type="search"
              autoComplete="off"
              placeholder="For example: Perumbavoor"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={`${inputClass} ring-1 ring-inset ring-outline`}
            />

            {lookingUp && (
              <p role="status" className="font-label-md text-label-md text-on-surface-variant">
                Looking for towns… this can take a few seconds.
              </p>
            )}

            {optionsSource === "fallback" && options.length > 0 && (
              <InfoNote>
                Town search is not working right now, so only district towns are shown. Choose
                the one closest to you.
              </InfoNote>
            )}

            {/* "No town found" is true only when the full search ran. After a
                fallback, only the 14 district towns were checked, so saying no
                town exists would be false. */}
            {!lookingUp && typed.trim().length >= 2 && options.length === 0 && (
              <p className="font-body-lg text-body-lg text-on-surface-variant">
                {optionsSource === "fallback"
                  ? "Town search did not answer in time, so only the district towns were checked. None matched. Try again in a moment."
                  : "No town found. Try fewer letters."}
              </p>
            )}

            {options.length > 0 && (
              <ul className="flex flex-col gap-space-sm">
                {options.map((o) => (
                  <li key={`${o.name}|${o.latitude}|${o.longitude}`}>
                    <button
                      type="button"
                      onClick={() => void searchAt(o)}
                      className="min-h-[var(--size-touch)] w-full rounded-xl bg-surface-container-lowest px-space-lg py-space-sm text-left ring-1 ring-inset ring-outline-variant transition hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <span className="block font-body-lg-medium text-body-lg-medium text-on-surface">{o.name}</span>
                      {o.area && <span className="block font-label-sm text-label-sm text-on-surface-variant">{o.area}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    

      <Card title="Can contractors see you?">
        <div className="flex flex-col gap-space-md px-space-lg py-space-md font-body-lg text-body-lg text-on-surface">
          {profile.looking ? (
            <>
              <p>
                Yes. Contractors can see your name, your phone number and that you are near{" "}
                <strong>{savedName}</strong>.
              </p>
              <div className="flex flex-col gap-space-sm">
                {choseSomewhereElse && (
                  <Button full onClick={showMeHere} busy={saving}>
                    Show me near {placeName} instead
                  </Button>
                )}
                <Button variant="secondary" full onClick={stopShowingMe} disabled={saving}>
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
              <Button full onClick={showMeHere} busy={saving}>
                Let contractors see me near {placeName}
              </Button>
            </>
          ) : (
            <p>No. Choose your town first.</p>
          )}
        </div>
      </Card>

      {searching && (
        <p role="status" className="font-body-lg text-body-lg text-on-surface-variant">
          Searching near {placeName}…
        </p>
      )}

      {results && !searching && (
        <>
          {results.contractors.length === 0 && results.businesses.length === 0 && (
            <Card>
              <EmptyState>Nobody near you is hiring within {RADIUS_KM} km right now.</EmptyState>
            </Card>
          )}

          {results.contractors.length > 0 && (
            <Card
              title="Contractors hiring"
              description="Contractors near you who are hiring."
            >
              <ul className="divide-y divide-outline-variant">
                {results.contractors.map((c) => (
                  <li key={c.id} className="flex flex-col gap-space-xs px-space-lg py-space-md">
                    <div className="flex items-start justify-between gap-space-md">
                      <p className="min-w-0 font-body-lg-bold text-body-lg-bold break-words text-on-surface">{c.name}</p>
                      <Distance km={c.distanceKm} />
                    </div>
                    <p className="font-label-md text-label-md break-words text-on-surface-variant">
                      {[c.company, c.preferredWorkType].filter(Boolean).join(" · ")}
                    </p>
                    <div>
                      <PhoneLink phone={c.phone} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          
          )}

          {results.businesses.length > 0 && (
            <Card
              title="Public business listings"
              description="These are businesses, not job offers."
            >
              <ul className="divide-y divide-outline-variant">
                {results.businesses.map((b) => (
                  <li key={b.id} className="flex flex-col gap-space-xs px-space-lg py-space-md">
                    <div className="flex items-start justify-between gap-space-md">
                      <p className="min-w-0 font-body-lg-bold text-body-lg-bold break-words text-on-surface">{b.name}</p>
                      <Distance km={b.distanceKm} />
                    </div>
                    <p className="font-label-md text-label-md text-on-surface-variant">{b.category}</p>
                    {/* A listing's number is often a landline with its own
                     * area code, so it is dialled as written, not as +91
                     * plus a mobile number. */}
                    {b.phone && (
                      <div>
                        <PhoneLink phone={b.phone} asWritten />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          
          )}
        </>
      )}
    </div>
  );
}

/** How far away, on one line, beside the name. */
function Distance({ km }: { km: number }) {
  return (
    <span className="flex shrink-0 items-center gap-space-xs font-label-md text-label-md whitespace-nowrap text-on-surface-variant">
      <Icon name="distance" size={18} />
      {km} km
    </span>
  );
}
