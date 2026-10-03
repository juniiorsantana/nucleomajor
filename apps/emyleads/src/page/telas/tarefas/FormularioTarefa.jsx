import { useState } from "react";
import { CalendarClock, CheckCircle2, SquareCheckBig, Trash2, X } from "lucide-react";
import { api } from "../../../data/client";
import { nomeCurto } from "../../../ui/perfil";
import { BotaoPrimario, DialogoConfirmar } from "../../ui";
import { SeletorResponsaveis } from "../gestaoCompartilhados";
import { Folha, SeletorContato } from "../agenda/componentes";
import {
  HORA_PADRAO,
  dataHoraParaTimestamp,
  dataInput,
  horaInput,
  prazoDoAtalho,
} from "./tarefasUtils";

const campo = "min-h-11 w-full rounded-ctl border border-line bg-bg px-3 text-[15px] text-fg outline-none transition-colors focus:border-signal md:min-h-10 md:text-[13px]";
const rotulo = "mb-1 block text-[13px] font-semibold text-sub md:text-[12px]";

const ATALHOS = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "amanha", rotulo: "Amanhã" },
  { id: "semana", rotulo: "Próx. semana" },
  { id: "nenhum", rotulo: "Sem prazo" },
];

/**
 * Criar ou editar uma tarefa.
 *
 * Mora fora da tela de Tarefas porque a Agenda também abre tarefa: antes,
 * tocar numa tarefa da semana trocava de tela e a pessoa perdia a semana que
 * estava vendo. Agora a mesma folha abre por cima de qualquer uma das duas.
 */
