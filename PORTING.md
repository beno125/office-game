# Port this repo → Wix-managed headless

Your app today is **Vite + React**. Wix-managed headless is **Astro 5** (with React / Vue / Svelte / Solid) plus the **Wix CLI** — see [Choose your development path](https://dev.wix.com/docs/go-headless/get-started/choose-your-development-path.md) and [Connect an existing Astro project](https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/connect-an-existing-astro-project.md).

You have **two** supported ways to end up on Wix-managed hosting.

---

## Path 1 — Fresh Wix headless project (simplest mentally)

Use when you want the CLI to scaffold everything, then you paste code in.

1. **Prereqs:** Node **≥ 20.11**, Git, Wix account ([Quick Start](https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/quick-start-with-the-wix-cli.md)).
2. Create a **new folder** (not inside this repo) and run:

   ```bash
   npm create @wix/new@latest headless
   ```

3. Open the generated project and note where **React** and **pages** live (template-dependent; often `src/pages/index.astro`, `src/components/`, `src/layouts/`).
4. **Copy from this repo (`car-game-wix-headless`)** using the table below.
5. Use the Wix CLI **dev** / **deploy** flow from [Build and Deploy](https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/build-and-deploy.md).

---

## Path 2 — Astro 5 + React first, then `headless link` (good if you want a clean Astro tree)

Use when you prefer an explicit **Astro 5** app, then link it to Wix in one command ([Connect an existing Astro project](https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/connect-an-existing-astro-project.md)).

**In-repo starter:** this repository already contains **`office-wix-managed/`** — an Astro 5 + React copy of the scene, `public/office-scene-optimized/`, and `scripts/build-office-scene-module.mjs` wired to output under `src/components/office/`. Open [`office-wix-managed/README.md`](./office-wix-managed/README.md) and [`office-wix-managed/CONNECT_WIX.md`](./office-wix-managed/CONNECT_WIX.md), then run `headless link` from that folder after you sign in with the Wix CLI.

1. In a **new directory** (or skip and use `office-wix-managed/` above):

   ```bash
   npm create astro@latest
   ```

   - Enable **React** (`@astrojs/react`).
   - Use **Astro 5** (not 6 — Wix does not support Astro 6 yet per docs).

2. Copy your UI + scene code from this repo (table below) into `src/components/` (and `public/`).
3. Add a page that mounts the scene, e.g. `src/pages/index.astro`:

   ```astro
   ---
   import Layout from "../layouts/Layout.astro";
   import OfficeScene from "../components/OfficeScene.jsx";
   ---
   <Layout title="Office">
     <OfficeScene client:only="react" />
   </Layout>
   ```

   Adjust paths to match your template’s `Layout`.

4. From that Astro project **root**:

   ```bash
   npm create @wix/new@latest -- headless link
   ```

   Enter business name when prompted. This creates the Wix headless project, adds `wix.config.json` (and related wiring), and installs Wix dependencies.

5. Run **`npm run dev`** and open the CLI-printed URL ([Connect an existing Astro project](https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/connect-an-existing-astro-project.md)).

---

## File map (this repo → Astro + Wix headless)

| In `car-game-wix-headless` | Action in Wix-managed Astro project |
|----------------------------|--------------------------------------|
| `src/OfficeScene.jsx` | Copy → e.g. `src/components/OfficeScene.jsx`. Import from a `.astro` page with `client:only="react"` or `client:load` so Three/WebGL runs only in the browser. |
| `src/office/officeSceneModule.js` | Copy → e.g. `src/components/office/officeSceneModule.js` (or `src/lib/office/…`). Update import in `OfficeScene.jsx` if the path changes. |
| `src/office/officeSceneMount.js` | Copy next to `officeSceneModule.js` (same relative imports). |
| `src/App.jsx` | **Optional.** Astro page can import `OfficeScene` directly; you may delete `App` or keep a thin `App.jsx` wrapper if you prefer. |
| `src/main.jsx` | **Replace** with Astro: remove React `createRoot` entry; the `.astro` page owns the layout. |
| `src/index.css` | Merge into global styles: e.g. `src/styles/global.css` imported from `Layout.astro`, or `<style is:global>` — keep `#perfBadge` rules. |
| `src/wixClient.js` | **Review after link.** Wix-managed projects often preconfigure the SDK; you may drop manual `OAuthStrategy` + `VITE_WIX_CLIENT_ID` if the template handles auth. Keep the file only if you still need a custom client. |
| `public/office-scene-optimized/**` | Copy entire folder → `public/office-scene-optimized/` in the Astro project. Large binaries unchanged. |
| `scripts/build-office-scene-module.mjs` | Copy → same path under new repo root. Keep `npm run sync-office` in `package.json` if you still sync from `office-scene.html`. |
| `index.html` | **Do not copy as the app shell.** Astro generates HTML; your scene mounts from the `.astro` + React island. |
| `vite.config.js` | **Do not copy.** Astro uses `astro.config.mjs`. |
| `vercel.json` / `netlify.toml` | **Optional.** Wix hosts production; remove or keep only if you also deploy elsewhere. |
| `.env.example` | Copy; after `headless link`, follow Wix docs for **env** ([Environment variables](https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/environment-variables.md)) — names may differ from `VITE_WIX_CLIENT_ID`. |

---

## `package.json` dependencies to carry over

Install in the **new** project (versions can match this repo’s `package.json`):

- `three` (^0.160)
- `cannon-es` (^0.20)
- `@astrojs/react` + `react` + `react-dom` (if not already added by Astro + Wix template)

Add `@wix/*` domain packages only when you call those APIs (e.g. `@wix/members`).

---

## Checks after port

1. **`import.meta.env.BASE_URL`** — Still used in `officeSceneModule.js` for asset URLs. In Astro, set [`base`](https://docs.astro.build/en/reference/configuration-reference/#base) if the app is served from a subpath; otherwise `/` is fine.
2. **`client:only("react")`** — Prefer for WebGL so the scene never SSRs (no `document` / `window` during SSR).
3. **`officeSceneMount.js`** — Still mounts the canvas into the React container; no change needed if `OfficeScene` root `ref` wraps the same DOM structure.
4. **Run `npm run build`** in the Astro project before relying on Wix deploy.
5. **Git:** Point your GitHub remote at the **new** project root once you’re happy, or replace `office-game` contents in a branch.

---

## Doc links (bookmark)

- [Go Headless hub](https://dev.wix.com/docs/go-headless?no-version-override=true)
- [Quick start (CLI, new project)](https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/quick-start-with-the-wix-cli.md)
- [Connect existing Astro (link)](https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/connect-an-existing-astro-project.md)
- [Build and deploy](https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/build-and-deploy.md)

---

## Summary

| Step | What |
|------|------|
| 1 | New **Astro 5 + React** app **or** `npm create @wix/new@latest headless` |
| 2 | Copy **OfficeScene**, **office/**, **public/office-scene-optimized/**, **styles**, **scripts** |
| 3 | Render **OfficeScene** from **`index.astro`** with **`client:only("react")`** |
| 4 | If not from step 1: run **`npm create @wix/new@latest -- headless link`** in Astro root |
| 5 | **`npm run dev`** → then Wix **deploy** per docs |

This repo can stay as the **reference** until the new project is complete; then archive or merge.
