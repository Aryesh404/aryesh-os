# 16 — Frontend & Deployment Architecture

Status: **Decided.** Supersedes any assumption that `apps/web` would move to
Next.js. Written after the framework audit at `a3897ca`.

---

## 1. Frontend decision

**React 19 + Vite remains the web frontend. The Next.js migration is deferred.**

| Layer | Decision | Status |
|---|---|---|
| Web frontend | **React 19 + Vite 6** | Final for this roadmap |
| API | **Fastify + tRPC v11** | Unchanged |
| Database | **libSQL via Drizzle** | Unchanged |
| Topology | **Frontend and API stay separate applications** | Unchanged |
| Desktop | **Tauri v2 wraps the same static build** | Phase 2, M11 |
| Next.js | **Deferred** pending a concrete requirement | See §8 |

### Why

The audit measured the coupling rather than guessing at it:

- **Exactly one** Vite-specific line exists in the codebase —
  `import.meta.env['VITE_API_URL']` in `apps/web/src/lib/trpc.ts`.
- No Vite aliases, no asset imports, no `public/`, no fonts, no images, no SVG
  files, no `.env` files. `vite.config.ts` is 12 lines and two plugins.
- The frontend is 24 files and ~3,500 lines, 100% client-rendered.

So the migration would be cheap — and buys nothing. Aryesh OS is a single-user,
fully-authenticated dashboard: there is no SEO, no cold-load path worth
optimising, no images to optimise, and every route needs private data behind a
session cookie. Server Components and Server Actions would additionally create a
second write path, which the architecture rule in §6 forbids.

Two decisive points:

1. **Tauri wants a static bundle.** Vite's `dist/` serves both a web deployment
   and Tauri from one artifact. Next would need `output: 'export'` for Tauri,
   which disables exactly the server features that would justify adopting it.
2. **Coupling this low does not accumulate.** Migrating in six months costs the
   same as migrating today, so there is no debt argument for doing it now.

The routing pain Next would have solved is better addressed by **TanStack
Router**, which `docs/12` already planned for Phase 2 and which changes no build,
deployment, or runtime model.

---

## 2. Current state, audited

### How the production frontend is built

```
npm run build  →  tsc --noEmit && vite build  →  apps/web/dist/
                                                  ├── index.html
                                                  └── assets/index-*.{js,css}
```

`build: { target: 'es2022', sourcemap: true }`. No `base` is set, so asset URLs
are absolute from the site root (`/assets/…`) — correct for a root-mounted
deployment, and the thing to revisit if the app is ever served from a subpath.

### How the API expects to be hosted

From `apps/api/src/env.ts`:

| Variable | Default | Meaning |
|---|---|---|
| `API_HOST` | `127.0.0.1` | **Loopback by default** — the API expects something in front of it |
| `API_PORT` | `4317` | |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS allow-list, a single origin |
| `DATABASE_URL` | `file:./data/aryesh.db` | Resolved against the repo root |
| `NODE_ENV` | `development` | `production` turns on `secure` cookies |

The loopback default is deliberate, and the code already says why: *"a tunnel
terminates TLS in front of this."* The reverse-proxy topology below is what that
comment anticipated.

The process also runs the scheduler in-process, so it is a **long-lived Node
server**, not a serverless function. It cannot go on Vercel Functions without
losing the snapshot job — and a missed snapshot is a permanent hole in the
trajectory.

### How the frontend currently reaches the API

`apps/web/src/lib/trpc.ts` builds `${VITE_API_URL}/trpc` at **build time** and
sends `credentials: 'include'` so the session cookie rides along.

### How the session cookie behaves

From `apps/api/src/trpc.ts`:

```ts
res.setCookie(SESSION_COOKIE, token, {
  httpOnly: true,
  sameSite: 'lax',
  secure: NODE_ENV === 'production',
  path: '/',
  expires: new Date(expiresAt),
});
```

`SameSite=Lax` is the right choice, and it is the one thing that constrains the
topology: **it only works if the browser considers the API same-site as the
page.**

