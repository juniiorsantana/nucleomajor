import { test, expect } from "@playwright/test";

test("dock móvel preserva os destinos, abre Mais e permite gerenciar agentes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/dev-gestao.html?tela=contatos");
  await page.evaluate(async () => {
    const original = globalThis.__EMYLEADS_DEV_CALL__;
    const agents = [
      { id: "demo-recepcao", name: "Recepção", slug: "demo-recepcao", audience: "customer", status: "active", isDefault: true, role: "Primeiro atendimento" },
      { id: "demo-vendas", name: "Vendas", slug: "demo-vendas", audience: "customer", status: "active", isDefault: false, role: "Acompanhamento comercial" },
      { id: "demo-suporte", name: "Suporte", slug: "demo-suporte", audience: "internal", status: "inactive", isDefault: false, role: "Apoio à equipe" },
    ];
    globalThis.__EMYLEADS_DEV_CALL__ = async (op, args) => {
      if (op === "agents.listar") return agents;
      if (op === "agents.listarSkills") return [];
      return original(op, args);
    };
  });
  const dock = page.getByRole("navigation", { name: "Navegação móvel", exact: true });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("button")).toHaveCount(5);
  await dock.getByRole("button", { name: "Inteligência", exact: true }).click();
  await expect(dock.getByRole("button", { name: "Inteligência", exact: true })).toHaveAttribute("aria-current", "page");
  for (const button of await dock.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await dock.getByRole("button", { name: "Mais seções" }).click();
  const menu = page.getByRole("dialog", { name: "Todas as seções" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Contatos", exact: true }).click();
  await expect(menu).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toBeVisible();
  await dock.getByRole("button", { name: "Inteligência", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Seção", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ativos \(/ })).toBeVisible();
  await page.getByRole("button", { name: /^Ativos \(/ }).click();
  await expect(page.locator(".agent-card--inactive")).toHaveCount(0);
  if (await page.locator(".agent-card").count()) {
    await page.locator(".agent-card").first().click();
    await expect(page.getByRole("dialog", { name: /^Configurar / })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: "test-results/inteligencia-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(dock).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/inteligencia-mobile-dark.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(dock).not.toBeVisible();
  await expect(page.getByRole("navigation", { name: "Seções da Inteligência" })).toBeVisible();
  await page.screenshot({ path: "test-results/inteligencia-desktop.png", fullPage: true });
});
