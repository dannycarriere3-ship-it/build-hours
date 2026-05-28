import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function reloadWhenServerRestarts(): Plugin {
  let previousInstanceId: string | undefined;

  return {
    name: "reload-when-server-restarts",
    configureServer(server) {
      const interval = setInterval(async () => {
        try {
          const response = await fetch("http://127.0.0.1:8421/api/health");
          if (!response.ok) return;

          const health = (await response.json()) as { instance_id?: string };
          if (!health.instance_id) return;
          if (previousInstanceId && health.instance_id !== previousInstanceId) {
            server.ws.send({ type: "full-reload" });
          }
          previousInstanceId = health.instance_id;
        } catch {
          // The API is briefly unavailable while uvicorn replaces the worker.
        }
      }, 500);

      return () => clearInterval(interval);
    },
  };
}

export default defineConfig({
  plugins: [react(), reloadWhenServerRestarts()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8421",
    },
  },
});
