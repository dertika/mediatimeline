import adapter from "@sveltejs/adapter-static";

// The GitHub Pages build (site/build.sh) serves the app below the repository
// path and lets GitHub's 404.html act as the SPA entry point.
const base = process.env.BASE_PATH ?? "";
const fallback = process.env.SPA_FALLBACK ?? "index.html";

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // Pure SPA: the backend serves index.html for every non-API route.
    adapter: adapter({ pages: "build", assets: "build", fallback }),
    paths: { base },
  },
};
