import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function fullReloadOnSceneModules() {
  const shouldReload = (file) => {
    const normalized = String(file).replace(/\\/g, "/");
    return (
      /(?:kitchen|office|meetingRoom)SceneModule\.js$/.test(normalized) ||
      /kitchen-scene\.html$/.test(normalized)
    );
  };
  return {
    name: "full-reload-scene-modules",
    handleHotUpdate({ file, server }) {
      if (!shouldReload(file)) return;
      server.ws.send({ type: "full-reload", path: "*" });
      return [];
    },
    configureServer(server) {
      const reload = (file) => {
        if (!shouldReload(file)) return;
        server.ws.send({ type: "full-reload", path: "*" });
      };
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
    },
  };
}

export default defineConfig({
  plugins: [react(), fullReloadOnSceneModules()],
  server: {
    host: "127.0.0.1",
    port: 5186,
    strictPort: true,
    hmr: {
      host: "127.0.0.1",
      port: 5186,
      protocol: "ws",
    },
    watch: {
      usePolling: true,
      interval: 300,
    },
    headers: {
      "Cache-Control": "no-store",
    },
  },
});
