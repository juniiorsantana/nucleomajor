import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:web --workspace @nucleomajor/emyleads -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175/app/dev-gestao.html?tela=agenda",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
