import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicRoot = fileURLToPath(new URL("../../public/", import.meta.url));
const screenshots = fileURLToPath(new URL("../../test-results/landing-story/", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png" };

test("etapas não atravessam a introdução durante a rolagem da landing", async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "landing.test") return route.abort();
      const path = resolve(publicRoot, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
      if (!path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep)) return route.abort();
      try {
        await route.fulfill({ body: await readFile(path), contentType: types[extname(path)] || "application/octet-stream" });
      } catch { await route.fulfill({ status: 404, body: "Not found" }); }
    });
    await mkdir(screenshots, { recursive: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1100, height: 768 }, { width: 1020, height: 800 }, { width: 390, height: 844 }, { width: 1440, height: 900, reduced: true }]) {
      await page.emulateMedia({ reducedMotion: viewport.reduced ? "reduce" : "no-preference" });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("http://landing.test/");
      await page.locator(".story-step").first().scrollIntoViewIfNeeded();
      await page.locator(".story-copy .section-intro").evaluate((element) => element.classList.add("revealed"));
      // Finish the entry animation before measuring positions.
      await page.waitForTimeout(1000);
      const positions = await page.evaluate(() => {
        const top = document.querySelector(".story-layout").getBoundingClientRect().top + scrollY;
        const bottom = document.querySelector(".story-copy").getBoundingClientRect().bottom + scrollY;
        return { top, bottom };
      });
      for (let y = positions.top - 110; y < positions.bottom - 200; y += 120) {
        await page.evaluate((scrollTop) => window.scrollTo({ top: scrollTop, behavior: "instant" }), y);
        const overlap = await page.evaluate(() => {
          const intro = document.querySelector(".story-copy .section-intro").getBoundingClientRect();
          return [...document.querySelectorAll(".story-step h3, .story-step p")].some((element) => {
            const box = element.getBoundingClientRect();
            return Math.max(box.top, intro.top, 0) < Math.min(box.bottom, intro.bottom, innerHeight)
              && Math.max(box.left, intro.left) < Math.min(box.right, intro.right);
          });
        });
        if (overlap) await page.screenshot({ path: resolve(screenshots, `overlap-${viewport.width}.png`) });
        assert.equal(overlap, false, `Texto sobreposto em ${viewport.width}px, scroll ${y}`);
      }
      await page.locator(".story-step").nth(1).click();
      await page.waitForFunction(() => document.querySelector('[data-story-state="1"]').classList.contains("active"));
      await page.locator(".story-step").nth(2).focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('[data-story-state="2"]').classList.contains("active"));
      assert.equal(await page.locator(".story-stage").evaluate((el) => getComputedStyle(el).position), viewport.width > 1020 ? "sticky" : "relative");
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), positions.top - 110);
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(screenshots, `corrigido-${viewport.width}${viewport.reduced ? "-reduced" : ""}.png`) });
    }
  } finally { await browser.close(); }
});
