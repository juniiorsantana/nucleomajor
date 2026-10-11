// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  conversas: { analisesDaEmpresa: vi.fn(), analise: vi.fn() },
}));
vi.mock("../../../data/client", () => ({ api }));

import { AnalisesDaEmpresa, quemFoiAnalisado } from "./AnalisesDaEmpresa";
import { textoDaOrigem } from "../conversas/AnaliseDaConversa";

let container;
let root;
const render = async (elemento) => {
  await act(async () => root.render(elemento));
  await act(async () => {});
};

const pronta = (extra) => ({
  kind: "completa",
  status: "done",
  result: { schema_version: "analysis_report.v2", summary: "Lead bom." },
  completed_at: "2026-10-04T12:00:00Z",
  saved_at: "2026-10-04T12:05:00Z",
  ...extra,
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.values(api.conversas).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("De qual WhatsApp e de quem é a análise", () => {
  it("a origem sai sem o número no nome, com o final ao lado", () => {
    expect(textoDaOrigem({ nome: "WhatsApp principal (8362)", final4: "5324" })).toBe("WhatsApp principal · final 5324");
    expect(textoDaOrigem({ nome: "", final4: "5324" })).toBe("final 5324");
    expect(textoDaOrigem(null)).toBe("");
  });

  it("sem contato, mostra só o final do telefone", () => {
    expect(quemFoiAnalisado({ contatoId: "k1", nomeDoContato: "Rodrigo" })).toBe("Rodrigo");
    expect(quemFoiAnalisado({ contatoId: null, telefone: "5511988887777" })).toBe("Sem contato · •••• 7777");
    expect(quemFoiAnalisado({ contatoId: null, telefone: "" })).toBe("Sem contato");
  });
});

describe("Análises das conversas em Relatórios", () => {
  it("lista as prontas da empresa, inclusive sem contato, e abre o relatório sem a conversa", async () => {
    api.conversas.analisesDaEmpresa.mockResolvedValue([
      pronta({ id: "a1", contact_id: "k1", contact_name: "Rodrigo Alves", contact_phone: "5565999990001",
        connection_id: null, connection_name: "WhatsApp principal (8362)", connection_last4: "5324" }),
      pronta({ id: "a2", contact_id: null, contact_name: "", contact_phone: "5511988887777", saved_at: null }),
    ]);
    api.conversas.analise.mockResolvedValue({
      analysisId: "a1", kind: "completa", status: "done", result: { schema_version: "analysis_report.v2", summary: "Lead bom." },
      completedAt: "2026-10-04T12:00:00Z", savedAt: "2026-10-04T12:05:00Z",
      report: { schema_version: "analysis.v2", kind: "completa", vendedor_score: null, lead_score: null, matrix: { key: "sem_conclusao" }, diagnosis: { summary: "Lead bom." }, red_flags: [] },
    });
    await render(<AnalisesDaEmpresa />);

    const texto = container.textContent;
    expect(texto).toContain("Rodrigo Alves");
    expect(texto).toContain("WhatsApp principal · final 5324");
    expect(texto).toContain("Sem contato · •••• 7777");
    expect(texto).toContain("Rascunho");

    const item = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Rodrigo Alves"));
    await act(async () => item.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => {});
    expect(api.conversas.analise).toHaveBeenCalledWith({ analiseId: "a1" });
    const dialogo = document.body.querySelector('[role="dialog"]');
    expect(dialogo.textContent).toContain("Pelo WhatsApp WhatsApp principal · final 5324");
    expect(document.body.textContent).not.toContain("Analisar conversa");
  });

  it("vazia e com erro, cada uma diz o que houve", async () => {
    api.conversas.analisesDaEmpresa.mockResolvedValue([]);
    await render(<AnalisesDaEmpresa />);
    expect(container.textContent).toContain("Nenhuma análise de conversa ainda.");

    act(() => root.unmount());
    root = createRoot(container);
    api.conversas.analisesDaEmpresa.mockRejectedValue(new Error("Não foi possível carregar as análises."));
    await render(<AnalisesDaEmpresa />);
    expect(container.querySelector('[role="alert"]').textContent).toContain("Não foi possível carregar as análises.");
  });
});
