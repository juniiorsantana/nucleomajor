import { useState } from "react";
import {
  CalendarPlus,
  DollarSign,
  Filter,
  MessageSquareText,
  SendHorizontal,
  Shuffle,
  SquareCheckBig,
  StickyNote,
  Tag,
  X,
  Zap,
} from "lucide-react";
import { renderizar, sortearVariacao } from "../../../lib/template";
import { Formularios } from "../../../ui/formularios";

/**
 * As duas folhas que abrem entre a conversa e a caixa de escrita.
 *
 * Abrem ANCORADAS, nunca em modal — o motivo está em `ui/formularios.jsx` e é
 * o mesmo aqui: modal cobre a conversa, que é justamente o que se está lendo
 * para decidir o que escrever.
 */

function Folha({ icone: Icone, titulo, nota, aoFechar, children }) {
  return (
    <div className="flex-none border-t border-line bg-surface px-3.5 pb-3 pt-2.5">
      <div className="flex items-center gap-2">
        <Icone size={15} strokeWidth={1.9} className="flex-none text-accent-forte" />
        <span className="text-[12.5px] font-semibold text-fg">{titulo}</span>
        {nota && <span className="truncate text-[11px] text-faint">{nota}</span>}
        <button
          onClick={aoFechar}
          title="Fechar"
          className="ml-auto flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[9px] text-sub transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X size={15} strokeWidth={2.2} />
        </button>
      </div>
      {children}
    </div>
  );
}

const CHIP = "cursor-pointer whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] transition-colors";
const chipCls = (ativo) =>
  `${CHIP} ${
    ativo
      ? "border-accent bg-accent-soft font-semibold text-accent-forte"
      : "border-line bg-bg font-medium text-sub hover:border-line-strong hover:text-fg"
  }`;

/* ------------------------------------------------------------------ */

/**
 * Mensagens padrão.
 *
 * O texto da prévia sai JÁ RESOLVIDO para quem está do outro lado: quem revisa
 * precisa ler o que o contato vai ler, e não `Oi, {nome}!`. Quem resolve é o
 * `renderizar` de `lib/template.js` — o mesmo das sugestões dentro do
 * WhatsApp.
 *
 * O sorteio também é o código que já existe: `sortearVariacao` tira uma das
 * variações ainda não usadas e só reembaralha quando acabam. O baralho volta
 * para quem chamou porque a função não guarda estado.
 *
 * Dois botões, de propósito: Inserir deixa o texto na caixa para revisar,
 * Enviar agora manda direto.
 */
