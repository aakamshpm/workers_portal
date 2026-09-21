# Contract: discovery

The server implements these shapes. Pages consume them. Do not invent extra fields in the client.

All routes require a valid JWT.

## POST /api/discovery/toggle

Worker or contractor turns visibility on or off and stores a typed location.

Request:

```json
{
  "looking": true,
  "latitude": 9.9816,
  "longitude": 76.2999,
  "preferredWorkType": "Painting"
}
```

- `looking` is required.
- When `looking` is true, `latitude` and `longitude` are required.
- `preferredWorkType` is optional. Workers use it as the work they want. Contractors use it as the work they are hiring for.
- Location is what they typed or confirmed, not a live stream.

Response: the updated profile fields only.

```json
{
  "looking": true,
  "latitude": 9.9816,
  "longitude": 76.2999,
  "preferredWorkType": "Painting"
}
```

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
