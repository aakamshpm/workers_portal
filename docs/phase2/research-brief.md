# Brief: research write-up (GiST index and Merkle tree)

For: Teammate 3. First paste [`system-brief.md`](system-brief.md) into your AI tool, then this file.

## Goal

Write the research chapter for the Phase 2 report and the slides. It covers two algorithms that solve two real problems in our system:

| Problem in our system | Algorithm | Section |
|---|---|---|
| Nearby search checks every user row, so it slows down as users grow | **R-tree through a PostgreSQL GiST index** | Part A |
| Verifying the ledger reads every row. A worker cannot check only his own record. Someone with the key could rewrite the whole chain | **Merkle tree** (as in Certificate Transparency, RFC 6962) | Part B |

The core developer builds both and runs the benchmarks. You explain **what, why and how**, and you prepare the tables and graphs. The real numbers arrive on Tuesday morning as CSV files.

**Length:** about 8 to 12 pages in total, with diagrams. Use simple English and short sentences. Explain every formula in words.

## Structure

1. Introduction (half a page): why a wage record needs fast search and trustworthy proof.
2. Part A: nearby search with a spatial index.
3. Part B: tamper evidence with a hash chain and a Merkle tree.
4. Experimental setup: machine, data sizes, method. The core developer will give you these details.
5. Results: tables and graphs from the CSV files.
6. Discussion and limits.
7. References.

## Part A: nearby search

### A1. The problem

- A worker wants contractors within 25 km. A contractor wants workers within 25 km.
- Today the query is `ST_DWithin(ST_MakePoint(lng, lat)::geography, centre, 25000)` on plain `latitude` and `longitude` columns, **with no index**. PostgreSQL computes the distance to **every** row. That is a full scan, O(n).
- With 100 users this does not matter. With 1,00,000 users, every search reads every row.

### A2. What to explain

1. **Haversine formula:** the distance between two points on a sphere.
   - `a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)`, `d = 2R · asin(√a)`, where R = 6371 km.
   - Explain each symbol: φ is latitude, λ is longitude, and both are in radians.
   - Work one example by hand: Kakkanad (10.0159, 76.3419) to Aluva (10.1076, 76.3516). The result should be about 10 km.
2. **`geometry` against `geography` in PostGIS.** `geometry` works on a flat plane in degrees. `geography` works on the curved Earth in metres. We use `geography` because the radius is given in metres.
3. **R-tree:**
   - Each node holds a **minimum bounding rectangle (MBR)** around its children.
   - A search keeps only the branches whose rectangle overlaps the search area, and skips the rest. This is called *pruning*.
   - Cost: about O(log n + k), where k is the number of results.
   - Draw a small example: 12 points, 3 leaf rectangles, and 1 root. Show which rectangles a 25 km search opens.
4. **GiST (Generalized Search Tree):** PostgreSQL's framework for building tree indexes such as the R-tree. PostGIS uses it for spatial columns. `CREATE INDEX ... USING GIST (location)`.
5. **The two-step search:**
   - First the index finds the candidates whose bounding boxes overlap (fast, but approximate).
   - Then the exact distance is computed only for those candidates.
   - This is why `ST_DWithin` can use the index, while `ST_Distance(...) < r` cannot.
6. **KNN ordering:** the `<->` operator can use the same index to return the nearest results first.
7. **Alternatives, one paragraph each:**
   - **Geohash grid:** splits the map into named cells. Simple, but a search near a cell border must also check the neighbouring cells.
   - **Quadtree:** divides space into four squares, again and again.
   - **k-d tree:** good in memory, weaker when rows are added all the time.
   - Say why a GiST R-tree fits us: it is built into our database already, it stays correct when rows are added, and it needs no extra service.
8. **Privacy link (ADR-0006):** locations are town centres, not GPS readings, so many workers share the same point. The response gives distance only, never coordinates.

### A3. Experiment (the core developer runs it, you present it)

- **Data:** synthetic workers placed on Kerala towns, with 1,000 / 10,000 / 1,00,000 / 10,00,000 rows.
- **Methods compared:**
  1. brute-force Haversine in application code,
  2. PostGIS `ST_DWithin` with no index (today),
  3. PostGIS `ST_DWithin` with the GiST index.
