# Forklift

A lifting tracker for a home gym. One container: a mobile-first web app plus a
JSON API, with its own SQLite database on a mounted volume.

Built to be used mid-set — phone in one hand, big buttons, a rest timer that
keeps counting while the screen is off.

## What it does

- **Plates** — the plates you actually own, counted individually. One collection,
  shared by every bar.
- **Equipment** — record what the gym has: what each bar weighs empty, or the
  fixed weights a dumbbell rack or stack offers (2–32 kg in 2 kg steps, say),
  and whether it can be shared mid-superset.
- **Exercises** — each one lists the equipment it needs.
- **Regimens** — the workouts you cycle through (A, B, C…), each an ordered list
  of exercises with sets, a rep target and a rest length. Consecutive exercises
  can be linked into a superset.
- **Workout mode** — walks through a regimen in the order you actually lift it,
  alternating the halves of a superset, and prefills each weight from the last
  time you did that lift — saying how long ago that was. Tap the reps you managed, adjust the
  weight, and the rest timer starts itself and rings a bell when it's up. The
  weight steps between loads that really exist — what your plates can make, or
  the rungs of the rack — and shows what to hang on the bar. Any exercise can be
  skipped for the day, with a reason kept against the session.
- **History** — every session, set by set, with volume and duration.

### Plates, and why supersets need them

Two exercises can only be supersetted if you can go straight from one to the
other without re-rigging anything. Forklift blocks a pair when:

1. both exercises need the same physical item (one bench, two lifts), or
2. the plates can't make both loads at the same time.

The second is a question of arithmetic, not of which bar is which. A 60 kg
deadlift (20 kg bar + a pair of 20s) and an 18.5 kg ez-bar curl (8.5 kg bar +
a pair of 5s) coexist happily on one plate collection. Two heavy bars do not.
So Forklift works from what you own and what each bar weighs, using the weights
from the last time you did each lift — and where there is no history it says the
plates were not checked rather than guessing.

Open a saved regimen and expand **Superset options** to see which pairs are
possible, at which weights, and why the rest are not.

Plates are loaded in pairs, so two 20 kg plates make one usable pair. Equipment
that loads asymmetrically (a landmine, say) isn't modelled. Dumbbell weights are
recorded per dumbbell, which is how people talk about them, so the volume figure
in history counts one hand for a two-dumbbell lift.

Weight fields take a comma or a full stop, because a Danish iPhone's number pad
offers only a comma.

### Supersets

Link two consecutive exercises in the regimen editor and they are worked in
rounds: A set 1, B set 1, A set 2, B set 2. No rest between the halves of a
round — going straight from one to the other is the point — only once the round
is done. Uneven set counts are fine; the shorter exercise drops out of the last
rounds.

Rest comes after every round. The only set that never earns one is the first
half of a superset — going straight to the partner is the point — and the very
last set of the workout, when there is nothing left to rest for.

Logging a set moves straight to whatever comes next, and once you are inside a
group you stay there until it is finished, even if you jumped to it out of
order. Only when the group runs out does the plan take over again.

Exercises that need the same physical item can't be linked, unless that item is
marked **shareable**: a bench takes a second to re-angle, so two lifts can share
one, while a loaded bar cannot. The editor says which item a clashing pair
collide on, and the API refuses to save it. The plate check is separate and
stays advisory, since it depends on the weights of the day.

## Running it

### Development

```bash
npm install
npm run dev
```

The API listens on `:8080`, Vite on `:5173` and proxies `/api` to it. Vite binds
to all interfaces, so you can open the dev server from your phone on the same
network to try the touch targets for real.

Data goes to `./data/forklift.db` (gitignored).

### On the apps server

Every push to `main` typechecks, runs the tests, and publishes an image to
`ghcr.io/emilbm/forklift:latest` (also tagged `sha-<commit>`, and with the
version for `v*` tags). Copy `deploy/docker-compose.yml` to the server and:

```bash
docker compose pull && docker compose up -d
```

Serves the app and API on port `8080`, with the database in the `forklift-data`
volume. If that port is taken on the host, set `FORKLIFT_PORT` — a `.env` file
next to the compose file is the version that survives later restarts:

```bash
echo FORKLIFT_PORT=8095 > .env
```

Only the host side moves; the container still listens on 8080, which is where
its health check looks. To roll back or pin a build, set the tag:

```bash
FORKLIFT_TAG=sha-<full-commit-sha> docker compose up -d
```

