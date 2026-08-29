import { describe, expect, it, vi } from "vitest";
import { criarOperacoesConhecimento } from "./knowledgeProvider.js";
import { WORKSPACE_KEY } from "./storage.js";

const ORGANIZATION_ID = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const USER_ID = "877792e8-21a0-4240-8f3a-9a93540342c8";

function bancada() {
  const rpc = vi.fn(async () => ({
    data: {
      id: "7fdc8d7f-6ce7-4dd8-9d2d-174b38f63e4f",
      organization_id: ORGANIZATION_ID,
      scope_type: "organization",
      scope_user_id: null,
      path: "atendimento/processo.md",
      title: "Processo de atendimento",
      content_markdown: "# Processo de atendimento\n",
      status: "active",
      audience: "external",
      published_at: "2026-08-28T20:00:00.000Z",
      version: 1,
      created_at: "2026-08-28T20:00:00.000Z",
      updated_at: "2026-08-28T20:00:00.000Z",
      updated_by: USER_ID,
    },
    error: null,
  }));
  const supabase = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: USER_ID } } }, error: null })) },
    rpc,
    from: vi.fn(() => { throw new Error("salvar não deve escrever tabelas diretamente"); }),
  };
  const area = { get: vi.fn(async () => ({ [WORKSPACE_KEY]: ORGANIZATION_ID })) };
  return { operacoes: criarOperacoesConhecimento({ supabase, area }), rpc, supabase };
}

describe("conhecimento.salvar", () => {
  it("envia documento e coleções para uma única RPC transacional", async () => {
    const { operacoes, rpc, supabase } = bancada();
    const salvo = await operacoes["conhecimento.salvar"]({
      escopo: "organization",
      caminho: "atendimento/processo.md",
      titulo: "Processo de atendimento",
      conteudo: "# Processo de atendimento\n",
      audiencia: "external",
      colecoesIds: ["colecao-1", "colecao-1", "colecao-2"],
      publicado: true,
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("nucleo_knowledge_save", expect.objectContaining({
      target_organization: ORGANIZATION_ID,
      target_document: null,
      document_scope: "organization",
      document_audience: "external",
      collection_ids: ["colecao-1", "colecao-2"],
      publish_document: true,
    }));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(salvo).toMatchObject({
      titulo: "Processo de atendimento",
      audiencia: "external",
      publicadoEm: "2026-08-28T20:00:00.000Z",
    });
  });
});
