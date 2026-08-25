import { useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
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
  CircleHelp,
  GitBranch,
  LayoutDashboard,
  MessageSquareText,
  Plus,
  Share2,
  Save,
  Tags,
  Trash2,
} from "lucide-react";
import { api } from "../../data/client";
import { ALVOS_IA, DESTINOS_TRANSFERENCIA, TIPOS_PASSO } from "../../domain/chatbots";
import { TIPOS_CONDICAO } from "../../domain/regras";
import { BotaoPrimario } from "../ui";
import { CampoFormulario, SeletorEtiquetas } from "./gestaoCompartilhados";
import { tiposDeNo } from "./ChatbotFlowNodes";
import {
  idConexao,
  NO_CONDICOES,
  NO_ENTRADA,
  SAIDA_PADRAO,
  ultimoNoDoCaminho,
  validarGrafo,
} from "../../domain/chatbotGrafo";
import { criarGrafoInicial, serializarCanvas } from "./chatbotFlow";
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
};

const DESTINOS = {
  [DESTINOS_TRANSFERENCIA.humano]: "Um atendente humano",
  [DESTINOS_TRANSFERENCIA.ia]: "O agente de IA",
};

function passoVazio(tipo) {
  if (tipo === TIPOS_PASSO.enviarMensagem) return { id: novoId(), tipo, texto: "" };
  // Padrão humano de propósito: transferir para uma pessoa é sempre seguro.
  // Passar para a IA é que precisa ser uma escolha.
  if (tipo === TIPOS_PASSO.transferir)
    return { id: novoId(), tipo, destino: DESTINOS_TRANSFERENCIA.humano, motivo: "", alvoIa: ALVOS_IA.recepcao, skillId: null, campanhaId: null, retornoPassoId: null, falhaPassoId: null };
  return { id: novoId(), tipo, adicionar: [], remover: [] };
}

const novaConexao = (source, target, saida = SAIDA_PADRAO) => ({
  id: idConexao(source, target, saida),
  source,
  target,
  saida,
  type: "smoothstep",
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--el-accent)" },
});

function resumoCondicao(condicao, tags, estagios) {
  switch (condicao.tipo) {
    case TIPOS_CONDICAO.primeiraConversa:
      return "Sem atividade no CRM";
    case TIPOS_CONDICAO.temEtiqueta:
      return tags.find((tag) => tag.id === condicao.etiquetaId)?.nome || "Etiqueta não escolhida";
    case TIPOS_CONDICAO.estagioAtual:
      return estagios.find((estagio) => estagio.id === condicao.stageId)?.nome || "Estágio não escolhido";
    case TIPOS_CONDICAO.tarefaAtrasada:
      return "Tarefa atrasada";
    case TIPOS_CONDICAO.semInteracaoHa:
      return `Sem interação há ${condicao.dias || 0} dias`;
    default:
      return "Condição";
  }
}

function resumoPasso(passo, tags) {
  if (passo.tipo === TIPOS_PASSO.enviarMensagem)
    return passo.texto?.trim() || "Escreva a mensagem que será enviada";
  if (passo.tipo === TIPOS_PASSO.transferir)
    return `Entrega a conversa para: ${DESTINOS[passo.destino] || "—"}`;
  const adicionar = (passo.adicionar || []).map((id) => tags.find((tag) => tag.id === id)?.nome || id);
  const remover = (passo.remover || []).map((id) => tags.find((tag) => tag.id === id)?.nome || id);
  const partes = [];
  if (adicionar.length) partes.push(`Adicionar: ${adicionar.join(", ")}`);
  if (remover.length) partes.push(`Remover: ${remover.join(", ")}`);
  return partes.join(" · ") || "Escolha as etiquetas do contato";
}

