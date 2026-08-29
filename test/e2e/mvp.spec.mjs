import { expect, test } from "@playwright/test";

const diaLocal = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
};

test.describe("jornadas essenciais do MVP", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => console.error(`[browser] ${error.message}`));
    page.on("requestfailed", (request) => console.error(`[request] ${request.url()} ${request.failure()?.errorText || "falhou"}`));
  });

  test("cria compromisso pessoal das 20h às 22h", async ({ page }) => {
    await page.goto("/app/dev-gestao.html?tela=agenda");
    await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();

    await page.getByRole("button", { name: /Novo evento/ }).click();
    const dialog = page.getByRole("dialog", { name: /evento/i });
    await dialog.getByLabel("Título").fill("Teste pessoal noturno");
    await dialog.getByLabel("Data").fill(diaLocal());
    await dialog.getByLabel("Começa às").fill("20:00");
    await dialog.getByLabel("Duração").selectOption("120");
    await dialog.getByRole("button", { name: "Pessoal" }).click();
    await dialog.getByRole("button", { name: "Criar evento" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Teste pessoal noturno", { exact: true })).toBeVisible();
  });

  test("cria tarefa e a mantém na fonte compartilhada da bancada", async ({ page }) => {
    await page.goto("/app/dev-gestao.html?tela=tarefas");
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    const dialog = page.getByRole("dialog", { name: "Nova tarefa" });
    await dialog.getByLabel("Título").fill("Revisar jornada do MVP");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Revisar jornada do MVP", { exact: true })).toBeVisible();
  });

  test("abre a base de conhecimento e inicia o fluxo guiado", async ({ page }) => {
    await page.goto("/app/dev-gestao.html?tela=conhecimento");
    await expect(page.getByRole("heading", { name: "Central de Inteligência" })).toBeVisible();
    await page.getByRole("button", { name: "Adicionar conhecimento" }).click();
    const dialog = page.getByRole("dialog", { name: "Adicionar conhecimento" });
    await expect(dialog.getByRole("heading", { name: "O que você quer ensinar?" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Sobre a empresa/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  test("registra uma nota vinculada ao contato", async ({ page }) => {
    await page.goto("/app/dev-gestao.html?tela=contatos");
    await page.getByText("Mariana Costa", { exact: true }).first().click();
    await page.getByRole("button", { name: "Nova" }).last().click();

    const dialog = page.getByRole("dialog", { name: /Nova nota/ });
    await dialog.getByLabel("Anotação").fill("Cliente prefere reuniões no período da noite.");
    await dialog.getByRole("button", { name: "Salvar nota" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Cliente prefere reuniões no período da noite.", { exact: true })).toBeVisible();
  });
});
