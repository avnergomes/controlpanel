import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/analytics.js", "src/normalize.js", "src/router.js", "src/format.js", "src/geo.js", "src/export.js", "src/sites.js"],
    },
  },
});
