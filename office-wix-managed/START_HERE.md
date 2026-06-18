# From start — Wix-managed office app

Do these **in order**. Skip any step you already finished.

---

### 0. Prerequisites

- **Node** ≥ 20.11 (22 is fine).
- A **Wix account** you will use for this project.
- This repo cloned on your machine.

---

### 1. Install dependencies

```bash
cd office-wix-managed
npm install
```

---

### 2. 3D assets (required for the scene)

The game loads files from **`public/office-scene-optimized/`**.

If that folder is empty or missing files, copy from the root Vite app:

```bash
cp -R ../public/office-scene-optimized ./public/
```

---

### 3. Log the Wix CLI into the right account

```bash
npx wix whoami
```

- If it shows the **wrong** email: `npx wix logout` then `npx wix login`.
- If it shows the **correct** email, continue.

---

### 4. Link this folder to Wix (only if you have no `wix.config.json` yet)

**If `wix.config.json` already exists** and matches the site you want, **skip to step 5**.

Otherwise, from **`office-wix-managed`**:

**Interactive (normal terminal):**

```bash
npm create @wix/new@latest -- headless link
```

Sign in in the browser if asked, then follow prompts (business / site name).

**Non-interactive (no TTY, scripts, CI):**

```bash
npx @wix/create-new@latest headless link --business-name "Your Business Name"
```

That creates **`wix.config.json`** with your `siteId` and `appId`.

---

### 5. Run the app locally

From `office-wix-managed`:

```bash
npm run dev
```

From the **repo root** (same thing):

```bash
npm run dev:wix
```

- Open the **local** URL (e.g. `http://localhost:4321/` or another port if `4321` is busy).
- Use the terminal’s **Site** / **Dashboard** links for the Wix preview and manager.

**Dashboard without hunting the sites list:**

`https://manage.wix.com/dashboard/<siteId>`

Replace `<siteId>` with the value from **`wix.config.json`** (the `siteId` field).

---

### 6. Optional: regenerate the big scene file from HTML

Only if you maintain `office-scene.html` elsewhere and want to rebuild the module:

```bash
npm run sync-office
```

See `scripts/build-office-scene-module.mjs` and env var **`OFFICE_HTML`** if paths differ.

---

### 7. Optional: Wix APIs from the browser (OAuth client)

If you call Wix from React with a client ID:

1. In the Wix dashboard: **Settings → Development & integrations → Headless Settings** — create a client, set redirect URLs (include your local dev URL).
2. Copy **`.env.example`** → **`.env`** or **`.env.local`** and set **`PUBLIC_WIX_CLIENT_ID`** (Astro only exposes `PUBLIC_*` to the client).

---

### 8. Ship to Wix hosting

When the app is ready, use Wix’s **build / preview / release** flow (see [Wix headless build and deploy](https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/build-and-deploy.md)). This repo’s `package.json` includes scripts such as **`npm run build`**, **`npm run preview`**, and **`npm run release`** — use what the Wix CLI documents for your plan.

---

### 9. Save the link in Git

Commit **`wix.config.json`** (no secrets there) so the project stays tied to the same Wix site.

---

## Troubleshooting: dev “not working”, blank page, or Vite errors

**1. Port exhaustion (many `Port 600x is in use`, HMR `24678` in use)**  
You likely have old **`wix dev`** / **Vite** / **Cursor** preview processes still running. Quit them from the IDE, or on macOS find and stop listeners, for example:

```bash
lsof -nP -iTCP:24678 -sTCP:LISTEN
lsof -nP -iTCP:4321 -sTCP:LISTEN
```

Then **`kill <pid>`** (or close the terminals that started those dev servers). Start **`npm run dev`** again.

This project sets a custom **HMR port (`25778`)** in `astro.config.mjs` to reduce clashes with the default `24678`.

**2. `@wix/stores` / optimizeDeps**  
`@wix/astro` expects **`@wix/stores`** to be installed. It is listed in `package.json`; run **`npm install`** if you see “Failed to resolve dependency: @wix/stores”.

**3. Blank 3D scene**  
Open the browser **developer console**. Check for **404** on `/office-scene-optimized/...` — if so, copy assets (**step 2**). Also confirm you are not blocking **WebGL** or **https://threejs.org** (HDR probe).

**4. Wrong URL**  
Use the exact **localhost** URL and port printed after **`npm run dev`** (it changes if `4321` is busy).

---

## Starting completely over (wrong site / wrong account)

1. Delete the mistaken site in the **wrong** Wix account (dashboard), if it still exists.
2. `npx wix logout` → `npx wix login` (correct account).
3. Delete **`wix.config.json`** and the **`.wix/`** folder in this directory.
4. Run **step 4** again.

More detail: [CONNECT_WIX.md](./CONNECT_WIX.md).