export default function FormularioTarefa({ tarefa, contatoIdInicial, contatos = [], equipe = [], usuarioId, aoFechar, aoSalvo, recarregar }) {
  // Tarefa nova começa com quem cria como responsável: é o caso comum, e o
  // seletor vazio fazia a pessoa tocar no próprio nome toda vez.
  const [form, setForm] = useState(() => ({
    contactId: tarefa?.contactId || contatoIdInicial || "",
    titulo: tarefa?.titulo || "",
    data: dataInput(tarefa?.venceEm),
    hora: tarefa?.venceEm != null ? horaInput(tarefa.venceEm) : "",
    responsaveis: tarefa?.responsaveis?.length
      ? [...tarefa.responsaveis]
      : (tarefa?.ownerId ? [tarefa.ownerId] : (usuarioId && !tarefa?.id ? [usuarioId] : [])),
  }));
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null);
  const editando = Boolean(tarefa?.id);

  const alterar = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));
  const aplicarAtalho = (id) => {
    const ts = prazoDoAtalho(id);
    setForm((atual) => ({ ...atual, data: dataInput(ts), hora: ts == null ? "" : horaInput(ts) }));
  };
  const atalhoAtivo = ATALHOS.find((atalho) => {
    const ts = prazoDoAtalho(atalho.id);
    return ts == null ? !form.data : dataInput(ts) === form.data && horaInput(ts) === form.hora;
  })?.id;

  const enviar = async (e) => {
    e.preventDefault();
    if (!form.titulo.trim()) { setErro("Dê um título para a tarefa."); return; }
    setSalvando(true);
    setErro(null);
    try {
      const principal = equipe.find((membro) => membro.user_id === form.responsaveis[0]);
      const dados = {
        contactId: form.contactId || null,
        titulo: form.titulo.trim(),
        venceEm: dataHoraParaTimestamp(form.data, form.hora),
        responsaveis: form.responsaveis,
        // `owner_label` continua sendo gravado: é dele que a agenda e o
        // assistente leem o nome enquanto o perfil não é carregado, e o
        // banco o tem como `not null`.
        responsavel: principal ? nomeCurto(principal.profile, "") : "",
      };
      if (editando) await api.tarefas.atualizar({ id: tarefa.id, patch: dados });
      else await api.tarefas.criar(dados);
      await recarregar?.();
      aoSalvo?.(editando ? "Tarefa atualizada." : "Tarefa criada.");
      aoFechar();
    } catch (falha) {
      setErro(falha?.message || String(falha));
    } finally {
      setSalvando(false);
    }
  };

  const concluir = async () => {
    setSalvando(true);
    try {
      await api.tarefas.concluir({ id: tarefa.id, concluida: !tarefa.concluida });
      await recarregar?.();
      aoSalvo?.(tarefa.concluida ? "Tarefa reaberta." : "Tarefa concluída.", tarefa.concluida ? null : tarefa);
      aoFechar();
    } catch (falha) {
      setErro(falha?.message || String(falha));
      setSalvando(false);
    }
  };

  const excluir = () => setConfirmacao({
    titulo: "Excluir esta tarefa?",
    descricao: `"${tarefa.titulo || "Sem título"}" sai da lista e da agenda de quem responde por ela.`,
    rotulo: "Excluir",
    confirmar: async () => {
      setSalvando(true);
      try {
        await api.tarefas.remover({ id: tarefa.id });
        await recarregar?.();
        aoSalvo?.("Tarefa excluída.");
        aoFechar();
      } catch (falha) {
        setErro(falha?.message || String(falha));
        setSalvando(false);
      }
    },
  });

  return (
    <>
      <Folha
        titulo={editando ? "Editar tarefa" : "Nova tarefa"}
        icone={SquareCheckBig}
        aoFechar={aoFechar}
        onSubmit={enviar}
        rodape={(
          <>
            {editando && (
              <button type="button" onClick={excluir} disabled={salvando} aria-label="Excluir tarefa" className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-ctl px-2.5 text-[14px] font-medium text-danger hover:bg-danger/10 disabled:opacity-40 md:min-h-9 md:text-[13px]">
                <Trash2 size={16} /><span className="hidden sm:inline">Excluir</span>
              </button>
            )}
            {editando && (
              <button type="button" onClick={concluir} disabled={salvando} className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-ctl border border-line px-3 text-[14px] font-semibold text-sub hover:border-success hover:text-success disabled:opacity-40 md:min-h-9 md:text-[13px]">
                <CheckCircle2 size={16} />{tarefa.concluida ? "Reabrir" : "Concluir"}
              </button>
            )}
            <button type="button" onClick={aoFechar} className="ml-auto hidden min-h-9 cursor-pointer rounded-ctl px-3 text-[13px] font-medium text-sub hover:text-fg md:block">Cancelar</button>
            <BotaoPrimario type="submit" disabled={salvando} className="!min-h-11 ml-auto !flex-1 !py-2 md:!min-h-9 md:ml-0 md:!flex-none">
              {salvando ? "Salvando…" : editando ? "Salvar" : "Criar tarefa"}
            </BotaoPrimario>
          </>
        )}
      >
        <div className="space-y-4 px-4 py-4 md:px-5">
          <div>
            <label htmlFor="tarefa-titulo" className={rotulo}>O que precisa ser feito?</label>
            <input
              id="tarefa-titulo"
              data-autofocus={editando ? undefined : "true"}
              required
              maxLength={240}
              value={form.titulo}
              onChange={(e) => alterar("titulo", e.target.value)}
              className={`${campo} font-medium`}
              placeholder="Ex.: Retornar para o cliente"
            />
          </div>

          <fieldset>
            <legend className={`${rotulo} flex items-center gap-1.5`}><CalendarClock size={14} />Prazo</legend>
            <div className="sem-barra -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
              {ATALHOS.map((atalho) => (
                <button
                  key={atalho.id}
                  type="button"
                  aria-pressed={atalhoAtivo === atalho.id}
                  onClick={() => aplicarAtalho(atalho.id)}
                  className={`min-h-10 flex-none cursor-pointer rounded-ctl border px-3.5 text-[14px] font-medium md:min-h-8 md:text-[12px] ${atalhoAtivo === atalho.id ? "border-fg bg-fg text-bg" : "border-line text-sub hover:border-line-strong"}`}
                >
                  {atalho.rotulo}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input
                type="date"
                aria-label="Dia do prazo"
                value={form.data}
                onChange={(e) => setForm((atual) => ({ ...atual, data: e.target.value, hora: e.target.value ? (atual.hora || HORA_PADRAO) : "" }))}
                className={campo}
              />
              <div className="relative">
                <input
                  type="time"
                  aria-label="Hora do prazo"
                  disabled={!form.data}
                  value={form.hora}
                  onChange={(e) => alterar("hora", e.target.value)}
                  className={`${campo} w-[128px] disabled:opacity-40`}
                />
              </div>
            </div>
            <p className="mt-1.5 text-[12px] text-faint md:text-[11px]">
              {form.data
                ? "O lembrete sai nesta hora, para quem responde pela tarefa."
                : "Sem prazo, a tarefa não aparece na agenda nem gera lembrete."}
            </p>
          </fieldset>

          <SeletorContato
            rotulo="Cliente (opcional)"
            contatos={contatos}
            valor={form.contactId}
            aoMudar={(id) => alterar("contactId", id)}
          />

          <SeletorResponsaveis
            membros={equipe}
            valores={form.responsaveis}
            aoMudar={(valores) => alterar("responsaveis", valores)}
            rotulo="Quem faz"
          />

          {erro && <p role="alert" className="rounded-ctl border border-danger/25 bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>}
        </div>
      </Folha>
      <DialogoConfirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  );
}

/**
 * Recusar pede um motivo, e não obriga.
 *
 * Obrigar transformaria "não é comigo" em três minutos de redação, e a pessoa
 * simplesmente não recusaria — ficaria pendente para sempre, que é o estado
 * pior. Pedir aumenta a chance de vir, e vazio continua sendo resposta.
 */
export function DialogoRecusa({ tarefa, aoFechar, aoConfirmar }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <Folha
      titulo="Recusar a tarefa"
      subtitulo={tarefa.titulo || "Sem título"}
      icone={X}
      aoFechar={aoFechar}
      camada="z-[55]"
      rodape={(
        <>
          <button type="button" onClick={aoFechar} className="min-h-11 cursor-pointer rounded-ctl px-3 text-[14px] font-medium text-sub hover:text-fg md:min-h-9 md:text-[13px]">Cancelar</button>
          <button
            type="button"
            disabled={salvando}
            onClick={async () => { setSalvando(true); await aoConfirmar(motivo); }}
            className="ml-auto min-h-11 flex-1 cursor-pointer rounded-ctl bg-danger px-4 text-[14px] font-semibold text-bg hover:brightness-95 disabled:opacity-40 md:min-h-9 md:flex-none md:text-[13px]"
          >
            {salvando ? "Recusando…" : "Recusar"}
          </button>
        </>
      )}
    >
      <div className="px-4 py-4 md:px-5">
        <p className="text-[14px] text-sub md:text-[12.5px]">A tarefa não some: ela volta para quem atribuiu, com o que você escrever aqui.</p>
        <label htmlFor="recusa-motivo" className={`${rotulo} mt-3`}>Motivo (opcional)</label>
        <textarea
          id="recusa-motivo"
          rows={3}
          maxLength={280}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className={`${campo} py-2`}
          placeholder="Ex.: estou fora esta semana"
        />
      </div>
    </Folha>
  );
}
