// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * De ponta a ponta: o hook de verdade sobre o provider de verdade, contra um
 * banco falso que segue o contrato da escala (changed_at e a RPC
 * `nucleo_conversation_list`). Prova o que nenhum dos dois prova sozinho: o
 * aviso de realtime não relê a lista inteira e a conversa aberta pede só o
 * delta.
 */

const ORG = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const CONEXAO = "0f2a1b6c-9d3e-4f18-a5c7-2b8e6d4a1c90";
const T0 = Date.parse("2026-10-20T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const t = (v) => (v ? new Date(v).getTime() : NaN);

const banco = vi.hoisted(() => ({ conversas: [], mensagens: [], rpcs: [], consultas: [], ops: null }));

vi.mock("../../../data/client", () => ({
  api: {
    conversas: new Proxy({}, { get: (_alvo, nome) => (args) => banco.ops[`conversas.${String(nome)}`](args) }),
    organizacoes: { membros: async () => [] },
    gateway: { ativarRealtime: async () => ({ ativo: true, inscrito: true }) },
  },
}));

globalThis.__EMYLEADS_PLATFORM__ = "web";

const { criarOperacoesConversasWeb } = await import("../../../web/conversasProvider.js");
const { WORKSPACE_KEY } = await import("../../../web/storage.js");
const { useConversas } = await import("./useConversas");

function supabaseFalso() {
  const from = (tabela) => {
    const pedido = { tabela, campos: "", filtros: [], maiores: [], ordem: null, limite: null };
    banco.consultas.push(pedido);
    const consulta = {
      select: (c) => ((pedido.campos = c), consulta),
      eq: (c, v) => (pedido.filtros.push([c, v]), consulta),
      is: (c, v) => (pedido.filtros.push([c, v]), consulta),
      gt: (c, v) => (pedido.maiores.push([c, v]), consulta),
      order: (c, o) => ((pedido.ordem = [c, o]), consulta),
      limit: (n) => ((pedido.limite = n), consulta),
      then: (ok, falha) => {
        let linhas = banco.mensagens.filter((l) => pedido.filtros.every(([c, v]) => l[c] === v));
        for (const [c, v] of pedido.maiores) linhas = linhas.filter((l) => t(l[c]) > t(v));
        const [col, { ascending }] = pedido.ordem;
        linhas = [...linhas].sort((a, b) => (ascending ? 1 : -1) * (t(a[col]) - t(b[col]))).slice(0, pedido.limite);
        return Promise.resolve({ data: linhas, error: null }).then(ok, falha);
      },
    };
    return consulta;
  };
  const rpc = async (nome, args) => {
    banco.rpcs.push([nome, args]);
    const desde = args.changed_since ? t(args.changed_since) : null;
    const linhas = banco.conversas
      .filter((c) => desde === null || t(c.changed_at) > desde)
      .sort((a, b) => (desde === null ? t(b.last_message_at) - t(a.last_message_at) : t(a.changed_at) - t(b.changed_at)));
    return { data: linhas.slice(0, args.max_rows), error: null };
  };
  const storage = { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) };
  return { from, rpc, storage };
}

const conversa = (telefone, em, extra = {}) => ({
  connection_id: CONEXAO,
  contact_phone: telefone,
  chat_kind: "pessoa",
  contact_name: `Cliente ${telefone.slice(-2)}`,
  last_message_preview: "oi",
  last_message_at: iso(em),
  unread_count: 0,
  owner: "bot",
  changed_at: iso(em),
  contact_id: null,
  ...extra,
});

const mensagem = (telefone, id, em) => ({
  organization_id: ORG,
  connection_id: CONEXAO,
  contact_phone: telefone,
  message_id: id,
  content: `texto ${id}`,
  sent_at: iso(em),
  is_from_me: false,
  changed_at: iso(em),
});

let container;
let root;
let estado;
function Harness() {
  estado = useConversas(ORG);
  return null;
}
const drenar = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  banco.conversas = [];
  banco.mensagens = [];
  banco.rpcs = [];
  banco.consultas = [];
  banco.ops = criarOperacoesConversasWeb({
    supabase: supabaseFalso(),
    area: { get: async () => ({ [WORKSPACE_KEY]: ORG }) },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("hook e provider juntos", () => {
  it("o aviso com a chave pede só o delta e só a conversa que mudou", async () => {
    banco.conversas.push(conversa("5511900000001", T0 - 60_000), conversa("5511900000002", T0 - 30_000));
    banco.mensagens.push(mensagem("5511900000002", "m1", T0 - 30_000));
    await act(async () => root.render(<Harness />));
    await drenar();
    await drenar();
    expect(estado.atual).toBe(`${CONEXAO}:5511900000002`);
    expect(estado.mensagens.filter((m) => m.tipo === "mensagem").map((m) => m.messageId)).toEqual(["m1"]);
    const rpcsAntes = banco.rpcs.length;
    const consultasAntes = banco.consultas.length;

    // Chega mensagem na conversa que NÃO está aberta.
    banco.conversas[0] = conversa("5511900000001", T0 + 10_000, { last_message_preview: "nova" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("emyleads:connections-changed", {
        detail: { organizationId: ORG, topic: "conversas", entityId: CONEXAO, entityKeys: ["5511900000001"] },
      }));
    });
    await drenar();

    const novos = banco.rpcs.slice(rpcsAntes);
    expect(novos).toHaveLength(1);
    expect(novos[0][1].changed_since).not.toBeNull();
    // A conversa aberta não foi relida, e nenhuma tabela inteira foi lida.
    expect(banco.consultas.slice(consultasAntes)).toEqual([]);
    expect(estado.conversas[0]).toMatchObject({ telefone: "5511900000001", previa: "nova" });
    expect(estado.atual).toBe(`${CONEXAO}:5511900000002`);

    // Agora na aberta: só as mensagens depois do cursor.
    banco.conversas[1] = conversa("5511900000002", T0 + 20_000);
    banco.mensagens.push(mensagem("5511900000002", "m2", T0 + 20_000));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("emyleads:connections-changed", {
        detail: { organizationId: ORG, topic: "conversas", entityId: CONEXAO, entityKeys: ["5511900000002"] },
      }));
    });
    await drenar();
    const ultima = banco.consultas.at(-1);
    expect(ultima.maiores).toHaveLength(1);
    expect(ultima.maiores[0][0]).toBe("changed_at");
    expect(estado.mensagens.filter((m) => m.tipo === "mensagem").map((m) => m.messageId)).toEqual(["m1", "m2"]);
  });
});
