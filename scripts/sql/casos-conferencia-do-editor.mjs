/**
 * Casos para provar que o editor e o banco concordam sobre um fluxo v3.
 *
 * O editor recusa antes de salvar (`problemaParaOServidor`); o banco recusa
 * quando a conversa começa (`private.flow_validate`). Se discordarem, um
 * fluxo aceito na tela falha na frente do cliente — ou um fluxo válido fica
 * impossível de salvar.
 *
 * Imprime uma linha JSON por caso: `{ caso, editorAceita, definicao }`.
 * `prova-conferencia-do-editor.sh` passa cada definição pelo banco e compara.
 */

import { problemaParaOServidor } from "../../apps/emyleads/src/domain/fluxoNoServidor.js";

const VIP = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const SKILL = "33333333-3333-4333-8333-333333333333";

function base() {
  return {
    condicoes: [{ tipo: "primeira_conversa" }],
    passos: [
      { id: "cond", tipo: "condicao", expressao: { operador: "ou", itens: [{ tipo: "tem_etiqueta", etiquetaId: VIP }] } },
      { id: "vip", tipo: "enviar_mensagem", texto: "Olá, cliente VIP!" },
      { id: "tag", tipo: "editar_etiquetas", adicionar: [LEAD], remover: [] },
      { id: "ia", tipo: "transferir", destino: "ia", alvoIa: "reception", objetivoIa: "Descobrir o que o contato quer" },
      { id: "fim", tipo: "encerrar" },
      { id: "gente", tipo: "transferir", destino: "humano", motivo: "" },
    ],
    canvas: {
      versao: 3,
      nos: [],
      conexoes: [
        { source: "entrada", saida: "padrao", target: "condicoes" },
        { source: "condicoes", saida: "padrao", target: "cond" },
        { source: "cond", saida: "sim", target: "vip" },
        { source: "cond", saida: "nao", target: "tag" },
        { source: "vip", saida: "padrao", target: "ia" },
        { source: "tag", saida: "padrao", target: "ia" },
        { source: "ia", saida: "sucesso", target: "fim" },
        { source: "ia", saida: "falha", target: "gente" },
      ],
    },
  };
}

const passo = (d, id) => d.passos.find((p) => p.id === id);
const semSaida = (d, source, saida) => {
  d.canvas.conexoes = d.canvas.conexoes.filter((c) => !(c.source === source && c.saida === saida));
};