- **Measured:** median and 95th-percentile query time (`EXPLAIN ANALYZE`), index size, and index build time.
- **Result files (ready now):** in `docs/research/results/`.
  - `search_bench.csv`: `users, method, p50_ms, p95_ms, mean_ms, avg_results`. The methods are `haversine_app`, `postgis_scan` and `postgis_gist`.
  - `search_index.csv`: `users, index_bytes, table_bytes, build_ms`.
  - `search_env.txt`: the machine, the versions and the settings of the run. Use it for section 4, "Experimental setup".
  - To run it again: `npm --prefix server run bench:search`. It takes about 2 minutes.
- **Graph to prepare now, with placeholder values:** a line chart with users on the x axis (log scale) and time in ms on the y axis, one line per method.
- **Expected shape:** methods 1 and 2 grow in a straight line with n, and method 3 stays almost flat. Write the text so it still makes sense if the real numbers are a little different.

## Part B: tamper evidence

### B1. The current hash chain (built)

- `h_i = HMAC-SHA-256(K, h_(i-1) || "|" || payload_i)`, and `h_(-1) = "0"`.
- **Why a hash:** a small change in the input gives a completely different output (the *avalanche effect*). Finding another input with the same hash is not practical.
- **Why HMAC and not plain SHA-256** (ADR-0004): with plain SHA-256, anyone who can edit the database can also recompute the hashes. With HMAC they also need the secret key K, which is not stored in the database.
- **Why the chain:** each hash includes the previous one, so a change to row i breaks every row after it.
- **Why we rebuild from the live row:** verification builds the payload again from the current WorkOffer, WorkPeriod or Payment row, not from a stored copy. If someone edits `dailyRate` from 900 to 700 in the database, the rebuilt payload differs, and the row fails.
- **What it detects:** an edited field (HASH_MISMATCH), a deleted or inserted ledger row (BROKEN_LINK or INDEX_GAP), and a deleted record (RECORD_MISSING).
- **Cost:** verification is O(n). It reads every row.

### B2. The weaknesses (be honest, because the tutor will ask)

1. **Checking one record needs the whole chain.** A worker cannot check his own offer without the server checking all the rows.
2. **A full rewrite:** someone who has K and database access can change a row and recompute every hash after it. The chain then looks valid.
3. **Speed:** verification time grows with the size of the ledger.

### B3. The Merkle tree (being built in Phase 2)

1. **Definition:**
   - The leaves are the ledger hashes `h_0 … h_(n-1)`.
   - Each parent is `H(0x01 || left || right)`, and each leaf is `H(0x00 || data)`.
   - The different prefixes stop an attacker from passing off an inner node as a leaf (a *second-preimage attack*). This is how RFC 6962 does it.
   - The top node is the **root**, and one hash represents the whole ledger.
2. **Inclusion proof:**
   - To prove that record i is in the tree, the server sends the sibling hash at each level. That is about log₂(n) hashes.
   - The worker's phone hashes upwards and compares the result with the root.
   - Worked example with 8 leaves: prove leaf 5 using 3 sibling hashes. Draw it.
   - Numbers: with 10,00,000 rows the proof is about 20 hashes × 32 bytes, which is about 640 bytes.
3. **Consistency proof:** it proves that the tree of size m is the first m leaves of the tree of size n. In other words, today's ledger is yesterday's ledger with rows added, and nothing changed. The proof is also about O(log n) hashes.
4. **Published root (a signed tree head):** at fixed times, the root is sent somewhere the operator cannot change later. Examples are the officer's email, an SMS receipt, or a printed daily notice. If someone later rewrites history, even with the key, the new root does not match the published one. **This closes weakness 2.**
5. **Real use:** Certificate Transparency (every HTTPS certificate is logged this way), Git (commits and trees), and Amazon QLDB.
6. **Why not a blockchain** (ADR-0003):
   - A blockchain solves agreement between many parties who do not trust each other. That is not our problem: we have one labour office.
   - A blockchain adds mining or validators, fees and delay.
   - A Merkle tree with a published root gives the same tamper evidence for one operator, at almost no cost.

### B4. Comparison table (fill in)

