import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCheck,
  ChevronDown,
  Clock3,
  Headset,
  MessageSquareText,
  Mic,
  Paperclip,
  Pin,
  SendHorizontal,
  Smile,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { EXPLICACAO_DO_DONO, OPCOES_DE_DONO, textoDoDono } from "../../../ui/atendimento";
import { Iniciais } from "../../ui";

/**
 * As peças da conversa.
 *
 * Vieram do desenho em `docs/design/conversas/Main.dc.html`, e o que veio do
 * WhatsApp veio de propósito: linha de duas linhas com a divisória começando
 * depois do avatar, hora e ticks dentro da bolha, canto sem raio só na
 * primeira ponta, divisor de data, faixa de não lidas.
 *
 * O que NÃO veio é o verde. Aqui verde é sucesso e roxo é a marca — o contador
 * de não lidas é roxo, e é isso que impede o produto de virar extensão visual
 * do WhatsApp. Está escrito no `theme.css` e vale aqui.
 *
 * A bolha de saída usa `accent-soft`, e não o roxo cheio: numa conversa de
 * trinta mensagens uma parede de accent não se lê.
 */

/** O dono aparece como selo no canto do avatar — é o dado que decide se você precisa abrir. */
export const ICONE_DO_DONO = { bot: Bot, ia: Sparkles, humano: Headset };
const FUNDO_DO_DONO = { bot: "bg-sub", ia: "bg-accent", humano: "bg-success" };
const TEXTO_DO_DONO = { bot: "text-sub", ia: "text-accent", humano: "text-success" };
const TOM_DO_AUTOR = { bot: "text-sub", ia: "text-accent-forte", humano: "text-accent" };

