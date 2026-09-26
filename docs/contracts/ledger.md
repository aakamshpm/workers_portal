# Contract: records (the ledger)

The server implements these shapes. The "records" page in every app consumes them. ADR-0003, ADR-0013.

All routes require a valid JWT.

## Who sees which records

| Role | Sees |
|---|---|
| Worker | Records of contracts where he is the worker. |
| Contractor | Records of contracts where he is the contractor. Not the same worker's contracts with someone else. |
| Labour officer | Every record. |

A record belongs to a contract: the offer, the worker's acceptance, each work period, each payment, the worker's answer to each, and the contractor's statement on a disputed one.

## GET /api/ledger

Query: `?workerId=…` narrows the list to one worker. Only a labour officer may use it. For anyone else it is ignored, and they get their own records as above.

```json
{
  "genesisHash": "0",
  "entries": [
    {
      "id": "…",
      "chainIndex": 12,
      "recordType": "PAYMENT",
      "recordId": "…",
      "workerId": "…",
      "summary": "Paid Rs 8000.00 to Bijoy Das by CASH",
      "createdAt": "…",
      "previousHash": "…",
      "currentHash": "…"
    }
  ]
}
```

Ordered by `chainIndex`. A caller who is not the officer sees gaps in `chainIndex`, because the records in between belong to other people.

## POST /api/ledger/verify

Checks the whole chain, for every caller.

```json
{
  "valid": false,
  "entriesChecked": 49,
  "failures": [
    {
      "chainIndex": 12,
      "entryId": "…",
      "recordType": "PAYMENT",
      "summary": "…",
      "problem": "HASH_MISMATCH",
      "expected": "…",
      "found": "…",
      "detail": "…",
      "changedFields": [{ "field": "amount paid", "original": "8000.00", "current": "4000.00" }]
    }
  ],
  "hiddenFailures": 0,
  "checkedAt": "…"
}
```

- `valid` is about the whole chain.
- `failures` lists only problems in records the caller can see. For the officer that is every problem.
- `hiddenFailures` counts the problems in records the caller cannot see. Their details are not returned, because they would show other people's figures. It is always `0` for the officer.
