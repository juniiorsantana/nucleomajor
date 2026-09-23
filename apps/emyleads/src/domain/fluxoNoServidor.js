/**
 * O que o servidor exige de um fluxo v3, conferido antes de salvar.
 *
 * O banco só valida a definição quando uma conversa COMEÇA o fluxo
 * (`private.flow_validate`, chamada por `nucleo_flow_start`). Salvar não
 * confere nada. Sem esta conferência, um fluxo aceito pelo editor e recusado
 * pelo banco só falharia na frente de um cliente — e a conversa cairia para
 * atendimento humano sem ninguém saber por quê.
 *
 * Por isso cada regra aqui tem par exato nas migrations
 * `20260907010000_fluxos_execucao_persistida.sql` e
 * `20260925110000_fluxos_com_dia_e_horario.sql` (dia da semana e horário).
 * Mudou lá, muda aqui — e roda de novo scripts/sql/prova-conferencia-do-editor.py.
 *
 * Devolve `null` quando o servidor aceitaria, ou a primeira recusa em
 * português — quem lê é quem está montando o fluxo.
 */

import { NO_CONDICOES, NO_ENTRADA, SAIDA_PADRAO } from "./chatbotGrafo.js";
import { DESTINOS_TRANSFERENCIA, TIPOS_PASSO, saidasDoPasso } from "./chatbots.js";
import { FUSOS_DO_BRASIL, horaValida, OPERADORES_LOGICOS, TIPOS_CONDICAO } from "./regras.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_DE_BLOCO = /^[A-Za-z0-9_-]{1,80}$/;
const TIPOS_ACEITOS = new Set(Object.values(TIPOS_PASSO));
const CONDICOES_ACEITAS = new Set(Object.values(TIPOS_CONDICAO));
const ALVOS_ACEITOS = new Set(["reception", "skill", "campaign"]);

export const LIMITES_DO_SERVIDOR = {
  passos: 200,
  conexoes: 402,
  texto: 4000,
  objetivoIa: 2000,
  etiquetas: 100,
  itensDaCondicao: 100,
  profundidade: 8,
  tamanho: 200000,
};

const NOMES = {
  [TIPOS_PASSO.enviarMensagem]: "Enviar mensagem",
  [TIPOS_PASSO.editarEtiquetas]: "Editar etiquetas",
  [TIPOS_PASSO.condicao]: "Condição",
  [TIPOS_PASSO.encerrar]: "Encerrar",
  [TIPOS_PASSO.transferir]: "Transferir conversa",
};
const nomeDoBloco = (passo) => `“${NOMES[passo?.tipo] || "bloco"}”`;

