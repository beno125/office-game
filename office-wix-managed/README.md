# Office (Wix-managed headless target)

Astro 5 + React island that hosts the same Three.js office scene as the root Vite app (`../`).

**→ Step-by-step from zero:** [START_HERE.md](./START_HERE.md)  
**→ Correct account → OAuth client → `npm run release`:** [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)

**Local preview without `wix dev` / `astro dev`:** the office scene in this folder is an **SSR** Wix Astro app — there is no plain `dist/index.html` to open with a static file server, and `astro preview` is not supported with the Wix adapter. To view the **same 3D office** as a normal static site on localhost, use the **repo root** Vite app: **`npm run local`** (build + `vite preview` on port **4173**).

From the **repo root** you can also run **`npm run dev:wix`** and **`npm run build:wix`** (see root `package.json`).

- **Wix link, re-link, env:** [CONNECT_WIX.md](./CONNECT_WIX.md)
- **Porting map (Vite → Astro):** [../PORTING.md](../PORTING.md)
