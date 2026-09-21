# Purpose

Inter-state migrant workers in Kerala are often hired on a spoken agreement. Nothing records the promised daily rate, the days worked, or what was paid. A Kerala helpline logged 1,093 wage complaints in 14 months (October 2022–December 2023).

This product gives the worker one number they cannot produce today:

```
agreed rate × days worked − already paid = what I am owed
```

It is a full package around that number:

- A contractor sends a formal offer. The worker accepts by SMS or in the app. Those terms lock.
- Work and payments are written as new rows. Nothing is edited or deleted.
- The worker confirms each work and payment record, or marks it wrong.
- Nearby search helps a worker find contractors (and public business listings) and helps a contractor find workers who opted in.
- A labour officer handles complaints on a website.

## Who uses it

| Role | Clients |
|---|---|
| Worker | Installable PWA, and SMS on their own phone via Textbee |
| Contractor | Website and the same PWA |
| Labour officer | Website only |

One Express API serves all three.

## Limits of the ledger

The hash chain answers whether a row was changed after it was written. It cannot prove a row was true when written, and it cannot prove a row that was never created. That is why worker confirmation and the hiring SMS exist.
