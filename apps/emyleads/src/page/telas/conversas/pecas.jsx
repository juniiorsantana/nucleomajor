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
  RotateCw,
  Smile,
  Sparkles,
  Square,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  EXPLICACAO_DO_DONO,
  OPCOES_DE_DONO,
  textoDoDono,
  textoDoMotivoDeEnvio,
} from "../../../ui/atendimento";
import { Iniciais } from "../../ui";
import { OndaAoVivo, PlayerDeAudio } from "./audio";
import { TextoFormatado } from "./TextoFormatado";

/**
 * As peças da conversa.
 *
 * Vieram do desenho em `docs/design/conversas/Main.dc.html`, e o que veio do
 * WhatsApp veio de propósito: linha de duas linhas com a divisória começando
 * depois do avatar, hora e ticks dentro da bolha, canto sem raio só na
 * primeira ponta, divisor de data, faixa de não lidas.
 *
 * O que NÃO veio é o verde. No Sistema Grafite (02/10/2026) a cor tem dono:
 *   - azul de SINAL para o que é novo, não lido, selecionado e lido;
 *   - a cor do ATOR em tudo que diz quem responde: violeta é a IA, ciano é o
 *     fluxo, grafite é a pessoa. A mesma cor no selo do avatar, na bolha, no
 *     nome de quem escreveu, na pílula de acontecimento e na faixa de
 *     atendimento.
 * Está escrito no `theme.css` e vale aqui.
 */

/** O dono aparece como selo no canto do avatar — é o dado que decide se você precisa abrir. */
export const ICONE_DO_DONO = { bot: Bot, ia: Sparkles, humano: Headset };
// Fundo cheio com `text-bg` em cima: branco no claro, grafite no escuro, e
// passa de 4,5:1 nas duas pontas (o ator escuro no claro, o claro no escuro).
const FUNDO_DO_DONO = { bot: "bg-flow", ia: "bg-ia", humano: "bg-fg" };
const TEXTO_DO_DONO = { bot: "text-flow", ia: "text-ia", humano: "text-fg" };
const TOM_DO_AUTOR = { bot: "text-flow", ia: "text-ia", humano: "text-equipe-sub" };
// A bolha que SAI tem a cor de quem escreveu: a pessoa é o azul profundo da
// conversa (direção A, 03/10/2026), IA e fluxo são o fundo suave do ator.
// Sem `tom` (mensagem antiga), é pessoa.
const BOLHA_DO_AUTOR = {
  bot: "bg-flow-soft text-fg",
  ia: "bg-ia-soft text-fg",
  humano: "bg-equipe text-on-equipe",
};
// O player dentro de cada bolha usa as cores dela.
const TOM_DO_PLAYER = { bot: "bot", ia: "ia", humano: "equipe" };

