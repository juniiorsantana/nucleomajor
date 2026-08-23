/**
 * Fila serial por chave.
 *
 * Existe para a primeira camada de proteção da resposta automática: mensagens
 * em rajada da MESMA conversa precisam ser avaliadas em ordem, uma esperando a
 * outra. Sem isso, duas mensagens que chegam juntas seriam avaliadas contra o
 * mesmo estado do CRM, e as duas atenderiam uma regra que deveria valer só
 * para a primeira.
 *
 * Conversas diferentes não se esperam: a chave é o `waId`.
 *
 * É memória de uma aba só. Duas abas do WhatsApp abertas têm duas filas
 * independentes, e é por isso que ela não basta — ver a reserva por
 * `messageId` no provider, e `IDEMPOTENCIA-AUTOMACAO.md`.
 */
export function criarFilaPorChave() {
  const filas = new Map();

  return function enfileirar(chave, tarefa) {
    const anterior = filas.get(chave) || Promise.resolve();
    // O `catch` antes do `then` é o que impede uma tarefa que falhou de
    // travar a fila inteira daquela conversa.
    const atual = anterior
      .catch(() => {})
      .then(tarefa)
      .finally(() => {
        // Só limpa se ninguém entrou depois: a última tarefa da fila é a
        // única que pode apagá-la sem descartar trabalho pendente.
        if (filas.get(chave) === atual) filas.delete(chave);
      });
    filas.set(chave, atual);
    return atual;
  };
}
