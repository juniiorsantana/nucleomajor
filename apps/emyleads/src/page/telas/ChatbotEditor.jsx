import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  reconnectEdge,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  CalendarDays,
  CircleHelp,
  CircleStop,
  Clock,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Plus,
  Share2,
  Save,
  Split,
  Tag,
  Tags,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../data/client";
import {
  ALVOS_IA,
  DESTINOS_TRANSFERENCIA,
  GATILHOS_SEM_MENSAGEM,
  ROTULOS_SAIDA,
  TIPOS_GATILHO,
  TIPOS_PASSO,
  VARIAVEIS_RESERVADAS,
  gatilhoDo,
  novoIdDeOpcao,
  rotuloDaSaida,
  saidasDoPasso,
} from "../../domain/chatbots";
import { DIAS_DA_SEMANA, FUSO_PADRAO, FUSOS_DO_BRASIL, OPERADORES_LOGICOS, TIPOS_CONDICAO } from "../../domain/regras";
import { problemaParaOServidor } from "../../domain/fluxoNoServidor";
import { BotaoPrimario } from "../ui";
import { CampoFormulario, SeletorEtiquetas } from "./gestaoCompartilhados";
import { tiposDeNo } from "./ChatbotFlowNodes";
import { tiposDeFio } from "./ChatbotFlowEdge";
import {
  idConexao,
  NO_CONDICOES,
  NO_ENTRADA,
  SAIDA_PADRAO,
  validarGrafo,
  VERSAO_CANVAS_RAMIFICADO,
} from "../../domain/chatbotGrafo";
import { conexaoPermitida, criarGrafoInicial, posicoesEmColunas, serializarCanvas } from "./chatbotFlow";
import "./chatbot-flow.css";

const entrada = "w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[13px] text-fg outline-none transition-colors focus:border-accent";
const novoId = () => `passo-${Math.random().toString(36).slice(2, 10)}`;

const clonarPassos = (passos = []) =>
  passos.map((passo) => ({
    ...passo,
    adicionar: passo.adicionar ? [...passo.adicionar] : undefined,
    remover: passo.remover ? [...passo.remover] : undefined,
  }));

const TITULOS_PASSO = {
  [TIPOS_PASSO.enviarMensagem]: "Enviar mensagem",
  [TIPOS_PASSO.editarEtiquetas]: "Editar etiquetas",
  [TIPOS_PASSO.transferir]: "Transferir conversa",
  [TIPOS_PASSO.condicao]: "Condição",
  [TIPOS_PASSO.encerrar]: "Encerrar",
  [TIPOS_PASSO.perguntar]: "Pedir para escolher",
  [TIPOS_PASSO.coletar]: "Pedir para digitar",
};

const DESTINOS = {
  [DESTINOS_TRANSFERENCIA.humano]: "Um atendente humano",
  [DESTINOS_TRANSFERENCIA.ia]: "O agente de IA",
};

const regraDeDias = () => ({ tipo: TIPOS_CONDICAO.diaDaSemana, dias: [1, 2, 3, 4, 5], fuso: FUSO_PADRAO });
const regraDeHorario = () => ({ tipo: TIPOS_CONDICAO.janelaDeHorario, inicio: "08:00", fim: "18:00", fuso: FUSO_PADRAO });

/**
 * Os blocos que se pode criar. `ramificado` marca os que só existem no
 * formato com caminhos: sem o executor da VPS, uma condição no meio do fluxo
 * não teria quem a avaliasse.
 *
 * "Tem etiqueta", "Dias da semana" e "Horário" são atalhos, não tipos: cada um
 * cria um bloco de Condição já com a regra certa. O mesmo predicado não
 * precisa de um segundo bloco — só de um jeito mais curto de chegar nele.
 */
const BLOCOS = [
  { id: TIPOS_PASSO.enviarMensagem, tipo: TIPOS_PASSO.enviarMensagem, titulo: "Enviar mensagem", descricao: "Responde no WhatsApp", icone: MessageSquareText, classe: "text-blue-600 bg-blue-500/10" },
  { id: TIPOS_PASSO.editarEtiquetas, tipo: TIPOS_PASSO.editarEtiquetas, titulo: "Editar etiquetas", descricao: "Organiza o contato", icone: Tags, classe: "text-success bg-success-soft" },
  { id: TIPOS_PASSO.condicao, tipo: TIPOS_PASSO.condicao, titulo: "Condição", descricao: "Segue por Sim ou por Não", icone: Split, classe: "text-warning bg-warning/10", ramificado: true },
  { id: "atalho_etiqueta", tipo: TIPOS_PASSO.condicao, titulo: "Tem etiqueta", descricao: "Sim para quem tiver a etiqueta", icone: Tag, classe: "text-warning bg-warning/10", ramificado: true, regra: () => ({ tipo: TIPOS_CONDICAO.temEtiqueta, etiquetaId: "" }) },
  { id: "atalho_dias", tipo: TIPOS_PASSO.condicao, titulo: "Dias da semana", descricao: "Sim nos dias marcados", icone: CalendarDays, classe: "text-warning bg-warning/10", ramificado: true, regra: regraDeDias },
  { id: "atalho_horario", tipo: TIPOS_PASSO.condicao, titulo: "Horário", descricao: "Sim dentro do horário", icone: Clock, classe: "text-warning bg-warning/10", ramificado: true, regra: regraDeHorario },
  { id: TIPOS_PASSO.perguntar, tipo: TIPOS_PASSO.perguntar, titulo: "Pedir para escolher", descricao: "Menu com opções numeradas", icone: ListChecks, classe: "text-sky-600 bg-sky-500/10", ramificado: true },
  { id: TIPOS_PASSO.coletar, tipo: TIPOS_PASSO.coletar, titulo: "Pedir para digitar", descricao: "Guarda a resposta do contato", icone: TextCursorInput, classe: "text-sky-600 bg-sky-500/10", ramificado: true },
  { id: TIPOS_PASSO.transferir, tipo: TIPOS_PASSO.transferir, titulo: "Transferir conversa", descricao: "Entrega para a IA ou para alguém", icone: Share2, classe: "text-accent-forte bg-accent-soft" },
  { id: TIPOS_PASSO.encerrar, tipo: TIPOS_PASSO.encerrar, titulo: "Encerrar", descricao: "Termina o fluxo aqui", icone: CircleStop, classe: "text-sub bg-surface-hover", ramificado: true },
];

function passoVazio(tipo, regra = null) {
  if (tipo === TIPOS_PASSO.enviarMensagem) return { id: novoId(), tipo, texto: "" };
  // Padrão humano de propósito: transferir para uma pessoa é sempre seguro.
  // Passar para a IA é que precisa ser uma escolha.
  if (tipo === TIPOS_PASSO.transferir)
    return { id: novoId(), tipo, destino: DESTINOS_TRANSFERENCIA.humano, motivo: "", alvoIa: ALVOS_IA.recepcao, skillId: null, campanhaId: null, objetivoIa: "", retornoPassoId: null, falhaPassoId: null };
  // A pergunta mais comum de uma condição é "tem esta etiqueta?".
  if (tipo === TIPOS_PASSO.condicao)
    return { id: novoId(), tipo, expressao: { operador: OPERADORES_LOGICOS.e, itens: [regra ? regra() : { tipo: TIPOS_CONDICAO.temEtiqueta, etiquetaId: "" }] } };
  if (tipo === TIPOS_PASSO.encerrar) return { id: novoId(), tipo };
  if (tipo === TIPOS_PASSO.perguntar)
    return {
      id: novoId(), tipo, texto: "", tentativas: 2, prazoHoras: 24,
      opcoes: [
        { id: novoIdDeOpcao(), rotulo: "", sinonimos: [] },
        { id: novoIdDeOpcao(), rotulo: "", sinonimos: [] },
      ],
    };
  if (tipo === TIPOS_PASSO.coletar) return { id: novoId(), tipo, texto: "", variavel: "resposta", prazoHoras: 24 };
  return { id: novoId(), tipo, adicionar: [], remover: [] };
}

const novaConexao = (source, target, saida = SAIDA_PADRAO) => ({
  id: idConexao(source, target, saida),
  source,
  target,
  saida,
  sourceHandle: saida,
  targetHandle: "entrada",
});

/** O grupo de uma expressão, venha ela como lista antiga, grupo ou regra solta. */
const grupoDa = (expressao) => {
  if (Array.isArray(expressao)) return { operador: OPERADORES_LOGICOS.e, itens: expressao };
  if (expressao?.operador) return { operador: expressao.operador, itens: expressao.itens || [] };
  return { operador: OPERADORES_LOGICOS.e, itens: expressao ? [expressao] : [] };
};