export function AvatarComDono({ nome, foto = null, dono, grupo = false, tamanho = 46 }) {
  const [fotoCarregavel, setFotoCarregavel] = useState(Boolean(foto));
  useEffect(() => setFotoCarregavel(Boolean(foto)), [foto]);

  // Grupo mostra o selo de grupo, e não o de dono: um grupo não tem
  // atendimento atribuído, e um selo de robô ali afirmaria que tem.
  const Icone = grupo ? Users : ICONE_DO_DONO[dono];
  const selo = Math.round(tamanho * 0.37);
  return (
    <span className="relative flex-none self-center">
      {foto && fotoCarregavel ? (
        <img
          src={foto}
          alt=""
          className="flex-none rounded-full object-cover"
          style={{ width: tamanho, height: tamanho }}
          onError={() => setFotoCarregavel(false)}
        />
      ) : (
        <Iniciais nome={nome} tamanho={tamanho} />
      )}
      {Icone && (
        <span
          title={grupo ? "Grupo" : textoDoDono(dono)}
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-bg text-bg ${
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

/**
 * Lido é azul de sinal: é exatamente o "aqui tem algo" do sistema.
 * `sobreGrafite`: dentro da bolha cheia da pessoa o azul some no fundo, e o
 * sinal claro (`signal-soft`) é o que contrasta nos dois temas.
 */
export function Ticks({ lido, sobreGrafite = false }) {
  const tom = sobreGrafite ? (lido ? "text-equipe-sub" : "text-on-equipe/55") : lido ? "text-signal" : "text-faint";
  return <CheckCheck size={15} strokeWidth={2} className={`flex-none ${tom}`} />;
}

export function LinhaConversa({ conversa, ativa, aoAbrir }) {
  const naoLidas = conversa.naoLidas > 0;
  return (
    <button
      onClick={aoAbrir}
      className={`relative flex w-full cursor-pointer items-stretch gap-[11px] px-3 text-left transition-colors ${
        ativa ? "bg-surface-hover shadow-[inset_2px_0_0_var(--el-signal)]" : "hover:bg-surface"
      }`}
    >
      <AvatarComDono
        nome={conversa.nome}
        foto={conversa.fotoUrl}
        dono={conversa.dono}
        grupo={conversa.grupo}
      />
      {/* A divisória mora nesta coluna, e não na linha: é o que faz ela começar
          depois do avatar em vez de cortar a lista de ponta a ponta. */}
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-[3px] border-b border-line py-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-fg">{conversa.nome}</span>
          {/* O nome de quem assumiu, na própria linha: é o dado que decide se
              esta conversa é sua ou da colega, e ele não pode exigir abrir. */}
          {conversa.atendenteNome && (
            <span className="flex-none rounded-ctl border border-line-strong px-1.5 py-px text-[10px] font-semibold text-fg">
              {conversa.atendenteNome}
            </span>
          )}
          {conversa.fixado && <Pin size={12} strokeWidth={2} className="flex-none text-faint" />}
          <span
            className={`ml-auto flex-none text-[11px] tabular-nums ${
              naoLidas ? "font-semibold text-signal" : "text-faint"
            }`}
          >
            {conversa.hora}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {conversa.saiu && <Ticks lido={conversa.lido} />}
          <span className={`truncate text-[12.5px] ${naoLidas ? "font-medium text-fg" : "text-sub"}`}>{conversa.previa}</span>
          {naoLidas && (
            <span className="ml-auto flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full bg-signal px-1.5 text-[10.5px] font-bold tabular-nums text-on-signal">
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
    <div className="mb-1 mt-4 flex justify-center">
      <span className="rounded-full border border-conversa-linha bg-bolha-entra px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-conversa-sub">
        {texto}
      </span>
    </div>
  );
}

export function FaixaNaoLidas({ texto }) {
  return (
    <div className="mx-1 mb-1 mt-4 flex items-center gap-2.5">
      <span className="h-px flex-1 bg-signal/40" />
      <span className="text-[9.5px] font-bold uppercase tracking-[.09em] text-signal">
        {texto}
      </span>
      <span className="h-px flex-1 bg-signal/40" />
    </div>
  );
}

export function PilulaSistema({ dono, texto, hora }) {
  const Icone = ICONE_DO_DONO[dono] || Bot;
  return (
    <div className="mb-1 mt-3 flex items-center gap-2.5">
      <span className="h-px min-w-3 flex-1 bg-conversa-linha" />
      <span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full bg-bolha-entra/85 px-2.5 py-0.5 text-[11px] text-conversa-sub">
        <Icone size={12} strokeWidth={2} className={`flex-none ${TEXTO_DO_DONO[dono] || "text-sub"}`} />
        {texto}
        {/* A hora fica ao lado, e não em linha própria: a pílula existe para
            ser lida de relance no meio da conversa, e duas linhas a
            transformariam num aviso. */}
        {hora && <span className="flex-none tabular-nums text-conversa-faint">· {hora}</span>}
      </span>
      <span className="h-px min-w-3 flex-1 bg-conversa-linha" />
    </div>
  );
}

/**
 * O aviso de que a mensagem não saiu, e o caminho de volta.
 *
 * O indicador continua do tamanho que era — um ícone de 13px no canto da
 * bolha, ao lado da hora. O que muda é ele passar a responder: antes a bolha
 * dizia "falhou" e o motivo aparecia numa faixa acima do composer, que some na
 * mensagem seguinte. Numa conversa em que duas falharam por motivos
 * diferentes, não havia como saber qual foi qual.
 *
 * O reinício importa mais que o motivo. A maior parte das recusas é
 * temporária — o Bridge estava fora do ar, o runtime não pegou a tempo — e
 * sem "tentar de novo" a saída é reescrever o texto e mandar outra vez, com o
 * cliente esperando.
 */
function AvisoDeFalha({ motivo, aoReenviar }) {
  const [aberto, setAberto] = useState(false);
  const texto = textoDoMotivoDeEnvio(motivo);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={texto}
        aria-label={`Não enviada: ${texto}`}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        onBlur={() => setAberto(false)}
        className="flex cursor-pointer items-center text-danger"
      >
        <AlertCircle size={13} strokeWidth={2.2} className="flex-none" />
      </button>
      {aberto && (
        <span
          role="status"
          // Ancorado à direita e acima: a bolha que falhou é nossa, e portanto
          // encostada na borda direita da conversa — abrir para a esquerda é o
          // único lado com espaço.
          className="absolute bottom-full right-0 z-20 mb-1.5 w-[228px] rounded-ctl border border-line bg-bg p-2.5 text-left "
        >
          <span className="block text-[11.5px] leading-[17px] text-fg">{texto}</span>
          {aoReenviar && (
            <button
              type="button"
              // `onMouseDown` e não `onClick`: o `onBlur` do botão de cima
              // fecharia este painel antes de o clique chegar aqui.
              onMouseDown={(evento) => {
                evento.preventDefault();
                setAberto(false);
                aoReenviar();
              }}
              className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-ctl border border-line py-1.5 text-[11.5px] font-semibold text-accent-forte transition-colors hover:border-accent"
            >
              <RotateCw size={12} strokeWidth={2.2} />
              Tentar novamente
            </button>
          )}
        </span>
      )}
    </span>
  );
}

/** O rótulo da mídia que a bolha mostra quando não tem o arquivo. */
const ROTULO_DA_MIDIA = { audio: "🎤 Áudio", imagem: "📎 Imagem", outro: "📎 Anexo" };

/**
 * O arquivo dentro da bolha: player para áudio, miniatura para imagem, link
 * para o resto. Sem URL — a provisória fora do navegador, ou a assinatura que
 * falhou — volta ao rótulo, que é o que a bolha sempre mostrou.
 */
/**
 * O texto que a VPS tirou do áudio. Vem marcado, em itálico, para ninguém
 * tomar a transcrição por algo que a pessoa escreveu — e pode ter erro de
 * reconhecimento. Sem o player (arquivo que não subiu), a marca diz também que
 * era um áudio.
 */
function TranscricaoDoAudio({ mensagem }) {
  return (
    <span className={`block ${mensagem.midia ? "mt-1.5 border-t border-current/15 pt-1.5" : ""}`}>
      <span className="block text-[10.5px] font-semibold opacity-70">
        {mensagem.midia ? "Transcrição automática" : "🎤 Áudio · transcrição automática"}
      </span>
      <span className="whitespace-pre-wrap italic">{mensagem.texto}</span>
    </span>
  );
}

function MidiaDaBolha({ midia, aoAbrir, tom = "entra" }) {
  if (!midia) return null;
  if (!midia.url) {
    return <span className="block">{ROTULO_DA_MIDIA[midia.tipo] || ROTULO_DA_MIDIA.outro}</span>;
  }
  if (midia.tipo === "audio") {
    // `preload="none"` dentro do player: uma conversa com trinta áudios não
    // baixa trinta arquivos ao abrir. O navegador busca quando alguém aperta play.
    return <PlayerDeAudio url={midia.url} nome={midia.nome} tom={tom} largura="w-full" />;
  }
  if (midia.tipo === "imagem") {
    return (
      <button
        type="button"
        onClick={() => aoAbrir?.(midia)}
        title="Abrir imagem"
        className="my-0.5 block cursor-zoom-in overflow-hidden rounded-ctl"
      >
        <img
          src={midia.url}
          alt={midia.nome || "Imagem"}
          loading="lazy"
          className="block max-h-72 max-w-full object-cover"
        />
      </button>
    );
  }
  return (
    <a
      href={midia.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block underline decoration-accent/60 underline-offset-2"
    >
      📎 {midia.nome || "Abrir anexo"}
    </a>
  );
}

/** A imagem em tela cheia. Esc ou clique fora fecha. */
export function Lightbox({ midia, aoFechar }) {
  useEffect(() => {
    if (!midia) return undefined;
    const aoTeclar = (e) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [midia, aoFechar]);
  if (!midia) return null;
  return (
    <div
      role="dialog"
      aria-label={midia.nome || "Imagem"}
      onClick={aoFechar}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
    >
      <button
        type="button"
        onClick={aoFechar}
        title="Fechar"
        className="absolute right-4 top-4 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X size={18} strokeWidth={2} />
      </button>
      <img
        src={midia.url}
        alt={midia.nome || "Imagem"}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-ctl object-contain"
      />
    </div>
  );
}

/**
 * Uma mensagem.
 *
 * `inicioDoGrupo`: mensagens seguidas da mesma pessoa andam juntas (03/10/2026).
 * Só a primeira do grupo mostra o nome e tem a ponta recortada, do lado de quem
 * falou; as seguintes encostam nela. É o que faz a conversa ler como conversa,
 * e não como uma pilha de cartões iguais.
 */
export function Bolha({ mensagem, nomeProprio, aoReenviar, aoAbrirMidia, inicioDoGrupo = true }) {
  const saiu = mensagem.direcao === "sai";
  // A bolha que ainda não voltou do WhatsApp foi escrita AQUI, agora, por quem
  // está olhando: é o único caso em que o nome de quem vê é o nome de quem
  // escreveu. Numa mensagem já espelhada o nome vem do banco — e usar
  // `nomeProprio` ali poria o nome de quem abriu a tela numa mensagem que
  // outra pessoa da equipe mandou.
  const provisoria = Boolean(mensagem.enviando || mensagem.falhou);
  const autor =
    mensagem.autor ||
    (saiu && provisoria && mensagem.tom === "humano" ? nomeProprio : null);
  const tom = BOLHA_DO_AUTOR[mensagem.tom] ? mensagem.tom : "humano";
  // `sobreGrafite` ficou com o nome antigo: é a bolha cheia da equipe, que hoje
  // é azul profundo. Dentro dela os tons claros são os que contrastam.
  const sobreGrafite = saiu && tom === "humano";
  // Os quatro cantos um a um: no Tailwind 4 o `rounded-bolha` geral vence o
  // `rounded-tl-none`, e a ponta recortada sumia.
  const cantos = inicioDoGrupo
    ? saiu
      ? "rounded-tl-bolha rounded-tr-none rounded-br-bolha rounded-bl-bolha"
      : "rounded-tl-none rounded-tr-bolha rounded-br-bolha rounded-bl-bolha"
    : "rounded-bolha";
  const temAudio = mensagem.midia?.tipo === "audio" && mensagem.midia?.url;
  return (
    <div
      className={`flex ${inicioDoGrupo ? "mt-3" : "mt-0.5"} ${saiu ? "justify-end" : ""}`}
      data-message-id={mensagem.messageId || undefined}
    >
      <div
        className={`relative max-w-[78%] px-3 py-2 text-[13.5px] leading-[20px] ${cantos} ${
          saiu ? BOLHA_DO_AUTOR[tom] : "border border-conversa-linha bg-bolha-entra text-fg"
        } ${temAudio ? "min-w-[min(320px,100%)]" : ""}`}
      >
        {autor && inicioDoGrupo && (
          <span className={`block text-[11px] font-semibold ${saiu ? TOM_DO_AUTOR[tom] : "text-conversa-sub"}`}>
            {autor}
          </span>
        )}
        {mensagem.cita && (
          <span className={`mb-1 block rounded-[6px] border-l-2 border-signal px-2 py-1 ${sobreGrafite ? "bg-on-equipe/10" : "bg-conversa-fundo/70"}`}>
            <span className={`block text-[10.5px] font-semibold ${sobreGrafite ? "text-equipe-sub" : "text-signal"}`}>
              {mensagem.cita.quem}
            </span>
            <span className={`block truncate text-[11.5px] ${sobreGrafite ? "text-on-equipe/70" : "text-sub"}`}>{mensagem.cita.texto}</span>
          </span>
        )}
        <MidiaDaBolha midia={mensagem.midia} aoAbrir={aoAbrirMidia} tom={saiu ? TOM_DO_PLAYER[tom] : "entra"} />
        {mensagem.texto && mensagem.transcricao && <TranscricaoDoAudio mensagem={mensagem} />}
        {mensagem.texto && !mensagem.transcricao && <TextoFormatado texto={mensagem.texto} />}
        {/* Espaço reservado para a hora não sentar em cima da última palavra. */}
        <span className={`inline-block h-px ${saiu ? "w-[58px]" : "w-10"}`} />
        <span className={`absolute bottom-1.5 right-2.5 flex items-center gap-[3px] font-mono text-[10.5px] tabular-nums ${sobreGrafite ? "text-on-equipe/60" : "text-conversa-faint"}`}>
          {mensagem.hora}
          {/* Três estados, e não dois. Entre "escrevi" e "chegou" existe a fila
              do runtime, e ela dura segundos: sem o relógio, quem escreveu não
              distingue a mensagem a caminho da que o Bridge recusou, e escreve
              de novo. O tique só aparece quando a mensagem voltou do aparelho. */}
          {saiu && mensagem.falhou && (
            <AvisoDeFalha
              motivo={mensagem.motivo}
              aoReenviar={
                mensagem.chave && aoReenviar ? () => aoReenviar(mensagem.chave) : null
              }
            />
          )}
          {saiu && mensagem.enviando && (
            <Clock3 size={13} strokeWidth={2.2} className={`flex-none ${sobreGrafite ? "text-on-equipe/60" : "text-faint"}`} />
          )}
          {saiu && !mensagem.enviando && !mensagem.falhou && <Ticks lido={mensagem.lido} sobreGrafite={sobreGrafite} />}
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
// O ator escolhido aparece cheio da cor dele; a pessoa é o grafite cheio.
const ATIVO_DO_DONO = { bot: "bg-flow-soft text-flow", ia: "bg-ia-soft text-ia", humano: "bg-equipe text-on-equipe" };

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
      <span className="flex flex-none gap-0.5 rounded-ctl border border-line bg-surface p-0.5">
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
                aria-pressed={ativo}
                className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-ctl px-2.5 py-1 text-[11px] transition-colors ${
                  ativo
                    ? `font-semibold ${ATIVO_DO_DONO[opcao.id]}`
                    : "font-medium text-sub hover:bg-bg hover:text-fg"
                }`}
              >
                <Icone size={12} strokeWidth={2} className={ativo ? "" : TEXTO_DO_DONO[opcao.id]} />
                {rotulo}
                {humano && <ChevronDown size={11} strokeWidth={2.4} className={ativo ? "opacity-60" : "text-faint"} />}
              </button>

              {humano && menu && (
                <span className="absolute bottom-full left-0 z-20 mb-1.5 flex w-56 flex-col overflow-hidden rounded-ctl border border-line bg-bg py-1 ">
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
 * O teto do arquivo escolhido, conferido aqui antes de qualquer upload. O
 * bucket recusa acima de 16 MB; dez é o que uma foto de celular ocupa com
 * folga, e o que a tela consegue mandar sem a pessoa achar que travou.
 */
const TETO_DO_ANEXO_BYTES = 10 * 1024 * 1024;
const TIPOS_DE_IMAGEM = "image/jpeg,image/png,image/webp";
/** Gravação máxima. O WhatsApp aceita mais; ninguém ouve mais. */
const GRAVACAO_MAXIMA_SEGUNDOS = 5 * 60;

/** O formato que o navegador sabe gravar, na ordem em que o WhatsApp prefere. */
const FORMATOS_DE_GRAVACAO = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

const formatoDeGravacao = () => {
  if (typeof MediaRecorder === "undefined") return "";
  return FORMATOS_DE_GRAVACAO.find((f) => MediaRecorder.isTypeSupported?.(f)) || "";
};

const podeGravarAqui = () =>
  Boolean(formatoDeGravacao()) &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

const relogio = (segundos) =>
  `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

const urlLocal = (arquivo) => {
  try {
    return typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(arquivo) : null;
  } catch {
    return null;
  }
};

/**
 * A caixa de escrita.
 *
 * Enter envia e Shift+Enter quebra linha, como no WhatsApp. O microfone vira
 * avião quando você digita — são os dois estados do mesmo lugar, e não dois
 * botões disputando espaço.
 *
 * Digitar `/` numa caixa vazia abre as mensagens padrão: é o atalho que
 * dispensa procurar o botão.
 *
 * Desde 16/09/2026 a caixa também manda arquivo. O clipe escolhe uma imagem;
 * o microfone grava um áudio. Os dois viram um ANEXO acima da caixa — com a
 * imagem ou o player para conferir — e o texto vira legenda. Só o botão de
 * enviar manda; nada sai ao soltar o microfone, porque num portal de equipe
 * um áudio errado sai para um cliente, e ouvir antes custa um clique.
 */
export function Composer({
  rascunho,
  aoMudar,
  aoEnviar,
  aoEnviarArquivo,
  aba,
  aoAlternarAba,
  aviso,
}) {
  const escrevendo = String(rascunho || "").trim().length > 0;
  // O arquivo escolhido ou gravado, ainda não enviado.
  const [anexo, setAnexo] = useState(null);
  // A gravação em curso: { segundos }.
  const [gravacao, setGravacao] = useState(null);
  // O fluxo do microfone, para a onda ao vivo. Vive enquanto grava.
  const [fluxo, setFluxo] = useState(null);
  const [erroLocal, setErroLocal] = useState("");
  const [enviando, setEnviando] = useState(false);
  const entradaDeArquivo = useRef(null);
  const gravadorRef = useRef(null);

  const podeAnexar = typeof aoEnviarArquivo === "function";
  const podeGravar = podeAnexar && podeGravarAqui();

  const largarAnexo = () => {
    setAnexo((atual) => {
      if (atual?.url) {
        try {
          URL.revokeObjectURL(atual.url);
        } catch {
          // Sem URL para revogar fora do navegador.
        }
      }
      return null;
    });
  };

  // A gravação não sobrevive à caixa: sair da conversa no meio dela solta o
  // microfone, senão o ícone do navegador fica aceso numa tela que já mudou.
  useEffect(
    () => () => {
      const gravador = gravadorRef.current;
      if (gravador && gravador.state !== "inactive") {
        gravador.descartar = true;
        gravador.stop();
      }
    },
    []
  );

  const escolherImagem = (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setErroLocal("");
    if (!TIPOS_DE_IMAGEM.split(",").includes(arquivo.type)) {
      setErroLocal("Só JPG, PNG ou WebP. Documento e vídeo ainda não saem por aqui.");
      return;
    }
    if (arquivo.size > TETO_DO_ANEXO_BYTES) {
      setErroLocal("A imagem passa de 10 MB. Reduza antes de enviar.");
      return;
    }
    largarAnexo();
    setAnexo({ arquivo, tipo: "imagem", url: urlLocal(arquivo), nome: arquivo.name });
  };

  const comecarGravacao = async () => {
    setErroLocal("");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErroLocal("O navegador não liberou o microfone. Confira a permissão do site.");
      return;
    }
    const formato = formatoDeGravacao();
    let gravador;
    try {
      gravador = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setErroLocal("Este navegador não grava áudio em um formato que o WhatsApp toque.");
      return;
    }
    const pedacos = [];
    gravador.ondataavailable = (evento) => {
      if (evento.data && evento.data.size > 0) pedacos.push(evento.data);
    };
    gravador.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setFluxo(null);
      window.clearInterval(gravador.cronometro);
      gravadorRef.current = null;
      setGravacao(null);
      if (gravador.descartar || pedacos.length === 0) return;
      const tipo = String(gravador.mimeType || formato || "audio/webm");
      const blob = new Blob(pedacos, { type: tipo });
      const extensao = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : "webm";
      const arquivo = new File([blob], `gravacao.${extensao}`, { type: tipo });
      largarAnexo();
      setAnexo({ arquivo, tipo: "audio", url: urlLocal(arquivo), nome: arquivo.name });
    };
    gravadorRef.current = gravador;
    setFluxo(stream);
    gravador.start(250);
    const inicio = Date.now();
    gravador.cronometro = window.setInterval(() => {
      const segundos = Math.floor((Date.now() - inicio) / 1000);
      setGravacao({ segundos });
      if (segundos >= GRAVACAO_MAXIMA_SEGUNDOS && gravador.state === "recording") gravador.stop();
    }, 250);
    setGravacao({ segundos: 0 });
  };

  const pararGravacao = (descartar = false) => {
    const gravador = gravadorRef.current;
    if (!gravador) return;
    gravador.descartar = descartar;
    if (gravador.state !== "inactive") gravador.stop();
  };

  const mandar = async () => {
    if (gravacao) return;
    if (!anexo) {
      aoEnviar();
      return;
    }
    if (enviando) return;
    setEnviando(true);
    setErroLocal("");
    try {
      await aoEnviarArquivo(anexo.arquivo, rascunho);
      largarAnexo();
    } catch {
      // O aviso do envio vem por `aviso`, de quem chamou; o anexo fica para a
      // pessoa tentar de novo sem escolher o arquivo outra vez.
    } finally {
      setEnviando(false);
    }
  };

  const aoTeclar = (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    mandar();
  };

  const aoDigitar = (e) => {
    const valor = e.target.value;
    if (valor === "/" && !anexo) {
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
      className={`flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-ctl transition-colors ${
        aba === nome ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface-hover hover:text-fg"
      }`}
    >
      <Icone size={18} strokeWidth={1.9} />
    </button>
  );

  const mostrarEnviar = escrevendo || Boolean(anexo);
  const rodape = erroLocal || aviso;

  return (
    <div className="fundo-conversa flex-none px-3.5 pb-3.5 pt-2.5">
      {anexo && (
        <div
          data-testid="anexo"
          className="mb-1.5 flex items-center gap-2.5 rounded-[12px] border border-conversa-linha bg-bolha-entra px-2.5 py-2"
        >
          {anexo.tipo === "imagem" ? (
            <img
              src={anexo.url || undefined}
              alt={anexo.nome}
              className="h-14 w-14 flex-none rounded-ctl object-cover"
            />
          ) : (
            <PlayerDeAudio url={anexo.url || undefined} nome="Áudio gravado" preload="metadata" largura="min-w-0 flex-1" />
          )}
          <span className={`truncate text-[12px] text-conversa-sub ${anexo.tipo === "imagem" ? "min-w-0 flex-1" : "flex-none"}`}>
            {anexo.tipo === "imagem" ? anexo.nome : "Ouça antes de enviar"}
          </span>
          <button
            type="button"
            onClick={largarAnexo}
            title="Remover anexo"
            className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg"
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-[12px] border-[1.5px] border-conversa-linha bg-bolha-entra px-1.5 py-1 transition-colors focus-within:border-equipe">
        <input
          ref={entradaDeArquivo}
          type="file"
          accept={TIPOS_DE_IMAGEM}
          onChange={escolherImagem}
          className="hidden"
          data-testid="entrada-de-imagem"
        />
        <button
          type="button"
          title={podeAnexar ? "Anexar imagem" : "Anexar — indisponível aqui"}
          disabled={!podeAnexar || Boolean(gravacao)}
          onClick={() => entradaDeArquivo.current?.click()}
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-ctl text-sub ${
            podeAnexar ? "cursor-pointer hover:bg-surface-hover hover:text-fg" : "opacity-40"
          }`}
        >
          <Paperclip size={18} strokeWidth={1.9} />
        </button>
        {botao("modelos", MessageSquareText, "Mensagens padrão")}
        {botao("atalhos", Zap, "Atalhos rápidos")}
        {gravacao ? (
          <div
            data-testid="gravando"
            className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-[13px] text-fg"
          >
            <span className="h-2.5 w-2.5 flex-none animate-pulse rounded-full bg-danger" />
            <span className="w-10 flex-none font-mono tabular-nums">{relogio(gravacao.segundos)}</span>
            {fluxo ? <OndaAoVivo stream={fluxo} /> : <span className="truncate text-sub">Gravando…</span>}
          </div>
        ) : (
          <textarea
            rows={1}
            value={rascunho}
            onChange={aoDigitar}
            onKeyDown={aoTeclar}
            placeholder={anexo ? "Legenda (opcional)" : "Escreva uma mensagem"}
            className="max-h-24 min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-[13.5px] leading-5 text-fg outline-none placeholder:text-faint"
          />
        )}
        <button
          title="Emoji — ainda sem seletor"
          disabled
          className="flex h-8 w-8 flex-none items-center justify-center rounded-ctl text-sub opacity-40"
        >
          <Smile size={18} strokeWidth={1.8} />
        </button>
        {gravacao ? (
          <>
            <button
              type="button"
              onClick={() => pararGravacao(true)}
              title="Descartar gravação"
              className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 size={18} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => pararGravacao(false)}
              title="Parar gravação"
              className="flex h-[38px] flex-none cursor-pointer items-center justify-center gap-1.5 rounded-full bg-equipe px-3.5 text-[12.5px] font-medium text-on-equipe transition-all hover:brightness-110"
            >
              <Square size={12} strokeWidth={2.2} fill="currentColor" />
              Parar
            </button>
          </>
        ) : mostrarEnviar ? (
          <button
            onClick={mandar}
            disabled={enviando}
            title="Enviar"
            className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-full bg-equipe text-on-equipe transition-all hover:brightness-110 disabled:opacity-60"
          >
            <SendHorizontal size={17} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            title={podeGravar ? "Gravar áudio" : "Gravar áudio — indisponível neste navegador"}
            disabled={!podeGravar}
            onClick={comecarGravacao}
            className={`flex h-[38px] w-[38px] flex-none items-center justify-center rounded-ctl text-sub ${
              podeGravar ? "cursor-pointer hover:bg-surface-hover hover:text-fg" : "opacity-40"
            }`}
          >
            <Mic size={18} strokeWidth={1.9} />
          </button>
        )}
      </div>
      <div className="mt-[7px] flex items-center gap-1.5 pl-1 text-[10.5px] text-conversa-faint">
        {rodape || (
          <>
            <strong className="font-semibold text-conversa-sub">Enter</strong> envia ·{" "}
            <strong className="font-semibold text-conversa-sub">Shift+Enter</strong> quebra linha ·{" "}
            <strong className="font-semibold text-conversa-sub">/</strong> abre as mensagens padrão ·{" "}
            <strong className="font-semibold text-conversa-sub">*negrito*</strong>
          </>
        )}
      </div>
    </div>
  );
}
