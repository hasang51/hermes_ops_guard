# OpsGuard

OpsGuard records a promise buried in a message, scores how likely it is to slip, and keeps a person in the loop before any reply is sent.

The app is a Next.js dashboard on SQLite. Hermes, an external agent, does the language work: decide whether a message is a commitment, draft a rescue note, and deliver that note on Telegram after approval. This repository is the workflow and the gate. It is a single-operator tool.

Stack: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Zod 4, better-sqlite3.

## Status

- The dashboard, ingest API, rescue flow, and approval flow are implemented.
- Analysis and Telegram delivery need a Hermes agent plus local environment variables. Those values are not in git.
- `npm run seed` inserts one sample commitment so the screen is not empty. That row is fixture data.

## How a commitment moves

| Step | What happens | Result |
| --- | --- | --- |
| Ingest | `POST /api/ingest` with `source`, `sender`, and `text`. The Telegram hook posts the same shape. | Activity `MESSAGE_RECEIVED` |
| Analyze | Hermes returns JSON. Zod checks the shape before anything is stored. | No row when `is_commitment` is false |
| Track | A risk score of 70 or more is `at_risk`. Anything lower is `detected`. | Commitment row |
| Rescue | Available only for `at_risk`. Hermes drafts markdown under `workspace/artifacts`. | Status `needs_approval` |
| Approve | A person approves. The draft goes to `OPSGUARD_TELEGRAM_TARGET`, and the delivery is stored as evidence. | Status `resolved` |

A second rescue on the same commitment returns `409`. An approval that is already running returns `409`. The development-only test routes are disabled when `NODE_ENV` is `production`.

## Dashboard

Open [http://localhost:3000](http://localhost:3000) after the app is running.

- **Needs you** lists approval gates that are still open.
- **Commitments** shows the person, deadline, risk score, status, blocker, and the rescue or approve action.
- **Autopilot** is the Hermes activity feed. It stays idle until there is work.
- **Proof / evidence** lists recorded outcomes, including Telegram delivery.

## Run it

Node.js 20 or newer, and npm. `better-sqlite3` builds a native addon, so a C++ toolchain has to be present on a fresh machine.

```bash
cd opsguard
npm install
npm run dev
```

Load the sample commitment:

```bash
npm run seed
```

The database file is `opsguard/data/opsguard.db` unless `OPSGUARD_DB` points somewhere else. Database files are gitignored.

## Try an ingest

The dev server has to be running, and Hermes has to be configured.

```bash
curl -s -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d "{\"source\":\"telegram\",\"sender\":\"telegram:42\",\"text\":\"Can you send the pricing proposal tomorrow by 2 PM?\"}"
```

A message that is not a commitment comes back as `commitmentDetected: false` and does not create a row.

`npm run test:ingest` sends five scripted cases to `OPSGUARD_BASE_URL` (default `http://localhost:3000`). It needs the server and Hermes.

## Configuration

| Variable | Purpose |
| --- | --- |
| `OPSGUARD_DB` | SQLite path. Default is `data/opsguard.db`. |
| `HERMES_TRANSPORT` | `ssh` (default) or `local`. |
| `HERMES_SSH_HOST`, `HERMES_SSH_USER`, `HERMES_SSH_PORT`, `HERMES_SSH_KEY`, `HERMES_REMOTE_BRIDGE` | SSH transport. |
| `HERMES_REMOTE_BIN` | Optional path to the remote Hermes binary. |
| `OPSGUARD_TELEGRAM_TARGET` | Destination used when an approval is executed. |
| `OPSGUARD_BASE_URL` | Used only by the ingest script. |

`.env*` files are gitignored.

The Telegram ingress hook is in [`opsguard/deploy/hooks/opsguard-ingest/`](opsguard/deploy/hooks/opsguard-ingest/). It forwards non-command Telegram `agent:start` events to `http://127.0.0.1:3000/api/ingest`. [`opsguard/deploy/opsguard.service`](opsguard/deploy/opsguard.service) is a user systemd unit for a host that already has Hermes and Node.

## Layout

```text
opsguard/
  app/           dashboard and route handlers
  lib/ingest.ts  validate the body, call Hermes, write the commitment
  lib/hermes.ts  SSH or local transport, timeouts, response schemas
  lib/rescue.ts  draft the artifact and stop at needs_approval
  lib/approve.ts human gate, Telegram delivery, evidence
  lib/db.ts      SQLite connection and migrations
  scripts/       seed data and ingest checks
  deploy/        Telegram hook and systemd unit
```

## Decisions

- Rescue writes a file. Sending it is a separate approval call, so the model cannot deliver on its own.
- Rescue accepts only `at_risk` (risk 70 or above). Lower scores stay on the board and are not auto-drafted.
- Ingest bodies and Hermes JSON pass through Zod before they touch SQLite. A malformed model response fails the request.
- SQLite runs in-process, with migrations in [`opsguard/lib/db.ts`](opsguard/lib/db.ts). The dashboard does not need a separate database server.
- Hermes stays outside this repo. The app reaches it over SSH or a local binary. Remote arguments are checked against an allowlist before they are quoted.
- A finished rescue and an in-flight approval both return `409`, so the same draft is not sent twice.

## Out of scope

- Accounts, roles, and signup.
- Several operators sharing one database.
- Delivery without the approval route.
- A hosted demo. The page reads the local database.

## Checks

```bash
npm run lint
npm run build
```

## Maintainer

[hasang51](https://github.com/hasang51). Questions and bugs go in [GitHub issues](https://github.com/hasang51/hermes_ops_guard/issues).