function resumoCondicao(condicao, tags, estagios) {
  if (condicao?.operador) return `Grupo com ${(condicao.itens || []).length} regras`;
  switch (condicao.tipo) {
    case TIPOS_CONDICAO.primeiraConversa:
      return "Sem atividade no CRM";
    case TIPOS_CONDICAO.temEtiqueta:
      return `Tem ${tags.find((tag) => tag.id === condicao.etiquetaId)?.nome || "etiqueta não escolhida"}`;
    case TIPOS_CONDICAO.estagioAtual:
      return `No estágio ${estagios.find((estagio) => estagio.id === condicao.stageId)?.nome || "não escolhido"}`;
    case TIPOS_CONDICAO.tarefaAtrasada:
      return "Tarefa atrasada";
    case TIPOS_CONDICAO.semInteracaoHa:
      return `Sem interação há ${condicao.dias || 0} dias`;
    case TIPOS_CONDICAO.diaDaSemana:
      return resumoDosDias(condicao.dias);
    case TIPOS_CONDICAO.janelaDeHorario:
      return `Das ${condicao.inicio || "--:--"} às ${condicao.fim || "--:--"}`;
    default:
      return "Condição";
  }
}

/** O título do cartão de início: o gatilho de verdade, não um texto fixo. */
function resumoDoGatilho(gatilho, { tags = [], estagios = [], campanhas = [] } = {}) {
  switch (gatilho?.tipo) {
    case TIPOS_GATILHO.palavra: {
      const palavras = (gatilho.palavras || []).filter((item) => item.trim());
      return palavras.length ? `Mensagem com “${palavras.slice(0, 2).join("”, “")}”${palavras.length > 2 ? "…" : ""}` : "Mensagem com palavra";
    }
    case TIPOS_GATILHO.manual:
      return "Iniciado pela equipe";
    case TIPOS_GATILHO.etiqueta:
      return `Etiqueta ${tags.find((tag) => tag.id === gatilho.etiquetaId)?.nome || "não escolhida"} aplicada`;
    case TIPOS_GATILHO.etapa:
      return `Negócio entra em ${estagios.find((estagio) => estagio.id === gatilho.stageId)?.nome || "etapa não escolhida"}`;
    case TIPOS_GATILHO.campanha:
      return `Lead da campanha ${campanhas.find((campanha) => campanha.id === gatilho.campanhaId)?.name || "não escolhida"}`;
    default:
      return "Nova mensagem do contato";
  }
}

/**
 * Gatilho que não é mensagem começa sem conferir condição; o banco ainda exige
 * uma na definição, e a de sempre fica guardada sem efeito.
 */
function condicoesParaGravar(form) {
  if (form.condicoes.length || !GATILHOS_SEM_MENSAGEM.has(form.gatilho?.tipo)) return form.condicoes;
  return [{ tipo: TIPOS_CONDICAO.primeiraConversa }];
}

/** Linhas em branco do gatilho por palavra não vão para o banco. */
function gatilhoParaGravar(gatilho) {
  if (gatilho?.tipo !== TIPOS_GATILHO.palavra) return gatilho;
  return { ...gatilho, palavras: (gatilho.palavras || []).map((item) => item.trim()).filter(Boolean) };
}

/** O gatilho nasce completo ao trocar de tipo. */
function gatilhoNovo(tipo) {
  if (tipo === TIPOS_GATILHO.palavra) return { tipo, palavras: [""] };
  if (tipo === TIPOS_GATILHO.etiqueta) return { tipo, etiquetaId: "" };
  if (tipo === TIPOS_GATILHO.etapa) return { tipo, stageId: "" };
  if (tipo === TIPOS_GATILHO.campanha) return { tipo, campanhaId: "" };
  return { tipo };
}

const OPCOES_DE_GATILHO = [
  [TIPOS_GATILHO.mensagem, "O contato manda uma mensagem"],
  [TIPOS_GATILHO.palavra, "A mensagem tem uma palavra"],
  [TIPOS_GATILHO.manual, "Alguém da equipe inicia (follow-up)", true],
  [TIPOS_GATILHO.etiqueta, "Uma etiqueta é aplicada", true],
  [TIPOS_GATILHO.etapa, "Um negócio muda de etapa do funil", true],
  [TIPOS_GATILHO.campanha, "Um lead entra numa campanha", true],
];

/** Como o fluxo começa. Os que não dependem de mensagem só existem com caminhos. */
function GatilhoEditor({ gatilho, ramificado, tags, estagios, campanhas, aoMudar }) {
  const tipo = gatilho?.tipo || TIPOS_GATILHO.mensagem;
  const palavras = gatilho?.palavras || [];
  return (
    <div className="grid gap-3">
      <CampoFormulario rotulo="O fluxo começa quando">
        <select value={tipo} onChange={(event) => aoMudar(gatilhoNovo(event.target.value))} className={entrada}>
          {OPCOES_DE_GATILHO.filter(([, , soComCaminhos]) => ramificado || !soComCaminhos).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>{rotulo}</option>
          ))}
        </select>
      </CampoFormulario>
      {tipo === TIPOS_GATILHO.palavra && (
        <CampoFormulario rotulo="Palavras ou frases">
          <textarea
            value={palavras.join("\n")}
            onChange={(event) => aoMudar({ ...gatilho, palavras: event.target.value.split("\n").slice(0, 20) })}
            rows={3}
            placeholder={"quero saber\npromoção"}
            className={`${entrada} resize-y leading-relaxed`}
          />
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">Uma por linha. Sem diferença entre maiúscula, minúscula ou acento. É assim que se separa o lead de cada anúncio: o “Clique para o WhatsApp” já manda o texto pronto.</p>
        </CampoFormulario>
      )}
      {tipo === TIPOS_GATILHO.etiqueta && (
        <CampoFormulario rotulo="Etiqueta">
          <select value={gatilho.etiquetaId || ""} onChange={(event) => aoMudar({ ...gatilho, etiquetaId: event.target.value })} className={entrada}>
            <option value="">Escolha a etiqueta</option>
            {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.nome}</option>)}
          </select>
        </CampoFormulario>
      )}
      {tipo === TIPOS_GATILHO.etapa && (
        <CampoFormulario rotulo="Etapa do funil">
          <select value={gatilho.stageId || ""} onChange={(event) => aoMudar({ ...gatilho, stageId: event.target.value })} className={entrada}>
            <option value="">Escolha a etapa</option>
            {estagios.map((estagio) => <option key={estagio.id} value={estagio.id}>{estagio.nome}</option>)}
          </select>
        </CampoFormulario>
      )}
      {tipo === TIPOS_GATILHO.campanha && (
        <CampoFormulario rotulo="Campanha">
          <select value={gatilho.campanhaId || ""} onChange={(event) => aoMudar({ ...gatilho, campanhaId: event.target.value })} className={entrada}>
            <option value="">Escolha a campanha</option>
            {campanhas.map((campanha) => <option key={campanha.id} value={campanha.id}>{campanha.name}</option>)}
          </select>
        </CampoFormulario>
      )}
      {GATILHOS_SEM_MENSAGEM.has(tipo) && (
        <div className="rounded-[10px] border border-accent/20 bg-accent-soft p-3 text-[11px] leading-relaxed text-accent-forte">
          {tipo === TIPOS_GATILHO.manual
            ? "O fluxo começa quando alguém da equipe o inicia na conversa, em “Iniciar fluxo”. Serve para follow-up: quem já conversou e parou de responder."
            : "O fluxo começa sozinho quando isso acontece, mesmo que o contato não tenha escrito agora. Quem tem a etiqueta “Não atender IA” não recebe."}
        </div>
      )}
    </div>
  );
}