/** `flow_validate_expression`: devolve a recusa ou `null`. */
function problemaDaExpressao(expressao, onde, profundidade = 0) {
  if (profundidade > LIMITES_DO_SERVIDOR.profundidade || expressao == null)
    return `${onde} tem grupos demais, um dentro do outro.`;
  let filhos;
  if (Array.isArray(expressao)) {
    filhos = expressao;
  } else if (typeof expressao === "object" && Object.hasOwn(expressao, "operador")) {
    if (!Object.values(OPERADORES_LOGICOS).includes(expressao.operador))
      return `${onde} tem um grupo sem "todas" ou "qualquer uma".`;
    filhos = expressao.itens;
    if (!Array.isArray(filhos)) return `${onde} tem um grupo sem regras.`;
  } else if (typeof expressao === "object") {
    if (!CONDICOES_ACEITAS.has(expressao.tipo)) return `${onde} tem uma regra de tipo desconhecido.`;
    if (expressao.tipo === TIPOS_CONDICAO.temEtiqueta && !UUID.test(String(expressao.etiquetaId || "")))
      return `${onde}: escolha a etiqueta.`;
    if (expressao.tipo === TIPOS_CONDICAO.estagioAtual && !UUID.test(String(expressao.stageId || "")))
      return `${onde}: escolha o estágio.`;
    if (
      expressao.tipo === TIPOS_CONDICAO.semInteracaoHa &&
      !(Number.isInteger(expressao.dias) && expressao.dias >= 0 && expressao.dias <= 999999999)
    )
      return `${onde}: informe a quantidade de dias.`;
    if (
      (expressao.tipo === TIPOS_CONDICAO.diaDaSemana || expressao.tipo === TIPOS_CONDICAO.janelaDeHorario)
      && !FUSOS_DO_BRASIL.includes(expressao.fuso)
    )
      return `${onde}: escolha o fuso do horário.`;
    if (
      expressao.tipo === TIPOS_CONDICAO.diaDaSemana && (
        !Array.isArray(expressao.dias) || expressao.dias.length < 1 || expressao.dias.length > 7
        || new Set(expressao.dias).size !== expressao.dias.length
        || expressao.dias.some((dia) => !Number.isInteger(dia) || dia < 0 || dia > 6)
      )
    )
      return `${onde}: marque ao menos um dia da semana.`;
    if (
      expressao.tipo === TIPOS_CONDICAO.janelaDeHorario
      && (!horaValida(expressao.inicio) || !horaValida(expressao.fim) || expressao.inicio === expressao.fim)
    )
      return `${onde}: o horário precisa de início e fim diferentes.`;
    return null;
  } else {
    return `${onde} tem uma regra inválida.`;
  }
  if (filhos.length < 1) return `${onde} precisa de ao menos uma regra.`;
  if (filhos.length > LIMITES_DO_SERVIDOR.itensDaCondicao) return `${onde} tem regras demais.`;
  for (const filho of filhos) {
    const problema = problemaDaExpressao(filho, onde, profundidade + 1);
    if (problema) return problema;
  }
  return null;
}

function problemaDoBloco(passo) {
  const nome = nomeDoBloco(passo);
  if (passo.tipo === TIPOS_PASSO.enviarMensagem) {
    const tamanho = String(passo.texto || "").trim().length;
    if (!tamanho) return `Escreva a mensagem do bloco ${nome}.`;
    if (tamanho > LIMITES_DO_SERVIDOR.texto)
      return `A mensagem do bloco ${nome} passa de ${LIMITES_DO_SERVIDOR.texto} caracteres.`;
  }
  if (passo.tipo === TIPOS_PASSO.transferir) {
    if (!Object.values(DESTINOS_TRANSFERENCIA).includes(passo.destino))
      return `Escolha para quem o bloco ${nome} entrega a conversa.`;
    if (passo.destino === DESTINOS_TRANSFERENCIA.ia) {
      const objetivo = String(passo.objetivoIa || "").trim().length;
      if (!objetivo) return `Diga no bloco ${nome} o que a IA precisa conseguir para o fluxo seguir por “Sucesso”.`;
      if (objetivo > LIMITES_DO_SERVIDOR.objetivoIa)
        return `O objetivo da IA no bloco ${nome} passa de ${LIMITES_DO_SERVIDOR.objetivoIa} caracteres.`;
      const alvo = passo.alvoIa || "reception";
      if (!ALVOS_ACEITOS.has(alvo)) return `Escolha como a IA entra no bloco ${nome}.`;
      if (alvo === "skill" && !UUID.test(String(passo.skillId || "")))
        return `Escolha a habilidade da IA no bloco ${nome}.`;
      if (alvo === "campaign" && !UUID.test(String(passo.campanhaId || "")))
        return `Escolha a campanha da IA no bloco ${nome}.`;
    }
  }
  if (passo.tipo === TIPOS_PASSO.condicao)
    return problemaDaExpressao(passo.expressao, `O bloco ${nome}`);
  if (passo.tipo === TIPOS_PASSO.editarEtiquetas) {
    for (const lista of [passo.adicionar, passo.remover]) {
      if (!Array.isArray(lista)) return `O bloco ${nome} está sem a lista de etiquetas.`;
      if (lista.length > LIMITES_DO_SERVIDOR.etiquetas) return `O bloco ${nome} tem etiquetas demais.`;
      if (lista.some((tagId) => !UUID.test(String(tagId || ""))))
        return `O bloco ${nome} usa uma etiqueta que ainda não foi salva na empresa.`;
    }
  }
  return null;
}

