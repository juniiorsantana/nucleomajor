import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarPlus,
  Check,
  DollarSign,
  Play,
  Plus,
  SquareCheckBig,
  StickyNote,
  Tag,
  UserPlus,
  X,
} from "lucide-react";
import { ehLead } from "../../../domain/lead";
import { corDoEstagio } from "../../../domain/types";
import { TONS, fmtMoeda, fmtRelativo, fmtVencimento } from "../../../lib/formato";
import { formatPhone } from "../../../lib/phone";
import { PilulaEstagio, SeloWhatsApp } from "../../ui";
import { contatoMarcadoNaoAtenderIA } from "./conversasUtils";
import { AvatarComDono } from "./pecas";

/**
 * O interruptor "a IA atende este contato?".
 *
 * O número da empresa também é pessoal, e com o agente ligado para todo
 * mundo um amigo do dono recebia três cumprimentos e uma transferência falsa.
 * A marca é a etiqueta "Não atender IA" do CRM — o gate do agente recusa
 * quem a carrega —, e este bloco é o atalho de um clique para ela. Sem contato
 * salvo, o clique cria o contato e aplica a marca: pedir duas ações para tirar
 * um amigo da IA é pedir que ninguém faça.
 *
 * **O estado mostrado é o do banco, nunca o da cópia local.** Em 13/09/2026 o
 * dono desligou alguns contatos, a ficha passou a dizer "desligado" lendo as
 * etiquetas do navegador, e o banco não tinha marca nenhuma — a IA continuou
 * respondendo. Por isso o interruptor pergunta ao banco ao abrir
 * (`aoConsultar`), mostra o que o banco devolveu depois de salvar, e fica
 * travado enquanto não sabe. A cópia local só vale na bancada sem banco, quando
 * não existe `aoConsultar`.
 */
