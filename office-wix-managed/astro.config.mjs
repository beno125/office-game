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

  // Avoid HMR WebSocket clashing when many old `wix dev` / Vite processes are still running (default 24678).
  vite: {
    server: {
      hmr: { port: 25778 },
    },
  },
});