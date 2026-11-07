import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PORT = 3100;
const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`;
const externalBase = process.env["E2E_BASE_URL"];
const isCi = process.env["CI"] === "true";

const DATABASE_URL = "postgres://chezz:chezz@127.0.0.1:54329/chezz_e2e";
const WEB_SERVER_COMMAND = [
  "node apps/server/scripts/prepare-db.ts --recreate",
  "node apps/server/scripts/seed.ts --demo",
  "npm run build -w @chezz/web",
  "node apps/server/src/main.ts",
].join(" && ");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: isCi && !externalBase ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: externalBase ?? LOCAL_ORIGIN,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile-360",
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 }, hasTouch: true },
    },
    { name: "webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  ...(externalBase
    ? {}
    : {
        webServer: {
          command: WEB_SERVER_COMMAND,
          cwd: ROOT,
          env: {
            DATABASE_URL,
            HOST: "127.0.0.1",
            PORT: String(PORT),
            APP_ORIGIN: LOCAL_ORIGIN,
            RATE_LIMIT_IP_PER_MIN: "100000",
          },
          url: `${LOCAL_ORIGIN}/api/health`,
          reuseExistingServer: !isCi,
          timeout: 180_000,
        },
      }),
});