/** "Pedir para escolher": a pergunta, as opções e o que fazer quando não entender. */
function PerguntaEditor({ passo, aoMudar }) {
  const opcoes = passo.opcoes || [];
  const mudarOpcao = (id, patch) => aoMudar({ ...passo, opcoes: opcoes.map((opcao) => (opcao.id === id ? { ...opcao, ...patch } : opcao)) });
  return (
    <div className="grid gap-4">
      <CampoFormulario rotulo="Pergunta">
        <textarea
          value={passo.texto}
          onChange={(event) => aoMudar({ ...passo, texto: event.target.value })}
          rows={4}
          placeholder="Oi {nome}! Como posso ajudar?"
          className={`${entrada} resize-y leading-relaxed`}
        />
        <p className="mt-1.5 text-[10.5px] text-faint">As opções vão numeradas logo abaixo da pergunta.</p>
      </CampoFormulario>
      <div>
        <p className="text-[11px] font-semibold text-fg">Opções</p>
        <div className="mt-2 grid gap-2">
          {opcoes.map((opcao, indice) => (
            <div key={opcao.id} className="rounded-[10px] border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="w-5 text-center text-[11px] font-bold text-faint">{indice + 1}</span>
                <input
                  value={opcao.rotulo}
                  onChange={(event) => mudarOpcao(opcao.id, { rotulo: event.target.value })}
                  maxLength={100}
                  placeholder="Agendar consulta"
                  className={`${entrada} min-w-0 flex-1 bg-bg`}
                />
                <button type="button" disabled={opcoes.length <= 1} onClick={() => aoMudar({ ...passo, opcoes: opcoes.filter((item) => item.id !== opcao.id) })} title="Remover opção" className="cursor-pointer rounded-[7px] p-2 text-sub hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={14} /></button>
              </div>
              <input
                value={(opcao.sinonimos || []).join(", ")}
                onChange={(event) => mudarOpcao(opcao.id, { sinonimos: event.target.value.split(",").map((item) => item.trimStart()).slice(0, 20) })}
                placeholder="Outras formas de dizer: marcar, horário"
                className={`${entrada} mt-2 bg-bg text-[12px]`}
              />
            </div>
          ))}
        </div>
        {opcoes.length < 10 && (
          <button type="button" onClick={() => aoMudar({ ...passo, opcoes: [...opcoes, { id: novoIdDeOpcao(), rotulo: "", sinonimos: [] }] })} className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-line-strong py-2.5 text-[11.5px] font-semibold text-sub hover:border-accent hover:text-accent-forte">
            <Plus size={14} /> Adicionar opção
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <CampoFormulario rotulo="Tentativas">
          <select value={passo.tentativas ?? 2} onChange={(event) => aoMudar({ ...passo, tentativas: Number(event.target.value) })} className={entrada}>
            {[1, 2, 3, 4, 5].map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </select>
        </CampoFormulario>
        <CampoFormulario rotulo="Espera (horas)">
          <input type="number" min={1} max={168} value={passo.prazoHoras ?? 24} onChange={(event) => aoMudar({ ...passo, prazoHoras: Math.max(1, Math.min(168, Math.trunc(Number(event.target.value) || 1))) })} className={entrada} />
        </CampoFormulario>
      </div>
      <CampoFormulario rotulo="Quando não entender (opcional)">
        <input value={passo.textoErro || ""} onChange={(event) => aoMudar({ ...passo, textoErro: event.target.value })} maxLength={1000} placeholder="Não entendi. Responda com o número de uma das opções:" className={entrada} />
      </CampoFormulario>
      <div className="rounded-[10px] border border-accent/20 bg-accent-soft p-3 text-[11px] leading-relaxed text-accent-forte">
        A resposta vale pelo número, pelo nome da opção, por uma palavra dela ou por um dos sinônimos. Sem entender depois das tentativas, ou sem resposta dentro da espera, a conversa segue por <strong>Não entendeu</strong>.
      </div>
    </div>
  );
}

/** "Pedir para digitar": guarda a resposta numa variável. */
function ColetaEditor({ passo, aoMudar }) {
  const variavel = passo.variavel || "";
  const reservada = VARIAVEIS_RESERVADAS.has(variavel);
  return (
    <div className="grid gap-4">
      <CampoFormulario rotulo="Pergunta">
        <textarea
          value={passo.texto}
          onChange={(event) => aoMudar({ ...passo, texto: event.target.value })}
          rows={4}
          placeholder="Qual é o seu melhor e-mail?"
          className={`${entrada} resize-y leading-relaxed`}
        />
      </CampoFormulario>
      <CampoFormulario rotulo="Guardar a resposta como">
        <input
          value={variavel}
          onChange={(event) => aoMudar({ ...passo, variavel: event.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]+/g, "_").slice(0, 40) })}
          placeholder="email_cliente"
          className={entrada}
        />
        <p className={`mt-1.5 text-[10.5px] ${reservada ? "text-danger" : "text-faint"}`}>
          {reservada ? `“${variavel}” já é do contato; escolha outro nome.` : <>Use nas mensagens seguintes como <code>{`{${variavel || "resposta"}}`}</code>.</>}
        </p>
      </CampoFormulario>
      <CampoFormulario rotulo="Espera (horas)">
        <input type="number" min={1} max={168} value={passo.prazoHoras ?? 24} onChange={(event) => aoMudar({ ...passo, prazoHoras: Math.max(1, Math.min(168, Math.trunc(Number(event.target.value) || 1))) })} className={entrada} />
      </CampoFormulario>
      <div className="rounded-[10px] border border-accent/20 bg-accent-soft p-3 text-[11px] leading-relaxed text-accent-forte">
        Quando o contato responder, a conversa segue por <strong>Respondeu</strong>. Sem resposta dentro da espera, segue por <strong>Não respondeu</strong>.
      </div>
    </div>
  );
}

/** "Seg a Sex", "Sáb e Dom", "Seg, Qua, Sex" — em ordem de domingo a sábado. */
function resumoDosDias(dias = []) {
  const marcados = [...new Set(dias)].filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6).sort();
  if (!marcados.length) return "Nenhum dia marcado";
  if (marcados.length === 7) return "Todos os dias";
  const seguidos = marcados.every((dia, i) => i === 0 || dia === marcados[i - 1] + 1);
  if (seguidos && marcados.length > 2) return `${DIAS_DA_SEMANA[marcados[0]]} a ${DIAS_DA_SEMANA[marcados.at(-1)]}`;
  const nomes = marcados.map((dia) => DIAS_DA_SEMANA[dia]);
  return nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

function resumoPasso(passo, tags, estagios) {
  if (passo.tipo === TIPOS_PASSO.enviarMensagem)
    return passo.texto?.trim() || "Escreva a mensagem que será enviada";
  if (passo.tipo === TIPOS_PASSO.transferir) {
    if (passo.destino === DESTINOS_TRANSFERENCIA.ia && passo.objetivoIa?.trim())
      return `IA: ${passo.objetivoIa.trim()}`;
    return `Entrega a conversa para: ${DESTINOS[passo.destino] || "—"}`;
  }
  if (passo.tipo === TIPOS_PASSO.condicao) {
    const grupo = grupoDa(passo.expressao);
    const juncao = grupo.operador === OPERADORES_LOGICOS.ou ? " ou " : " e ";
    return grupo.itens.map((item) => resumoCondicao(item, tags, estagios)).join(juncao) || "Escolha a regra";
  }
  if (passo.tipo === TIPOS_PASSO.encerrar) return "A conversa segue sem o fluxo";
  if (passo.tipo === TIPOS_PASSO.perguntar) return passo.texto?.trim() || "Escreva a pergunta e as opções";
  if (passo.tipo === TIPOS_PASSO.coletar)
    return passo.texto?.trim() ? `${passo.texto.trim()} → {${passo.variavel || "resposta"}}` : "Escreva o que perguntar";
  const adicionar = (passo.adicionar || []).map((id) => tags.find((tag) => tag.id === id)?.nome || id);
  const remover = (passo.remover || []).map((id) => tags.find((tag) => tag.id === id)?.nome || id);
  const partes = [];
  if (adicionar.length) partes.push(`Adicionar: ${adicionar.join(", ")}`);
  if (remover.length) partes.push(`Remover: ${remover.join(", ")}`);
  return partes.join(" · ") || "Escolha as etiquetas do contato";
}

/** Ao trocar o tipo, a regra nasce completa — o servidor recusa regra pela metade. */
function regraNova(tipo) {
  if (tipo === TIPOS_CONDICAO.semInteracaoHa) return { tipo, dias: 0 };
  if (tipo === TIPOS_CONDICAO.diaDaSemana) return regraDeDias();
  if (tipo === TIPOS_CONDICAO.janelaDeHorario) return regraDeHorario();
  return { tipo };
}

function CondicaoEditor({ condicao, tags, estagios, aoMudar, aoRemover, ramificado = false }) {
  const tipo = condicao.tipo;
  return (
    <div className="rounded-[10px] border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <select
          value={tipo}
          onChange={(event) => aoMudar(regraNova(event.target.value))}
          className={`${entrada} min-w-0 flex-1 bg-bg`}
        >
          <option value={TIPOS_CONDICAO.primeiraConversa}>Sem atividade no CRM</option>
          <option value={TIPOS_CONDICAO.temEtiqueta}>Tiver uma etiqueta</option>
          <option value={TIPOS_CONDICAO.estagioAtual}>Estiver no estágio</option>
          <option value={TIPOS_CONDICAO.tarefaAtrasada}>Tiver tarefa atrasada</option>
          <option value={TIPOS_CONDICAO.semInteracaoHa}>Sem interação há dias</option>
          {/* Relógio só no formato com caminhos: quem avalia é o executor da
              VPS, com o fuso da regra. */}
          {ramificado && <option value={TIPOS_CONDICAO.diaDaSemana}>For um destes dias</option>}
          {ramificado && <option value={TIPOS_CONDICAO.janelaDeHorario}>Estiver neste horário</option>}
        </select>
        <button type="button" onClick={aoRemover} title="Remover condição" className="cursor-pointer rounded-[7px] p-2 text-sub hover:bg-danger/10 hover:text-danger">
          <Trash2 size={14} />
        </button>
      </div>
      {tipo === TIPOS_CONDICAO.temEtiqueta && (
        <select value={condicao.etiquetaId || ""} onChange={(event) => aoMudar({ ...condicao, etiquetaId: event.target.value })} className={`${entrada} mt-2 bg-bg`}>
          <option value="">Escolha a etiqueta</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.nome}</option>)}
        </select>
      )}
      {tipo === TIPOS_CONDICAO.estagioAtual && (
        <select value={condicao.stageId || ""} onChange={(event) => aoMudar({ ...condicao, stageId: event.target.value })} className={`${entrada} mt-2 bg-bg`}>
          <option value="">Escolha o estágio</option>
          {estagios.map((estagio) => <option key={estagio.id} value={estagio.id}>{estagio.nome}</option>)}
        </select>
      )}
      {tipo === TIPOS_CONDICAO.semInteracaoHa && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] font-medium text-sub">Quantidade de dias</span>
          <input type="number" min="0" value={condicao.dias ?? 0} onChange={(event) => aoMudar({ ...condicao, dias: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} className={`${entrada} bg-bg`} />
        </label>
      )}
      {tipo === TIPOS_CONDICAO.diaDaSemana && (
        <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="Dias da semana">
          {DIAS_DA_SEMANA.map((nome, dia) => {
            const marcado = (condicao.dias || []).includes(dia);
            return (
              <button
                key={nome}
                type="button"
                aria-pressed={marcado}
                onClick={() => aoMudar({
                  ...condicao,
                  dias: marcado ? condicao.dias.filter((item) => item !== dia) : [...(condicao.dias || []), dia].sort(),
                })}
                className={`cursor-pointer rounded-[7px] border py-1.5 text-[11px] font-semibold ${marcado ? "border-accent bg-accent-soft text-accent-forte" : "border-line bg-bg text-sub hover:text-fg"}`}
              >
                {nome}
              </button>
            );
          })}
        </div>
      )}
      {tipo === TIPOS_CONDICAO.janelaDeHorario && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-sub">A partir das</span>
            <input type="time" value={condicao.inicio || ""} onChange={(event) => aoMudar({ ...condicao, inicio: event.target.value })} className={`${entrada} bg-bg`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-sub">Até as</span>
            <input type="time" value={condicao.fim || ""} onChange={(event) => aoMudar({ ...condicao, fim: event.target.value })} className={`${entrada} bg-bg`} />
          </label>
        </div>
      )}
      {(tipo === TIPOS_CONDICAO.diaDaSemana || tipo === TIPOS_CONDICAO.janelaDeHorario) && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] font-medium text-sub">Fuso do horário</span>
          <select value={condicao.fuso || FUSO_PADRAO} onChange={(event) => aoMudar({ ...condicao, fuso: event.target.value })} className={`${entrada} bg-bg`}>
            {FUSOS_DO_BRASIL.map((fuso) => <option key={fuso} value={fuso}>{fuso.replace("America/", "").replace("_", " ")}</option>)}
          </select>
          <span className="mt-1 block text-[10.5px] leading-relaxed text-faint">
            Quem escreve de outro estado é medido por este relógio, não pelo dele.
            {tipo === TIPOS_CONDICAO.janelaDeHorario && " Se o fim for antes do início, a janela atravessa a meia-noite."}
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * As regras de um bloco de condição: "todas" (E) ou "qualquer uma" (OU).
 *
 * Grupos dentro de grupos existem no modelo, mas não nesta tela; um grupo
 * aninhado que chegou de outro lugar aparece como uma linha só, que se pode
 * remover mas não abrir. Assim nada que o editor não sabe mostrar se perde.
 */