export function PainelModelos({
  modelos,
  categorias,
  contato,
  aoInserir,
  aoEnviar,
  aoGuardarBaralho,
  aoFechar,
}) {
  const [categoria, setCategoria] = useState("todas");
  const [escolhido, setEscolhido] = useState(null);
  const [variacao, setVariacao] = useState(null);

  const visiveis = modelos.filter((m) => categoria === "todas" || m.categoria === categoria);
  const modelo = modelos.find((m) => m.id === escolhido) || null;
  const textoAtual = variacao
    ? renderizar(variacao.texto, contato)
    : modelo
      ? renderizar(modelo.variacoes[0].texto, contato)
      : "";

  const escolher = (m) => {
    setEscolhido(m.id);
    const sorteio = sortearVariacao(m);
    setVariacao(sorteio.variacao);
    aoGuardarBaralho(m.id, sorteio.baralho);
  };

  const sortear = () => {
    if (!modelo) return;
    const sorteio = sortearVariacao(modelo);
    setVariacao(sorteio.variacao);
    aoGuardarBaralho(modelo.id, sorteio.baralho);
  };

  return (
    <Folha
      icone={MessageSquareText}
      titulo="Mensagens padrão"
      nota="digite / na caixa"
      aoFechar={aoFechar}
    >
      <div className="scrollbar-fina mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
        {categorias.map((c) => (
          <button key={c.id} onClick={() => setCategoria(c.id)} className={chipCls(categoria === c.id)}>
            {c.rotulo}
          </button>
        ))}
      </div>

      <div className="scrollbar-fina mt-2 flex max-h-[150px] flex-col gap-1.5 overflow-y-auto">
        {visiveis.map((m) => {
          const previa = renderizar(
            m.id === escolhido && variacao ? variacao.texto : m.variacoes[0].texto,
            contato
          );
          return (
            <button
              key={m.id}
              onClick={() => escolher(m)}
              className={`flex w-full cursor-pointer items-start gap-2.5 rounded-[10px] border bg-bg px-3 py-2.5 text-left transition-colors ${
                m.id === escolhido ? "border-accent" : "border-line hover:border-accent"
              }`}
            >
              <span className="mt-px flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-surface text-sub">
                <Zap size={14} strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-fg">{m.titulo}</span>
                  <span className="rounded-[4px] bg-accent-soft px-1.5 py-px text-[10px] font-semibold text-accent-forte">
                    {m.variaveis}
                  </span>
                  {m.variacoes.length > 1 && (
                    <span className="flex items-center gap-1 text-[10px] text-faint">
                      <Shuffle size={10} strokeWidth={2} />
                      {m.variacoes.length} variações
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-[17px] text-sub">{previa}</span>
              </span>
            </button>
          );
        })}
      </div>

      {modelo && (
        <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-line bg-bg px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-sub">
            Vai chegar assim: <span className="text-fg">{textoAtual}</span>
          </span>
          {modelo.variacoes.length > 1 && (
            <button
              onClick={sortear}
              title="Sortear outra variação"
              className="flex flex-none cursor-pointer items-center gap-1 rounded-[8px] border border-line px-2 py-1 text-[11px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
            >
              <Shuffle size={12} strokeWidth={2} />
              Sortear
            </button>
          )}
          <button
            onClick={() => aoInserir(textoAtual)}
            className="flex-none cursor-pointer rounded-[8px] border border-line px-2.5 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent-forte"
          >
            Inserir na caixa
          </button>
          <button
            onClick={() => aoEnviar(textoAtual)}
            className="flex flex-none cursor-pointer items-center gap-1 rounded-[8px] bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-all hover:brightness-110"
          >
            <SendHorizontal size={12} strokeWidth={2} />
            Enviar agora
          </button>
        </div>
      )}
    </Folha>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Atalhos rápidos.
 *
 * Seis no desenho, três com formulário de verdade. Tarefa, Nota e Negócio
 * abrem o `Formularios` que o painel do WhatsApp já usa — mesmo formulário,
 * mesma gravação, mesmo lugar no rodapé.
 *
 * Agendar, Mover no funil e Etiqueta continuam no lugar que o desenho deu a
 * eles, mas dizem que ainda não têm para onde escrever. Botão que some é pior
 * que botão que explica: o desenho previu os seis, e esconder três faria a
 * tela mentir sobre o que ela vai ser.
 */
const ATALHOS = [
  { id: "tarefa", rotulo: "Nova tarefa", icone: SquareCheckBig, pronto: true },
  { id: "agenda", rotulo: "Agendar", icone: CalendarPlus, pronto: false },
  { id: "nota", rotulo: "Nota interna", icone: StickyNote, pronto: true },
  { id: "negocio", rotulo: "Novo negócio", icone: DollarSign, pronto: true },
  { id: "funil", rotulo: "Mover no funil", icone: Filter, pronto: false },
  { id: "etiqueta", rotulo: "Etiqueta", icone: Tag, pronto: false },
];

const PENDENTES = {
  agenda: "Agendar ainda não tem rota própria aqui — a Agenda cria o compromisso hoje.",
  funil: "Mover no funil ainda não tem rota própria aqui — o Funil move o negócio hoje.",
  etiqueta: "Etiquetar ainda não tem rota própria aqui — a ficha do contato edita as etiquetas hoje.",
};

export function PainelAtalhos({
  aberto,
  aoAbrir,
  contactId,
  estagios,
  textoInicial,
  recarregar,
  aoFechar,
}) {
  const pendente = PENDENTES[aberto];
  const comFormulario = ATALHOS.find((a) => a.id === aberto)?.pronto;

  return (
    <Folha
      icone={Zap}
      titulo="Atalhos rápidos"
      nota="criam no CRM sem sair da conversa"
      aoFechar={aoFechar}
    >
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {ATALHOS.map((a) => (
          <button
            key={a.id}
            onClick={() => aoAbrir(a.id)}
            className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] border bg-bg px-3 py-2.5 text-left text-[12px] font-medium transition-colors ${
              aberto === a.id
                ? "border-accent text-accent-forte"
                : "border-line text-fg hover:border-accent hover:text-accent-forte"
            }`}
          >
            <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-surface text-sub">
              <a.icone size={14} strokeWidth={1.9} />
            </span>
            {a.rotulo}
          </button>
        ))}
      </div>

      {comFormulario && (
        <div className="mt-2 overflow-hidden rounded-[10px] border border-line">
          <Formularios
            qual={aberto}
            contactId={contactId}
            estagios={estagios}
            textoInicial={aberto === "tarefa" ? textoInicial : ""}
            aoFechar={() => aoAbrir(null)}
            recarregar={recarregar}
          />
        </div>
      )}

      {pendente && (
        <div className="mt-2 rounded-[10px] border border-dashed border-line bg-bg px-3 py-2.5 text-[11.5px] text-sub">
          {pendente}
        </div>
      )}

      <div className="mt-2 text-[10.5px] text-faint">
        Salvar aqui não escreve nada no WhatsApp — só no CRM.
      </div>
    </Folha>
  );
}
