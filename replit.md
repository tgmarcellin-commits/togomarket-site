# TogoMarket

Plateforme de marketplace multi-secteurs pour le Togo — permet à n'importe qui de publier et consulter des annonces dans 4 secteurs : AgriMarket, Immobilier, Automobile et Divers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/togomarket run dev` — run the frontend (port 24326)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `ADMIN_PASSWORD` — admin password (default: "17210")

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/listings.ts` — listings table schema
- `lib/db/src/schema/orders.ts` — orders table schema
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/togomarket/src/` — React frontend
  - `pages/home.tsx` — main marketplace page
  - `components/listing-card.tsx` — product card
  - `components/publish-modal.tsx` — sell listing modal
  - `components/order-modal.tsx` — custom order request modal
  - `components/admin-modal.tsx` — admin login modal
  - `lib/image.ts` — client-side image resize utility

## Architecture decisions

- Images stored as base64 arrays in PostgreSQL (text[]) — consistent with original local site behavior, avoids object storage complexity for MVP
- Admin password checked server-side only; not stored in session (stateless)
- Listings are returned newest-first (reversed) from the API
- WhatsApp integration for contact unlock and order notifications
- Admin delete uses POST /admin/listings/delete (body) instead of DELETE /{id} to avoid Orval type-generation collision with path params

## Product

- Browse listings across 4 sectors (AgriMarket, Immobilier, Automobile, Divers)
- Search and filter listings by sector and keyword
- Publish listings with up to 4 photos (auto-compressed client-side)
- Contact unlock system: buyer pays 5% commission via WhatsApp to get seller contact
- Custom order: request hard-to-find items, team finds them for you
- Admin panel: view seller phone numbers and delete listings

## User preferences

- WhatsApp number: 22870703131 (hardcoded in frontend)
- Default admin password: "17210" (override with ADMIN_PASSWORD env var)
- Language: French

## Gotchas

- After OpenAPI spec changes, always run codegen before building: `pnpm --filter @workspace/api-spec run codegen`
- After DB schema changes, run `pnpm run typecheck:libs` to rebuild the lib declarations before typechecking the API server
- Base64 images in PostgreSQL can make the listings table large if many high-res photos are uploaded

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
