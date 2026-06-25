import { defineConfig } from "astro/config";
import react from "@astrojs/react";

import wix from "@wix/astro";
import cloudProviderFetchAdapter from "@wix/cloud-provider-fetch-adapter";
const isBuild = process.env.NODE_ENV == "production";

// After linking Wix: `npm create @wix/new@latest -- headless link` (Node ≥ 20.11, Wix login)
// https://dev.wix.com/docs/go-headless/wix-managed-headless/get-started/connect-an-existing-astro-project.md
export default defineConfig({
  integrations: [react(), wix()],
  ...(isBuild && { adapter: cloudProviderFetchAdapter({}) }),

  image: {
    domains: ["static.wixstatic.com"],
  },

  output: "server",

  // Vite's WS (HMR / module runner) defaults to port 24678. If that port is taken by an old
  // `wix dev` / `astro dev` process, the client hangs on "[vite] connecting…" and the page stays white.
  // Use a high, stable port pair; free 24678 with `lsof -nP -iTCP:24678 -sTCP:LISTEN` + kill if needed.
  vite: {
    server: {
      hmr: {
        protocol: "ws",
        host: "127.0.0.1",
        port: 58989,
        clientPort: 58989,
      },
    },
  },
});