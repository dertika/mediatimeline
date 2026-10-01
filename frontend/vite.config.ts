import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // During development the backend runs on :8080
    proxy: { "/api": "http://localhost:8080" },
  },
});
