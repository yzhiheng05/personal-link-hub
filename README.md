# Personal Link Hub

A Cloudflare Worker full-stack first-version app for a single-user personal link hub.

## Included in this version

- Single Worker entry that serves API routes and static pages
- D1 schema for links, categories, tags, and link-tag relations
- Cookie-based admin login
- Manual link creation with optional metadata editing on the detail page
- Link list, detail, edit, archive, and short-link routes
- Search by title, URL, and note
- Category and tag filtering
- Duplicate URL warning before redirecting to detail
- Explicit validation and failure messages for invalid input and duplicate taxonomy names

## Setup

1. Install dependencies: `npm install`
2. Copy `.dev.vars.example` to `.dev.vars`
3. Set your own `ADMIN_PASSWORD` in `.dev.vars`
4. Create a D1 database: `npx wrangler d1 create link_hub`
5. Apply migrations locally: `npm run db:migrate:local`
6. Start dev server: `npm run dev`

## Local routes

When served by Wrangler assets, HTML pages are exposed through extensionless routes:

- `/login`
- `/`
- `/new`
- `/link?id=<id>`
- `/taxonomy`

## Required password configuration

`ADMIN_PASSWORD` is required. The Worker validates this binding on every request, and the app will fail with `Missing ADMIN_PASSWORD environment variable.` if it is not configured.

- Local development reads `ADMIN_PASSWORD` from `.dev.vars`.
- `.dev.vars.example` is only an example file; copy it to `.dev.vars` and replace the value with your own password.
- Cloudflare production does not read `.dev.vars`; set `ADMIN_PASSWORD` as a Worker secret before deploying.

## Deploy to Cloudflare

The production Worker requires both a D1 binding named `DB` and a secret named `ADMIN_PASSWORD`. Do not deploy before both are configured.

1. Install dependencies if this is a fresh checkout: `npm install`.
2. Authenticate Wrangler: `npx wrangler login`. In CI, provide a `CLOUDFLARE_API_TOKEN` with permissions to manage Workers and D1.
3. Create the production D1 database if it does not exist: `npx wrangler d1 create link_hub`.
4. In the Cloudflare dashboard, open Workers & Pages, select `personal-link-hub`, and confirm the D1 database binding:
   - Binding variable name: `DB`
   - D1 database: `link_hub`
5. Apply remote D1 migrations: `npm run db:migrate:remote`.
6. Set the production admin password as a Worker secret: `npx wrangler secret put ADMIN_PASSWORD`. Enter the password you want to use on `/login`.
7. You can also check the secret in the Cloudflare dashboard under Worker settings, Variables and Secrets. The secret name must be exactly `ADMIN_PASSWORD`.
8. Verify the deployment package without publishing: `npx wrangler deploy --dry-run`.
9. Deploy to Cloudflare: `npm run deploy`.
10. Open the deployed URL, visit `/login`, and sign in with the `ADMIN_PASSWORD` value you set as a secret.
11. Optional: run the smoke test against production:
    - PowerShell: `$env:BASE_URL='https://<your-domain-or-worker-url>'; $env:SMOKE_PASSWORD='<admin-password>'; node scripts/local-smoke.mjs`
    - Replace `SMOKE_PASSWORD` with the same value stored in the Cloudflare `ADMIN_PASSWORD` secret.

## Smoke test contract

`scripts/local-smoke.mjs` supports these environment variables:

- `BASE_URL`: target server base URL, default `http://127.0.0.1:8787`
- `SMOKE_PASSWORD`: login password for the target environment. If omitted, the script uses `admin123`, which only works when your configured `ADMIN_PASSWORD` is also `admin123`.

The same script can be used for both local verification and `workers.dev` regression.

## Notes

- This first version keeps only `visit_count` and `last_visited_at` in `links`
- New links are created from manual input; extra metadata can be filled in later on the detail page
- URL validation blocks obvious localhost and private-network targets, but it does not do DNS-layer private IP resolution
- `wrangler.jsonc` declares the D1 binding by name and intentionally does not store a `database_id`; bind `DB` to `link_hub` in the Cloudflare dashboard for dashboard-managed deployments
- Production password must be provided explicitly through Wrangler secrets or the Cloudflare dashboard; do not rely on `.dev.vars` for deployment
