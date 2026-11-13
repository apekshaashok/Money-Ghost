# Testing results

Run on 2026-11-13 with `npm test` against the seeded demo data.

```
# tests 27
# pass 27
# fail 0
```

Database tests run inside `BEGIN ... ROLLBACK`, so they do not change the demo data.

## Parser unit tests (tests/parser.test.mjs)

| ID | Test case | Result |
|---|---|---|
| P1 | parseDate understands every bank date format and rejects impossible dates | PASS |
| P2 | parseAmount strips currency symbols, commas and handles negatives | PASS |
| P3 | the right bank profile is detected from CSV headers | PASS |
| P4 | nested JSON wallet export is read through its records_path | PASS |
| P5 | credits are skipped and bad rows are reported, not silently dropped | PASS |

## Database tests (tests/database.test.mjs)

| ID | Test case | Result |
|---|---|---|
| D1 | users: plain-text passwords and malformed e-mails are rejected by CHECK constraints | PASS |
| D2 | transactions: amount > 0, no future dates, no duplicates, FK to account | PASS |
| D3 | normalize_merchant groups noisy bank descriptions | PASS |
| D4 | leak detection finds the planted subscriptions with the right status | PASS |
| D5 | trigger: changing a subscription amount logs a price change and raises the alert | PASS |
| D6 | trigger: the owner cannot be added as a member of their own account | PASS |
| D7 | set_split is all-or-nothing (bad total, or a user without access, changes nothing) | PASS |
| D8 | MongoDB $jsonSchema validator rejects a malformed raw statement document | PASS |
| D9 | recursive forecast lists upcoming charges inside the horizon only | PASS |
| D10 | views: deja vu double charges, household duplicates, cost roll-up | PASS |
| D11 | vector auto-categorisation puts merchants in the right category | PASS |
| D12 | indexes exist and the vector index is used for nearest-neighbour search | PASS |
| D13 | deleting an import cascades to its transactions (ON DELETE CASCADE) | PASS |

## API tests (tests/api.test.mjs)

| ID | Test case | Result |
|---|---|---|
| A1 | protected API and pages require a session | PASS |
| A2 | login: wrong password gives 401 with a generic message; right password sets an httpOnly cookie | PASS |
| A3 | register validates input; duplicate e-mail is reported by the database constraint | PASS |
| A4 | role-based access: read-only member cannot import; an outsider cannot see the account | PASS |
| A5 | contributor can change a shared account; read-only cannot | PASS |
| A6 | vector search finds cryptic bank codes by meaning; keyword search does not | PASS |
| A7 | import: new file works end-to-end, the same file twice is refused, unknown formats are refused | PASS |
| A8 | database constraint errors come back as readable 4xx messages | PASS |
| A9 | security headers are sent | PASS |

## Manual UI test cases

| ID | Steps | Expected result | Result |
|---|---|---|---|
| U1 | Open `/dashboard` while logged out | Redirected to `/login` | PASS |
| U2 | Log in as apeksha, account HDFC Savings | Dashboard shows Netflix price rise, dormant gym, double charge, Spotify household duplicate | PASS |
| U3 | Subscriptions → Netflix | Price history ₹499 → ₹649, list of charges, 50/50 split | PASS |
| U4 | Search "video streaming" by meaning, then by keyword | Meaning finds Netflix etc.; keyword finds nothing | PASS |
| U5 | Import `sample/generic_statement.csv` | Rows inserted, LinkedIn Premium detected | PASS |
| U6 | Switch to SBI Savings (read-only) → Import | Upload hidden, read-only message shown | PASS |
| U7 | Household → share an account by e-mail | Member appears with chosen access level | PASS |
| U8 | Budgets → add a budget for a category that already has one | Error: one budget per category | PASS |
