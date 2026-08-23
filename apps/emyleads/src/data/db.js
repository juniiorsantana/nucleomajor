/**
 * IndexedDB cru, sem dependência externa.
 *
 * Vive no service worker, nunca no content script: IndexedDB aberto de dentro
 * de um content script grava sob a origem do web.whatsapp.com — onde a página
 * enxerga e onde o WhatsApp pode limpar. Aqui grava sob a origem da extensão.
 *
 * O worker do MV3 dorme e acorda o tempo todo, então `abrir()` memoiza a
 * conexão mas nunca assume que ela sobreviveu: qualquer chamada reabre se
 * preciso.
 */

import { ESTAGIOS_PADRAO, TAGS_PADRAO } from "../domain/types.js";
import { chatbotsPadrao } from "../domain/chatbots.js";

const NOME_DB = "emyleads";
// Incrementar somente quando houver uma migração em `onupgradeneeded`.
// O esquema atual já usa criação idempotente das lojas, então versões futuras
// podem adicionar índices/lojas sem apagar os dados existentes.
export const VERSAO_DB = 4;

export const LOJAS = {
  contatos: "contatos",
  negocios: "negocios",
  tarefas: "tarefas",
  notas: "notas",
  estagios: "estagios",
  tags: "tags",
  meta: "meta",
  outbox: "outbox",
  sync: "sync",
  eventos: "eventos",
  chatbots: "chatbots",
};

let conexao = null;
let workspaceAtual = null;

/**
 * Cada empresa tem um cache IndexedDB independente. `null` é reservado para
 * a base legada criada antes do login; ela só é usada durante a migração.
 */
export function definirWorkspace(organizationId = null) {
  const proximo = organizationId ? String(organizationId).trim() : null;
  if (workspaceAtual === proximo) return;
  esquecerConexao();
  workspaceAtual = proximo;
}

export const obterWorkspace = () => workspaceAtual;

export const nomeDoBanco = () =>
  workspaceAtual ? `${NOME_DB}-${workspaceAtual}` : NOME_DB;

export function abrir() {
  if (conexao) return Promise.resolve(conexao);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(nomeDoBanco(), VERSAO_DB);

    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = e.target.transaction;

      if (!db.objectStoreNames.contains(LOJAS.contatos)) {
        const s = db.createObjectStore(LOJAS.contatos, { keyPath: "id" });
        // Sem `unique: true` de propósito: contato recém-criado pode ter
        // telefone vazio, e duas strings vazias colidiriam num índice único.
        // A unicidade real é imposta no localProvider, que sabe o que é vazio.
        s.createIndex("telefone", "telefone");
        s.createIndex("waId", "waId");
      }

      if (!db.objectStoreNames.contains(LOJAS.negocios)) {
        const s = db.createObjectStore(LOJAS.negocios, { keyPath: "id" });
        s.createIndex("contactId", "contactId");
        s.createIndex("stageId", "stageId");
      }

      if (!db.objectStoreNames.contains(LOJAS.tarefas)) {
        const s = db.createObjectStore(LOJAS.tarefas, { keyPath: "id" });
        s.createIndex("contactId", "contactId");
        // `concluida` não vira índice: booleano não é chave válida em
        // IndexedDB. Filtrar em memória é correto e barato nesta escala.
        s.createIndex("venceEm", "venceEm");
      }

      if (!db.objectStoreNames.contains(LOJAS.notas)) {
        const s = db.createObjectStore(LOJAS.notas, { keyPath: "id" });
        s.createIndex("contactId", "contactId");
      }

      if (!db.objectStoreNames.contains(LOJAS.estagios)) {
        const s = db.createObjectStore(LOJAS.estagios, { keyPath: "id" });
        // Semear aqui, dentro da transação de upgrade, e não no primeiro uso:
        // é o único momento em que dá para garantir que roda uma vez só.
        ESTAGIOS_PADRAO.forEach((e) => s.put(e));
      }

      if (!db.objectStoreNames.contains(LOJAS.tags)) {
        const s = db.createObjectStore(LOJAS.tags, { keyPath: "id" });
        TAGS_PADRAO.forEach((t) => s.put(t));
      }

      if (!db.objectStoreNames.contains(LOJAS.meta)) {
        db.createObjectStore(LOJAS.meta, { keyPath: "chave" });
      }

      if (!db.objectStoreNames.contains(LOJAS.outbox)) {
        const s = db.createObjectStore(LOJAS.outbox, { keyPath: "id" });
        s.createIndex("status", "status");
        s.createIndex("entidade", "entidade");
        s.createIndex("criadoEm", "criadoEm");
      }

      if (!db.objectStoreNames.contains(LOJAS.sync)) {
        db.createObjectStore(LOJAS.sync, { keyPath: "chave" });
      }

      if (!db.objectStoreNames.contains(LOJAS.eventos)) {
        const s = db.createObjectStore(LOJAS.eventos, { keyPath: "id" });
        s.createIndex("contactId", "contactId");
        s.createIndex("ocorridoEm", "ocorridoEm");
      }

      if (!db.objectStoreNames.contains(LOJAS.chatbots)) {
        const s = db.createObjectStore(LOJAS.chatbots, { keyPath: "id" });
        s.createIndex("criadoEm", "criadoEm");
        chatbotsPadrao(Date.now()).forEach((chatbot) => s.put(chatbot));
      }

      tx.oncomplete = () => {};
    };

    req.onsuccess = () => {
      const aberta = req.result;
      conexao = aberta;
      // O navegador fecha a conexão sozinho quando outra aba pede um upgrade.
      // Sem soltar a memoização aqui, todas as chamadas seguintes falhariam.
      aberta.onclose = () => {
        if (conexao === aberta) conexao = null;
      };
      conexao.onversionchange = () => {
        if (conexao === aberta) conexao = null;
        aberta.close();
      };
      resolve(aberta);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("Banco bloqueado por outra aba. Feche e tente de novo."));
  });
}