export function AvatarComDono({ nome, dono, grupo = false, tamanho = 46 }) {
  // Grupo mostra o selo de grupo, e não o de dono: um grupo não tem
  // atendimento atribuído, e um selo de robô ali afirmaria que tem.
  const Icone = grupo ? Users : ICONE_DO_DONO[dono];
  const selo = Math.round(tamanho * 0.37);
  return (
    <span className="relative flex-none self-center">
      <Iniciais nome={nome} tamanho={tamanho} />
      {Icone && (
        <span
          title={grupo ? "Grupo" : textoDoDono(dono)}
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-bg text-white ${
            grupo ? "bg-faint" : FUNDO_DO_DONO[dono]
          }`}
          style={{ width: selo, height: selo }}
        >
          <Icone size={Math.round(selo * 0.58)} strokeWidth={2.6} />
        </span>
      )}
    </span>
  );
}

/** Roxo quando lido, e não azul: a cor de "chegou" aqui é a da marca. */
export function Ticks({ lido }) {
  return (
    <CheckCheck
      size={15}
      strokeWidth={2}
      className={`flex-none ${lido ? "text-accent" : "text-faint"}`}
    />
  );
}

export function LinhaConversa({ conversa, ativa, aoAbrir }) {
  const naoLidas = conversa.naoLidas > 0;
  return (
    <button
      onClick={aoAbrir}
      className={`flex w-full cursor-pointer items-stretch gap-[11px] px-3 text-left transition-colors ${
        ativa ? "bg-accent-soft" : "hover:bg-surface"
      }`}
    >
      <AvatarComDono nome={conversa.nome} dono={conversa.dono} grupo={conversa.grupo} />
      {/* A divisória mora nesta coluna, e não na linha: é o que faz ela começar
          depois do avatar em vez de cortar a lista de ponta a ponta. */}
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-[3px] border-b border-line py-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-fg">{conversa.nome}</span>
          {/* O nome de quem assumiu, na própria linha: é o dado que decide se
              esta conversa é sua ou da colega, e ele não pode exigir abrir. */}
          {conversa.atendenteNome && (
            <span className="flex-none rounded-full bg-success/12 px-1.5 py-px text-[10px] font-semibold text-success">
              {conversa.atendenteNome}
            </span>
          )}
          {conversa.fixado && <Pin size={12} strokeWidth={2} className="flex-none text-faint" />}
          <span
            className={`ml-auto flex-none text-[11px] tabular-nums ${
              naoLidas ? "font-semibold text-accent-forte" : "text-faint"
            }`}
          >
            {conversa.hora}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {conversa.saiu && <Ticks lido={conversa.lido} />}
          <span className="truncate text-[12.5px] text-sub">{conversa.previa}</span>
          {naoLidas && (
            <span className="ml-auto flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full bg-accent px-1.5 text-[10.5px] font-bold tabular-nums text-white">
              {conversa.naoLidas}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function DivisorData({ texto }) {
  return (
    <div className="mb-1 mt-3 flex justify-center">
      <span className="rounded-full border border-line bg-bg px-2.5 py-1 text-[10.5px] font-bold tracking-[.07em] text-faint">
        {texto}
      </span>
    </div>
  );
}

export function FaixaNaoLidas({ texto }) {
  return (
    <div className="mx-1 mb-1 mt-4 flex items-center gap-2.5">
      <span className="h-px flex-1 bg-accent/30" />
      <span className="text-[9.5px] font-bold uppercase tracking-[.09em] text-accent-forte">
        {texto}
      </span>
      <span className="h-px flex-1 bg-accent/30" />
    </div>
  );
}

export function PilulaSistema({ dono, texto }) {
  const Icone = ICONE_DO_DONO[dono] || Bot;
  return (
    <div className="mb-1 mt-3 flex justify-center">
      <span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1 text-[10.5px] text-sub">
        <Icone size={12} strokeWidth={2} className={`flex-none ${TEXTO_DO_DONO[dono] || "text-sub"}`} />
        {texto}
      </span>
    </div>
  );
}

export function Bolha({ mensagem, nomeProprio }) {
  const saiu = mensagem.direcao === "sai";
  const autor = mensagem.autor || (saiu && mensagem.tom === "humano" ? nomeProprio : null);
  return (
    <div className={`mt-1.5 flex ${saiu ? "justify-end" : ""}`}>
      <div
        className={`relative max-w-[78%] rounded-[12px] px-2.5 py-[7px] text-[13px] leading-[19px] ${
          saiu
            ? "rounded-tr-[4px] border border-accent/25 bg-accent-soft"
            : "rounded-tl-[4px] border border-line bg-bg"
        } text-fg`}
      >
        {autor && (
          <span className={`block text-[10.5px] font-semibold ${TOM_DO_AUTOR[mensagem.tom] || "text-accent"}`}>
            {autor}
          </span>
        )}
        {mensagem.cita && (
          <span className="mb-1 block rounded-[5px] border-l-[3px] border-accent bg-accent/[0.07] px-2 py-1">
            <span className="block text-[10.5px] font-semibold text-accent-forte">
              {mensagem.cita.quem}
            </span>
            <span className="block truncate text-[11.5px] text-sub">{mensagem.cita.texto}</span>
          </span>
        )}
        <span className="whitespace-pre-wrap">{mensagem.texto}</span>
        {/* Espaço reservado para a hora não sentar em cima da última palavra. */}
        <span className={`inline-block h-px ${saiu ? "w-[58px]" : "w-10"}`} />
        <span className="absolute bottom-1.5 right-2.5 flex items-center gap-[3px] text-[10.5px] tabular-nums text-faint">
          {mensagem.hora}
          {/* Três estados, e não dois. Entre "escrevi" e "chegou" existe a fila
              do runtime, e ela dura segundos: sem o relógio, quem escreveu não
              distingue a mensagem a caminho da que o Bridge recusou, e escreve
              de novo. O tique só aparece quando a mensagem voltou do aparelho. */}
          {saiu && mensagem.falhou && (
            <AlertCircle size={13} strokeWidth={2.2} className="flex-none text-danger" />
          )}
          {saiu && mensagem.enviando && (
            <Clock3 size={13} strokeWidth={2.2} className="flex-none text-faint" />
          )}
          {saiu && !mensagem.enviando && !mensagem.falhou && <Ticks lido={mensagem.lido} />}
        </span>
      </div>
    </div>
  );
}

/**
 * Fecha o menu ao clicar fora ou apertar Esc.
 *
 * Um menu que só fecha pelo próprio botão fica aberto por cima da conversa
 * quando a pessoa desiste e vai ler outra coisa — que é o que ela faz.
 */
function useFechaFora(aberto, fechar) {
  const caixa = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const foraDaCaixa = (e) => {
      if (caixa.current && !caixa.current.contains(e.target)) fechar();
    };
    const aoTeclar = (e) => e.key === "Escape" && fechar();
    document.addEventListener("mousedown", foraDaCaixa);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", foraDaCaixa);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto, fechar]);
  return caixa;
}

/**
 * A faixa de quem responde esta conversa.
 *
 * Os três donos e as três frases vêm de `ui/atendimento.js` — os mesmos que a
 * tela de Conexões e a faixa dentro do WhatsApp mostram. Reescrever o texto
 * aqui criaria uma quarta versão da mesma explicação para manter em dia.
 *
 * "Atendente" ganhou um menu porque, numa equipe de duas pessoas, ele responde
 * a pergunta errada: quem olha precisa saber se é ela mesma ou a colega, e
 * "Atendente" serve igual para as duas. Escolher a pessoa continua sendo
 * opcional — "Alguém assume" é o que um fluxo diz quando pede gente sem saber
 * quem, e recusar isso deixaria a conversa presa esperando um nome.
 *
 * Grupo não tem faixa: o árbitro da VPS chaveia atendimento por telefone, e a
 * pergunta "quem assumiu este grupo?" não existe no modelo dele. Oferecer o
 * botão e recusar depois seria pior que não oferecer.
 */
export function FaixaAtendimento({ dono, atendenteNome, equipe = [], grupo = false, aoTrocar }) {
  const [menu, setMenu] = useState(false);
  const caixa = useFechaFora(menu, () => setMenu(false));

  if (grupo) {
    return (
      <div className="flex flex-none items-center gap-2.5 border-t border-line bg-bg px-3.5 py-2">
        <Users size={14} strokeWidth={1.8} className="flex-none text-faint" />
        <span className="min-w-0 truncate text-[11.5px] text-sub">
          Conversa de grupo. Nenhum automatismo atende grupo, e ninguém assume um.
        </span>
      </div>
    );
  }

  const escolher = (id, atendenteId = null) => {
    setMenu(false);
    aoTrocar(id, atendenteId);
  };

  return (
    <div className="flex flex-none items-center gap-2.5 border-t border-line bg-bg px-3.5 py-2">
      <Headset size={14} strokeWidth={1.8} className="flex-none text-faint" />
      <span className="hidden flex-none text-[11.5px] text-faint lg:block">Atendimento</span>
      <span className="flex flex-none gap-0.5 rounded-[9px] border border-line bg-surface p-0.5">
        {OPCOES_DE_DONO.map((opcao) => {
          const Icone = ICONE_DO_DONO[opcao.id];
          const ativo = opcao.id === dono;
          const humano = opcao.id === "humano";
          const rotulo = humano && ativo && atendenteNome ? atendenteNome : opcao.rotulo;
          return (
            <span key={opcao.id} className="relative" ref={humano ? caixa : null}>
              <button
                onClick={() => (humano ? setMenu((v) => !v) : escolher(opcao.id))}
                title={EXPLICACAO_DO_DONO[opcao.id]}
                className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 py-1 text-[11px] transition-colors ${
                  ativo
                    ? "bg-bg font-semibold text-fg shadow-[0_1px_2px_rgba(18,23,48,.12)]"
                    : "font-medium text-sub hover:text-fg"
                }`}
              >
                <Icone size={12} strokeWidth={2} />
                {rotulo}
                {humano && <ChevronDown size={11} strokeWidth={2.4} className="text-faint" />}
              </button>

              {humano && menu && (
                <span className="absolute bottom-full left-0 z-20 mb-1.5 flex w-56 flex-col overflow-hidden rounded-[10px] border border-line bg-bg py-1 shadow-[0_10px_30px_rgba(18,23,48,.16)]">
                  <span className="px-3 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-faint">
                    Quem assume
                  </span>
                  {equipe.map((pessoa) => (
                    <button
                      key={pessoa.id}
                      onClick={() => escolher("humano", pessoa.id)}
                      className="cursor-pointer px-3 py-1.5 text-left text-[12px] text-fg transition-colors hover:bg-surface-hover"
                    >
                      {pessoa.nome}
                    </button>
                  ))}
                  <button
                    onClick={() => escolher("humano")}
                    className="cursor-pointer border-t border-line px-3 py-1.5 text-left text-[12px] text-sub transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    Alguém assume
                    <span className="block text-[10.5px] text-faint">
                      Tira os automatismos sem dizer quem responde
                    </span>
                  </button>
                </span>
              )}
            </span>
          );
        })}
      </span>
      <span className="min-w-0 truncate text-[11.5px] text-sub">{EXPLICACAO_DO_DONO[dono]}</span>
    </div>
  );
}

