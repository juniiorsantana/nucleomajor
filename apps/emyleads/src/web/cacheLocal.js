/**
 * A cópia local das Conversas, no IndexedDB do navegador.
 *
 * Serve para a lista aparecer na hora depois de um F5, antes de a primeira
 * resposta do Supabase chegar. É só aceleração: quem manda continua sendo o
 * banco, e a tela funciona igual sem ela.
 *
 * **Desligada** (`CACHE_LOCAL_LIGADO = false`), por decisão do dono em
 * 19/10/2026: ligar grava conversa de cliente no disco do computador de quem
 * atende, e isso é decisão de LGPD, não de engenharia. Para ligar, trocar a
 * constante; a ligação já está feita em `operations.js`.
 *
 * As regras, todas para que a cópia nunca mostre o que não devia:
 *
 * - **Isolada por usuário e empresa.** A chave guardada é
 *   `usuário|empresa|chave`, com os dois lidos a cada chamada: trocar de
 *   empresa muda de gaveta sozinho, e outra pessoa no mesmo navegador nunca lê
 *   a gaveta de ninguém. Sem usuário ou sem empresa, não lê nem grava.
 * - **Vence em 7 dias.** O que é mais velho que isso é tratado como ausente e
 *   apagado.
 * - **Só as 50 últimas mensagens por conversa** (chaves que começam com
 *   `mensagens`), não o histórico inteiro.
 * - **Apagada inteira** no logout, no login e quando o usuário da sessão muda
 *   (`apagarCacheLocal` e `apagarTudo`).
 * - **Nunca derruba a tela.** IndexedDB ausente, bloqueado (aba anônima,
 *   cota cheia, navegador antigo) ou com erro: `ler` devolve `null`, `gravar`
 *   devolve `false`, `apagarTudo` resolve. Nenhum método lança.
 *
 * O formato é o do ponto de injeção da seção 4 do plano da escala:
 * `ler(chave)`, `gravar(chave, valor)` e `apagarTudo()`.
 */

export const CACHE_LOCAL_LIGADO = false;

export const NOME_DO_BANCO = "emyleads-conversas";
const GAVETA = "entradas";
export const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
export const MENSAGENS_POR_CONVERSA = 50;

const pedido = (req) =>
  new Promise((ok, falhou) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falhou(req.error);
  });

function abrir(indexedDB) {
  return new Promise((ok, falhou) => {
    const req = indexedDB.open(NOME_DO_BANCO, 1);
    req.onupgradeneeded = () => {
      const banco = req.result;
      if (!banco.objectStoreNames.contains(GAVETA)) {
        banco.createObjectStore(GAVETA, { keyPath: "id" }).createIndex("gravadoEm", "gravadoEm");
      }
    };
    req.onsuccess = () => {
      const banco = req.result;
      // Outra aba (ou o logout) quer apagar o banco: soltar na hora, senão a
      // exclusão fica esperando esta conexão fechar.
      banco.onversionchange = () => banco.close();
      ok(banco);
    };
    req.onerror = () => falhou(req.error);
    req.onblocked = () => falhou(new Error("IndexedDB bloqueado"));
  });
}

/** O que o cache guarda de um valor: as mensagens, só as últimas 50. */
function aparado(chave, valor) {
  if (String(chave).startsWith("mensagens") && Array.isArray(valor) && valor.length > MENSAGENS_POR_CONVERSA) {
    return valor.slice(-MENSAGENS_POR_CONVERSA);
  }
  return valor;
}

/**
 * Cria o cache. `escopo()` devolve `{ usuario, organizacao }` da sessão de
 * agora (ou nulos). `indexedDB` e `agora` existem para as provas.
 */
export function criarCacheLocal({ escopo, indexedDB = globalThis.indexedDB, agora = () => Date.now() } = {}) {
  let conexao = null;
  let ultimoUsuario = null;

  const banco = () => {
    if (!indexedDB) return Promise.reject(new Error("sem IndexedDB"));
    if (!conexao) {
      conexao = abrir(indexedDB).then(async (aberto) => {
        await faxina(aberto).catch(() => {});
        return aberto;
      });
      // Falhou ao abrir: tenta de novo na próxima chamada, sem guardar a falha.
      conexao.catch(() => {
        conexao = null;
      });
    }
    return conexao;
  };

  /** Apaga o que venceu. Roda uma vez, ao abrir. */
  async function faxina(aberto) {
    const limite = agora() - VALIDADE_MS;
    const gaveta = aberto.transaction(GAVETA, "readwrite").objectStore(GAVETA);
    const vencidas = await pedido(gaveta.index("gravadoEm").getAllKeys(IDBKeyRange.upperBound(limite, true)));
    await Promise.all(vencidas.map((id) => pedido(gaveta.delete(id))));
  }

  const limpar = async () => {
    const aberto = await banco();
    await pedido(aberto.transaction(GAVETA, "readwrite").objectStore(GAVETA).clear());
  };

  /** A chave guardada, ou `null` quando não se sabe de quem é a gaveta. */
  const chaveDe = async (chave) => {
    const atual = await escopo?.();
    const usuario = atual?.usuario ? String(atual.usuario) : "";
    const organizacao = atual?.organizacao ? String(atual.organizacao) : "";
    if (!usuario || !organizacao || !chave) return null;
    // Outra pessoa entrou neste navegador sem passar pelo logout (sessão que
    // venceu, por exemplo): a cópia da anterior sai antes de qualquer leitura.
    if (ultimoUsuario && ultimoUsuario !== usuario) await limpar();
    ultimoUsuario = usuario;
    return `${usuario}|${organizacao}|${chave}`;
  };

  return {
    async ler(chave) {
      try {
        const id = await chaveDe(chave);
        if (!id) return null;
        const aberto = await banco();
        const gaveta = aberto.transaction(GAVETA, "readwrite").objectStore(GAVETA);
        const entrada = await pedido(gaveta.get(id));
        if (!entrada) return null;
        if (agora() - entrada.gravadoEm >= VALIDADE_MS) {
          await pedido(gaveta.delete(id));
          return null;
        }
        return entrada.valor;
      } catch {
        return null;
      }
    },

    async gravar(chave, valor) {
      try {
        const id = await chaveDe(chave);
        if (!id) return false;
        const aberto = await banco();
        await pedido(
          aberto
            .transaction(GAVETA, "readwrite")
            .objectStore(GAVETA)
            .put({ id, valor: aparado(chave, valor), gravadoEm: agora() })
        );
        return true;
      } catch {
        return false;
      }
    },

    async apagarTudo() {
      try {
        await limpar();
      } catch {
        // Sem IndexedDB não há o que apagar.
      }
    },
  };
}

/**
 * Apaga o banco do cache inteiro, de qualquer usuário, mesmo com o cache
 * desligado (se um dia esteve ligado, a cópia não pode sobrar). É o que o
 * logout e o login chamam. Nunca lança nem espera mais que `esperaMs`: sair
 * da conta não pode travar por causa de uma cópia local.
 */
export function apagarCacheLocal({ indexedDB = globalThis.indexedDB, esperaMs = 2000 } = {}) {
  if (!indexedDB) return Promise.resolve(false);
  return new Promise((pronto) => {
    const desistir = setTimeout(() => pronto(false), esperaMs);
    const terminar = (resultado) => {
      clearTimeout(desistir);
      pronto(resultado);
    };
    try {
      const req = indexedDB.deleteDatabase(NOME_DO_BANCO);
      req.onsuccess = () => terminar(true);
      req.onerror = () => terminar(false);
    } catch {
      terminar(false);
    }
  });
}