const mutacoes = {
  "valido: bifurcação, convergência, IA e encerrar": () => {},
  "valido: linear só com mensagem": (d) => {
    d.passos = [{ id: "m", tipo: "enviar_mensagem", texto: "Oi" }];
    d.canvas.conexoes = [
      { source: "entrada", saida: "padrao", target: "condicoes" },
      { source: "condicoes", saida: "padrao", target: "m" },
      { source: "m", saida: "padrao", target: "fim" },
    ];
    d.passos.push({ id: "fim", tipo: "encerrar" });
  },
  "valido: IA com habilidade": (d) => Object.assign(passo(d, "ia"), { alvoIa: "skill", skillId: SKILL }),
  "valido: grupos aninhados": (d) => {
    passo(d, "cond").expressao = { operador: "e", itens: [{ operador: "ou", itens: [{ tipo: "tarefa_atrasada" }, { tipo: "sem_interacao_ha", dias: 3 }] }] };
  },
  "valido: entrada como grupo": (d) => { d.condicoes = { operador: "ou", itens: [{ tipo: "primeira_conversa" }, { tipo: "estagio_atual", stageId: LEAD }] }; },
  "valido: saida sem campo usa padrao": (d) => { delete d.canvas.conexoes.find((c) => c.source === "vip").saida; },
  "recusa: versao 2": (d) => { d.canvas.versao = 2; },
  "recusa: sem passos": (d) => { d.passos = []; },
  "recusa: entrada vazia": (d) => { d.condicoes = []; },
  "recusa: objetivo da IA vazio": (d) => { passo(d, "ia").objetivoIa = "   "; },
  "recusa: objetivo da IA longo": (d) => { passo(d, "ia").objetivoIa = "x".repeat(2001); },
  "recusa: habilidade sem id": (d) => Object.assign(passo(d, "ia"), { alvoIa: "skill", skillId: null }),
  "recusa: campanha com id ruim": (d) => Object.assign(passo(d, "ia"), { alvoIa: "campaign", campanhaId: "abc" }),
  "recusa: alvo desconhecido": (d) => { passo(d, "ia").alvoIa = "outro"; },
  "recusa: mensagem vazia": (d) => { passo(d, "vip").texto = " "; },
  "recusa: mensagem longa": (d) => { passo(d, "vip").texto = "x".repeat(4001); },
  "recusa: etiqueta local": (d) => { passo(d, "tag").adicionar = ["tag-local"]; },
  "recusa: etiqueta da condição vazia": (d) => { passo(d, "cond").expressao.itens[0].etiquetaId = ""; },
  "recusa: grupo vazio": (d) => { passo(d, "cond").expressao.itens = []; },
  "recusa: operador desconhecido": (d) => { passo(d, "cond").expressao.operador = "xor"; },
  "recusa: tipo de regra desconhecido": (d) => { passo(d, "cond").expressao.itens[0] = { tipo: "chove" }; },
  "recusa: dias fracionado": (d) => { passo(d, "cond").expressao.itens[0] = { tipo: "sem_interacao_ha", dias: 1.5 }; },
  "recusa: saida falha sem destino": (d) => { semSaida(d, "ia", "falha"); d.passos = d.passos.filter((p) => p.id !== "gente"); },
  "recusa: saida nao sem destino": (d) => { semSaida(d, "cond", "nao"); d.passos = d.passos.filter((p) => p.id !== "tag"); },
  "recusa: saida de bloco que encerra": (d) => { d.canvas.conexoes.push({ source: "fim", saida: "padrao", target: "gente" }); },
  "recusa: bloco solto": (d) => { d.passos.push({ id: "solto", tipo: "encerrar" }); },
  "recusa: ciclo": (d) => { d.canvas.conexoes = d.canvas.conexoes.map((c) => (c.source === "tag" ? { ...c, target: "cond" } : c)); },
  "recusa: id com espaço": (d) => { d.passos[0].id = "com espaço"; },
  "recusa: id repetido": (d) => { d.passos[1].id = "cond"; },
  "recusa: id reservado": (d) => { d.passos[1].id = "entrada"; },
  "recusa: tipo de bloco desconhecido": (d) => { passo(d, "fim").tipo = "pausar"; },
  "recusa: destino desconhecido": (d) => { passo(d, "gente").destino = "robo"; },
  "recusa: volta para condicoes": (d) => { d.canvas.conexoes.push({ source: "vip", saida: "padrao", target: "condicoes" }); },
  "recusa: saida duplicada": (d) => { d.canvas.conexoes.push({ source: "cond", saida: "sim", target: "tag" }); },
  "recusa: saida que o bloco nao tem": (d) => { d.canvas.conexoes.push({ source: "vip", saida: "sim", target: "gente" }); },
  "recusa: entrada nao vai a condicoes": (d) => {
    d.canvas.conexoes = d.canvas.conexoes.map((c) => (c.source === "entrada" ? { ...c, target: "cond" } : c));
  },
  "recusa: conexao para bloco inexistente": (d) => { d.canvas.conexoes.push({ source: "fim", saida: "padrao", target: "fantasma" }); },
};

for (const [caso, mudar] of Object.entries(mutacoes)) {
  const definicao = base();
  mudar(definicao);
  const problema = problemaParaOServidor(definicao);
  process.stdout.write(`${JSON.stringify({ caso, editorAceita: problema === null, problema, definicao })}\n`);
}