/** Envolve uma request do IndexedDB numa promise. */
export const pedir = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function comLoja(nome, modo, fn) {
  const db = await abrir();
  const tx = db.transaction(nome, modo);
  const resultado = await fn(tx.objectStore(nome));
  // Esperar a transação fechar, e não só a request resolver: em escrita, o
  // dado só está durável quando o `complete` dispara.
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transação abortada"));
  });
  return resultado;
}

/**
 * Executa uma operação atômica envolvendo várias lojas.
 *
 * Exclusão em cascata e realocação de registros não podem ser uma sequência
 * de transações independentes: se uma delas falhar, a base fica com órfãos ou
 * referências quebradas. O IndexedDB só oferece atomicidade quando todas as
 * escritas compartilham a mesma transação.
 */
export async function comLojas(nomes, modo, fn) {
  const db = await abrir();
  const tx = db.transaction(nomes, modo);
  const lojas = Object.fromEntries(
    nomes.map((nome) => [nome, tx.objectStore(nome)])
  );

  let resultado;
  try {
    resultado = await fn(lojas);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // A transação pode já ter sido abortada pelo próprio IndexedDB.
    }
    throw err;
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transação abortada"));
  });
  return resultado;
}

export const todos = (loja) => comLoja(loja, "readonly", (s) => pedir(s.getAll()));

export const buscar = (loja, id) =>
  comLoja(loja, "readonly", (s) => pedir(s.get(id)));

export const porIndice = (loja, indice, valor) =>
  comLoja(loja, "readonly", (s) => pedir(s.index(indice).getAll(valor)));

export const gravar = (loja, registro) =>
  comLoja(loja, "readwrite", (s) => pedir(s.put(registro))).then(() => registro);

export const gravarVarios = (loja, registros) =>
  comLoja(loja, "readwrite", (s) => {
    registros.forEach((r) => s.put(r));
    return registros;
  });

export const apagar = (loja, id) =>
  comLoja(loja, "readwrite", (s) => pedir(s.delete(id)));

export const limpar = (loja) =>
  comLoja(loja, "readwrite", (s) => pedir(s.clear()));

/** Só para testes e para o "apagar tudo" das configurações. */
export function esquecerConexao() {
  conexao?.close?.();
  conexao = null;
}
