// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FichaLateral } from "./ficha";

let container;
let root;

function renderizar(elemento) {
  act(() => root.render(elemento));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const conversa = { id: "c1", nome: "L", telefone: "556596783150", dono: "ia", grupo: false };
const base = {
  conversa,
  contato: null,
  negocio: null,
  estagio: null,
  tarefa: null,
  nota: null,
  etiquetas: [],
  todasEtiquetas: [],
  aoFechar: () => {},
  aoAtalho: () => {},
  aoAbrirFicha: () => {},
  aoSalvarContato: () => {},
  aoAtualizarEtiquetas: async () => {},
  aoCriarEtiqueta: async () => ({}),
};

function interruptor() {
  return container.querySelector('button[role="switch"]');
}

describe("interruptor 'Atendimento pela IA' na ficha", () => {
  it("começa ligado para um contato sem a marca, mesmo sem contato salvo", () => {
    renderizar(<FichaLateral {...base} aoDefinirAtendimentoIA={async () => {}} />);
    expect(interruptor().getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("A IA responde este número");
  });

  it("aparece desligado quando o contato carrega a etiqueta, pelo slug ou pelo nome", () => {
    renderizar(
      <FichaLateral
        {...base}
        contato={{ id: "k1", tags: ["t1"] }}
        etiquetas={[{ id: "t1", nome: "Não atender IA", legacyId: "nao-atender-ia" }]}
        aoDefinirAtendimentoIA={async () => {}}
      />
    );
    expect(interruptor().getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("a IA não responde este número");
  });

  it("o clique pede a inversão do estado atual, levando conversa e contato", async () => {
    const definir = vi.fn(async () => {});
    renderizar(<FichaLateral {...base} aoDefinirAtendimentoIA={definir} />);
    await act(async () => {
      interruptor().click();
    });
    expect(definir).toHaveBeenCalledWith({ conversa, contato: null, atender: false });
  });

  it("mostra o erro do salvamento sem derrubar a ficha", async () => {
    const definir = vi.fn(async () => {
      throw new Error("Sem permissão para editar etiquetas.");
    });
    renderizar(<FichaLateral {...base} aoDefinirAtendimentoIA={definir} />);
    await act(async () => {
      interruptor().click();
    });
    expect(container.textContent).toContain("Sem permissão para editar etiquetas.");
    expect(interruptor().getAttribute("aria-checked")).toBe("true");
  });

  describe("com banco: o estado é o que o banco diz, nunca a cópia local", () => {
    it("13/09/2026: etiqueta só no navegador não aparece como desligado", async () => {
      renderizar(
        <FichaLateral
          {...base}
          contato={{ id: "k1", tags: ["t1"] }}
          etiquetas={[{ id: "t1", nome: "Não atender IA", legacyId: "nao-atender-ia" }]}
          aoConsultarAtendimentoIA={async () => ({ atende: true })}
          aoDefinirAtendimentoIA={async () => ({ atende: false })}
        />
      );
      await act(async () => {});
      expect(interruptor().getAttribute("aria-checked")).toBe("true");
      expect(container.textContent).toContain("A IA responde este número");
    });

    it("marca gravada no banco aparece desligada mesmo sem etiqueta local", async () => {
      renderizar(
        <FichaLateral
          {...base}
          aoConsultarAtendimentoIA={async () => ({ atende: false })}
          aoDefinirAtendimentoIA={async () => ({ atende: true })}
        />
      );
      await act(async () => {});
      expect(interruptor().getAttribute("aria-checked")).toBe("false");
    });

    it("enquanto confere, o interruptor não afirma nada e não aceita clique", async () => {
      const definir = vi.fn(async () => ({ atende: false }));
      renderizar(
        <FichaLateral
          {...base}
          aoConsultarAtendimentoIA={() => new Promise(() => {})}
          aoDefinirAtendimentoIA={definir}
        />
      );
      expect(interruptor().disabled).toBe(true);
      expect(container.textContent).toContain("Conferindo no servidor");
      await act(async () => {
        interruptor().click();
      });
      expect(definir).not.toHaveBeenCalled();
    });

    it("depois de salvar mostra o que o banco gravou, e não o que foi pedido", async () => {
      const definir = vi.fn(async () => ({ atende: true }));
      renderizar(
        <FichaLateral
          {...base}
          aoConsultarAtendimentoIA={async () => ({ atende: true })}
          aoDefinirAtendimentoIA={definir}
        />
      );
      await act(async () => {});
      await act(async () => {
        interruptor().click();
      });
      expect(definir).toHaveBeenCalledWith({ conversa, contato: null, atender: false });
      expect(interruptor().getAttribute("aria-checked")).toBe("true");
    });

    it("se não der para conferir, avisa e continua travado", async () => {
      renderizar(
        <FichaLateral
          {...base}
          aoConsultarAtendimentoIA={async () => {
            throw new Error("Você não faz parte desta empresa.");
          }}
          aoDefinirAtendimentoIA={async () => ({ atende: false })}
        />
      );
      await act(async () => {});
      expect(interruptor().disabled).toBe(true);
      expect(container.textContent).toContain("Você não faz parte desta empresa.");
    });
  });

  it("não existe para grupo: grupo não é contato de ninguém", () => {
    renderizar(
      <FichaLateral
        {...base}
        conversa={{ ...conversa, grupo: true, telefone: "" }}
        aoDefinirAtendimentoIA={async () => {}}
      />
    );
    expect(interruptor()).toBeNull();
  });
});

describe("iniciar fluxo pela ficha", () => {
  const fluxos = [{ id: "f1", nome: "Follow-up 24h" }, { id: "f2", nome: "Reativar" }];
  const contato = { id: "k1", tags: [] };

  it("não aparece sem contato salvo nem sem fluxo manual", () => {
    renderizar(<FichaLateral {...base} fluxosManuais={fluxos} aoIniciarFluxo={async () => {}} />);
    expect(container.textContent).not.toContain("Iniciar fluxo");
    renderizar(<FichaLateral {...base} contato={contato} fluxosManuais={[]} aoIniciarFluxo={async () => {}} />);
    expect(container.textContent).not.toContain("Iniciar fluxo");
  });

  it("inicia o fluxo escolhido para o contato e confirma", async () => {
    const iniciar = vi.fn(async () => ({ enfileirado: true }));
    renderizar(<FichaLateral {...base} contato={contato} fluxosManuais={fluxos} aoIniciarFluxo={iniciar} />);
    const select = container.querySelector('select[aria-label="Fluxo para iniciar"]');
    await act(async () => {
      select.value = "f2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const botao = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Iniciar");
    await act(async () => {
      botao.click();
    });
    expect(iniciar).toHaveBeenCalledWith({ contato, chatbotId: "f2" });
    expect(container.querySelector('[role="status"]').textContent).toContain("“Reativar” vai começar");
  });

  it("mostra a recusa do banco", async () => {
    const iniciar = vi.fn(async () => { throw new Error("Esse fluxo não está mais ativo."); });
    renderizar(<FichaLateral {...base} contato={contato} fluxosManuais={fluxos} aoIniciarFluxo={iniciar} />);
    const botao = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Iniciar");
    await act(async () => {
      botao.click();
    });
    expect(container.querySelector('[role="status"]').textContent).toBe("Esse fluxo não está mais ativo.");
  });
});