---

## 3. Deployment architecture

### The rule this is designed around

> **No third-party cookie dependency.** The browser must never be asked to send
> a cookie to an origin it considers third-party. That is a permission browsers
> are progressively withdrawing, and building on it means the login breaks on
> someone else's release schedule.

### Recommended topology

One public origin. The frontend is static files; `/api/*` is a reverse-proxy
rewrite onto Fastify. The browser only ever talks to one host, so **every request
is same-origin and the cookie is first-party**.

```
                    https://aryesh.example.com
                              │
              ┌───────────────┴────────────────┐
              │                                │
        /  and /assets/*                    /api/*
              │                                │
      apps/web/dist (static)          proxy → 127.0.0.1:4317
                                                │
                                        Fastify + tRPC
                                                │
                                    packages/core → intelligence
                                                │
                                        libSQL (persistent disk)
```

- `GET /` → `index.html`
- `GET /assets/*` → hashed bundles, immutable cache
- `POST /api/trpc/*` → Fastify `/trpc/*`
- SPA fallback: any unmatched path → `index.html`, needed the moment hash
  routing is replaced by real paths

### Build-time configuration

| Target | `VITE_API_URL` | Auth |
|---|---|---|
| Local dev | *(unset → `http://localhost:4317`)* | Cookie, same-site via localhost |
| Production web | **`/api`** | Cookie, first-party |
| Tauri desktop | `https://aryesh.example.com/api` | **Device token** — see §5 |

Setting `VITE_API_URL=/api` makes the client request `/api/trpc` as a **relative
URL**, which the browser resolves against the page origin. **No code change is
required** — the existing template string already produces exactly this.

### Two ways to run it, both valid

**A. Single host — recommended to start.** One small VPS or home server running
Caddy in front of the Node process. libSQL is a file on a real disk, so backups
stay `VACUUM INTO` and the whole OS remains one copyable file, which is the
property `docs/01` chose libSQL for.

```
aryesh.example.com {
    handle /api/* {
        uri strip_prefix /api
        reverse_proxy 127.0.0.1:4317
    }
    handle {
        root * /srv/aryesh/web
        try_files {path} /index.html
        file_server
    }
}
```

**B. Split hosting with a rewrite.** Frontend on Vercel, API on a Node host, with
`vercel.json` rewriting `/api/*` to the API's public URL. The browser still sees
one origin, so the cookie stays first-party.

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api-host.example.com/:path*" }
  ]
}
```

This costs an extra network hop on every request and requires the API to be
publicly reachable. Prefer **A** unless Vercel's CDN and preview deployments are
worth those two things.

### What must NOT be done

**Frontend on `app.example.com`, API on `api.otherhost.com`, talking directly.**
Those are cross-site. `SameSite=Lax` stops sending the cookie, and the fix —
`SameSite=None; Secure` — is a third-party cookie. This is the topology to avoid,
and it is precisely the one you end up with by default if nobody decides
otherwise.

---

## 4. Cookie strategy

| Context | Origin the browser sees | Mechanism | First-party? |
|---|---|---|---|
| Local dev | `localhost:5173` → `localhost:4317` | Cookie + CORS | Yes — ports do not affect same-site |
| Production web | `aryesh.example.com` → same | Cookie, no CORS at all | **Yes** |
| Tauri desktop | `tauri://localhost` → API | **`Authorization: Bearer`** | N/A — no cookie |
| Mobile / CLI | any | **`Authorization: Bearer`** | N/A — no cookie |

Under the recommended topology the requests are same-origin, so **CORS stops
being involved at all** — no preflight, no `WEB_ORIGIN` matching. The `cors`
plugin stays registered because local development still crosses ports, and
because a native client may later call the API directly.

`credentials: 'include'` stays on the tRPC client. It is a no-op for same-origin
requests and is what makes the cross-port development setup work.

**Nothing about authentication changes.** Argon2id hashing, hashed session
storage, lockout, and generation bumping are untouched.

