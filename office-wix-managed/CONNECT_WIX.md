# Connect this folder to Wix-managed headless

For the **full path from zero** (install → assets → login → link → dev → deploy), see **[START_HERE.md](./START_HERE.md)**. This file focuses on linking, re-linking, and env vars.

### Browser / device login (open URL, enter code)

**I cannot complete this step for you** from Cursor’s tool shell: there is no real TTY, and `wix login` / `npm create … headless link` need an interactive terminal (or they error with “non-interactive terminals” / Ink raw mode).

**Do this on your Mac** in **Terminal.app** or **iTerm** (not a minimal automation shell):

```bash
cd /path/to/car-game-wix-headless/office-wix-managed
```

Optional fresh login (browser / code):

```bash
npx wix logout
npx wix login
```

Follow the browser window or paste the **user code** at the URL the CLI prints.

Then link (if you need a new site or first-time link):

```bash
npm create @wix/new@latest -- headless link
```

Or run the helper script (same idea, prompts you):

```bash
./scripts/wix-browser-flow.sh
```

If you only need **non-interactive** link (no browser prompts), use:

`npx @wix/create-new@latest headless link --business-name "Your Business Name"`

Prerequisites: **Node ≥ 20.11** (this repo’s `package.json` also allows 22), a Wix account, and Git.

## 1. Local dev (no Wix yet)

```bash
cd office-wix-managed
npm install
npm run dev
```

The office scene loads from `public/office-scene-optimized/`. If assets are missing, copy them from the parent app:

`../public/office-scene-optimized/` → `public/office-scene-optimized/`.

## 2. Regenerate the scene module (optional)

If you update the source HTML in the sibling `car-game-wix-table` tree (see `scripts/build-office-scene-module.mjs`), run:

```bash
npm run sync-office
```

Or set `OFFICE_HTML` to an absolute path to `office-scene.html`.

## 3. Link to Wix (device login)

From **this directory** (`office-wix-managed`):

```bash
npm create @wix/new@latest -- headless link
```

In a **non-interactive** shell (no TTY), use the generator directly with a business name:

```bash
npx @wix/create-new@latest headless link --business-name "Your Business Name"
```

The **`npm create … headless link`** flow may open a **device login** URL on **users.wix.com**; finish sign-in in the browser, then answer prompts in the terminal.

The **`--business-name`** form uses your **current** Wix CLI session (`npx wix whoami`); it does not need a TTY and is suitable for automation.

That step adds Wix project files (for example `wix.config.json`) and installs any extra Wix dependencies the template expects. After linking, follow [Build and Deploy](https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/build-and-deploy.md) for `npm run dev` / deploy URLs printed by the CLI.

### Wrong Wix account or deleted site — re-link

You cannot “move” a headless site to another Wix user by editing files locally. Delete the mistaken site in the wrong dashboard (already done), then on your machine:

1. Confirm the CLI user: `npx wix whoami` — if it is still the wrong account, run **`npx wix logout`** then log in again (**`npx wix login`**) with the correct account.
2. Remove the old link in this folder: delete **`wix.config.json`** and the **`.wix/`** directory (they pointed at the old `siteId`). This repo’s `.gitignore` ignores `.wix/` so it stays local-only after the CLI recreates it.
3. Run **`npm create @wix/new@latest -- headless link`** again from `office-wix-managed` and create or pick a site under the **correct** account (or non-interactively: `npx @wix/create-new@latest headless link --business-name "…"`).
4. Commit the new **`wix.config.json`** when it reflects the right project.

## 4. Environment variables (client-side Wix SDK)

Astro exposes only variables prefixed with **`PUBLIC_`** to browser code. If you still use `@wix/sdk` with a client ID in React islands, add to `.env`:

```bash
PUBLIC_WIX_CLIENT_ID=your-oauth-client-id
```

See `.env.example`. Create the OAuth client under Wix: **Settings → Development & integrations → Headless Settings**.

## 5. Astro version

This subproject targets **Astro 5** with `@astrojs/react` 4.x. Wix-managed docs currently describe Astro 5; avoid upgrading to Astro 6 until Wix documents support.
