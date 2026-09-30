import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Segmentado } from "./componentes";
import { formatarDuracao, horaLocal } from "./agendaUtils";

const LARGURA = 340;
const MARGEM = 12;

/**
 * Marcar na grade e já escrever o título, sem o formulário inteiro.
 *
 * Arrastar na semana abria o formulário completo — oito campos para anotar
 * "ligar para a Ana às 15h". Aqui aparece um cartão ao lado do horário
 * marcado: título, Enter, pronto. "Mais opções" leva ao formulário com o que
 * já foi digitado. Serve também para tarefa: o mesmo horário vira o prazo.
 *
 * Só no computador. No telefone não há arraste, e o "+" abre direto o
 * formulário em folha, que lá cabe melhor do que um cartão flutuante.
 */
export default function CriacaoRapida({ abertura, salvando, aoSalvar, aoMaisOpcoes, aoFechar }) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("compromisso");
  const [posicao, setPosicao] = useState({ left: -9999, top: -9999 });
  const cartaoRef = useRef(null);
  const entradaRef = useRef(null);

  useLayoutEffect(() => {
    const cartao = cartaoRef.current;
    if (!cartao) return;
    const altura = cartao.offsetHeight;
    const largura = Math.min(LARGURA, window.innerWidth - MARGEM * 2);
    // Ao lado do ponteiro, e virando para o outro lado quando não cabe: na
    // coluna de domingo o cartão à direita sairia da tela.
    let left = (abertura.x ?? window.innerWidth / 2) + 16;
    if (left + largura > window.innerWidth - MARGEM) left = (abertura.x ?? window.innerWidth / 2) - largura - 16;
    left = Math.max(MARGEM, Math.min(left, window.innerWidth - largura - MARGEM));
    let top = (abertura.y ?? window.innerHeight / 2) - altura / 2;
    top = Math.max(MARGEM, Math.min(top, window.innerHeight - altura - MARGEM));
    setPosicao({ left, top });
    entradaRef.current?.focus();
  }, [abertura]);

  useEffect(() => {
    const teclado = (e) => { if (e.key === "Escape") { e.preventDefault(); aoFechar(); } };
    const fora = (e) => { if (cartaoRef.current && !cartaoRef.current.contains(e.target)) aoFechar(); };
    window.addEventListener("keydown", teclado);
    // Um tique depois: o mesmo `pointerup` que abriu o cartão não pode fechá-lo.
    const relogio = setTimeout(() => window.addEventListener("pointerdown", fora), 0);
    return () => {
      clearTimeout(relogio);
      window.removeEventListener("keydown", teclado);
      window.removeEventListener("pointerdown", fora);
    };
  }, [aoFechar]);

  const inicio = new Date(abertura.inicio);
  const duracao = Math.round((new Date(abertura.fim) - inicio) / 60000);
  const dia = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" }).format(inicio).replaceAll(".", "");

  const enviar = (e) => {
    e.preventDefault();
    if (!titulo.trim() || salvando) return;
    aoSalvar({ titulo: titulo.trim(), tipo });
  };

  return (
    <form
      ref={cartaoRef}
      role="dialog"
      aria-label="Criação rápida"
      onSubmit={enviar}
      className="fixed z-50 rounded-[14px] border border-line bg-bg p-3 shadow-[0_12px_40px_rgba(18,23,48,0.22)]"
      style={{ ...posicao, width: Math.min(LARGURA, typeof window === "undefined" ? LARGURA : window.innerWidth - MARGEM * 2) }}
    >
      <div className="flex items-center gap-2">
        <Segmentado
          rotulo="Criar"
          valor={tipo}
          aoMudar={setTipo}
          className="flex-1"
          opcoes={[{ id: "compromisso", rotulo: "Compromisso" }, { id: "tarefa", rotulo: "Tarefa" }]}
        />
        <button type="button" onClick={aoFechar} aria-label="Fechar" className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[8px] text-sub hover:bg-surface-hover hover:text-fg"><X size={16} /></button>
      </div>
      <input
        ref={entradaRef}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        maxLength={240}
        aria-label="Título"
        placeholder={tipo === "tarefa" ? "O que precisa ser feito?" : "Título do compromisso"}
        className="mt-3 min-h-10 w-full rounded-[9px] border border-line bg-bg px-3 text-[14px] font-medium text-fg outline-none focus:border-accent"
      />
      <p className="mt-2 text-[12px] first-letter:uppercase text-sub">
        {dia} · {tipo === "tarefa" ? `prazo às ${horaLocal(inicio)}` : `${horaLocal(inicio)}–${horaLocal(abertura.fim)} (${formatarDuracao(duracao)})`}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => aoMaisOpcoes({ titulo, tipo })} className="min-h-8 cursor-pointer rounded-[8px] px-2 text-[12px] font-semibold text-accent-forte hover:bg-accent-soft">
          Mais opções
        </button>
        <button type="submit" disabled={!titulo.trim() || salvando} className="ml-auto min-h-8 cursor-pointer rounded-[8px] bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-40">
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
