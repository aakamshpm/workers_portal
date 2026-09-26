# Contract: discovery

The server implements these shapes. Pages consume them. Do not invent extra fields in the client.

All routes require a valid JWT.

## Places (ADR-0010, ADR-0011)

A worker chooses a town, never coordinates. The server asks Photon and falls back to the 14 district towns in the `Town` table when Photon fails. Only towns in Kerala are returned.

One place:

```json
{
  "name": "Perumbavoor",
  "area": "Kunnathunad",
  "latitude": 10.1148,
  "longitude": 76.4778
}
```

`area` is the taluk or district Photon reports. It may be `null`. It helps a worker tell two towns with the same name apart.

### GET /api/discovery/places?q=perum

Worker or contractor. `q` is at least 2 characters after trimming, otherwise 400.

```json
{
  "places": [{ "name": "Perumbavoor", "area": "Kunnathunad", "latitude": 10.1148, "longitude": 76.4778 }],
  "source": "photon"
}
```

At most 8 places. `source` is `"photon"`, or `"fallback"` when Photon failed and the district towns were searched by name instead. A fallback search with no match returns an empty list, not an error.

### GET /api/discovery/places/nearest?lat=10.1150&lng=76.4780

Worker or contractor. Used once, after the worker taps "Use my location". The page rounds the reading to 3 decimals before sending it, and the server rounds it again before asking Photon.

```json
{
  "place": { "name": "Perumbavoor", "area": "Kunnathunad", "latitude": 10.1148, "longitude": 76.4778 },
  "source": "photon"
}
```

`place` is `null` when the point is outside Kerala, because naming a Kerala town for someone in another state would tell them something false. On fallback the nearest district town within 80 km is used, and a point farther than that from every district town gets `null`. The server does not store the reading.

## POST /api/discovery/toggle

Worker or contractor turns visibility on or off and stores a location chosen as a town.

Request:

```json
{
  "looking": true,
  "latitude": 10.1148,
  "longitude": 76.4778,
  "locationName": "Perumbavoor",
  "preferredWorkType": "Painting"
}
```

- `looking` is required.
- When `looking` is true, `latitude`, `longitude` and `locationName` are required. They are the chosen town, never the phone's exact position.
- When `looking` is false, the saved location is cleared.
- `preferredWorkType` is optional. Workers use it as the work they want. Contractors use it as the work they are hiring for. Leaving it out keeps the saved value, so turning visibility off does not erase it.

Response: the updated profile fields only.

```json
{
  "looking": true,
  "latitude": 10.1148,
  "longitude": 76.4778,
  "locationName": "Perumbavoor",
  "preferredWorkType": "Painting"
}
```

## GET /api/discovery/me

Worker or contractor reads their own saved visibility, so Find Work and Find Workers can show the current state when the page opens.

Response: the same five fields as the toggle response.

Someone who never opted in gets `looking: false` and `null` for the other four. A labour officer gets 403, because officers have no directory entry.

## GET /api/discovery/nearby-work

Worker. Two groups in one response.

Query: `?lat=9.9816&lng=76.2999&radiusKm=25`  
Default radius 25. Maximum 50.

```json
{
  "contractors": [
    {
      "id": "…",
      "name": "Ramesh Pillai",
      "phone": "9000010001",
      "company": "Ramesh Builders",
      "preferredWorkType": "Painting",
      "distanceKm": 4.2
    }
  ],
  "businesses": [
    {
      "id": "…",
      "name": "Example Interlock Works",
      "category": "interlock",
      "phone": "0484…",
      "distanceKm": 6.1,
      "source": "public_listing"
    }
  ]
}
```

`businesses` are not jobs. The page must say they are public listings.

Only contractors with `looking: true` appear in `contractors`.

## GET /api/discovery/nearby-workers

Contractor.

Query: same `lat`, `lng`, `radiusKm`. Optional `workType`.

```json
{
  "workers": [
    {
      "id": "…",
      "name": "Ramu",
      "phone": "9845687924",
      "homeState": "Assam",
      "preferredWorkType": "Painting",
      "distanceKm": 3.4
    }
  ]
}
```

Only workers with `looking: true` appear. No live coordinates are returned, only `distanceKm`.
