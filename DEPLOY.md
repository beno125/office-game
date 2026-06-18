# Deploy this site

Your app is a **static Vite build** (`dist/`). Large assets live in `public/office-scene-optimized/` — they must be in the repo (or uploaded with your deploy) or the 3D scene will fail to load.

Set **`VITE_WIX_CLIENT_ID`** in the host’s environment variables (same value as in Wix Headless Settings → OAuth client). Never commit a real `.env` file.

## Option A — Vercel (recommended)

1. Push this project to **GitHub** (see [First-time Git](#first-time-git) below).
2. Go to [vercel.com](https://vercel.com) → sign in with GitHub → **Add New… → Project**.
3. Import the repo. Defaults should work:
   - **Framework Preset:** Vite (or Other with Build `npm run build`, Output `dist`).
   - Root directory: `.` (repo root).
4. Click **Deploy**. When it finishes, open the `.vercel.app` URL.

`vercel.json` in this repo pins **build** and **output** so detection is reliable.

### CLI (optional)

```bash
npm i -g vercel
cd /path/to/car-game-wix-headless
vercel
```

Follow the prompts (login, link project). Production: `vercel --prod`.

## Option B — Netlify

1. Push the repo to GitHub.
2. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → pick the repo.
3. Build settings are read from `netlify.toml` (`npm run build`, publish `dist`).

## Option C — Cloudflare Pages

1. Push to GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Build command: `npm run build`, build output directory: `dist`, Node 20.

---

## First-time Git

From the project folder (only if you have not pushed yet):

```bash
git init
git add .
git status   # confirm large binaries under public/office-scene-optimized are intended
git commit -m "Initial commit: office scene Vite app"
```

Create a new empty repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

**Note:** `office-table-embed65.gltf` and videos are large; the first push may take a while. If you prefer not to store them in git, use **Git LFS** or a CI step that uploads `public/` from a secret store—otherwise keep them committed so static hosts serve them.

---

## After deploy

- Open the live URL and check the browser **Network** tab if assets 404.
- For a **custom domain**, add it in the host’s dashboard and set DNS as they instruct.
