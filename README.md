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
3. Set `ADMIN_PASSWORD` in `.dev.vars`
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

## Local dev credentials

Current local development credentials are controlled by `.dev.vars`.
In the current local setup:

- password: `admin123`

## Production deployment

This project is currently prepared for a single `workers.dev` deployment target.

1. Authenticate Wrangler with either `npx wrangler login` or a `CLOUDFLARE_API_TOKEN` that can manage Workers and D1.
2. Create or select the production D1 database named `link_hub`.
3. Bind the D1 database to the Worker with binding name `DB`. In the Cloudflare dashboard, add a D1 database binding, set variable name to `DB`, and select `link_hub`.
4. Apply remote migrations: `npm run db:migrate:remote`
5. Set production secrets:
   - `npx wrangler secret put ADMIN_PASSWORD`
6. Verify packaging before release: `npx wrangler deploy --dry-run`
7. Deploy to Cloudflare: `npm run deploy`
8. Save the deployed `https://<worker>.workers.dev` URL and run smoke regression against it:
   - PowerShell: `$env:BASE_URL='https://<worker>.workers.dev'; $env:SMOKE_PASSWORD='<admin-password>'; node scripts/local-smoke.mjs`

## Smoke test contract

`scripts/local-smoke.mjs` supports these environment variables:

- `BASE_URL`: target server base URL, default `http://127.0.0.1:8787`
- `SMOKE_PASSWORD`: login password, default `admin123`

The same script can be used for both local verification and `workers.dev` regression.

## Notes

- This first version keeps only `visit_count` and `last_visited_at` in `links`
- New links are created from manual input; extra metadata can be filled in later on the detail page
- URL validation blocks obvious localhost and private-network targets, but it does not do DNS-layer private IP resolution
- `wrangler.jsonc` declares the D1 binding by name and intentionally does not store a `database_id`; bind `DB` to `link_hub` in the Cloudflare dashboard for dashboard-managed deployments
- Production password must be provided explicitly through Wrangler secrets; do not rely on `.dev.vars` for deployment
