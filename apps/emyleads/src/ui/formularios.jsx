import { useState } from "react";
import { api } from "../data/client";

/**
 * Os formulários de criação, ancorados.
 *
 * Abrem no rodapé de quem os chamou, não em modal. Modal cobriria a conversa —
 * que é justamente o que se está lendo para decidir o que escrever.
 *
 * Vive em `ui/` pelo mesmo motivo que `atendimento.js`: duas superfícies pedem
 * a mesma coisa. O painel dentro do WhatsApp abre estes formulários no rodapé
 * dele, e a tela de Conversas abre os mesmos no rodapé dela. `page/` não
 * importa de `content/`, e essa fronteira é o que mantém a Gestão viva fora da
 * aba do WhatsApp — então o que os dois usam desce para cá em vez de ser
 * copiado.
 */

const DIA = 24 * 60 * 60 * 1000;

/** 9h do dia N — hora comercial, não meia-noite. */
function noDia(emDias) {
  const d = new Date(Date.now() + emDias * DIA);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** Prazos como se fala, não como se digita. */
const PRAZOS = [
  { id: "hoje", rotulo: "Hoje", ms: () => noDia(0) },
  { id: "amanha", rotulo: "Amanhã", ms: () => noDia(1) },
  { id: "tres", rotulo: "+3 dias", ms: () => noDia(3) },
  { id: "semana", rotulo: "+1 semana", ms: () => noDia(7) },
  { id: "sem", rotulo: "Sem data", ms: () => null },
];

const ENTRADA =
  "w-full rounded-el border border-line bg-bg px-2 py-1.5 text-[12.5px] text-fg placeholder:text-faint outline-none transition-colors focus:border-accent";

function Moldura({ titulo, children, aoFechar, aoSalvar, podeSalvar }) {
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await aoSalvar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form
      onSubmit={enviar}
      className="flex flex-none flex-col gap-2 border-t border-line bg-bg px-3 py-2.5 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
    >
      <div className="text-[11px] font-semibold text-fg">{titulo}</div>
      {children}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={salvando || !podeSalvar}
          className="cursor-pointer rounded-el bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={aoFechar}
          className="cursor-pointer rounded-el px-2 py-1.5 text-[12px] text-sub transition-colors hover:text-fg"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function NovaTarefa({ contactId, textoInicial = "", aoFechar, recarregar }) {
  const [titulo, setTitulo] = useState(textoInicial);
  const [prazo, setPrazo] = useState("amanha");

  const salvar = async () => {
    await api.tarefas.criar({
      contactId,
      titulo: titulo.trim(),
      venceEm: PRAZOS.find((p) => p.id === prazo).ms(),
    });
    await recarregar();
    aoFechar();
  };

  return (
    <Moldura
      titulo="Nova tarefa"
      aoFechar={aoFechar}
      aoSalvar={salvar}
      podeSalvar={!!titulo.trim()}
    >
      <input
        autoFocus
        className={ENTRADA}
        placeholder="O que precisa ser feito?"
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        {PRAZOS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPrazo(p.id)}
            className={`cursor-pointer rounded-full px-2 py-[3px] text-[11px] font-medium transition-colors ${
              prazo === p.id
                ? "bg-accent-soft text-accent-forte"
                : "text-sub hover:bg-surface-hover hover:text-fg"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
    </Moldura>
  );
}

function NovaNota({ contactId, textoInicial = "", aoFechar, recarregar }) {
  const [texto, setTexto] = useState(textoInicial);

  const salvar = async () => {
    await api.notas.criar({ contactId, texto: texto.trim() });
    await recarregar();
    aoFechar();
  };

  return (
    <Moldura
      titulo="Nova nota"
      aoFechar={aoFechar}
      aoSalvar={salvar}
      podeSalvar={!!texto.trim()}
    >
      <textarea
        autoFocus
        rows={3}
        className={`${ENTRADA} resize-y`}
        placeholder="A objeção, o que ficou combinado, o nome do sócio…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
    </Moldura>
  );
}

function NovoNegocio({ contactId, estagios, textoInicial = "", aoFechar, recarregar }) {
  const [titulo, setTitulo] = useState(textoInicial);
  const [valor, setValor] = useState("");

  const salvar = async () => {
    await api.negocios.criar({
      contactId,
      titulo: titulo.trim(),
      valor: valor ? Number(String(valor).replace(/\./g, "").replace(",", ".")) : null,
      stageId: estagios[0]?.id,
    });
    await recarregar();
    aoFechar();
  };

  return (
    <Moldura
      titulo="Novo negócio"
      aoFechar={aoFechar}
      aoSalvar={salvar}
      podeSalvar={!!titulo.trim()}
    >
      <input
        autoFocus
        className={ENTRADA}
        placeholder="Ex.: Site institucional"
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
      />
      <input
        className={ENTRADA}
        inputMode="decimal"
        placeholder="Valor (opcional)"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />
    </Moldura>
  );
}

/** Formulário aberto, ancorado no rodapé de quem chamou. */
export function Formularios({ qual, contactId, estagios, textoInicial = "", aoFechar, recarregar }) {
  if (!qual) return null;
  // `textoInicial` existe para o campo único do painel: quem começou a
  // escrever ali e percebeu que precisa de prazo, valor ou estágio abre o
  // formulário completo sem perder o que já digitou.
  const props = { contactId, estagios, textoInicial, aoFechar, recarregar };
  if (qual === "tarefa") return <NovaTarefa {...props} />;
  if (qual === "nota") return <NovaNota {...props} />;
  if (qual === "negocio") return <NovoNegocio {...props} />;
  return null;
}
