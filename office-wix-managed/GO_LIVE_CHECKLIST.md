# Correct account → OAuth client → live site

**Fast path (after you are logged in with `npx wix whoami`):** from `office-wix-managed/` run  
`./scripts/after-wix-login-go-live.sh` — it runs **headless link** (new business name with timestamp), **build**, and **release**. You still complete **OAuth / `.env.local`** yourself (step 5 below).

Run these **in order** in **Terminal.app** (or iTerm) on your Mac so **browser** and **CLI** steps work. Use **Node ≥ 20.11**.

---

## 1. Confirm the **browser** is on the right Wix user (before any CLI)

1. Open **[https://manage.wix.com](https://manage.wix.com)** in a normal window (or **private/incognito** if you want zero doubt).
2. Sign in as the **account that should own this project** (check the **avatar / email / account switcher** in the header).
3. Leave that tab open — you will come back here for **Headless Settings** in step 5.

If this is not the right user, **switch account** or sign out and sign in again until it is.

---

## 2. CLI login (browser opens — ties the **terminal** to that same identity)

```bash
cd /path/to/car-game-wix-headless/office-wix-managed
npx wix login
```

- A **browser** window or **device-login** page should open; complete sign-in there.
- If the terminal is minimal, use:  
  `CI=true npx wix login`  
  then open the printed **`verificationUri`** and enter **`userCode`**.

**Verify the CLI matches the browser account:**

```bash
npx wix whoami
```

The email **must** match the account you confirmed in step 1. If it does not, run `npx wix logout` (answer **Y** in a real TTY), then `npx wix login` again.

---

## 3. Link this folder to a headless site (under that account)

If **`wix.config.json` is missing**, create it:

**Interactive (recommended):**

```bash
npm create @wix/new@latest -- headless link
```

**Non-interactive:**

```bash
npx @wix/create-new@latest headless link --business-name "Your unique business name"
```

You should get **`wix.config.json`** with **`siteId`** and **`appId`**.

**Open the site dashboard directly** (proves the site is on the account you want):

`https://manage.wix.com/dashboard/<siteId>`

Replace `<siteId>` with the value from **`wix.config.json`**. If the page opens under the wrong user, you are not on the same login as steps 1–2 — fix login first, then re-run step 3.

---

## 4. Local dev (smoke test)

```bash
npm install
npm run dev
```

Open the **localhost** URL, confirm the office scene loads. Use the terminal **Site** / **Dashboard** links as needed.

---

## 5. OAuth **Client ID** (“API key” for the browser SDK)

Wix does not use a random API key for this flow — you create an **OAuth client** and copy the **Client ID**.

1. In the dashboard for **this** headless site: **Settings → Development & integrations → Headless Settings**  
   ([Connect a frontend](https://dev.wix.com/docs/go-headless/self-managed-headless/get-started/connect-a-frontend.md) — same client concept.)
2. **Create** (or select) a **Headless** / **OAuth** client.
3. **Redirect / allowed origins:** add at least:
   - Your **local** dev origin (e.g. `http://localhost:4321` — use the **exact** port `npm run dev` prints).
   - Your **hosted** preview/production origin after first deploy (e.g. `https://….wix-site-host.com` or your custom domain).
4. Copy the **Client ID**.

In **`office-wix-managed/`**, create **`.env.local`** (gitignored) from **`.env.example`**:

```bash
PUBLIC_WIX_CLIENT_ID=paste-client-id-here
```

Restart **`npm run dev`** after changing env.

> The Wix Astro integration may also define **`WIX_CLIENT_ID`** in env types; if the template or docs tell you to set **`WIX_CLIENT_ID`** instead, follow the value Wix shows for your client — same ID, different env name depending on setup.

---

## 6. Production build (local check)

```bash
npm run build
```

Fix any errors before releasing.

---

## 7. Go **live** on Wix hosting

```bash
npm run release
```

Optional flags (see `npx wix release --help`):

```bash
npx wix release -c "First correct-account release" -t minor
```

When it finishes, the CLI prints a **`*.wix-site-host.com`** (or updated) URL — that is your **live** build under the **account from steps 1–2**.

---

## 8. Git (recommended)

Commit **`wix.config.json`**, **`package.json` / lockfile**, **`astro.config.mjs`**, and docs — **do not** commit **`.env.local`** (secrets / client config).

---

## Quick “am I on the right account?” triad

| Check | What you expect |
|--------|------------------|
| `manage.wix.com` header | Intended email / workspace |
| `npx wix whoami` | Same email |
| `https://manage.wix.com/dashboard/<siteId>` | Opens without “no access” |

If all three match, you can trust **Headless Settings** and **release** for that account.