function AtendimentoPelaIA({ conversa, contato, etiquetas, aoConsultar, aoDefinir }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  // `null` é "ainda não sei": o interruptor não afirma nada que o banco não disse.
  const [confirmado, setConfirmado] = useState(null);
  const marcadoLocal = contatoMarcadoNaoAtenderIA(etiquetas);
  const telefone = conversa?.telefone || "";

  useEffect(() => {
    if (!aoConsultar || !telefone) return undefined;
    let vivo = true;
    setConfirmado(null);
    setErro("");
    Promise.resolve(aoConsultar({ conversa }))
      .then((estado) => {
        if (vivo) setConfirmado(estado?.atende !== false);
      })
      .catch((falha) => {
        if (vivo) setErro(falha?.message || "Não foi possível conferir se a IA atende este número.");
      });
    return () => {
      vivo = false;
    };
    // A pergunta é por número: trocar de conversa pergunta de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoConsultar, telefone]);

  const conhecido = aoConsultar ? confirmado !== null : true;
  const atende = aoConsultar ? confirmado !== false : !marcadoLocal;

  const alternar = async () => {
    if (!aoDefinir || salvando || !conhecido) return;
    setSalvando(true);
    setErro("");
    try {
      const gravado = await aoDefinir({ conversa, contato, atender: !atende });
      if (aoConsultar) {
        setConfirmado(gravado && typeof gravado.atende === "boolean" ? gravado.atende : !atende);
      }
    } catch (falha) {
      setErro(falha?.message || "Não foi possível alterar o atendimento pela IA.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div
      className={`mt-3.5 rounded-[11px] border px-3 py-2.5 ${
        atende ? "border-line" : "border-danger/25 bg-danger/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">
          Atendimento pela IA
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={atende}
          aria-label="A IA atende este contato"
          disabled={salvando || !aoDefinir || !conhecido}
          onClick={alternar}
          className={`ml-auto flex h-[22px] w-[40px] flex-none cursor-pointer items-center rounded-full border p-[2px] transition-colors disabled:cursor-default disabled:opacity-40 ${
            atende ? "justify-end border-accent bg-accent" : "justify-start border-line-strong bg-bg"
          }`}
        >
          <span className={`block h-[16px] w-[16px] rounded-full ${atende ? "bg-white" : "bg-line-strong"}`} />
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-4 text-sub">
        {salvando
          ? "Salvando…"
          : !conhecido
            ? erro
              ? "Não deu para conferir agora. Recarregue a conversa para tentar de novo."
              : "Conferindo no servidor…"
            : atende
            ? "A IA responde este número. Desligue para contatos pessoais — nada é enviado a quem está desligado."
            : "Desligado: a IA não responde este número em nenhuma conversa. Etiqueta “Não atender IA” no CRM."}
      </p>
      {erro && <p className="mt-1 text-[11px] text-danger">{erro}</p>}
    </div>
  );
}

/**
 * A ficha do contato, ao lado da conversa.
 *
 * Fecha pelo botão do cabeçalho da conversa. Fechada, ela e o menu recolhido
 * devolvem 550px para a conversa — que é o que se lê o dia inteiro.
 *
 * O que aparece aqui é dado REAL: negócio, tarefa, nota e etiquetas saem do
 * mesmo `dados` que a tela de Contatos usa. Só o histórico de mensagens é de
 * demonstração; a ficha nunca foi.
 */

const ATALHOS_DA_FICHA = [
  { id: "tarefa", rotulo: "Tarefa", icone: SquareCheckBig },
  { id: "agenda", rotulo: "Agenda", icone: CalendarPlus },
  { id: "nota", rotulo: "Nota", icone: StickyNote },
  { id: "negocio", rotulo: "Negócio", icone: DollarSign },
];

/**
 * "Iniciar fluxo": o disparo manual de um fluxo de follow-up.
 *
 * Só aparece quando o contato está salvo e existe fluxo ativo com gatilho
 * manual. O pedido vai para a fila da VPS, que roda o fluxo como robô — mesmo
 * que o contato tenha a etiqueta "Não atender IA", porque foi alguém da equipe
 * que escolheu. Um contato por vez, de propósito: isto não é disparo em massa.
 */
function IniciarFluxo({ contato, fluxos, aoIniciar }) {
  const [escolhido, setEscolhido] = useState("");
  const [estado, setEstado] = useState({ tipo: "parado", texto: "" });

  // A lista é recriada a cada render; o que importa é quais fluxos existem.
  const ids = fluxos.map((fluxo) => fluxo.id).join(",");
  useEffect(() => {
    setEscolhido(ids.split(",")[0] || "");
    setEstado({ tipo: "parado", texto: "" });
  }, [contato?.id, ids]);

  if (!contato || !fluxos.length || !aoIniciar) return null;

  const iniciar = async () => {
    const fluxo = fluxos.find((item) => item.id === escolhido);
    if (!fluxo) return;
    setEstado({ tipo: "enviando", texto: "" });
    try {
      await aoIniciar({ contato, chatbotId: fluxo.remoteId || fluxo.id });
      setEstado({ tipo: "ok", texto: `“${fluxo.nome}” vai começar em instantes.` });
    } catch (erro) {
      setEstado({ tipo: "erro", texto: erro?.message || "Não foi possível iniciar o fluxo." });
    }
  };

  return (
    <div className="mt-3.5 rounded-[11px] border border-line px-3 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">Iniciar fluxo</span>
      <div className="mt-2 flex items-center gap-1.5">
        <select
          value={escolhido}
          onChange={(event) => { setEscolhido(event.target.value); setEstado({ tipo: "parado", texto: "" }); }}
          aria-label="Fluxo para iniciar"
          className="min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2 py-1.5 text-[12px] text-fg outline-none focus:border-accent"
        >
          {fluxos.map((fluxo) => <option key={fluxo.id} value={fluxo.id}>{fluxo.nome}</option>)}
        </select>
        <button
          type="button"
          onClick={iniciar}
          disabled={estado.tipo === "enviando" || !escolhido}
          title="Iniciar este fluxo para o contato"
          className="flex h-[30px] flex-none cursor-pointer items-center gap-1 rounded-[8px] bg-accent px-2.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
        >
          <Play size={12} strokeWidth={2.4} />
          {estado.tipo === "enviando" ? "Iniciando…" : "Iniciar"}
        </button>
      </div>
      {estado.texto && (
        <p role="status" className={`mt-1.5 text-[11px] leading-[16px] ${estado.tipo === "erro" ? "text-danger" : "text-sub"}`}>
          {estado.texto}
        </p>
      )}
    </div>
  );
}

function Linha({ rotulo, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-[92px] flex-none text-[11.5px] text-faint">{rotulo}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function EditorEtiquetas({ contato, etiquetas, todas, aoAtualizar, aoCriar }) {
  const [aberto, setAberto] = useState(false);
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const selecionadas = contato?.tags || [];

  const alternar = async (id) => {
    if (!contato || salvando) return;
    const proxima = selecionadas.includes(id)
      ? selecionadas.filter((tagId) => tagId !== id)
      : [...selecionadas, id];
    setSalvando(true);
    setErro("");
    try {
      await aoAtualizar(contato.id, proxima);
    } catch (falha) {
      setErro(falha?.message || "Não foi possível atualizar as etiquetas.");
    } finally {
      setSalvando(false);
    }
  };

  const criar = async (evento) => {
    evento.preventDefault();
    if (!nova.trim() || !contato || salvando) return;
    setSalvando(true);
    setErro("");
    try {
      const tag = await aoCriar(nova.trim());
      await aoAtualizar(contato.id, [...new Set([...selecionadas, tag.id])]);
      setNova("");
    } catch (falha) {
      setErro(falha?.message || "Não foi possível criar a etiqueta.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mt-3.5 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">Etiquetas</span>
        {contato && (
          <button
            type="button"
            onClick={() => setAberto((valor) => !valor)}
            className="ml-auto inline-flex items-center gap-1 rounded-[7px] px-1.5 py-1 text-[10.5px] font-semibold text-accent-forte transition-colors hover:bg-accent-soft"
          >
            <Tag size={12} strokeWidth={2} />
            Gerenciar
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {etiquetas.length ? etiquetas.map((tag) => (
          <span
            key={tag.id}
            className="rounded-[6px] px-2 py-1 text-[10.5px] font-semibold"
            style={{ color: tag.cor || "var(--el-sub)", backgroundColor: `${tag.cor || "#667085"}18` }}
          >
            {tag.nome}
          </span>
        )) : <span className="text-[11.5px] text-faint">Nenhuma etiqueta.</span>}
      </div>

      {!contato && <p className="mt-2 text-[11px] leading-4 text-faint">Crie o lead para adicionar etiquetas.</p>}

      {aberto && contato && (
        <div className="mt-2.5 rounded-[10px] border border-line bg-surface p-2">
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {todas.map((tag) => {
              const ativa = selecionadas.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={salvando}
                  onClick={() => alternar(tag.id)}
                  className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[11.5px] transition-colors ${ativa ? "bg-accent-soft text-fg" : "text-sub hover:bg-surface-hover hover:text-fg"}`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.cor || "#667085" }} />
                  <span className="min-w-0 flex-1 truncate">{tag.nome}</span>
                  {ativa && <Check size={13} strokeWidth={2.5} className="text-accent" />}
                </button>
              );
            })}
          </div>
          <form onSubmit={criar} className="mt-2 flex gap-1.5 border-t border-line pt-2">
            <input
              id="nova-etiqueta-conversa"
              name="novaEtiqueta"
              value={nova}
              onChange={(evento) => setNova(evento.target.value)}
              placeholder="Nova etiqueta"
              aria-label="Nome da nova etiqueta"
              className="min-w-0 flex-1 rounded-[7px] border border-line bg-bg px-2 py-1.5 text-[11.5px] text-fg outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!nova.trim() || salvando}
              title="Criar e adicionar etiqueta"
              className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-accent text-white transition-colors hover:bg-accent-forte disabled:opacity-40"
            >
              <Plus size={14} strokeWidth={2.3} />
            </button>
          </form>
          {erro && <p role="alert" className="mt-1.5 text-[10.5px] text-danger">{erro}</p>}
        </div>
      )}
    </div>
  );
}