/**
 * Espelho de `private.flow_validate`.
 *
 * Recebe o que vai para `chatbot_definitions.definition`: `condicoes`,
 * `passos` e `canvas`.
 */
export function problemaParaOServidor(definicao) {
  const passos = definicao?.passos;
  const conexoes = definicao?.canvas?.conexoes;
  if (Number(definicao?.canvas?.versao) !== 3) return "Este fluxo não está no formato com caminhos.";
  if (!Array.isArray(passos) || !passos.length) return "Adicione ao menos um bloco de ação.";
  if (passos.length > LIMITES_DO_SERVIDOR.passos)
    return `O fluxo passa de ${LIMITES_DO_SERVIDOR.passos} blocos.`;
  if (!Array.isArray(conexoes)) return "O fluxo está sem conexões.";
  if (conexoes.length > LIMITES_DO_SERVIDOR.conexoes) return "O fluxo tem conexões demais.";
  if (JSON.stringify(definicao).length > LIMITES_DO_SERVIDOR.tamanho) return "O fluxo ficou grande demais.";

  const problemaDaEntrada = problemaDaExpressao(definicao.condicoes, "O bloco “Condições”");
  if (problemaDaEntrada) return problemaDaEntrada;

  const porId = new Map([[NO_ENTRADA, null], [NO_CONDICOES, null]]);
  for (const passo of passos) {
    if (!ID_DE_BLOCO.test(String(passo?.id || "")) || porId.has(passo.id))
      return "Existe um bloco com identificação inválida. Remova e crie o bloco de novo.";
    if (!TIPOS_ACEITOS.has(passo.tipo)) return "Existe um bloco de tipo desconhecido.";
    const problema = problemaDoBloco(passo);
    if (problema) return problema;
    porId.set(passo.id, passo);
  }

  for (const conexao of conexoes) {
    if (!porId.has(conexao?.source) || !porId.has(conexao?.target) || conexao.target === NO_ENTRADA
      || (conexao.target === NO_CONDICOES && conexao.source !== NO_ENTRADA))
      return "Existe uma conexão inválida. Remova-a e ligue de novo.";
  }

  for (const [id, passo] of porId) {
    const portas = passo ? saidasDoPasso(passo) : [SAIDA_PADRAO];
    const saindo = conexoes.filter((conexao) => conexao.source === id);
    for (const porta of portas) {
      const daPorta = saindo.filter((conexao) => (conexao.saida || SAIDA_PADRAO) === porta);
      if (daPorta.length !== 1) {
        const rotulo = { padrao: "Próximo", sim: "Sim", nao: "Não", sucesso: "Sucesso", falha: "Falha" }[porta] || porta;
        return `Conecte a saída “${rotulo}” do bloco ${passo ? nomeDoBloco(passo) : "“Condições”"}.`;
      }
    }
    if (saindo.length !== portas.length)
      return passo && !portas.length
        ? `O bloco ${nomeDoBloco(passo)} encerra o fluxo. Remova a conexão que sai dele.`
        : "Existe uma conexão saindo de uma porta que o bloco não tem.";
    if (id !== NO_ENTRADA && !conexoes.some((conexao) => conexao.target === id))
      return `O bloco ${passo ? nomeDoBloco(passo) : "“Condições”"} não recebe nenhuma conexão.`;
  }
  if (conexoes.find((conexao) => conexao.source === NO_ENTRADA)?.target !== NO_CONDICOES)
    return "Conecte ‘Nova mensagem’ diretamente a ‘Condições’.";

  // Kahn, como o banco: remove quem não tem mais entrada; se sobrar alguém, há ciclo.
  const pendentes = new Set(porId.keys());
  let removeu = true;
  while (pendentes.size && removeu) {
    removeu = false;
    for (const id of [...pendentes]) {
      const temEntrada = conexoes.some((conexao) => conexao.target === id && pendentes.has(conexao.source));
      if (!temEntrada) {
        pendentes.delete(id);
        removeu = true;
      }
    }
  }
  if (pendentes.size) return "O fluxo não pode voltar para um bloco anterior.";
  return null;
}