function CondicaoEditor({ condicao, tags, estagios, aoMudar, aoRemover }) {
  const tipo = condicao.tipo;
  return (
    <div className="rounded-[10px] border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <select
          value={tipo}
          onChange={(event) => aoMudar({ tipo: event.target.value })}
          className={`${entrada} min-w-0 flex-1 bg-bg`}
        >
          <option value={TIPOS_CONDICAO.primeiraConversa}>Sem atividade no CRM</option>
          <option value={TIPOS_CONDICAO.temEtiqueta}>Tiver uma etiqueta</option>
          <option value={TIPOS_CONDICAO.estagioAtual}>Estiver no estágio</option>
          <option value={TIPOS_CONDICAO.tarefaAtrasada}>Tiver tarefa atrasada</option>
          <option value={TIPOS_CONDICAO.semInteracaoHa}>Sem interação há dias</option>
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
          <input type="number" min="0" value={condicao.dias ?? 0} onChange={(event) => aoMudar({ ...condicao, dias: Number(event.target.value) })} className={`${entrada} bg-bg`} />
        </label>
      )}
    </div>
  );
}

function Paleta({ aoAdicionar }) {
  const itens = [
    {
      tipo: TIPOS_PASSO.enviarMensagem,
      titulo: "Enviar mensagem",
      descricao: "Responde no WhatsApp",
      icone: MessageSquareText,
      classe: "text-blue-600 bg-blue-500/10",
    },
    {
      tipo: TIPOS_PASSO.editarEtiquetas,
      titulo: "Editar etiquetas",
      descricao: "Organiza o contato",
      icone: Tags,
      classe: "text-success bg-success-soft",
    },
    {
      tipo: TIPOS_PASSO.transferir,
      titulo: "Transferir conversa",
      descricao: "Entrega para a IA ou para alguém",
      icone: Share2,
      classe: "text-accent-forte bg-accent-soft",
    },
  ];
  return (
    <aside className="z-10 flex w-[224px] flex-none flex-col border-r border-line bg-bg">
      <div className="border-b border-line px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-faint">Blocos</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-sub">Arraste para o mapa ou clique para adicionar.</p>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {itens.map(({ tipo, titulo, descricao, icone: Icone, classe }) => (
          <button
            key={tipo}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/emyleads-flow", tipo);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => aoAdicionar(tipo)}
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
      <div className="mt-auto border-t border-line p-4 text-[10.5px] leading-relaxed text-faint">
        Puxe uma saída roxa até a entrada do próximo bloco. Cada saída segue para um bloco só, e “Transferir conversa” encerra o fluxo.
      </div>
    </aside>
  );
}