function ExpressaoEditor({ expressao, tags, estagios, aoMudar }) {
  const grupo = grupoDa(expressao);
  const mudarItens = (itens) => aoMudar({ operador: grupo.operador, itens });
  return (
    <div>
      <div className="flex rounded-[9px] border border-line bg-surface p-0.5" role="radiogroup" aria-label="Como as regras se combinam">
        {[
          [OPERADORES_LOGICOS.e, "Todas as regras"],
          [OPERADORES_LOGICOS.ou, "Qualquer uma"],
        ].map(([operador, rotulo]) => (
          <button
            key={operador}
            type="button"
            role="radio"
            aria-checked={grupo.operador === operador}
            onClick={() => aoMudar({ operador, itens: grupo.itens })}
            className={`flex-1 cursor-pointer rounded-[7px] py-1.5 text-[11.5px] font-semibold ${grupo.operador === operador ? "bg-bg text-fg shadow-sm" : "text-sub hover:text-fg"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2">
        {grupo.itens.map((item, indice) =>
          item?.operador ? (
            <div key={indice} className="flex items-center justify-between rounded-[10px] border border-line bg-surface p-3 text-[11.5px] text-sub">
              {resumoCondicao(item, tags, estagios)}
              <button type="button" onClick={() => mudarItens(grupo.itens.filter((_, i) => i !== indice))} title="Remover grupo" className="cursor-pointer rounded-[7px] p-2 text-sub hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
            </div>
          ) : (
            <CondicaoEditor
              key={indice}
              ramificado
              condicao={item}
              tags={tags}
              estagios={estagios}
              aoMudar={(proxima) => mudarItens(grupo.itens.map((atual, i) => (i === indice ? proxima : atual)))}
              aoRemover={() => mudarItens(grupo.itens.filter((_, i) => i !== indice))}
            />
          )
        )}
      </div>
      <button type="button" onClick={() => mudarItens([...grupo.itens, { tipo: TIPOS_CONDICAO.temEtiqueta, etiquetaId: "" }])} className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-line-strong py-2.5 text-[11.5px] font-semibold text-sub hover:border-accent hover:text-accent-forte">
        <Plus size={14} /> Adicionar regra
      </button>
      <div className="mt-3 rounded-[10px] border border-accent/20 bg-accent-soft p-3 text-[11px] leading-relaxed text-accent-forte">
        Se as regras atenderem, a conversa segue por <strong>Sim</strong>. Se não, por <strong>Não</strong>. Etiquetas alteradas antes deste bloco já contam.
      </div>
    </div>
  );
}

function Paleta({ blocos, ramificado, aoAdicionar }) {
  return (
    <aside className="z-10 flex w-[224px] flex-none flex-col border-r border-line bg-bg">
      <div className="border-b border-line px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-faint">Blocos</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-sub">Arraste para o mapa ou clique para adicionar.</p>
      </div>
      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
        {blocos.map(({ id, titulo, descricao, icone: Icone, classe }) => (
          <button
            key={id}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/emyleads-flow", id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => aoAdicionar(id)}
            className="group flex cursor-grab items-center gap-3 rounded-[11px] border border-line bg-bg p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md active:cursor-grabbing"
          >
            <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-[9px] ${classe}`}><Icone size={17} /></span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[12px] font-semibold text-fg">{titulo}</strong>
              <small className="mt-0.5 block text-[10.5px] text-sub">{descricao}</small>
            </span>
            <Plus size={14} className="text-faint group-hover:text-accent" />
          </button>
        ))}
        </div>
      </div>
      <div className="mt-auto flex-none border-t border-line p-4 text-[10.5px] leading-relaxed text-faint">
        {ramificado
          ? "Puxe uma saída até outro bloco, ou solte no vazio para escolher o bloco ali. Cada saída segue para um bloco só; vários caminhos podem chegar ao mesmo bloco."
          : "Puxe uma saída roxa até a entrada do próximo bloco. Cada saída segue para um bloco só, e “Transferir conversa” encerra o fluxo."}
      </div>
    </aside>
  );
}

