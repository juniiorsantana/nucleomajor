import { useEffect, useRef } from "react";

/**
 * Um relógio que só anda com a aba à vista.
 *
 * O portal relê o Supabase de tempos em tempos para não depender só do
 * Realtime. Só que um `setInterval` comum continua batendo com a aba de fundo,
 * a noite inteira, e cada batida é egress do plano gratuito: em 23/10/2026 o
 * projeto passou da cota (6,2 GB de 5 GB), com `whatsapp_connections` e
 * `connection_runtime_status` no topo das consultas. Conferir
 * `document.visibilityState` dentro do intervalo já poupava a consulta, mas
 * deixava o relógio vivo; aqui ele para de verdade e volta junto com a aba.
 *
 * Ao voltar, roda na hora só se perdeu uma batida (ou sempre, com
 * `sempreAoVoltar`): quem esteve fora quer a tela em dia, e quem trocou de aba
 * por dois segundos não precisa de outra consulta.
 *
 * Não roda ao ligar. Cada tela já faz a primeira leitura do jeito dela.
 */
export function iniciarIntervaloVisivel(tarefa, intervaloMs, {
  sempreAoVoltar = false,
  documento = globalThis.document,
  agora = () => Date.now(),
} = {}) {
  let id = null;
  let ultima = agora();

  const rodar = () => {
    ultima = agora();
    // Uma promessa recusada aqui não tem quem a ouça; a próxima batida tenta.
    const resultado = tarefa();
    if (resultado && typeof resultado.catch === "function") resultado.catch(() => {});
  };
  const visivel = () => abaVisivel(documento);
  const ligar = () => {
    if (id === null) id = setInterval(rodar, intervaloMs);
  };
  const desligar = () => {
    if (id === null) return;
    clearInterval(id);
    id = null;
  };
  const aoMudarVisibilidade = () => {
    if (!visivel()) {
      desligar();
      return;
    }
    if (sempreAoVoltar) {
      // Recomeça a contagem daqui: a batida seguinte vem um intervalo depois
      // desta leitura, e não logo em cima dela.
      desligar();
      rodar();
    } else if (id !== null) {
      return;
    } else if (agora() - ultima >= intervaloMs) {
      rodar();
    }
    ligar();
  };

  if (visivel()) ligar();
  documento?.addEventListener?.("visibilitychange", aoMudarVisibilidade);
  return () => {
    desligar();
    documento?.removeEventListener?.("visibilitychange", aoMudarVisibilidade);
  };
}

/**
 * A aba está à vista? Fora do navegador (testes, provider), sim.
 *
 * Para os avisos do Realtime: com a aba oculta, a releitura que eles pedem
 * fica para a volta (`sempreAoVoltar`), em vez de gastar uma consulta que
 * ninguém vê.
 */
export const abaVisivel = (documento = globalThis.document) =>
  !documento || documento.visibilityState === "visible";

/**
 * `iniciarIntervaloVisivel` preso a um componente.
 *
 * A tarefa mais recente é a que roda, sem recriar o relógio a cada render;
 * trocar o intervalo ou desligar (`ativo: false`) recria. Intervalo zero ou
 * vazio também desliga, para a tela poder dizer "agora não precisa".
 */
export function useIntervaloVisivel(tarefa, intervaloMs, { ativo = true, sempreAoVoltar = false } = {}) {
  const tarefaRef = useRef(tarefa);
  tarefaRef.current = tarefa;

  useEffect(() => {
    if (!ativo || !(intervaloMs > 0)) return undefined;
    return iniciarIntervaloVisivel(() => tarefaRef.current(), intervaloMs, { sempreAoVoltar });
  }, [ativo, intervaloMs, sempreAoVoltar]);
}
