import { useState } from "react";
import {
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Database,
  Mail,
  MapPin,
  Phone,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "../data/client";
import { fmtData, fmtDataHora, fmtMoeda, fmtVencimento, TONS } from "../lib/formato";
import { formatPhone } from "../lib/phone";
import { camposTecnicosDoContato, fotoPersistidaDoContato, resumoValorTecnico, valorTecnico } from "../lib/contatoTecnico";
import { Cartao, LinhaIcone, Pilula } from "../ui/componentes";
import { EdicaoRapida } from "./CampoEditavel";

/**
 * Os blocos da ficha, cada um num cartão.
 *
 * Empilhados numa rolagem só, em vez de escondidos atrás de abas: num CRM,
 * clicar para descobrir em que pé está o contato é justamente o trabalho que a
 * ficha deveria eliminar.
 */

/* ------------------------------------------------------------------ */
/* Contato                                                             */
/* ------------------------------------------------------------------ */

/**
 * Perfil: quem é, como está classificado, e — só se pedirem — os campos.
 *
 * Os seis campos de contato ocupavam meia tela em linhas de ícone, e quase
 * nenhum deles é consultado durante a conversa: o telefone você já tem (está
 * conversando com ele), e cargo e responsável são consulta rara. Viraram uma
 * linha de resumo, com o resto atrás de um "Detalhes".
 *
 * As tags subiram para cá, logo abaixo do nome. São identidade — "cliente",
 * "lead quente" —, e num cartão próprio lá embaixo gastavam um bloco inteiro
 * para exibir duas palavras.
 */
export function CartaoPerfil({
  contato,
  estagioAtual,
  foto,
  tags,
  recarregar,
}) {
  const [detalhes, setDetalhes] = useState(false);
  const [escolhendoTag, setEscolhendoTag] = useState(false);
  const [tecnicos, setTecnicos] = useState(false);
  const [copiadoTecnico, setCopiadoTecnico] = useState(null);

  const campo = (chave) => ({ contato, campo: chave, aoSalvar: recarregar });
  const marcadas = contato.tags || [];
  const fotoExibida = foto || fotoPersistidaDoContato(contato);
  const camposTecnicos = camposTecnicosDoContato(contato);

  const alternarTag = async (tagId) => {
    const proximas = marcadas.includes(tagId)
      ? marcadas.filter((t) => t !== tagId)
      : [...marcadas, tagId];
    await api.contatos.atualizar({ id: contato.id, patch: { tags: proximas } });
    await recarregar();
  };

  const copiarTecnico = async (chave, valor) => {
    try {
      await navigator.clipboard.writeText(valorTecnico(valor));
      setCopiadoTecnico(chave);
      window.setTimeout(() => setCopiadoTecnico(null), 1200);
    } catch {
      setCopiadoTecnico(null);
    }
  };

  const resumo = [
    contato.telefone ? formatPhone(contato.telefone) : null,
    contato.empresa,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Cartao>
      <div className="flex items-start gap-2.5 px-3 pt-3">
        {fotoExibida ? (
          <img
            src={fotoExibida}
            alt=""
            className="h-10 w-10 flex-none rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent-forte">
            {(contato.nome || "?").trim().charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <EdicaoRapida
                {...campo("nome")}
                className="text-[14px] font-semibold text-fg"
                placeholder="Sem nome"
              />
            </div>
            {estagioAtual && <Pilula tom="accent">{estagioAtual}</Pilula>}
          </div>

          <button
            onClick={() => setDetalhes(!detalhes)}
            title="Ver os campos do contato"
            className="mt-0.5 block max-w-full cursor-pointer truncate text-left text-[11.5px] text-sub transition-colors hover:text-fg"
          >
            {resumo || "Sem telefone nem empresa"}
          </button>
        </div>
      </div>

      {/* Tags logo abaixo do perfil, ocupando a largura inteira. */}
      <div className="relative flex flex-wrap items-center gap-1 px-3 pt-2">
        {marcadas.map((id) => {
          const t = tags.find((x) => x.id === id);
          return (
            <span
              key={id}
              className="group/tag inline-flex items-center gap-1 rounded-full py-[2px] pl-2 pr-1.5 text-[11px] font-medium"
              style={{
                color: t?.cor || "var(--el-sub)",
                background: t?.cor ? `${t.cor}1f` : "var(--el-surface-hover)",
              }}
            >
              {t?.nome || id}
              <button
                onClick={() => alternarTag(id)}
                title="Remover tag"
                className="cursor-pointer text-[13px] leading-none opacity-0 transition-opacity group-hover/tag:opacity-70 hover:!opacity-100"
              >
                ×
              </button>
            </span>
          );
        })}

        <button
          onClick={() => setEscolhendoTag(!escolhendoTag)}
          className="cursor-pointer rounded-full border border-dashed border-line-strong px-2 py-[2px] text-[11px] font-medium text-faint transition-colors hover:border-accent hover:text-accent-forte"
        >
          + tag
        </button>

        {escolhendoTag && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setEscolhendoTag(false)}
            />
            <div className="absolute left-3 top-full z-20 mt-1 w-44 overflow-hidden rounded-el border border-line bg-bg shadow-lg">
              {tags.map((t) => {
                const on = marcadas.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => alternarTag(t.id)}
                    className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[11.5px] transition-colors hover:bg-surface-hover"
                  >
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ background: t.cor }}
                    />
                    <span className={`flex-1 ${on ? "text-fg" : "text-sub"}`}>
                      {t.nome}
                    </span>
                    {on && <Check size={12} className="text-accent" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <button
        onClick={() => setDetalhes(!detalhes)}
        className="mt-1.5 flex w-full cursor-pointer items-center gap-1 px-3 pb-2.5 text-[11.5px] text-sub transition-colors hover:text-fg"
      >
        Detalhes
        <ChevronDown
          size={13}
          className={`transition-transform ${detalhes ? "rotate-180" : ""}`}
        />
      </button>

      {detalhes && (
        <div className="border-t border-line pb-2 pt-1.5">
          <EdicaoRapida
            {...campo("telefone")}
            icone={Phone}
            formatar={formatPhone}
            placeholder="Adicionar telefone"
          />
          <EdicaoRapida
            {...campo("email")}
            icone={Mail}
            placeholder="Adicionar e-mail"
          />
          <EdicaoRapida
            {...campo("empresa")}
            icone={Building2}
            placeholder="Adicionar empresa"
          />
          <EdicaoRapida
            {...campo("origem")}
            icone={MapPin}
            placeholder="Adicionar origem"
          />
          <EdicaoRapida
            {...campo("cargo")}
            icone={Briefcase}
            placeholder="Adicionar cargo"
          />
          <EdicaoRapida
            {...campo("responsavel")}
            icone={UserRound}
            placeholder="Adicionar responsável"
          />
        </div>
      )}

      <div className="border-t border-line">
        <button
          onClick={() => setTecnicos(!tecnicos)}
          className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left text-[11px] text-sub transition-colors hover:text-fg"
        >
          <Database size={12} className="text-faint" />
          <span className="flex-1">Dados técnicos · {camposTecnicos.length}</span>
          <ChevronDown size={12} className={`transition-transform ${tecnicos ? "rotate-180" : ""}`} />
        </button>
        {tecnicos && (
          <div className="mx-3 mb-2 rounded-el bg-surface px-2">
            {camposTecnicos.map(([chave, valor]) => (
              <div key={chave} className="flex min-w-0 items-center gap-2 border-b border-line/70 py-1 last:border-b-0">
                <code className="w-16 flex-none text-[9px] text-faint">{chave}</code>
                <code title={valorTecnico(valor)} className="min-w-0 flex-1 truncate text-[10px] text-sub">{resumoValorTecnico(valor)}</code>
                <button type="button" onClick={() => copiarTecnico(chave, valor)} title={`Copiar ${chave}`} className="flex-none cursor-pointer text-faint hover:text-accent-forte">
                  {copiadoTecnico === chave ? "ok" : <Copy size={11} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Cartao>
  );
}

/* ------------------------------------------------------------------ */
/* Funil                                                               */
/* ------------------------------------------------------------------ */

/** Trilha em setas. O estágio atual ganha mais espaço para o nome caber. */
function Setas({ estagios, atual }) {
  const i = estagios.findIndex((e) => e.id === atual);

  return (
    <div className="flex px-3 pb-3">
      {estagios.map((e, k) => {
        const ativo = k === i;
        const passado = k < i;
        const recorte =
          k === 0
            ? "polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%)"
            : "polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%, 7px 50%)";

        return (
          <div
            key={e.id}
            title={e.nome}
            className={`flex h-[22px] min-w-0 items-center justify-center text-[9.5px] font-semibold ${
              ativo
                ? "bg-accent text-white"
                : passado
                  ? "bg-accent-soft text-accent-forte"
                  : "bg-surface-hover text-faint"
            }`}
            style={{
              flex: ativo ? 2 : 1,
              clipPath: recorte,
              marginLeft: k === 0 ? 0 : -5,
              borderTopLeftRadius: k === 0 ? 4 : 0,
              borderBottomLeftRadius: k === 0 ? 4 : 0,
            }}
          >
            <span className="truncate px-1.5">{e.nome}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CartaoFunil({ negocios, estagios, contactId, recarregar }) {
  const aberto = negocios.find((n) => n.status === "aberto") || negocios[0] || null;

  const criar = async () => {
    await api.negocios.criar({
      contactId,
      titulo: "Nova oportunidade",
      stageId: estagios[0]?.id,
    });
    await recarregar();
  };

  if (!aberto) {
    return (
      <Cartao titulo="Funil de vendas">
        <div className="flex items-center gap-2 px-3 pb-3 pt-1">
          <span className="flex-1 text-[11.5px] text-faint">
            Nenhum negócio registrado
          </span>
          <button
            onClick={criar}
            className="flex cursor-pointer items-center gap-1 rounded-el border border-line px-2 py-1 text-[11.5px] font-medium text-accent-forte transition-colors hover:border-accent"
          >
            <Plus size={12} /> Negócio
          </button>
        </div>
      </Cartao>
    );
  }

  const mover = async (stageId) => {
    await api.negocios.atualizar({ id: aberto.id, patch: { stageId } });
    await recarregar();
  };

  return (
    <Cartao
      titulo="Funil de vendas"
      acao={
        <div className="relative">
          <select
            value={aberto.stageId}
            onChange={(e) => mover(e.target.value)}
            title="Mover de estágio"
            className="cursor-pointer appearance-none rounded-full bg-accent-soft py-[3px] pl-2.5 pr-6 text-[11px] font-semibold text-accent-forte outline-none"
          >
            {estagios.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-accent-forte"
          />
        </div>
      }
    >
      <div className="flex items-baseline gap-2 px-3 pb-1.5 pt-0.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-sub">
          {aberto.titulo}
        </span>
        {aberto.valor != null && (
          <span className="flex-none text-[12.5px] font-semibold text-fg">
            {fmtMoeda(aberto.valor)}
          </span>
        )}
      </div>
      <Setas estagios={estagios} atual={aberto.stageId} />
    </Cartao>
  );
}

/* ------------------------------------------------------------------ */
/* Tarefas                                                             */
/* ------------------------------------------------------------------ */

export function CartaoTarefas({ tarefas, recarregar, aoNova }) {
  const abertas = tarefas.filter((t) => !t.concluida).length;

  const alternar = async (t) => {
    await api.tarefas.concluir({ id: t.id, concluida: !t.concluida });
    await recarregar();
  };

  const ordenadas = [...tarefas].sort(
    (a, b) => a.concluida - b.concluida || (a.venceEm ?? Infinity) - (b.venceEm ?? Infinity)
  );

  return (
    <Cartao
      titulo="Tarefas"
      acao={
        <>
          {abertas > 0 && <Pilula>{abertas}</Pilula>}
          <button
            onClick={aoNova}
            title="Nova tarefa"
            className="cursor-pointer rounded-el p-1 text-sub transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Plus size={14} />
          </button>
        </>
      }
    >
      {ordenadas.length === 0 ? (
        <p className="px-3 pb-2.5 pt-0.5 text-[11.5px] text-faint">
          Nenhuma tarefa.
        </p>
      ) : (
        <div className="pb-2">
          {ordenadas.map((t) => {
            const venc = fmtVencimento(t.venceEm);
            return (
              <button
                key={t.id}
                onClick={() => alternar(t)}
                title={t.concluida ? "Reabrir" : "Concluir"}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-[5px] text-left transition-colors hover:bg-surface-hover"
              >
                <span
                  className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                    t.concluida
                      ? "border-accent bg-accent text-white"
                      : "border-line-strong"
                  }`}
                >
                  {t.concluida && <Check size={10} strokeWidth={3} />}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[12.5px] ${
                    t.concluida ? "text-faint line-through" : "text-fg"
                  }`}
                >
                  {t.titulo}
                </span>
                <span
                  className={`flex-none text-[11px] ${t.concluida ? "text-faint" : TONS[venc.tom]}`}
                >
                  {t.concluida ? "Concluída" : venc.texto}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Cartao>
  );
}

/* ------------------------------------------------------------------ */
/* Notas                                                               */
/* ------------------------------------------------------------------ */

export function CartaoNotas({ notas, recarregar, aoNova }) {
  const remover = async (id) => {
    if (!confirm("Excluir esta nota?")) return;
    await api.notas.remover({ id });
    await recarregar();
  };

  return (
    <Cartao
      titulo="Notas"
      acao={
        <button
          onClick={aoNova}
          title="Nova nota"
          className="cursor-pointer rounded-el p-1 text-sub transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <Plus size={14} />
        </button>
      }
    >
      {notas.length === 0 ? (
        <p className="px-3 pb-2.5 pt-0.5 text-[11.5px] text-faint">
          Nenhuma nota.
        </p>
      ) : (
        <div className="pb-2">
          {notas.map((n) => (
            <div key={n.id} className="group px-3 py-1.5">
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg">
                {n.texto}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-faint">
                <span>
                  {n.autor ? `${n.autor} · ` : ""}
                  {fmtDataHora(n.criadoEm)}
                </span>
                <button
                  onClick={() => remover(n.id)}
                  title="Excluir nota"
                  className="ml-auto cursor-pointer opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Cartao>
  );
}

/* ------------------------------------------------------------------ */
/* Negócios (histórico)                                                */
/* ------------------------------------------------------------------ */

export function CartaoNegocios({ negocios, estagios, recarregar }) {
  if (negocios.length <= 1) return null;

  const marcar = async (id, status) => {
    await api.negocios.atualizar({ id, patch: { status } });
    await recarregar();
  };

  return (
    <Cartao titulo="Todos os negócios">
      <div className="pb-2">
        {negocios.map((n) => (
          <div key={n.id} className="px-3 py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                {n.titulo}
              </span>
              {n.valor != null && (
                <span className="text-[12px] font-semibold text-fg">
                  {fmtMoeda(n.valor)}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-faint">
              <span>{estagios.find((e) => e.id === n.stageId)?.nome}</span>
              <span>·</span>
              <span>{fmtData(n.criadoEm)}</span>
              {n.status === "aberto" && (
                <span className="ml-auto flex gap-1.5">
                  <button
                    onClick={() => marcar(n.id, "ganho")}
                    className="cursor-pointer text-accent-forte hover:underline"
                  >
                    ganho
                  </button>
                  <button
                    onClick={() => marcar(n.id, "perdido")}
                    className="cursor-pointer text-danger hover:underline"
                  >
                    perdido
                  </button>
                </span>
              )}
              {n.status !== "aberto" && (
                <span
                  className={`ml-auto font-medium ${n.status === "ganho" ? "text-accent-forte" : "text-danger"}`}
                >
                  {n.status}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Cartao>
  );
}