function BotaoMarcarLead({ aoMarcar }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const marcar = async () => {
    if (!aoMarcar || salvando) return;
    setSalvando(true);
    setErro("");
    try {
      await aoMarcar();
    } catch (e) {
      setErro(e?.message || "Não foi possível marcar como lead.");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <>
      <button
        onClick={marcar}
        disabled={!aoMarcar || salvando}
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] bg-accent py-2.5 text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-default disabled:opacity-50"
      >
        <UserPlus size={14} strokeWidth={2} />
        {salvando ? "Marcando…" : "Marcar como lead"}
      </button>
      {erro && <p className="text-[11px] text-danger">{erro}</p>}
    </>
  );
}

export function FichaLateral({
  conversa,
  contato,
  negocio,
  estagio,
  tarefa,
  nota,
  etiquetas,
  todasEtiquetas,
  aoFechar,
  aoAtalho,
  aoAbrirFicha,
  aoSalvarContato,
  aoMarcarLead,
  aoAtualizarEtiquetas,
  aoCriarEtiqueta,
  aoConsultarAtendimentoIA,
  aoDefinirAtendimentoIA,
  fluxosManuais = [],
  aoIniciarFluxo,
}) {
  const vencimento = tarefa ? fmtVencimento(tarefa.venceEm) : null;

  return (
    <aside className="hidden w-[296px] flex-none flex-col border-l border-line bg-bg lg:flex">
      <div className="flex flex-none items-center px-3.5 pt-3.5">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">
          Ficha do contato
        </span>
        <button
          onClick={aoFechar}
          title="Fechar ficha"
          className="ml-auto flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[9px] text-sub transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-3.5 pb-4 pt-3">
        <div className="flex flex-col items-center text-center">
          <AvatarComDono
            nome={conversa.nome}
            foto={conversa.fotoUrl}
            dono={conversa.dono}
            tamanho={62}
          />
          <span className="mt-2.5 text-[15.5px] font-semibold text-fg">{conversa.nome}</span>
          {(conversa.cargo || conversa.empresa) && (
            <span className="mt-0.5 text-[12px] text-sub">
              {[conversa.cargo, conversa.empresa].filter(Boolean).join(" · ")}
            </span>
          )}
          {conversa.telefone && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-sub">
              <SeloWhatsApp tamanho={12} />
              {formatPhone(conversa.telefone)}
            </span>
          )}
        </div>

        {!conversa.grupo && (
          <AtendimentoPelaIA
            conversa={conversa}
            contato={contato}
            etiquetas={etiquetas}
            aoConsultar={aoConsultarAtendimentoIA}
            aoDefinir={aoDefinirAtendimentoIA}
          />
        )}

        <IniciarFluxo contato={contato} fluxos={fluxosManuais} aoIniciar={aoIniciarFluxo} />

        <div className="mt-3.5 grid grid-cols-4 gap-1.5">
          {ATALHOS_DA_FICHA.map((a) => (
            <button
              key={a.id}
              onClick={() => aoAtalho(a.id)}
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border border-line px-1 py-2.5 text-[10.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
            >
              <a.icone size={15} strokeWidth={1.9} />
              {a.rotulo}
            </button>
          ))}
        </div>

        {negocio ? (
          <div className="mt-3.5 rounded-[11px] border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <PilulaEstagio nome={estagio?.nome} cor={corDoEstagio(estagio?.ordem)} />
              {negocio.valor != null && (
                <span className="ml-auto text-[14px] font-semibold tabular-nums text-fg">
                  {fmtMoeda(negocio.valor)}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[12.5px] font-medium text-fg">{negocio.titulo}</div>
            <div className="mt-0.5 text-[11px] text-faint">
              aberto {fmtRelativo(negocio.criadoEm)}
              {negocio.origem ? ` · origem ${negocio.origem}` : ""}
            </div>
          </div>
        ) : (
          <div className="mt-3.5 rounded-[11px] border border-dashed border-line px-3 py-2.5 text-[11.5px] text-faint">
            Nenhum negócio aberto com este contato.
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">Tarefas</span>
        </div>
        {tarefa ? (
          <div
            className={`mt-1.5 flex items-start gap-2 rounded-[10px] border px-2.5 py-2.5 ${
              vencimento?.tom === "danger" ? "border-danger/25 bg-danger/5" : "border-line"
            }`}
          >
            <span className="mt-0.5 block h-[15px] w-[15px] flex-none rounded-[5px] border border-line-strong bg-bg" />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-fg">{tarefa.titulo}</span>
              <span className={`mt-0.5 block text-[10.5px] font-semibold ${TONS[vencimento.tom]}`}>
                {vencimento.texto}
              </span>
            </span>
          </div>
        ) : (
          <div className="mt-1.5 text-[11.5px] text-faint">Nada pendente.</div>
        )}

        <div className="mt-3.5 flex flex-col gap-2">
          <Linha rotulo="Responsável">
            <span className="text-[12px] text-fg">{contato?.responsavel || "—"}</span>
          </Linha>
          <Linha rotulo="Origem">
            <span className="text-[12px] text-fg">{contato?.origem || "—"}</span>
          </Linha>
        </div>

        <EditorEtiquetas
          contato={contato}
          etiquetas={etiquetas}
          todas={todasEtiquetas}
          aoAtualizar={aoAtualizarEtiquetas}
          aoCriar={aoCriarEtiqueta}
        />

        <div className="mt-3.5 border-t border-line pt-2.5">
          <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">
            Última nota
          </span>
          {nota ? (
            <>
              <p className="mt-1.5 text-[12px] leading-[18px] text-sub">{nota.texto}</p>
              <span className="mt-1 block text-[10.5px] text-faint">
                {[nota.autor, fmtRelativo(nota.criadoEm)].filter(Boolean).join(" · ")}
              </span>
            </>
          ) : (
            <p className="mt-1.5 text-[12px] text-faint">Nenhuma nota ainda.</p>
          )}
        </div>
      </div>

      {/*
        O rodapé troca de botão conforme a conversa tenha contato ou não.
        "Abrir ficha completa" cinza era o estado mais comum aqui: quem chegou
        agora é justamente quem ainda não está no CRM, e a ficha lateral
        oferecia como única ação um botão que não fazia nada. O nome e o
        telefone que o WhatsApp já entregou vão preenchidos — redigitar o que a
        tela mostra logo acima seria trabalho inventado.
      */}
      <div className="flex-none border-t border-line px-3.5 py-2.5">
        {contato && !ehLead(contato) ? (
          // Já está no CRM (o chatbot ou a IA cadastraram), mas ninguém decidiu
          // que é oportunidade. Criar de novo duplicaria; o que falta é a marca.
          <div className="flex flex-col gap-1.5">
            <BotaoMarcarLead aoMarcar={aoMarcarLead} />
            <button
              onClick={aoAbrirFicha}
              className="cursor-pointer py-1 text-[11.5px] font-medium text-sub hover:text-fg"
            >
              Abrir ficha do contato
            </button>
          </div>
        ) : contato ? (
          <button
            onClick={aoAbrirFicha}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-line py-2.5 text-[12.5px] font-semibold text-accent-forte transition-colors hover:border-accent"
          >
            Abrir ficha do lead
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        ) : (
          <button
            onClick={() =>
              aoSalvarContato?.({
                // O nome que o espelho trouxe pode ser o próprio número, e
                // gravar "5565992178164" como nome de contato é pior que deixar
                // o campo vazio para a pessoa preencher.
                nome: conversa.nome === conversa.telefone ? "" : conversa.nome,
                telefone: conversa.telefone,
              })
            }
            disabled={!aoSalvarContato}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-line py-2.5 text-[12.5px] font-semibold text-accent-forte transition-colors hover:border-accent disabled:cursor-default disabled:opacity-40"
          >
            <UserPlus size={14} strokeWidth={2} />
            Criar lead
          </button>
        )}
      </div>
    </aside>
  );
}
