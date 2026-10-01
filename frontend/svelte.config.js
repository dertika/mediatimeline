import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // Pure SPA: the backend serves index.html for every non-API route.
    adapter: adapter({ pages: "build", assets: "build", fallback: "index.html" }),
  },
};
