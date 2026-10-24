/**
 * URLs assinadas do Storage, guardadas enquanto ainda servem (23/10/2026).
 *
 * Cada `createSignedUrls` devolve um token novo, e uma URL nova é, para o
 * navegador, um arquivo que ele nunca viu: baixa de novo. A tela de Conversas
 * recarrega a lista e a conversa aberta a cada 20 segundos, e assinava tudo de
 * novo a cada volta — as fotos da lista inteira e a mídia da conversa saíam do
 * Storage outra vez, e isso foi parte do Egress que estourou a cota do plano
 * gratuito (6,2 GB de 5 GB em outubro).
 *
 * Aqui a URL de um (bucket, caminho) é a mesma até faltar `folga` do prazo
 * (20%, por padrão: doze minutos de uma hora). Só então se pede outra, com
 * tempo de sobra para a tela trocar antes de a velha vencer. Pedidos ao mesmo
 * tempo para o mesmo caminho esperam a mesma resposta, em vez de assinar duas
 * vezes. Falha não fica guardada: a próxima recarga tenta de novo.
 *
 * O caminho só chega aqui depois de o banco o devolver sob RLS, e a URL não
 * dá acesso a nada além daquele arquivo; por isso a chave não leva quem está
 * logado.
 */
export const FOLGA_PADRAO = 0.2;

const normalizar = (caminho) => String(caminho || "").trim();

export function criarCacheDeUrlsAssinadas({ agora = () => Date.now(), folga = FOLGA_PADRAO } = {}) {
  // chave → { url, renovarEm } ou { pendente: Promise<string|null> }
  const guardadas = new Map();
  const chave = (bucket, caminho) => `${bucket}\u0000${caminho}`;

  const aindaServe = (registro, instante) =>
    Boolean(registro) && (Boolean(registro.pendente) || instante < registro.renovarEm);

  const guardar = (k, pendente, emitidaEm, validade) =>
    pendente.then(
      (url) => {
        // Outra assinatura pode ter tomado o lugar desta no meio do caminho.
        if (guardadas.get(k)?.pendente !== pendente) return url;
        if (url) guardadas.set(k, { url, renovarEm: emitidaEm + validade * 1000 * (1 - folga) });
        else guardadas.delete(k);
        return url;
      },
      (erro) => {
        if (guardadas.get(k)?.pendente === pendente) guardadas.delete(k);
        throw erro;
      }
    );

  const lerGuardada = async (k) => {
    const registro = guardadas.get(k);
    if (!registro) return null;
    return registro.pendente ? registro.pendente : registro.url;
  };

  /**
   * Vários caminhos de um bucket, numa chamada só para os que faltam.
   * Devolve `Map<caminho, url>` só com os que deram certo; nunca rejeita.
   */
  async function assinarVarios(supabase, bucket, caminhos, validade) {
    const unicos = [...new Set((caminhos || []).map(normalizar).filter(Boolean))];
    if (unicos.length === 0) return new Map();

    const instante = agora();
    const faltam = unicos.filter((c) => !aindaServe(guardadas.get(chave(bucket, c)), instante));
    if (faltam.length) {
      const lote = (async () => {
        try {
          const { data, error } = await supabase.storage.from(bucket).createSignedUrls(faltam, validade);
          if (error) return new Map();
          return new Map(
            (data || [])
              .filter((arquivo) => arquivo?.path && arquivo?.signedUrl && !arquivo?.error)
              .map((arquivo) => [arquivo.path, arquivo.signedUrl])
          );
        } catch {
          return new Map();
        }
      })();
      for (const caminho of faltam) {
        const k = chave(bucket, caminho);
        const pendente = lote.then((urls) => urls.get(caminho) || null);
        guardadas.set(k, { pendente });
        guardar(k, pendente, instante, validade);
      }
    }

    const pares = await Promise.all(
      unicos.map(async (c) => [c, await lerGuardada(chave(bucket, c)).catch(() => null)])
    );
    return new Map(pares.filter(([, url]) => url));
  }

  /**
   * Um caminho só, pelo `createSignedUrl` do supabase-js. Rejeita com o erro
   * do Storage, para quem chama poder dizer o motivo.
   */
  async function assinarUm(supabase, bucket, caminho, validade) {
    const alvo = normalizar(caminho);
    if (!alvo) throw new Error("caminho vazio");
    const k = chave(bucket, alvo);
    const instante = agora();
    if (!aindaServe(guardadas.get(k), instante)) {
      const pendente = (async () => {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(alvo, validade);
        if (error || !data?.signedUrl) throw error || new Error("foto sem URL privada");
        return data.signedUrl;
      })();
      guardadas.set(k, { pendente });
      return guardar(k, pendente, instante, validade);
    }
    return lerGuardada(k);
  }

  /** O arquivo mudou no bucket (upload por cima): a próxima URL tem de ser nova. */
  const esquecer = (bucket, caminho) => guardadas.delete(chave(bucket, normalizar(caminho)));

  const limpar = () => guardadas.clear();

  return { assinarVarios, assinarUm, esquecer, limpar };
}
