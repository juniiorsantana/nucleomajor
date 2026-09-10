import { useState } from "react";
import {
  ArrowRight,
  CalendarPlus,
  Check,
  DollarSign,
  Plus,
  SquareCheckBig,
  StickyNote,
  Tag,
  UserPlus,
  X,
} from "lucide-react";
import { corDoEstagio } from "../../../domain/types";
import { TONS, fmtMoeda, fmtRelativo, fmtVencimento } from "../../../lib/formato";
import { formatPhone } from "../../../lib/phone";
import { PilulaEstagio, SeloWhatsApp } from "../../ui";
import { AvatarComDono } from "./pecas";

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

      {!contato && <p className="mt-2 text-[11px] leading-4 text-faint">Salve o contato para adicionar etiquetas.</p>}

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
  aoAtualizarEtiquetas,
  aoCriarEtiqueta,
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
        {contato ? (
          <button
            onClick={aoAbrirFicha}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-line py-2.5 text-[12.5px] font-semibold text-accent-forte transition-colors hover:border-accent"
          >
            Abrir ficha completa
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
            Salvar contato
          </button>
        )}
      </div>
    </aside>
  );
}
