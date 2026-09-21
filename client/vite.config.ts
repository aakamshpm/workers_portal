import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
