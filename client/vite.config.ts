/// <reference types="vitest/config" />
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The three apps and the sign-in page (ADR-0012). Each entry is its own HTML
 * page and its own bundle, so the officer bundle carries no worker or
 * contractor screens.
 */
const APPS = ["worker", "contractor", "officer"] as const;

// The client folder. The package is an ES module, so there is no __dirname.
const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * In the dev server, send every address inside an app to that app's page.
 *
 * Each app routes inside itself with the browser's real addresses, so a
 * refresh on /worker/find-work asks the server for that path. Vite knows only
 * /worker/index.html, and without this it would answer with the sign-in page.
 * The hosted build will need the same rule on its web server.
 */
function appPages(): Plugin {
  return {
    name: "app-pages",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "";
        for (const app of APPS) {
          const inApp = url === `/${app}` || url.startsWith(`/${app}/`);
          // A path with a dot is a real file (a script, a style, an image).
          const isFile = /\.[a-z0-9]+(\?|$)/i.test(url.split("?")[0]!);
          if (inApp && !isFile) {
            req.url = `/${app}/index.html`;
            break;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), appPages()],
  build: {
    rollupOptions: {
      input: {
        signin: resolve(ROOT, "index.html"),
        ...Object.fromEntries(APPS.map((a) => [a, resolve(ROOT, `${a}/index.html`)])),
      },
    },
  },
  // ADR-0009: page tests run in a browser DOM inside Node, and never reach the API.
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  server: {
    port: 5173,
    // The API is proxied so the browser only ever talks to one origin. That
    // keeps CORS out of the picture during the demo and means the frontend can
    // use plain relative paths like fetch("/api/wages").
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
