import { describe, expect, it } from "vitest";
import {
  FASES,
  conexaoPrincipal,
  haQuanto,
  mensagemDoPareamento,
  nomeSemNumero,
  resumirConexao,
  textoDoSinal,
} from "./estadoDaConexao";

const AGORA = Date.parse("2026-09-11T19:20:00Z");

function conexao(status, extra = {}) {
  return {
    connectionId: "c1",
    runtime: "online",
    remoteManaged: true,
    expectedPhoneMasked: "+55 65 •••• 8362",
    connection: { status },
    controlPlane: { heartbeat_at: "2026-09-11T19:19:48Z", fresh: true },
    ...extra,
  };
}

describe("resumirConexao", () => {
  it("conectado é sucesso e nunca oferece conectar de novo", () => {
    const r = resumirConexao(conexao("connected", { connection: { status: "connected", updatedAt: "2026-09-11T19:16:00Z" } }), AGORA);
    expect(r.fase).toBe(FASES.CONECTADO);
    expect(r.selo).toBe("Conectado");
    expect(r.detalhe).toBe("Última atividade há 4 min.");
    expect(r.podeConectar).toBe(false);
    expect(r.sinal).toBe("Sinal da VPS há 12 s");
  });

  it("aguardando QR diz o número que precisa ler o código", () => {
    const r = resumirConexao(conexao("awaiting_qr"), AGORA);
    expect(r.fase).toBe(FASES.PAREANDO);
    expect(r.titulo).toBe("Leia o QR com o celular do número final 8362.");
    expect(r.podeConectar).toBe(true);
    expect(r.qrExpirado).toBe(false);
  });

  it("código expirado pede um novo, na mesma fase", () => {
    const r = resumirConexao(conexao("qr_expired"), AGORA);
    expect(r.fase).toBe(FASES.PAREANDO);
    expect(r.selo).toBe("Código expirado");
    expect(r.qrExpirado).toBe(true);
  });

  it("sessão encerrada ou ausente é desconectado, com convite para conectar", () => {
    for (const status of ["logged_out", "whatsapp_disconnected", "", undefined]) {
      const r = resumirConexao(conexao(status), AGORA);
      expect(r.fase).toBe(FASES.DESCONECTADO);
      expect(r.podeConectar).toBe(true);
    }
  });

  it("runtime parado vence a sessão: não se afirma conectado com sinal velho", () => {
    // Em 08/09/2026 o número ficou 23 horas mudo com a tela toda verde.
    const r = resumirConexao(
      conexao("connected", { runtime: "runtime_offline", controlPlane: { heartbeat_at: "2026-09-10T19:20:00Z", fresh: false } }),
      AGORA
    );
    expect(r.fase).toBe(FASES.RUNTIME_PARADO);
    expect(r.tom).toBe("erro");
    expect(r.detalhe).toMatch(/último estado conhecido era conectado/);
    expect(r.sinal).toBe("Sem sinal da VPS desde 24 h");
    expect(r.podeConectar).toBe(false);
  });

  it("número divergente vence tudo e bloqueia conectar", () => {
    const r = resumirConexao(conexao("identity_mismatch", { connection: { status: "identity_mismatch", phoneMasked: "+55 65 •••• 1111" } }), AGORA);
    expect(r.fase).toBe(FASES.DIVERGENTE);
    expect(r.numero).toBe("+55 65 •••• 1111");
    expect(r.detalhe).toContain("Esperava +55 65 •••• 8362");
    expect(r.podeConectar).toBe(false);
  });
});

describe("haQuanto e textoDoSinal", () => {
  it("escolhe a unidade pelo tamanho do intervalo", () => {
    expect(haQuanto("2026-09-11T19:19:48Z", AGORA)).toBe("há 12 s");
    expect(haQuanto("2026-09-11T19:05:00Z", AGORA)).toBe("há 15 min");
    expect(haQuanto("2026-09-11T14:20:00Z", AGORA)).toBe("há 5 h");
    expect(haQuanto("2026-09-05T19:20:00Z", AGORA)).toBe("há 6 dias");
    expect(haQuanto(null, AGORA)).toBe("");
    expect(haQuanto("não é data", AGORA)).toBe("");
  });

  it("sem heartbeat não inventa sinal", () => {
    expect(textoDoSinal(null)).toBe("");
    expect(textoDoSinal({ heartbeat_at: null, fresh: true })).toBe("");
  });
});

describe("conexaoPrincipal", () => {
  it("prefere a remota e cai na primeira", () => {
    expect(conexaoPrincipal([{ connectionId: "a" }, { connectionId: "b", remoteManaged: true }]).connectionId).toBe("b");
    expect(conexaoPrincipal([{ connectionId: "a" }]).connectionId).toBe("a");
    expect(conexaoPrincipal([])).toBeNull();
    expect(conexaoPrincipal(undefined)).toBeNull();
  });
});

describe("nomeSemNumero", () => {
  it("tira o número do fim do nome, que já tem linha própria no cartão", () => {
    expect(nomeSemNumero("WhatsApp principal (8362)")).toBe("WhatsApp principal");
    expect(nomeSemNumero("WhatsApp principal (•••• 8362)")).toBe("WhatsApp principal");
    expect(nomeSemNumero("Comercial - 65 99999-8362")).toBe("Comercial");
    expect(nomeSemNumero("Recepção [8362]")).toBe("Recepção");
  });

  it("não mexe no que não é número no fim, nem deixa o nome vazio", () => {
    expect(nomeSemNumero("Comercial")).toBe("Comercial");
    expect(nomeSemNumero("Loja 2")).toBe("Loja 2");
    expect(nomeSemNumero("(8362)")).toBe("(8362)");
    expect(nomeSemNumero("")).toBe("WhatsApp");
  });
});

describe("mensagemDoPareamento", () => {
  const daVps = (mensagem) => Object.assign(new Error(mensagem), { codigo: "pareamento-recusado" });

  it("traduz o código da VPS e a frase da RPC; nunca mostra o código cru", () => {
    expect(mensagemDoPareamento(daVps("pairing_in_progress"))).toContain("Já existe um QR aberto");
    expect(mensagemDoPareamento(daVps("bridge_offline"))).toContain("não respondeu");
    expect(mensagemDoPareamento(Object.assign(new Error("too many pairing requests: 9 in the last 00:01:00"), {
      codigo: "pareamento-nao-enfileirado",
    }))).toContain("Muitos pedidos de QR");
    expect(mensagemDoPareamento(daVps("algo_novo"))).toBe("Não foi possível mostrar o QR agora. Tente de novo em alguns segundos.");
  });

  it("a frase do serviço local já vem em português e passa como veio", () => {
    expect(mensagemDoPareamento(Object.assign(new Error("Vincule esta máquina ao serviço local."), {
      codigo: "gateway-nao-vinculado",
    }))).toBe("Vincule esta máquina ao serviço local.");
  });
});
