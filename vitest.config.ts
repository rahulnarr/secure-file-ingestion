import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Scoped to the layers unit tests actually exercise: business logic
      // and pure infrastructure utilities. Controllers/routes/app wiring
      // are thin HTTP adapters covered by the integration suite instead —
      // enforcing a unit-coverage threshold on them would just reward
      // testing framework glue rather than logic.
      include: [
        "src/common/errors/**",
        "src/common/validation/**",
        "src/infrastructure/crypto/**",
        "src/infrastructure/resilience/**",
        "src/infrastructure/storage/**",
        "src/infrastructure/metrics/**",
        "src/modules/**/services/**",
        "src/modules/**/*.mapper.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "src/infrastructure/database/**",
        "src/infrastructure/logging/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