| Attack | Hash chain (SHA-256) | Hash chain (HMAC) | HMAC + Merkle + published root |
|---|---|---|---|
| Edit a field in a record | detected | detected | detected |
| Delete a ledger row | detected | detected | detected |
| Insert a fake row | detected | detected | detected |
| Reorder rows | detected | detected | detected |
| Delete the **last** row | not detected | not detected | **detected** (root does not match) |
| Rewrite the whole chain **without** the key | not detected | detected | detected |
| Rewrite the whole chain **with** the key | not detected | not detected | **detected** (root does not match) |
| Worker checks only his own record | no | no | **yes, about log₂ n hashes** |

The core developer's tamper simulation checks this table. Use the real `tamper.csv` in the final version.

### B5. Experiment (the core developer runs it, you present it)

- **Ledger sizes:** 1,000 / 5,000 / 10,000 / 20,000 / 1,00,000 rows.
- **Measured:** time for full verification (current), time for full verification with batched reads, time to create and check one inclusion proof, and proof size in bytes.
- **Result files (ready now):** in `docs/research/results/`.
  - `verify_bench.csv`: `rows, method, total_ms, proof_bytes, runs`. The methods are:
    - `chain_per_row`: the check as it was before 29 September, which runs one query per row.
    - `chain_batched`: the check the app uses now, with one query per table.
    - `merkle_root`: computing the root.
    - `merkle_proof_build`: the server making one proof.
    - `merkle_proof_check`: the worker's phone checking it.
  - `chain_per_row` stops at 20,000 rows. One run at 1,00,000 rows did not finish in 18 minutes, and that is a result in itself: it is why the app now uses `chain_batched`.
  - `verify_env.txt`: the machine and the settings of the run.
  - `tamper.csv`: `attack, method, detected, row_found, target_row, first_reported`. The simulation uses 100 rows, and each attack is aimed at row 50 (for `delete_last_row`, row 99).
  - To run them again: `npm --prefix server run bench:verify` (about 4 minutes) and `npm --prefix server run tamper` (1 second).
- **Graphs to prepare now:**
  1. verification time against rows, one line per method, log scale;
  2. proof size against rows, which should grow like log₂ n;
  3. the attack table as a coloured grid.

## How to make the graphs

Use Google Sheets or Excel. Import the CSV, insert a line chart, and set the x axis to logarithmic. Or ask your AI tool: "Write Python matplotlib code that reads search_bench.csv and draws …". Export each graph as PNG at a width of at least 1200 px.

## References to cite

- Guttman, A. (1984). *R-Trees: A Dynamic Index Structure for Spatial Searching.* ACM SIGMOD.
- Hellerstein, J., Naughton, J., Pfeffer, A. (1995). *Generalized Search Trees for Database Systems.* VLDB.
- PostGIS documentation: `ST_DWithin`, spatial indexing (postgis.net/docs).
- Merkle, R. (1987). *A Digital Signature Based on a Conventional Encryption Function.* CRYPTO.
- Laurie, B., Langley, A., Kasper, E. (2013). *RFC 6962: Certificate Transparency.* IETF.
- Krawczyk, H., Bellare, M., Canetti, R. (1997). *RFC 2104: HMAC.* IETF.
- Crosby, S., Wallach, D. (2009). *Efficient Data Structures for Tamper-Evident Logging.* USENIX Security.

Check each reference yourself before you cite it. AI tools sometimes invent papers or page numbers.

## Prompt you can use

> Using the system brief above, write section [A2.3 R-tree] of our research chapter. Audience: MCA reviewers. Use simple English and short sentences, explain every symbol, and give one small worked example from Kerala towns. Do not claim any benchmark number. Mark where a figure goes as [FIGURE: …].

## Questions to prepare for

- Why not use ML for search? Search here is exact geometry, not a prediction. An index gives the exact answer quickly, and a model would only give an approximate one.
- Why not a blockchain? See B3 point 6.
- What if the secret key leaks? In the design, a root published earlier still catches a rewrite of old rows (see `tamper.csv`). Say clearly that this was shown in the simulation: the running app does not publish a root, so today it would not catch this rewrite.
- Can a worker check his own record in the app? Not in the app. The experiment shows it is possible with a proof of about 544 bytes at 1,00,000 rows, checked in 0.025 ms.
- Why GiST and not B-tree? A B-tree orders one value on a line. Location has two dimensions, and "within a radius" is not a range on one column.
- Does the index slow down writes? A little, because each new or moved location also updates the index. People register and move far less often than they search, so the trade-off is worth it.