/**
 * A caixa de escrita.
 *
 * Enter envia e Shift+Enter quebra linha, como no WhatsApp. O microfone vira
 * avião quando você digita — são os dois estados do mesmo lugar, e não dois
 * botões disputando espaço.
 *
 * Digitar `/` numa caixa vazia abre as mensagens padrão: é o atalho que
 * dispensa procurar o botão.
 */
export function Composer({
  rascunho,
  aoMudar,
  aoEnviar,
  aba,
  aoAlternarAba,
  aviso,
}) {
  const escrevendo = String(rascunho || "").trim().length > 0;

  const aoTeclar = (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    aoEnviar();
  };

  const aoDigitar = (e) => {
    const valor = e.target.value;
    if (valor === "/") {
      aoMudar("");
      aoAlternarAba("modelos", true);
      return;
    }
    aoMudar(valor);
  };

  const botao = (nome, Icone, titulo) => (
    <button
      onClick={() => aoAlternarAba(nome)}
      title={titulo}
      className={`flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[9px] transition-colors ${
        aba === nome ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover hover:text-fg"
      }`}
    >
      <Icone size={18} strokeWidth={1.9} />
    </button>
  );

  return (
    <div className="flex-none bg-bg px-3.5 pb-3.5 pt-2.5">
      <div className="flex items-end gap-1.5 rounded-[14px] border border-line bg-bg px-1.5 py-1 shadow-[0_6px_22px_rgba(18,23,48,.06)]">
        <button
          title="Anexar — ainda sem envio de arquivo"
          disabled
          className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-sub opacity-40"
        >
          <Paperclip size={18} strokeWidth={1.9} />
        </button>
        {botao("modelos", MessageSquareText, "Mensagens padrão")}
        {botao("atalhos", Zap, "Atalhos rápidos")}
        <textarea
          rows={1}
          value={rascunho}
          onChange={aoDigitar}
          onKeyDown={aoTeclar}
          placeholder="Escreva uma mensagem"
          className="max-h-24 min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-[13.5px] leading-5 text-fg outline-none placeholder:text-faint"
        />
        <button
          title="Emoji — ainda sem seletor"
          disabled
          className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-sub opacity-40"
        >
          <Smile size={18} strokeWidth={1.8} />
        </button>
        {escrevendo ? (
          <button
            onClick={aoEnviar}
            title="Enviar"
            className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-[11px] bg-accent text-white transition-all hover:brightness-110"
          >
            <SendHorizontal size={17} strokeWidth={2} />
          </button>
        ) : (
          <button
            title="Gravar áudio — ainda sem gravação"
            disabled
            className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] text-sub opacity-40"
          >
            <Mic size={18} strokeWidth={1.9} />
          </button>
        )}
      </div>
      <div className="mt-[7px] flex items-center gap-1.5 pl-1 text-[10.5px] text-faint">
        {aviso || (
          <>
            <strong className="font-semibold text-sub">Enter</strong> envia ·{" "}
            <strong className="font-semibold text-sub">Shift+Enter</strong> quebra linha ·{" "}
            <strong className="font-semibold text-sub">/</strong> abre as mensagens padrão
          </>
        )}
      </div>
    </div>
  );
}
