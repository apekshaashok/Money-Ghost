# Money Ghosts — Subscription Leak & Financial Déjà Vu Detector

DBMS Level 3 project · PES University
**Team:** Apeksha Ashok (PES1UG24AM048) · Avanthika J (PES1UG24AM059)

Upload a bank statement and Money Ghosts finds the recurring charges in it. It flags price increases, dormant subscriptions, double charges and services your household pays for twice. You can also search transactions by meaning.

- **PostgreSQL**: users, accounts, transactions, subscriptions, splits, budgets
- **pgvector**: embeddings for semantic search and automatic categories
- **MongoDB**: raw uploaded statements and bank-format profiles
- **Next.js**: web interface and API

Documentation: [docs/REPORT.md](docs/REPORT.md) (PDF: [docs/Money_Ghosts_Report.pdf](docs/Money_Ghosts_Report.pdf))

## Setup

Requires Node.js 20+ and Docker Desktop.

```bash
npm install
# if npm says install scripts were blocked:
npm install-scripts approve sharp && npm rebuild sharp

cp .env.example .env.local      # then replace every CHANGE_ME
npm run db:up                   # start PostgreSQL + MongoDB in Docker
npm run db:setup                # create tables, functions, views, Mongo collections; download the model
npm run db:seed                 # load demo users and sample statements
```

## Run

```bash
npm run dev                     # http://localhost:3000
```

Demo logins (password `Demo@1234`):

- `apeksha@moneyghosts.dev`: owns HDFC, ICICI and Paytm accounts; read-only on Avanthika's SBI account
- `avanthika@moneyghosts.dev`: owns SBI; contributor on Apeksha's HDFC account

Sample statement files are in `sample/`.

## Tests and demo queries

```bash
npm test        # needs the app running for the API tests
docker exec -i moneyghosts-postgres psql -U moneyghosts -d moneyghosts < database/05_demo_queries.sql
```

## Folders

```
app/          pages and API routes
components/   navigation bar and small helpers
lib/          database clients, auth, import pipeline, embeddings
database/     SQL files (schema, functions/triggers, views, reference data, demo queries)
scripts/      setup, seed, sample data, screenshots, diagrams, report
tests/        automated tests
docs/         report, diagrams, data dictionary, screenshots, test results
sample/       sample bank statements
```
