// Проекты Vitest (TESTING §5, §6). Проект web (jsdom, apps/web) — задача фронтенда.
// Группы идут по очереди (groupOrder): int и contract не делят базы воркеров одновременно.
// retries нет (TESTING §15); passWithNoTests — проект без файлов не падает (EC-2).
import { defineConfig } from "vitest/config";

const serverDb = {
  globalSetup: ["apps/server/test/support/db.ts"],
  setupFiles: ["apps/server/test/support/setup.ts"],
  pool: "forks",
  maxWorkers: 2,
  testTimeout: 15_000,
  hookTimeout: 30_000,
} as const;

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          sequence: { groupOrder: 0 },
          environment: "node",
          include: [
            "**/src/**/*.test.{ts,tsx}",
            "packages/*/test/**/*.test.{ts,tsx}",
            "apps/server/test/acceptance/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**", "**/*.int.test.ts", "apps/web/**"],
        },
      },
      {
        test: {
          name: "web",
          sequence: { groupOrder: 0 },
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "int",
          sequence: { groupOrder: 1 },
          environment: "node",
          include: ["apps/server/src/**/*.int.test.ts"],
          ...serverDb,
        },
      },
      {
        test: {
          name: "contract",
          sequence: { groupOrder: 2 },
          environment: "node",
          include: ["apps/server/test/contract/**/*.test.ts"],
          ...serverDb,
        },
      },
      {
        test: {
          name: "deploy",
          sequence: { groupOrder: 0 },
          environment: "node",
          include: ["tests/deploy/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.image.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "deploy-image",
          sequence: { groupOrder: 3 },
          environment: "node",
          include: ["tests/deploy/**/*.image.test.ts"],
          testTimeout: 900_000,
          maxWorkers: 1,
        },
      },
    ],
  },
});