/** O menu que aparece no `+`, na linha ou ao soltar uma conexão no vazio. */
function SeletorDeBloco({ seletor, blocos, aoEscolher, aoFechar }) {
  const lista = seletor.fio
    // No meio de uma ligação só cabe bloco que continua: um bloco final ali
    // deixaria o resto do caminho solto.
    ? blocos.filter((bloco) => ![TIPOS_PASSO.encerrar, TIPOS_PASSO.transferir].includes(bloco.tipo))
    : blocos;
  return (
    <div className="flow-seletor" style={{ left: seletor.tela.x, top: seletor.tela.y }} role="menu" aria-label="Escolha o bloco">
      <div className="flow-seletor__topo">
        <span>{seletor.fio ? "Inserir no meio" : seletor.origem ? `Depois de “${ROTULOS_SAIDA[seletor.origem.saida] || seletor.origem.saida}”` : "Novo bloco"}</span>
        <button type="button" onClick={aoFechar} aria-label="Fechar" className="cursor-pointer rounded-[6px] p-1 text-sub hover:bg-surface-hover hover:text-fg"><X size={13} /></button>
      </div>
      <div className="flow-seletor__lista">
        {lista.map(({ id, titulo, descricao, icone: Icone, classe }) => (
          <button key={id} type="button" role="menuitem" onClick={() => aoEscolher(id)} className="flow-seletor__item">
            <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-[8px] ${classe}`}><Icone size={15} /></span>
            <span className="min-w-0">
              <strong>{titulo}</strong>
              <small>{descricao}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Inspetor({ ramificado, selecionado, form, setForm, passos, atualizarPasso, tags, estagios, inteligencia, aoRemover }) {
  const passo = passos.find((item) => item.id === selecionado);
  const tiposDisponiveis = BLOCOS.filter((bloco) => bloco.id === bloco.tipo && (ramificado || !bloco.ramificado));

  return (
    <aside className="z-10 flex w-[326px] flex-none flex-col border-l border-line bg-bg">
      <div className="border-b border-line px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-faint">Propriedades</p>
        <h2 className="mt-1 text-[14px] font-semibold text-fg">
          {selecionado === NO_ENTRADA || selecionado === NO_CONDICOES ? "Início do fluxo" : passo ? TITULOS_PASSO[passo.tipo] : "Selecione um bloco"}
        </h2>
      </div>

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto p-4">
        {selecionado === NO_ENTRADA || selecionado === NO_CONDICOES ? (
          <div className="grid gap-4">
            <CampoFormulario rotulo="Nome do fluxo">
              <input value={form.nome} onChange={(event) => setForm((atual) => ({ ...atual, nome: event.target.value }))} className={entrada} />
            </CampoFormulario>
            <label className="flex cursor-pointer items-center justify-between rounded-[10px] border border-line bg-surface px-3 py-3">
              <span>
                <strong className="block text-[12px] font-semibold text-fg">Fluxo ativo</strong>
                <small className="mt-0.5 block text-[10.5px] text-sub">Desligado, ele não começa para ninguém</small>
              </span>
              <button type="button" role="switch" aria-checked={form.ativo} onClick={() => setForm((atual) => ({ ...atual, ativo: !atual.ativo }))} className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors ${form.ativo ? "bg-accent" : "bg-line-strong"}`}>
                <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.ativo ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </label>
            <GatilhoEditor
              gatilho={form.gatilho}
              ramificado={ramificado}
              tags={tags}
              estagios={estagios}
              campanhas={(inteligencia.campaigns || []).filter((campaign) => campaign.status !== "archived")}
              aoMudar={(gatilho) => setForm((atual) => ({ ...atual, gatilho }))}
            />
            {!GATILHOS_SEM_MENSAGEM.has(form.gatilho?.tipo) && (
              <div>
                <p className="text-[11px] font-semibold text-fg">Condições</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-sub">Todas precisam ser verdadeiras para o fluxo começar.</p>
                <div className="mt-2 grid gap-2">
                  {form.condicoes.map((condicao, indice) => (
                    <CondicaoEditor
                      key={indice}
                      ramificado={ramificado}
                      condicao={condicao}
                      tags={tags}
                      estagios={estagios}
                      aoMudar={(proxima) => setForm((atual) => ({ ...atual, condicoes: atual.condicoes.map((item, i) => i === indice ? proxima : item) }))}
                      aoRemover={() => setForm((atual) => ({ ...atual, condicoes: atual.condicoes.filter((_, i) => i !== indice) }))}
                    />
                  ))}
                </div>
                <button type="button" onClick={() => setForm((atual) => ({ ...atual, condicoes: [...atual.condicoes, { tipo: TIPOS_CONDICAO.primeiraConversa }] }))} className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-line-strong py-2.5 text-[11.5px] font-semibold text-sub hover:border-accent hover:text-accent-forte">
                  <Plus size={14} /> Adicionar condição
                </button>
              </div>
            )}
            {ramificado && (
              <p className="text-[10.5px] leading-relaxed text-faint">O fluxo roda no servidor da conexão de WhatsApp, mesmo com o portal fechado.</p>
            )}
          </div>
        ) : passo ? (
          <div className="grid gap-4">
            <CampoFormulario rotulo="Tipo de bloco">
              <select
                value={passo.tipo}
                onChange={(event) => atualizarPasso({ ...passoVazio(event.target.value), id: passo.id })}
                className={entrada}
              >
                {tiposDisponiveis.map((bloco) => <option key={bloco.tipo} value={bloco.tipo}>{bloco.titulo}</option>)}
              </select>
            </CampoFormulario>
            {passo.tipo === TIPOS_PASSO.enviarMensagem ? (
              <CampoFormulario rotulo="Mensagem">
                <textarea
                  value={passo.texto}
                  onChange={(event) => atualizarPasso({ ...passo, texto: event.target.value })}
                  rows={8}
                  placeholder="Olá {nome}! Como posso ajudar?"
                  className={`${entrada} resize-y leading-relaxed`}
                />
                <p className="mt-1.5 text-[10.5px] text-faint">
                  Variáveis: <code>{"{nome}"}</code>, <code>{"{empresa}"}</code>
                  {passos.filter((item) => item.tipo === TIPOS_PASSO.coletar && item.variavel).map((item) => (
                    <span key={item.id}>, <code>{`{${item.variavel}}`}</code></span>
                  ))}
                </p>
              </CampoFormulario>
            ) : passo.tipo === TIPOS_PASSO.perguntar ? (
              <PerguntaEditor passo={passo} aoMudar={atualizarPasso} />
            ) : passo.tipo === TIPOS_PASSO.coletar ? (
              <ColetaEditor passo={passo} aoMudar={atualizarPasso} />
            ) : passo.tipo === TIPOS_PASSO.condicao ? (
              <ExpressaoEditor expressao={passo.expressao} tags={tags} estagios={estagios} aoMudar={(expressao) => atualizarPasso({ ...passo, expressao })} />
            ) : passo.tipo === TIPOS_PASSO.encerrar ? (
              <div className="rounded-[10px] border border-line bg-surface p-3 text-[11px] leading-relaxed text-sub">
                O fluxo termina aqui. A conversa continua com quem já a atendia, sem mais mensagens automáticas deste fluxo.
              </div>
            ) : passo.tipo === TIPOS_PASSO.transferir ? (
              <div className="grid gap-4">
                <CampoFormulario rotulo="Entregar a conversa para">
                  <select
                    value={passo.destino}
                    onChange={(event) => atualizarPasso({ ...passo, destino: event.target.value })}
                    className={entrada}
                  >
                    <option value={DESTINOS_TRANSFERENCIA.humano}>Um atendente humano</option>
                    <option value={DESTINOS_TRANSFERENCIA.ia}>O agente de IA</option>
                  </select>
                </CampoFormulario>
                <CampoFormulario rotulo="Motivo (opcional)">
                  <input
                    value={passo.motivo || ""}
                    onChange={(event) => atualizarPasso({ ...passo, motivo: event.target.value })}
                    placeholder="Pedido de orçamento"
                    className={entrada}
                  />
                  <p className="mt-1.5 text-[10.5px] text-faint">Aparece na lista de atendimentos, para quem for assumir.</p>
                </CampoFormulario>
                {passo.destino === DESTINOS_TRANSFERENCIA.ia && <>
                  <CampoFormulario rotulo="Como a IA deve entrar">
                    <select value={passo.alvoIa || ALVOS_IA.recepcao} onChange={(event) => atualizarPasso({ ...passo, alvoIa: event.target.value, skillId: null, campanhaId: null })} className={entrada}>
                      <option value={ALVOS_IA.recepcao}>Recepção — entender a necessidade</option>
                      <option value={ALVOS_IA.skill}>Uma habilidade específica</option>
                      <option value={ALVOS_IA.campanha}>Uma campanha específica</option>
                    </select>
                  </CampoFormulario>
                  {(passo.alvoIa || ALVOS_IA.recepcao) === ALVOS_IA.skill && <CampoFormulario rotulo="Habilidade">
                    <select value={passo.skillId || ""} onChange={(event) => atualizarPasso({ ...passo, skillId: event.target.value || null })} className={entrada}>
                      <option value="">Escolha uma habilidade</option>
                      {(inteligencia.skills || []).filter((skill) => skill.status === "published" && ["customer", "both"].includes(skill.audience)).map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                    </select>
                  </CampoFormulario>}
                  {(passo.alvoIa || ALVOS_IA.recepcao) === ALVOS_IA.campanha && <CampoFormulario rotulo="Campanha">
                    <select value={passo.campanhaId || ""} onChange={(event) => atualizarPasso({ ...passo, campanhaId: event.target.value || null })} className={entrada}>
                      <option value="">Escolha uma campanha ativa ou de teste</option>
                      {(inteligencia.campaigns || []).filter((campaign) => ["active", "test"].includes(campaign.status)).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                    </select>
                  </CampoFormulario>}
                  {ramificado ? (
                    <CampoFormulario rotulo="O que a IA precisa conseguir">
                      <textarea
                        value={passo.objetivoIa || ""}
                        onChange={(event) => atualizarPasso({ ...passo, objetivoIa: event.target.value })}
                        rows={4}
                        maxLength={2000}
                        placeholder="Descobrir o serviço que o contato procura e o melhor horário para ele"
                        className={`${entrada} resize-y leading-relaxed`}
                      />
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
                        Quando a IA conseguir, o fluxo segue por <strong>Sucesso</strong>. Se ela não conseguir, ou se passarem 24 horas, segue por <strong>Falha</strong>. Se alguém da equipe assumir a conversa, o fluxo para.
                      </p>
                    </CampoFormulario>
                  ) : (
                    <div className="grid gap-3 rounded-[10px] border border-line bg-surface p-3">
                      <p className="text-[10.5px] font-semibold text-fg">Depois que a IA terminar</p>
                      <label className="text-[10px] text-sub">Em sucesso
                        <select value={passo.retornoPassoId || ""} onChange={(event) => atualizarPasso({ ...passo, retornoPassoId: event.target.value || null })} className={`${entrada} mt-1`}>
                          <option value="">Encerrar o fluxo</option>
                          {passos.filter((item) => item.id !== passo.id).map((item) => <option key={item.id} value={item.id}>{TITULOS_PASSO[item.tipo]} · {item.id}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] text-sub">Em falha
                        <select value={passo.falhaPassoId || ""} onChange={(event) => atualizarPasso({ ...passo, falhaPassoId: event.target.value || null })} className={`${entrada} mt-1`}>
                          <option value="">Encerrar e registrar a falha</option>
                          {passos.filter((item) => item.id !== passo.id).map((item) => <option key={item.id} value={item.id}>{TITULOS_PASSO[item.tipo]} · {item.id}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                </>}
                <div className="rounded-[10px] border border-accent/20 bg-accent-soft p-3 text-[11px] leading-relaxed text-accent-forte">
                  {ramificado
                    ? passo.destino === DESTINOS_TRANSFERENCIA.ia
                      ? "Ligue as saídas Sucesso e Falha no mapa para dizer por onde a conversa segue depois da IA."
                      : "Para uma pessoa, o fluxo termina aqui."
                    : "A transferência acontece depois do envio confirmado. Para uma pessoa, o fluxo termina. Para a IA, você pode definir o ponto exato de retorno ou falha."}
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                <SeletorEtiquetas tags={tags} valores={passo.adicionar || []} aoMudar={(adicionar) => atualizarPasso({ ...passo, adicionar })} rotulo="Adicionar" />
                <SeletorEtiquetas tags={tags} valores={passo.remover || []} aoMudar={(remover) => atualizarPasso({ ...passo, remover })} rotulo="Remover" />
              </div>
            )}
            <button type="button" onClick={() => aoRemover(passo.id)} className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-danger/20 py-2.5 text-[11.5px] font-semibold text-danger hover:bg-danger/10">
              <Trash2 size={14} /> Excluir bloco
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-hover text-faint"><CircleHelp size={19} /></span>
            <p className="mt-3 text-[12px] font-semibold text-fg">Clique em um card</p>
            <p className="mt-1 text-[11px] leading-relaxed text-sub">As configurações do bloco aparecem aqui, sem ocupar espaço no mapa.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Para o formato com caminhos: tira os campos que o canvas substituiu. */
const semDestinosEscondidos = (passo) =>
  passo.tipo === TIPOS_PASSO.transferir ? { ...passo, retornoPassoId: null, falhaPassoId: null } : passo;

/**
 * O construtor de fluxo.
 *
 * `ramificado` liga o formato com caminhos (canvas v3): condição, encerrar e
 * as saídas Sucesso/Falha da IA. Vem da função `fluxos_ramificados` da
 * empresa, porque um fluxo assim só roda onde o executor da VPS está ligado.
 * Um fluxo que já é v3 abre como v3 mesmo sem a função — regravá-lo como v2
 * apagaria os caminhos.
 */
export default function ChatbotEditor({ chatbot, tags = [], estagios = [], recarregar, aoFechar, ramificado: liberado = false }) {
  const ramificado = liberado || chatbot?.canvas?.versao === VERSAO_CANVAS_RAMIFICADO;
  const blocos = useMemo(() => BLOCOS.filter((bloco) => ramificado || !bloco.ramificado), [ramificado]);
  const [inteligencia, setInteligencia] = useState({ skills: [], campaigns: [] });
  useEffect(() => {
    api.inteligencia.carregar().then((dados) => setInteligencia({ skills: dados.skills || [], campaigns: dados.campaigns || [] })).catch(() => {});
  }, []);
  const novo = !chatbot;
  const iniciais = useMemo(() => {
    const passos = clonarPassos(chatbot?.passos || []);
    return {
      form: {
        nome: chatbot?.nome || "Novo chatbot",
        ativo: chatbot?.ativo ?? true,
        condicoes: chatbot?.condicoes?.map((condicao) => ({ ...condicao })) || [{ tipo: TIPOS_CONDICAO.primeiraConversa }],
        gatilho: { ...gatilhoDo(chatbot) },
      },
      passos,
      grafo: criarGrafoInicial(passos, chatbot?.canvas, { ramificado }),
    };
  }, [chatbot, ramificado]);
  const [form, setForm] = useState(iniciais.form);
  const [passos, setPassos] = useState(iniciais.passos);
  const [nos, setNos, aoMudarNos] = useNodesState(iniciais.grafo.nos);
  const [conexoes, setConexoes, aoMudarConexoes] = useEdgesState(
    iniciais.grafo.conexoes.map((conexao) => novaConexao(conexao.source, conexao.target, conexao.saida))
  );
  const [selecionado, setSelecionado] = useState(NO_CONDICOES);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [seletor, setSeletor] = useState(null);
  const [fioEmFoco, setFioEmFoco] = useState(null);
  const instancia = useRef(null);
  const area = useRef(null);
  const relogioDoFoco = useRef(null);

  const versao = ramificado ? VERSAO_CANVAS_RAMIFICADO : undefined;
  const caminho = useMemo(() => validarGrafo(passos, conexoes), [passos, conexoes]);
  // No v3 o selo diz o que o servidor recusaria, não só o que falta ligar.
  const pendencia = useMemo(() => {
    if (!ramificado) return caminho.erro;
    return problemaParaOServidor({
      condicoes: condicoesParaGravar(form),
      gatilho: gatilhoParaGravar(form.gatilho),
      passos: passos.map(semDestinosEscondidos),
      canvas: serializarCanvas([], conexoes, VERSAO_CANVAS_RAMIFICADO),
    });
  }, [ramificado, caminho.erro, form, passos, conexoes]);
  const assinaturaInicial = useMemo(
    () => JSON.stringify({ form: iniciais.form, passos: iniciais.passos, canvas: serializarCanvas(iniciais.grafo.nos, iniciais.grafo.conexoes, versao) }),
    [iniciais, versao]
  );
  const alterado = novo || JSON.stringify({ form, passos, canvas: serializarCanvas(nos, conexoes, versao) }) !== assinaturaInicial;
  const ordemVisual = caminho.erro ? passos.map((passo) => passo.id) : caminho.ordem;
  const indicePrimeiraMensagem = ordemVisual.findIndex((id) => passos.find((passo) => passo.id === id)?.tipo === TIPOS_PASSO.enviarMensagem);

  /** Saídas de um nó que ainda não seguem para lugar nenhum. */
  const saidasLivres = (id, saidas) =>
    saidas.filter((saida) => !conexoes.some((conexao) => conexao.source === id && (conexao.saida || SAIDA_PADRAO) === saida));

  const abrirSeletor = (evento, extra) => {
    const ponto = evento?.changedTouches?.[0] || evento;
    const caixa = area.current?.getBoundingClientRect();
    if (!ponto || !caixa || !instancia.current) return;
    setSeletor({
      tela: {
        x: Math.max(8, Math.min(ponto.clientX - caixa.left, caixa.width - 250)),
        y: Math.max(8, Math.min(ponto.clientY - caixa.top, caixa.height - 320)),
      },
      fluxo: instancia.current.screenToFlowPosition({ x: ponto.clientX, y: ponto.clientY }),
      ...extra,
    });
  };

  const nosExibidos = useMemo(
    () => nos.map((no) => {
      // O disparo continua no dado (o banco valida entrada → condições), mas o
      // mapa mostra um cartão só de início.
      if (no.id === NO_ENTRADA)
        return { ...no, hidden: true, data: { nome: form.nome, ativo: form.ativo } };
      if (no.id === NO_CONDICOES)
        return {
          ...no,
          deletable: false,
          data: {
            gatilho: resumoDoGatilho(form.gatilho, { tags, estagios, campanhas: inteligencia.campaigns || [] }),
            comMensagem: !GATILHOS_SEM_MENSAGEM.has(form.gatilho?.tipo),
            ativo: form.ativo,
            quantidade: form.condicoes.length,
            resumos: form.condicoes.map((condicao) => resumoCondicao(condicao, tags, estagios)),
            livres: saidasLivres(NO_CONDICOES, [SAIDA_PADRAO]),
            aoPedirBloco: (saida, evento) => abrirSeletor(evento, { origem: { source: NO_CONDICOES, saida } }),
          },
        };
      const passo = passos.find((item) => item.id === no.id);
      const indice = ordemVisual.indexOf(no.id);
      const saidas = passo ? saidasDoPasso(passo) : [];
      return {
        ...no,
        data: {
          passoId: no.id,
          tipo: passo?.tipo,
          indice,
          resumo: passo ? resumoPasso(passo, tags, estagios) : "Bloco indisponível",
          // Só o executor antigo para na primeira mensagem.
          alerta: !ramificado && passo?.tipo !== TIPOS_PASSO.transferir && indicePrimeiraMensagem >= 0 && indice > indicePrimeiraMensagem,
          // No v2 a transferência para IA é terminal: as portas Sucesso/Falha
          // só existem quando há quem as execute.
          saidas: !ramificado && passo?.tipo === TIPOS_PASSO.transferir ? [] : saidas,
          rotulos: passo ? Object.fromEntries(saidas.map((saida) => [saida, rotuloDaSaida(passo, saida)])) : {},
          livres: saidasLivres(no.id, saidas),
          aoPedirBloco: (saida, evento) => abrirSeletor(evento, { origem: { source: no.id, saida } }),
        },
      };
    }),
    [nos, form, passos, tags, estagios, ordemVisual, indicePrimeiraMensagem, conexoes, ramificado, inteligencia]
  );

  const focarFio = (id) => {
    clearTimeout(relogioDoFoco.current);
    setFioEmFoco(id);
  };
  const desfocarFio = (id) => {
    clearTimeout(relogioDoFoco.current);
    // Uma folga para o mouse sair da linha e chegar na barra sem ela sumir.
    relogioDoFoco.current = setTimeout(() => setFioEmFoco((atual) => (atual === id ? null : atual)), 240);
  };
  const removerConexao = (id) => {
    setConexoes((atuais) => atuais.filter((conexao) => conexao.id !== id));
    setFioEmFoco(null);
  };

  const conexoesExibidas = useMemo(
    () => conexoes.map((conexao) => {
      const acesa = selecionado && (conexao.source === selecionado || conexao.target === selecionado);
      return {
        ...conexao,
        hidden: conexao.source === NO_ENTRADA,
        type: "fio",
        markerEnd: { type: MarkerType.ArrowClosed, color: acesa ? "var(--el-accent)" : "var(--el-line-strong)" },
        data: {
          acesa,
          emFoco: fioEmFoco === conexao.id,
          aoInserir: (id, evento) => abrirSeletor(evento, { fio: id }),
          aoRemover: removerConexao,
          aoFocar: focarFio,
          aoDesfocar: desfocarFio,
        },
      };
    }),
    [conexoes, selecionado, fioEmFoco]
  );

  const permitida = (conexao, ignorarId = null) => conexaoPermitida(conexoes, conexao, { ramificado, ignorarId });

  const conectar = (conexao) => {
    const saida = conexao.sourceHandle || SAIDA_PADRAO;
    if (!permitida({ ...conexao, saida })) return;
    setConexoes((atuais) => [...atuais, novaConexao(conexao.source, conexao.target, saida)]);
    setErro("");
  };

  /**
   * Onde pendurar um bloco criado pela paleta, sem origem explícita.
   *
   * Primeiro no bloco escolhido: numa saída livre, ou no meio da ligação que
   * já existe, se ele só tem uma. Senão, na primeira saída livre do caminho.
   * Sem nenhuma, o bloco nasce solto e quem monta o fluxo liga.
   */
  const origemAutomatica = () => {
    const saidasDe = (id) => {
      if (id === NO_CONDICOES) return [SAIDA_PADRAO];
      const passo = passos.find((item) => item.id === id);
      if (!passo || (!ramificado && passo.tipo === TIPOS_PASSO.transferir)) return [];
      return saidasDoPasso(passo);
    };
    if (selecionado && selecionado !== NO_ENTRADA) {
      const saidas = saidasDe(selecionado);
      const livre = saidasLivres(selecionado, saidas)[0];
      if (livre) return { source: selecionado, saida: livre };
      if (saidas.length === 1) {
        const ocupada = conexoes.find((conexao) => conexao.source === selecionado);
        return { source: selecionado, saida: saidas[0], dividir: ocupada };
      }
    }
    for (const id of [NO_CONDICOES, ...ordemVisual]) {
      const livre = saidasLivres(id, saidasDe(id))[0];
      if (livre) return { source: id, saida: livre };
    }
    return null;
  };

  const criarBloco = (idDoBloco, { posicao = null, origem = null, fio = null } = {}) => {
    const bloco = BLOCOS.find((item) => item.id === idDoBloco);
    if (!bloco) return;
    const { tipo } = bloco;
    const passo = passoVazio(tipo, bloco.regra);
    const saidasDoNovo = !ramificado && tipo === TIPOS_PASSO.transferir ? [] : saidasDoPasso(passo);
    const ligacoes = [];
    let removerId = null;
    let origemFinal = origem;

    if (fio) {
      const antiga = conexoes.find((conexao) => conexao.id === fio);
      if (antiga) {
        removerId = antiga.id;
        origemFinal = { source: antiga.source, saida: antiga.saida || SAIDA_PADRAO };
        ligacoes.push(novaConexao(antiga.source, passo.id, origemFinal.saida));
        if (saidasDoNovo.length) ligacoes.push(novaConexao(passo.id, antiga.target, saidasDoNovo[0]));
      }
    } else {
      origemFinal = origem || origemAutomatica();
      if (origemFinal?.dividir) {
        removerId = origemFinal.dividir.id;
        if (saidasDoNovo.length) ligacoes.push(novaConexao(passo.id, origemFinal.dividir.target, saidasDoNovo[0]));
      }
      if (origemFinal) ligacoes.push(novaConexao(origemFinal.source, passo.id, origemFinal.saida));
    }

    const noOrigem = origemFinal ? nos.find((no) => no.id === origemFinal.source) : null;
    const saidasDaOrigem = origemFinal?.source === NO_CONDICOES
      ? [SAIDA_PADRAO]
      : saidasDoPasso(passos.find((item) => item.id === origemFinal?.source));
    const deslocamento = saidasDaOrigem.length > 1
      ? (saidasDaOrigem.indexOf(origemFinal.saida) - (saidasDaOrigem.length - 1) / 2) * 230
      : 0;
    const proximaPosicao = posicao || {
      x: (noOrigem?.position.x ?? 380) + 380,
      y: (noOrigem?.position.y ?? 176) + deslocamento,
    };

    setPassos((atuais) => [...atuais, passo]);
    setNos((atuais) => [...atuais, { id: passo.id, type: "acao", position: proximaPosicao, data: { passoId: passo.id } }]);
    setConexoes((atuais) => [...atuais.filter((conexao) => conexao.id !== removerId), ...ligacoes]);
    setSelecionado(passo.id);
    setSeletor(null);
    setErro("");
    if (!posicao) {
      requestAnimationFrame(() =>
        instancia.current?.setCenter(proximaPosicao.x + 138, proximaPosicao.y + 78, { zoom: 0.92, duration: 380 })
      );
    }
  };

  const escolherNoSeletor = (idDoBloco) => {
    if (!seletor) return;
    if (seletor.fio) criarBloco(idDoBloco, { fio: seletor.fio });
    else criarBloco(idDoBloco, { posicao: seletor.fluxo, origem: seletor.origem || null });
  };

  /**
   * Trocar o tipo ou o destino de um bloco muda as saídas que ele tem. As
   * ligações que saíam por uma porta que deixou de existir vão embora; se o
   * bloco tinha e continua tendo uma saída só, a ligação é preservada.
   */
  const atualizarPasso = (proximo) => {
    const anterior = passos.find((item) => item.id === proximo.id);
    setPassos((atuais) => atuais.map((item) => (item.id === proximo.id ? proximo : item)));
    const saidasDe = (passo) => (!ramificado && passo?.tipo === TIPOS_PASSO.transferir ? [] : saidasDoPasso(passo));
    const antes = saidasDe(anterior);
    const depois = saidasDe(proximo);
    if (antes.join() === depois.join()) return;
    setConexoes((atuais) => {
      const saindo = atuais.filter((conexao) => conexao.source === proximo.id);
      const resto = atuais.filter((conexao) => conexao.source !== proximo.id);
      const ficam = saindo.filter((conexao) => depois.includes(conexao.saida || SAIDA_PADRAO));
      if (depois.length === 1 && saindo.length === 1 && !ficam.length)
        return [...resto, novaConexao(proximo.id, saindo[0].target, depois[0])];
      return [...resto, ...ficam];
    });
  };

  const removerPasso = (id, removerNo = true) => {
    setPassos((atuais) => atuais.filter((passo) => passo.id !== id));
    if (removerNo) setNos((atuais) => atuais.filter((no) => no.id !== id));
    setConexoes((atuais) => {
      const chegando = atuais.filter((conexao) => conexao.target === id);
      const saindo = atuais.filter((conexao) => conexao.source === id);
      const proximas = atuais.filter((conexao) => conexao.source !== id && conexao.target !== id);
      // Com uma saída só, quem chegava ao bloco passa a chegar aonde ele ia.
      if (saindo.length === 1) {
        for (const anterior of chegando) {
          const ponte = novaConexao(anterior.source, saindo[0].target, anterior.saida || SAIDA_PADRAO);
          if (conexaoPermitida(proximas, ponte, { ramificado })) proximas.push(ponte);
        }
      }
      return proximas;
    });
    setSelecionado(NO_CONDICOES);
  };

  const organizar = () => {
    let posicoes;
    if (ramificado) {
      posicoes = posicoesEmColunas(nos.map((no) => no.id), conexoes);
    } else {
      const ordem = [NO_ENTRADA, NO_CONDICOES, ...(caminho.erro ? passos.map((passo) => passo.id) : caminho.ordem)];
      posicoes = new Map(ordem.map((id, indice) => [id, { x: 72 + indice * 380, y: indice % 2 === 0 ? 176 : 236 }]));
    }
    setNos((atuais) => atuais.map((no) => ({ ...no, position: posicoes.get(no.id) || no.position })));
    requestAnimationFrame(() => instancia.current?.fitView({ padding: 0.18, duration: 420 }));
  };

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      if (!form.nome.trim()) throw new Error("Informe um nome para o chatbot.");
      const condicoes = condicoesParaGravar(form);
      if (!condicoes.length) throw new Error("Adicione ao menos uma condição.");
      const gatilho = gatilhoParaGravar(form.gatilho);
      if (passos.some((item) => item.tipo === TIPOS_PASSO.coletar && VARIAVEIS_RESERVADAS.has(item.variavel)))
        throw new Error("“nome” e “empresa” já são do contato. Dê outro nome à variável do bloco “Pedir para digitar”.");
      if (!passos.length) throw new Error("Adicione ao menos um bloco de ação.");
      const passosGravados = ramificado ? passos.map(semDestinosEscondidos) : passos;
      const canvas = serializarCanvas(nos, conexoes, versao);
      if (ramificado) {
        // A mesma conferência que o servidor faz quando a conversa começa:
        // recusar agora, com o motivo, em vez de falhar na frente do cliente.
        const problema = problemaParaOServidor({ condicoes, gatilho, passos: passosGravados, canvas });
        if (problema) throw new Error(problema);
      }
      const validacao = validarGrafo(passosGravados, conexoes, { versao });
      if (validacao.erro) throw new Error(validacao.erro);
      const dados = {
        nome: form.nome.trim(),
        ativo: form.ativo,
        condicoes,
        gatilho,
        passos: validacao.passos,
        canvas,
      };
      if (novo) await api.chatbots.criar(dados);
      else await api.chatbots.atualizar({ id: chatbot.id, patch: dados });
      await recarregar();
      aoFechar();
    } catch (err) {
      setErro(err?.message || "Não foi possível salvar o chatbot.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      <header className="z-20 flex h-[68px] flex-none items-center gap-3 border-b border-line bg-bg px-5">
        <button type="button" onClick={aoFechar} title="Voltar para chatbots" className="cursor-pointer rounded-[9px] p-2 text-sub hover:bg-surface-hover hover:text-fg"><ArrowLeft size={18} /></button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[.13em] text-accent">Construtor de fluxo</p>
            <span className={`h-1.5 w-1.5 rounded-full ${form.ativo ? "bg-success" : "bg-faint"}`} />
            {ramificado && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[9.5px] font-semibold text-accent-forte">Com caminhos</span>}
          </div>
          <h1 className="max-w-[440px] truncate text-[18px] font-semibold tracking-tight text-fg">{form.nome || "Fluxo sem nome"}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            title={pendencia || undefined}
            className={`hidden rounded-full px-2.5 py-1 text-[10.5px] font-semibold lg:inline-flex ${pendencia || alterado ? "bg-warning/10 text-warning" : "bg-success-soft text-success"}`}
          >
            {pendencia ? "Fluxo incompleto" : alterado ? "Alterações não salvas" : `${passos.length + 1} blocos conectados`}
          </span>
          <button type="button" onClick={organizar} className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-3 py-2 text-[11.5px] font-semibold text-sub hover:border-line-strong hover:text-fg">
            <LayoutDashboard size={14} /> Organizar
          </button>
          <BotaoPrimario type="button" onClick={salvar} disabled={salvando}><Save size={15} />{salvando ? "Salvando…" : "Salvar fluxo"}</BotaoPrimario>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Paleta blocos={blocos} ramificado={ramificado} aoAdicionar={(idDoBloco) => criarBloco(idDoBloco)} />
        <main ref={area} className="chatbot-flow relative min-w-0 flex-1 bg-surface">
          {erro && (
            <div role="alert" className="absolute left-1/2 top-4 z-20 flex max-w-[520px] -translate-x-1/2 items-center gap-2 rounded-[10px] border border-danger/25 bg-bg px-4 py-2.5 text-[11.5px] font-medium text-danger shadow-lg">
              <span className="h-2 w-2 flex-none rounded-full bg-danger" /> {erro}
            </div>
          )}
          {seletor && (
            <SeletorDeBloco seletor={seletor} blocos={blocos} aoEscolher={escolherNoSeletor} aoFechar={() => setSeletor(null)} />
          )}
          <ReactFlow
            nodes={nosExibidos}
            edges={conexoesExibidas}
            nodeTypes={tiposDeNo}
            edgeTypes={tiposDeFio}
            onInit={(reactFlow) => { instancia.current = reactFlow; }}
            onNodesChange={aoMudarNos}
            onEdgesChange={aoMudarConexoes}
            onConnect={conectar}
            onConnectEnd={(evento, estado) => {
              // Soltar a conexão no vazio: o construtor pergunta o que vai ali,
              // e o bloco nasce já ligado a esta saída.
              if (estado?.toNode || !estado?.fromNode || estado.fromHandle?.type !== "source") return;
              const saida = estado.fromHandle.id || SAIDA_PADRAO;
              if (!saidasLivres(estado.fromNode.id, [saida]).length) return;
              // Soltar em cima de um cartão, fora da bolinha, é ligar a ele: o
              // React Flow só reconhece a porta, mas a intenção é clara.
              const ponto = evento?.changedTouches?.[0] || evento;
              const sob = ponto && document.elementFromPoint(ponto.clientX, ponto.clientY);
              const alvo = sob?.closest?.(".react-flow__node")?.getAttribute("data-id");
              if (alvo) {
                conectar({ source: estado.fromNode.id, sourceHandle: saida, target: alvo, targetHandle: "entrada" });
                return;
              }
              abrirSeletor(evento, { origem: { source: estado.fromNode.id, saida } });
            }}
            onReconnect={(conexaoAntiga, proxima) => {
              const saida = proxima.sourceHandle || conexaoAntiga.saida || SAIDA_PADRAO;
              if (!permitida({ ...proxima, saida }, conexaoAntiga.id)) return;
              setConexoes((atuais) => reconnectEdge(
                conexaoAntiga,
                { ...proxima, saida, sourceHandle: saida, id: idConexao(proxima.source, proxima.target, saida) },
                atuais
              ));
            }}
            onEdgeMouseEnter={(_, conexao) => focarFio(conexao.id)}
            onEdgeMouseLeave={(_, conexao) => desfocarFio(conexao.id)}
            onNodeClick={(_, no) => setSelecionado(no.id)}
            onPaneClick={() => { setSelecionado(null); setSeletor(null); }}
            onNodesDelete={(removidos) => removidos.filter((no) => ![NO_ENTRADA, NO_CONDICOES].includes(no.id)).forEach((no) => removerPasso(no.id, false))}
            isValidConnection={(conexao) => permitida(conexao)}
            connectionMode={ConnectionMode.Strict}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.28}
            maxZoom={1.7}
            panOnScroll
            selectionOnDrag
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
            onDrop={(event) => {
              event.preventDefault();
              const idDoBloco = event.dataTransfer.getData("application/emyleads-flow");
              if (!blocos.some((bloco) => bloco.id === idDoBloco) || !instancia.current) return;
              criarBloco(idDoBloco, { posicao: instancia.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={19} size={1.2} color="var(--flow-grid)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={(no) => no.id === NO_ENTRADA ? "var(--el-accent)" : no.id === NO_CONDICOES ? "var(--el-warning)" : "var(--el-line-strong)"}
              maskColor="color-mix(in srgb, var(--el-surface) 72%, transparent)"
            />
          </ReactFlow>
        </main>
        <Inspetor
          ramificado={ramificado}
          selecionado={selecionado}
          form={form}
          setForm={setForm}
          passos={passos}
          atualizarPasso={atualizarPasso}
          tags={tags}
          estagios={estagios}
          inteligencia={inteligencia}
          aoRemover={removerPasso}
        />
      </div>
    </div>
  );
}