To point storage at a host directory instead — easier to fold into an existing
backup job — swap the volume for a bind mount:

```yaml
volumes:
  - /srv/forklift:/data
```

The package is public, so the server pulls it without logging in. If you ever
make the repo private, the package follows, and the server then needs a personal
access token with `read:packages`:

```bash
echo <token> | docker login ghcr.io -u emilbm --password-stdin
```

The image is built for **linux/amd64** only, which is what Proxmox runs. It will
not run on an arm64 machine — build locally with the root compose file there
instead. To publish arm64 as well, add it to `platforms` in
`.github/workflows/build.yml`; it builds under emulation, so expect it to be
slower.

### Building the image locally

The compose file at the repo root builds from the working copy instead, which is
the one to use when changing the Dockerfile:

```bash
docker compose up -d --build
```

### Exposure

The app has **no authentication**, which is fine on the LAN. If you put a
Cloudflare tunnel in front of it, protect it with Cloudflare Access so auth
happens at the edge — nothing in the app needs to change, and it already trusts
proxy headers for request logging.

### Backup

Everything is in `/data/forklift.db` (plus the WAL sidecar files). To take a
consistent copy while it's running:

```bash
docker exec forklift node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/forklift.db').exec(\"VACUUM INTO '/data/backup.db'\")"
```

## Which build is running

The home screen shows the version, and `/api/version` returns it. CI stamps the
commit sha into the image, so it is the quickest way to tell whether the server
is running the change you just made.

## Install on your phone

Open it in mobile Chrome or Safari and use *Add to Home Screen*. It runs
full-screen with its own icon. It is not offline-capable — it talks to the
server for every set — which is deliberate while the gym and the server are on
the same network.

## Layout

```
shared/types.ts     types used by both sides
server/src/db.ts    schema and migrations (node:sqlite, no native module)
server/src/store.ts all queries
shared/plan.ts      the order sets are performed in, supersets included
server/src/plates.ts    plate arithmetic: what can be loaded, and what can be loaded at once
server/src/superset.ts  the superset rules, built on that
server/src/routes.ts    the HTTP API
client/src/pages/       one file per screen; WorkoutPage.tsx is the important one
```

Migrations are an append-only list in `db.ts`, tracked with `user_version`, so a
running instance upgrades its own volume on restart.

## API

| Method | Path | |
| --- | --- | --- |
| `GET/POST` | `/api/plates` | the plate collection |
| `PUT/DELETE` | `/api/plates/:id` | |
| `POST` | `/api/loads/plan` | how to load one bar, or whether several can be loaded at once |
| `GET/POST` | `/api/equipment` | |
| `PUT/DELETE` | `/api/equipment/:id` | |
| `GET` | `/api/equipment/:id/loads` | every weight this equipment can be set to |
| `GET/POST` | `/api/exercises` | |
| `PUT/DELETE` | `/api/exercises/:id` | |
| `GET` | `/api/exercises/:id/last-performance` | prefills the weight in workout mode |
| `GET/POST` | `/api/regimens` | |
| `GET/PUT/DELETE` | `/api/regimens/:id` | |
| `GET` | `/api/regimens/:id/superset-pairs` | which pairs can be supersetted, and why not |
| `GET` | `/api/version` | which build is running |
| `GET/POST` | `/api/sessions` | history / start a workout |
| `GET` | `/api/sessions/active` | the unfinished session, if any |
| `GET/DELETE` | `/api/sessions/:id` | |
| `POST` | `/api/sessions/:id/sets` | log a set |
| `DELETE` | `/api/sessions/:id/sets/:setId` | undo a set |
| `POST` | `/api/sessions/:id/skips` | skip an exercise for this session, with a reason |
| `DELETE` | `/api/sessions/:id/skips/:itemId` | put it back |
| `POST` | `/api/sessions/:id/finish` | |

## Tests

```bash
npm test
```

Runs the plate arithmetic against known loadings, the superset and skip ordering
against known regimens, then boots the API on a throwaway database and exercises
the whole flow.
CI runs this plus `npm run typecheck` and a client build before any image is
published, so `latest` is always a build that passed.

## Not built yet

AI-assisted weight and superset suggestions. The groundwork is in place: full
set history per exercise, the plates and bars on hand, `/api/loads/plan` to test
whether a set of loads can coexist, and `superset-pairs` to narrow any suggestion
to what this gym can physically assemble.