function Inspetor({ selecionado, form, setForm, passos, setPassos, tags, estagios, inteligencia, aoRemover }) {
  const passo = passos.find((item) => item.id === selecionado);
  const atualizarPasso = (proximo) => setPassos((atuais) => atuais.map((item) => item.id === proximo.id ? proximo : item));

  return (
    <aside className="z-10 flex w-[326px] flex-none flex-col border-l border-line bg-bg">
      <div className="border-b border-line px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-faint">Propriedades</p>
        <h2 className="mt-1 text-[14px] font-semibold text-fg">
          {selecionado === NO_ENTRADA ? "Nova mensagem" : selecionado === NO_CONDICOES ? "Condições" : passo ? TITULOS_PASSO[passo.tipo] : "Selecione um bloco"}
        </h2>
      </div>

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto p-4">
        {selecionado === NO_ENTRADA ? (
          <div className="grid gap-4">
            <CampoFormulario rotulo="Nome do fluxo">
              <input value={form.nome} onChange={(event) => setForm((atual) => ({ ...atual, nome: event.target.value }))} className={entrada} />
            </CampoFormulario>
            <label className="flex cursor-pointer items-center justify-between rounded-[10px] border border-line bg-surface px-3 py-3">
              <span>
                <strong className="block text-[12px] font-semibold text-fg">Resposta automática</strong>
                <small className="mt-0.5 block text-[10.5px] text-sub">Executa quando as regras atenderem</small>
              </span>
              <button type="button" role="switch" aria-checked={form.ativo} onClick={() => setForm((atual) => ({ ...atual, ativo: !atual.ativo }))} className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors ${form.ativo ? "bg-accent" : "bg-line-strong"}`}>
                <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.ativo ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </label>
            <div className="rounded-[10px] border border-accent/20 bg-accent-soft p-3 text-[11px] leading-relaxed text-accent-forte">
              O fluxo começa quando um contato conhecido envia uma nova mensagem individual.
            </div>
          </div>
        ) : selecionado === NO_CONDICOES ? (
          <div>
            <p className="text-[11px] leading-relaxed text-sub">Todas as condições abaixo precisam ser verdadeiras.</p>
            <div className="mt-3 grid gap-2">
              {form.condicoes.map((condicao, indice) => (
                <CondicaoEditor
                  key={indice}
                  condicao={condicao}
                  tags={tags}
                  estagios={estagios}
                  aoMudar={(proxima) => setForm((atual) => ({ ...atual, condicoes: atual.condicoes.map((item, i) => i === indice ? proxima : item) }))}
                  aoRemover={() => setForm((atual) => ({ ...atual, condicoes: atual.condicoes.filter((_, i) => i !== indice) }))}
                />
              ))}
            </div>
            <button type="button" onClick={() => setForm((atual) => ({ ...atual, condicoes: [...atual.condicoes, { tipo: TIPOS_CONDICAO.primeiraConversa }] }))} className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-line-strong py-2.5 text-[11.5px] font-semibold text-sub hover:border-accent hover:text-accent-forte">
              <Plus size={14} /> Adicionar condição
            </button>
          </div>
        ) : passo ? (
          <div className="grid gap-4">
            <CampoFormulario rotulo="Tipo de bloco">
              <select
                value={passo.tipo}
                onChange={(event) => atualizarPasso({ ...passoVazio(event.target.value), id: passo.id })}
                className={entrada}
              >
                <option value={TIPOS_PASSO.enviarMensagem}>Enviar mensagem</option>
                <option value={TIPOS_PASSO.editarEtiquetas}>Editar etiquetas</option>
                <option value={TIPOS_PASSO.transferir}>Transferir conversa</option>
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
                <p className="mt-1.5 text-[10.5px] text-faint">Variáveis: <code>{"{nome}"}</code> e <code>{"{empresa}"}</code></p>
              </CampoFormulario>
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
                </>}
                <div className="rounded-[10px] border border-accent/20 bg-accent-soft p-3 text-[11px] leading-relaxed text-accent-forte">
                  A transferência acontece <strong>depois</strong> do envio confirmado. Para uma pessoa, o fluxo termina. Para a IA, você pode definir o ponto exato de retorno ou falha.
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

export default function ChatbotEditor({ chatbot, tags = [], estagios = [], recarregar, aoFechar }) {
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
      },
      passos,
      grafo: criarGrafoInicial(passos, chatbot?.canvas),
    };
  }, [chatbot]);
  const [form, setForm] = useState(iniciais.form);
  const [passos, setPassos] = useState(iniciais.passos);
  const [nos, setNos, aoMudarNos] = useNodesState(iniciais.grafo.nos);
  const [conexoes, setConexoes, aoMudarConexoes] = useEdgesState(iniciais.grafo.conexoes.map((conexao) => novaConexao(conexao.source, conexao.target)));
  const [selecionado, setSelecionado] = useState(NO_ENTRADA);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const instancia = useRef(null);

  const caminho = useMemo(() => validarGrafo(passos, conexoes), [passos, conexoes]);
  const assinaturaInicial = useMemo(
    () => JSON.stringify({ form: iniciais.form, passos: iniciais.passos, canvas: serializarCanvas(iniciais.grafo.nos, iniciais.grafo.conexoes) }),
    [iniciais]
  );
  const alterado = novo || JSON.stringify({ form, passos, canvas: serializarCanvas(nos, conexoes) }) !== assinaturaInicial;
  const ordemVisual = caminho.erro ? passos.map((passo) => passo.id) : caminho.ordem;
  const indicePrimeiraMensagem = ordemVisual.findIndex((id) => passos.find((passo) => passo.id === id)?.tipo === TIPOS_PASSO.enviarMensagem);

  const nosExibidos = useMemo(
    () => nos.map((no) => {
      if (no.id === NO_ENTRADA)
        return { ...no, data: { nome: form.nome, ativo: form.ativo } };
      if (no.id === NO_CONDICOES)
        return {
          ...no,
          data: {
            quantidade: form.condicoes.length,
            resumos: form.condicoes.map((condicao) => resumoCondicao(condicao, tags, estagios)),
          },
        };
      const passo = passos.find((item) => item.id === no.id);
      const indice = ordemVisual.indexOf(no.id);
      return {
        ...no,
        data: {
          passoId: no.id,
          tipo: passo?.tipo,
          indice,
          resumo: passo ? resumoPasso(passo, tags) : "Bloco indisponível",
          alerta: indicePrimeiraMensagem >= 0 && indice > indicePrimeiraMensagem,
        },
      };
    }),
    [nos, form, passos, tags, estagios, ordemVisual, indicePrimeiraMensagem]
  );

  const conexaoValida = (conexao, ignorarId = null) => {
    const { source, target } = conexao;
    if (!source || !target || source === target || target === NO_ENTRADA || source === NO_ENTRADA && target !== NO_CONDICOES)
      return false;
    if (target === NO_CONDICOES && source !== NO_ENTRADA) return false;
    if (source === NO_CONDICOES && [NO_ENTRADA, NO_CONDICOES].includes(target)) return false;
    if (![NO_ENTRADA].includes(source) && target === NO_CONDICOES) return false;
    const outras = conexoes.filter((item) => item.id !== ignorarId);
    if (outras.some((item) => item.source === source || item.target === target)) return false;
    const saidas = new Map(outras.map((item) => [item.source, item.target]));
    let cursor = target;
    const vistos = new Set();
    while (cursor && !vistos.has(cursor)) {
      if (cursor === source) return false;
      vistos.add(cursor);
      cursor = saidas.get(cursor);
    }
    return true;
  };

  const conectar = (conexao) => {
    if (!conexaoValida(conexao)) return;
    setConexoes((atuais) => addEdge(novaConexao(conexao.source, conexao.target), atuais));
    setErro("");
  };

  const adicionarPasso = (tipo, posicao = null) => {
    const passo = passoVazio(tipo);
    const origemSelecionada = selecionado && selecionado !== NO_ENTRADA ? selecionado : null;
    const origem = origemSelecionada || ultimoNoDoCaminho(conexoes);
    const noOrigem = nos.find((no) => no.id === origem) || nos.find((no) => no.id === NO_CONDICOES);
    const proximaPosicao = posicao || {
      x: (noOrigem?.position.x || 380) + 380,
      y: noOrigem?.position.y || 176,
    };
    const saidaAtual = conexoes.find((conexao) => conexao.source === origem);

    setPassos((atuais) => [...atuais, passo]);
    setNos((atuais) => [...atuais, { id: passo.id, type: "acao", position: proximaPosicao, data: { passoId: passo.id } }]);
    setConexoes((atuais) => {
      const semSaida = saidaAtual ? atuais.filter((conexao) => conexao.id !== saidaAtual.id) : atuais;
      const proximas = [...semSaida, novaConexao(origem, passo.id)];
      if (saidaAtual) proximas.push(novaConexao(passo.id, saidaAtual.target));
      return proximas;
    });
    setSelecionado(passo.id);
    setErro("");
    if (!posicao) {
      requestAnimationFrame(() =>
        instancia.current?.setCenter(proximaPosicao.x + 138, proximaPosicao.y + 78, {
          zoom: 0.92,
          duration: 380,
        })
      );
    }
  };

  const removerPasso = (id, removerNo = true) => {
    const entradaDoNo = conexoes.find((conexao) => conexao.target === id);
    const saidaDoNo = conexoes.find((conexao) => conexao.source === id);
    setPassos((atuais) => atuais.filter((passo) => passo.id !== id));
    if (removerNo) setNos((atuais) => atuais.filter((no) => no.id !== id));
    setConexoes((atuais) => {
      const proximas = atuais.filter((conexao) => conexao.source !== id && conexao.target !== id);
      if (entradaDoNo && saidaDoNo)
        proximas.push(novaConexao(entradaDoNo.source, saidaDoNo.target));
      return proximas;
    });
    setSelecionado(NO_CONDICOES);
  };

  const organizar = () => {
    const ordem = [NO_ENTRADA, NO_CONDICOES, ...(caminho.erro ? passos.map((passo) => passo.id) : caminho.ordem)];
    const porIndice = new Map(ordem.map((id, indice) => [id, indice]));
    setNos((atuais) => atuais.map((no) => {
      const indice = porIndice.get(no.id) ?? ordem.length;
      return { ...no, position: { x: 72 + indice * 380, y: indice % 2 === 0 ? 176 : 236 } };
    }));
    requestAnimationFrame(() => instancia.current?.fitView({ padding: 0.18, duration: 420 }));
  };

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      if (!form.nome.trim()) throw new Error("Informe um nome para o chatbot.");
      if (!form.condicoes.length) throw new Error("Adicione ao menos uma condição.");
      if (!passos.length) throw new Error("Adicione ao menos um bloco de ação.");
      const validacao = validarGrafo(passos, conexoes);
      if (validacao.erro) throw new Error(validacao.erro);
      const dados = {
        nome: form.nome.trim(),
        ativo: form.ativo,
        condicoes: form.condicoes,
        passos: validacao.passos,
        canvas: serializarCanvas(nos, conexoes),
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
          </div>
          <h1 className="max-w-[440px] truncate text-[18px] font-semibold tracking-tight text-fg">{form.nome || "Fluxo sem nome"}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`hidden rounded-full px-2.5 py-1 text-[10.5px] font-semibold lg:inline-flex ${caminho.erro || alterado ? "bg-warning/10 text-warning" : "bg-success-soft text-success"}`}>
            {caminho.erro ? "Fluxo incompleto" : alterado ? "Alterações não salvas" : `${passos.length + 2} blocos conectados`}
          </span>
          <button type="button" onClick={organizar} className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-3 py-2 text-[11.5px] font-semibold text-sub hover:border-line-strong hover:text-fg">
            <LayoutDashboard size={14} /> Organizar
          </button>
          <BotaoPrimario type="button" onClick={salvar} disabled={salvando}><Save size={15} />{salvando ? "Salvando…" : "Salvar fluxo"}</BotaoPrimario>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Paleta aoAdicionar={adicionarPasso} />
        <main className="chatbot-flow relative min-w-0 flex-1 bg-surface">
          {erro && (
            <div className="absolute left-1/2 top-4 z-20 flex max-w-[520px] -translate-x-1/2 items-center gap-2 rounded-[10px] border border-danger/25 bg-bg px-4 py-2.5 text-[11.5px] font-medium text-danger shadow-lg">
              <span className="h-2 w-2 flex-none rounded-full bg-danger" /> {erro}
            </div>
          )}
          <ReactFlow
            nodes={nosExibidos}
            edges={conexoes}
            nodeTypes={tiposDeNo}
            onInit={(reactFlow) => { instancia.current = reactFlow; }}
            onNodesChange={aoMudarNos}
            onEdgesChange={aoMudarConexoes}
            onConnect={conectar}
            onReconnect={(conexaoAntiga, proxima) => {
              if (!conexaoValida(proxima, conexaoAntiga.id)) return;
              setConexoes((atuais) => reconnectEdge(
                conexaoAntiga,
                { ...proxima, saida: conexaoAntiga.saida || SAIDA_PADRAO, id: idConexao(proxima.source, proxima.target, conexaoAntiga.saida) },
                atuais
              ));
            }}
            onNodeClick={(_, no) => setSelecionado(no.id)}
            onPaneClick={() => setSelecionado(null)}
            onNodesDelete={(removidos) => removidos.filter((no) => ![NO_ENTRADA, NO_CONDICOES].includes(no.id)).forEach((no) => removerPasso(no.id, false))}
            isValidConnection={conexaoValida}
            connectionMode={ConnectionMode.Strict}
            defaultEdgeOptions={{ type: "smoothstep", animated: true, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--el-accent)" } }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.28}
            maxZoom={1.7}
            panOnScroll
            selectionOnDrag
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
            onDrop={(event) => {
              event.preventDefault();
              const tipo = event.dataTransfer.getData("application/emyleads-flow");
              if (!Object.values(TIPOS_PASSO).includes(tipo) || !instancia.current) return;
              adicionarPasso(tipo, instancia.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
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
          selecionado={selecionado}
          form={form}
          setForm={setForm}
          passos={passos}
          setPassos={setPassos}
          tags={tags}
          estagios={estagios}
          inteligencia={inteligencia}
          aoRemover={removerPasso}
        />
      </div>
    </div>
  );
}