---

## 5. Tauri compatibility

Tauri v2 serves the frontend from a custom protocol origin (`tauri://localhost`,
or `http://tauri.localhost` on Windows). That origin is **not** same-site with the
API, so the cookie strategy above does not extend to it.

**It does not need to.** `apps/api/src/trpc.ts` already resolves a principal from
`Authorization: Bearer` *before* it looks at the cookie:

```ts
// A device token is explicit and scoped, so it wins over an ambient cookie
// when both happen to be present.
```

Device tokens are already implemented in `apps/api/src/auth/service.ts` with
labels, scopes, hashed storage, and last-used tracking. So:

- **Web** authenticates with a first-party cookie.
- **Tauri, mobile, and CLI** authenticate with a device-token header.

Two mechanisms, both already built, neither depending on third-party cookies.

The build story is equally clean: Tauri points `frontendDist` at
`apps/web/dist`, built with an absolute `VITE_API_URL`. **The same Vite output
serves the web deployment and the desktop bundle** — the concrete reason this
document keeps Vite.

---

## 6. Architecture that must remain untouched

**The API is the only write path.** Explicitly forbidden:

- Next.js Server Actions, or any server-side mutation path outside `apps/api`.
- A second server runtime that talks to `packages/core` or `packages/db`.
- Frontend-direct database access of any kind.
- Duplicated authentication logic — one Argon2id implementation, one session
  table, one device-token path.
- Any bypass of the four procedure scopes (`public` / `protected` / `capture` /
  `full`).

Unchanged, and not to be revisited during Phase 2:

| Component | Status |
|---|---|
| `packages/domain`, `intelligence`, `db`, `core` | Untouched. `intelligence` stays pure — no I/O, no clock, no randomness |
| The honesty gates (`docs/04 §2`) | Engine-enforced and tested. No deployment concern may weaken them |
| Snapshot semantics | Never backfill (`docs/03 §7`) |
| tRPC error mapping | Domain errors → real HTTP statuses; 422 not 500 |
| Repository layer | Audit, soft delete, optimistic version, revisions |
| Auth | Argon2id, hashed sessions, lockout, generation bump |
| The dependency rule | Lint-enforced (`docs/11`) |

---

## 7. Required future changes

Only what is actually necessary. **Nothing is required today** — the current code
already supports the recommended topology through environment variables alone.

| # | Change | When | Why |
|---|---|---|---|
| 1 | Build production web with `VITE_API_URL=/api` | First deploy | Makes every API call same-origin. Configuration only, no code |
| 2 | `API_HOST=0.0.0.0` **only** if the process runs in a container without host networking | First deploy | The loopback default is correct behind a local proxy and should stay the default |
| 3 | SPA fallback in the proxy | First deploy | Needed the moment hash routing is replaced by real paths |
| 4 | `WEB_ORIGIN` accepts a **list** of origins | Before Tauri (M11) | A native client origin may need allowing alongside the web one |
| 5 | Device-token issuing UI | Before Tauri (M11) | Tokens exist in the API; nothing in the interface creates one |
| 6 | Decide `docs/13` D3 (Tailscale vs public host) | Before any remote access | Determines whether the origin is public at all |

**Deliberately not doing now:** no Dockerfile, no CI/CD pipeline, no
infrastructure-as-code, no health-check orchestration. One user, one machine —
those are Phase 4 concerns at the earliest.

---

## 8. Revisiting the Next.js decision

Deferred, not rejected. Reopen it if a **concrete** requirement appears:

- A public marketing or shared-report surface that genuinely needs SSR/SEO.
- Tauri is abandoned in favour of web-first, removing the static-bundle
  constraint.
- Route-level state outgrows both hash routing and TanStack Router.
- Multi-user, where server-rendered per-user shells begin to matter.

Absent one of those, the migration remains 2–3 days of work for no user-visible
change — and those days are better spent closing the reachability gap identified
in `docs/15 §0`.
