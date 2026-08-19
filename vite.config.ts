import { defineConfig, type Plugin } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

function matchServerPlugin(): Plugin {
  return {
    name: "match-server",
    configureServer(server) {
      // Post-hook so Vite's HMR upgrade listener is already in place.
      // Dynamic import keeps MatchSim out of the config watcher (avoids
      // restarting the dev server on every sim edit).
      return () => {
        void import("./src/net/attachMatchServer").then(({ attachMatchServer }) => {
          if (server.httpServer) attachMatchServer(server.httpServer);
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [matchServerPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        balance: resolve(root, "balance.html"),
      },
    },
  },
});
