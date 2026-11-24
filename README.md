# React (client-only) — Wix Headless–ready

This is a **static React app** (Vite, JavaScript + JSX). It can call **Wix Headless** APIs via `@wix/sdk` using an OAuth **Client ID** from your Wix project’s [Headless Settings](https://dev.wix.com/docs/go-headless/self-managed-headless/get-started/connect-a-frontend.md). The 3D office scene does not require Wix Stores, Events, or other apps unless you add them.

**Node:** Use **Node 18 LTS or newer** for the root Vite app. **Wix-managed** (`npm run dev:wix`) needs **Node ≥ 20.11** ([Wix CLI](https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/quick-start-with-the-wix-cli.md)).

## Commands

```bash
npm install
npm run local          # build + open static preview http://127.0.0.1:4173 (no dev / no HMR)
npm run dev              # Vite app (self-managed path)
npm run dev:wix          # Wix-managed Astro app (from office-wix-managed/)
npm run dev:wix-astro    # Same app via plain `astro dev` (no Wix proxy; use if `wix dev` + Vite WS hangs)
npm run build            # Vite → dist/
npm run build:wix        # Wix Astro production build only
npm run build:all        # Vite + Wix Astro
```

### Wix Headless (self-managed)

1. In the Wix dashboard open your **Headless project** (or site with a headless client): **Settings → Development & integrations → Headless Settings** — see [Connect a Frontend](https://dev.wix.com/docs/go-headless/self-managed-headless/get-started/connect-a-frontend.md).
2. **Create New Client** (OAuth app), pick your stack, copy the **Client ID**.
3. Under URLs, add **Allow Redirect Domains** / **Allow Authorization Redirect URIs** for every origin you use (e.g. `http://localhost:5173`, `https://your-deployment.vercel.app`).
4. Copy `.env.example` to `.env` and set `VITE_WIX_CLIENT_ID=…`. The app creates a Wix client in `src/wixClient.js` on load (`getWixClient()` in `main.jsx`).
5. When you need a product API, install the matching package (e.g. `@wix/stores`) and pass `modules: { … }` into `createClient` per the SDK docs.

On Vercel/Netlify, set `VITE_WIX_CLIENT_ID` in the host’s **Environment Variables** UI (no secrets in git).

### Which Wix Headless path?

| Goal | Where to work | Hosting |
|------|----------------|---------|
| **Wix-managed** (CLI, previews, Wix pipeline) | [`office-wix-managed/`](./office-wix-managed/START_HERE.md) | Wix ([managed headless](https://dev.wix.com/docs/go-headless/wix-managed-headless/about-wix-managed-headless.md)) |
| **Self-managed** (keep this Vite app as-is) | Repo root (`npm run dev` → Vite) | You ([self-managed](https://dev.wix.com/docs/go-headless/self-managed-headless/get-started/connect-a-frontend.md)) |

**→ Wix-managed headless (Astro + Wix CLI):** step-by-step port map is in [PORTING.md](./PORTING.md). A ready **Astro 5** subproject lives in [`office-wix-managed/`](./office-wix-managed/README.md) (`npm run dev` there, then `headless link` per [CONNECT_WIX.md](./office-wix-managed/CONNECT_WIX.md)).

**Go live (self-hosted):** see [DEPLOY.md](./DEPLOY.md).

## Scenes (Three.js + cannon-es)

Dependencies: **`three@^0.160`** and **`cannon-es@^0.20`**. Each level is a code-split module that appends its WebGL canvas to a mount set by its React component, and loads its files from `public/` (e.g. `officeAsset()` → `/office-scene-optimized/...`):

| Level | Module | Model |
|------|--------|-------|
| Office | `src/office-copy/officeSceneModule.js` | `public/office-scene-optimized/office-scene1.glb` |
| Kitchen | `src/kitchen/kitchenSceneModule.js` (+ `src/kitchen/*.js`) | `public/kitchen-scene-optimized/ul-kitchen28.glb` |
| Meeting room | `src/meeting-room/meetingRoomSceneModule.js` | `public/meeting-room-optimized/` |

The modules are edited directly (they're no longer generated from HTML files). Every change in `src/` is mirrored to the same file under `office-wix-managed/src/components/`, and `public/` assets to `office-wix-managed/public/`.

## Porting checklist (from one HTML file + inline script + JSON)

1. **Markup** — Move the `<body>` content (except `<script>`) into a React component; use `className` instead of `class`.
2. **JSON** — Either `import config from './config.json'` from `src/`, or put files in `public/` and `fetch('/config.json')` if you need to swap them without rebuilding.
3. **`document.getElementById` / `querySelector`** — Prefer React `state` / `useRef` instead of imperative DOM lookups.
4. **Timers / listeners** — `setInterval` / `addEventListener` belong in `useEffect` with a cleanup function.
5. **One-off init** — Code that ran at parse time in the old script usually moves to `useEffect(() => { ... }, [])` or event handlers.
6. **Canvas / games** — Keep your game loop in `useRef` for mutable state (e.g. engine instance) and `useEffect` for setup/teardown.

When your original `index.html` (or `.html` + `.js` + `.json`) files are in this repo, the inline script can be translated line by line into components and hooks.
