import { readFileSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    // Shown in the footers; one version for the whole project (see CHANGELOG.md).
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    // During development the backend runs on :8080
    proxy: { "/api": "http://localhost:8080" },
  },
});
