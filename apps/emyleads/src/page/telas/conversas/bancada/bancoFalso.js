import { variantesBR } from "../../../../lib/phone.js";

/**
 * O Supabase de mentira da bancada de carga.
 *
 * Não é um mock de chamadas: é um banco pequeno, em memória, com as mesmas
 * tabelas, colunas e gatilhos de realtime que a tela de Conversas usa, e um
 * cliente com a forma do `supabase-js` por cima. O provider de verdade
 * (`web/conversasProvider.js`) e o gateway de verdade (`web/gatewayProvider.js`)
 * conversam com ele sem saber que é falso — e é por isso que o mesmo cenário
 * mede o "antes" (main) e o "depois" (as branches integradas).
 *
 * Duas versões do banco, escolhidas por `esquema`:
 *
 * - `"hoje"`: o de produção em 19/10/2026. Sem `changed_at`, sem a RPC
 *   `nucleo_conversation_list`, aviso de realtime só com a conexão.
 * - `"escala"`: o contrato da seção 4 do plano da escala. `changed_at` que só
 *   anda com mudança de verdade, a RPC da lista com o contato casado e o aviso
 *   com `entity_key`.
 *
 * Pedir coluna que não existe responde `42703`, e RPC que não existe responde
 * `PGRST202`, como o PostgREST: é isso que prova a reserva do portal novo.
 *
 * Cada cliente (uma aba) conta o que leu: pedidos, linhas e bytes do JSON da
 * resposta, por origem. Os bytes são o tamanho do JSON que a resposta teria, e
 * não o que a rede gasta de verdade (cabeçalho, compressão) — é a medida que
 * compara antes e depois, não a conta do Supabase.
 */

const COLUNAS = {
  whatsapp_conversations: [
    "organization_id", "connection_id", "contact_phone", "chat_kind", "contact_name",
    "contact_photo_url", "last_message_preview", "last_message_at", "last_message_from_me",
    "unread_count", "owner", "attendant_id", "attendant_name", "updated_at",
  ],
  whatsapp_messages: [
    "organization_id", "connection_id", "contact_phone", "message_id", "content", "sent_at",
    "is_from_me", "media_type", "media_filename", "media_path", "media_mime", "author_kind",
    "author_name", "transcribed_at", "created_at",
  ],
  contacts: [
    "id", "organization_id", "name", "phone", "company", "job_title", "avatar_path",
    "deleted_at", "updated_at",
  ],
  conversation_insight_runs: [
    "organization_id", "connection_id", "contact_phone", "analyzed_until", "created_at",
    "messages_count", "summary", "is_latest",
  ],
};

const COM_MUDANCA = ["whatsapp_conversations", "whatsapp_messages"];

/** As colunas de cada tabela na versão do banco pedida. */
function colunasDoEsquema(esquema) {
  const colunas = Object.fromEntries(Object.entries(COLUNAS).map(([t, c]) => [t, new Set(c)]));
  if (esquema === "escala") for (const tabela of COM_MUDANCA) colunas[tabela].add("changed_at");
  return colunas;
}

const bytesDe = (valor) => (valor == null ? 0 : JSON.stringify(valor).length);

/** Igualdade de linha ignorando colunas de carimbo, como o gatilho do banco. */
function mudouDeVerdade(antes, depois, ignorar) {
  for (const chave of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
    if (ignorar.includes(chave)) continue;
    if (antes[chave] !== depois[chave]) return true;
  }
  return false;
}

/**
 * O banco. `agora()` é o relógio da bancada (o `Date.now` dos timers falsos),
 * e o carimbo de cada escrita sai dele.
 */
export function criarBancoFalso({ esquema = "hoje", agora = () => Date.now() } = {}) {
  const colunas = colunasDoEsquema(esquema);
  const tabelas = Object.fromEntries(Object.keys(COLUNAS).map((t) => [t, []]));
  const ouvintes = new Set();
  const iso = () => new Date(agora()).toISOString();

  /** O aviso de realtime, como `private.portal_realtime_notify` o grava. */
  const avisar = (linha, topico) => {
    const evento = {
      organization_id: linha.organization_id,
      topic: topico,
      entity_id: linha.connection_id || linha.id || null,
      ...(esquema === "escala" && topico === "conversas" ? { entity_key: linha.contact_phone } : {}),
    };
    for (const ouvir of ouvintes) ouvir(evento);
  };

  const inserir = (tabela, linha) => {
    const nova = { ...linha };
    if (colunas[tabela].has("changed_at")) nova.changed_at = nova.changed_at || iso();
    if (colunas[tabela].has("updated_at") && !nova.updated_at) nova.updated_at = iso();
    tabelas[tabela].push(nova);
    if (tabela === "whatsapp_conversations") avisar(nova, "conversas");
    return nova;
  };

  /**
   * Atualiza as linhas que passam em `onde`. `changed_at` só anda quando algo
   * além de `updated_at` mudou, e o aviso de `conversas` só sai nesse caso —
   * o comportamento dos dois gatilhos (20260926140000 e o do Major 1).
   */
  const atualizar = (tabela, onde, mudancas) => {
    const alteradas = [];
    tabelas[tabela] = tabelas[tabela].map((linha) => {
      if (!onde(linha)) return linha;
      const troca = typeof mudancas === "function" ? mudancas(linha) : mudancas;
      const depois = { ...linha, ...troca };
      if (colunas[tabela].has("updated_at") && !("updated_at" in troca)) depois.updated_at = iso();
      const real = mudouDeVerdade(linha, depois, ["updated_at", "changed_at"]);
      if (colunas[tabela].has("changed_at")) depois.changed_at = real ? iso() : linha.changed_at;
      if (real) alteradas.push(depois);
      return depois;
    });
    if (tabela === "whatsapp_conversations") for (const linha of alteradas) avisar(linha, "conversas");
    return alteradas;
  };

  return {
    esquema,
    tabelas,
    colunas,
    inserir,
    atualizar,
    /** O canal de realtime: recebe cada linha nova de `portal_realtime_events`. */
    ouvir(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    /** Aviso de outro tópico (o heartbeat das conexões, por exemplo). */
    avisarTopico(organizationId, topico, entityId = null) {
      const evento = { organization_id: organizationId, topic: topico, entity_id: entityId };
      for (const ouvir of ouvintes) ouvir(evento);
    },
  };
}

/* ------------------------------------------------------------------ */

const erro = (code, message) => ({ code, message, details: null, hint: null });

/** Tira o apelido e o `!inner` de um item do select: `a:b` → `b`. */
const colunaDoItem = (item) => item.split(":").pop().trim();

class Consulta {
  constructor(cliente, tabela) {
    this.cliente = cliente;
    this.tabela = tabela;
    this.filtros = [];
    this.ordens = [];
    this.limite = null;
    this.campos = null;
  }

  select(campos = "*") {
    this.campos = campos === "*" ? null : campos.split(",").map(colunaDoItem).filter(Boolean);
    return this;
  }

  eq(coluna, valor) { this.filtros.push([coluna, (v) => v === valor]); return this; }
  neq(coluna, valor) { this.filtros.push([coluna, (v) => v !== valor]); return this; }
  is(coluna, valor) { this.filtros.push([coluna, (v) => (valor === null ? v == null : v === valor)]); return this; }
  in(coluna, valores) { const s = new Set(valores); this.filtros.push([coluna, (v) => s.has(v)]); return this; }
  gt(coluna, valor) { this.filtros.push([coluna, (v) => v != null && v > valor]); return this; }
  gte(coluna, valor) { this.filtros.push([coluna, (v) => v != null && v >= valor]); return this; }
  lt(coluna, valor) { this.filtros.push([coluna, (v) => v != null && v < valor]); return this; }
  lte(coluna, valor) { this.filtros.push([coluna, (v) => v != null && v <= valor]); return this; }

  order(coluna, { ascending = true, nullsFirst } = {}) {
    this.ordens.push({ coluna, ascending, nullsFirst: nullsFirst ?? !ascending });
    return this;
  }

  limit(n) { this.limite = n; return this; }

  executar() {
    const banco = this.cliente.banco;
    const colunas = banco.colunas[this.tabela];
    if (!colunas) return { data: null, error: erro("42P01", `relation "public.${this.tabela}" does not exist`) };
    const pedidas = [...(this.campos || []), ...this.filtros.map(([c]) => c), ...this.ordens.map((o) => o.coluna)];
    const falta = pedidas.find((c) => !colunas.has(c));
    if (falta) {
      return { data: null, error: erro("42703", `column ${this.tabela}.${falta} does not exist`) };
    }
    let linhas = banco.tabelas[this.tabela].filter((linha) => this.filtros.every(([c, f]) => f(linha[c])));
    if (this.ordens.length) linhas = [...linhas].sort((a, b) => compararPor(this.ordens, a, b));
    if (this.limite != null) linhas = linhas.slice(0, this.limite);
    const data = linhas.map((linha) =>
      this.campos ? Object.fromEntries(this.campos.map((c) => [c, linha[c] ?? null])) : { ...linha }
    );
    return { data, error: null };
  }

  then(ok, falhou) {
    return Promise.resolve()
      .then(() => {
        const resposta = this.executar();
        this.cliente.contar(this.tabela, resposta);
        return resposta;
      })
      .then(ok, falhou);
  }
}

function compararPor(ordens, a, b) {
  for (const { coluna, ascending, nullsFirst } of ordens) {
    const x = a[coluna];
    const y = b[coluna];
    if (x == null && y == null) continue;
    if (x == null) return nullsFirst ? -1 : 1;
    if (y == null) return nullsFirst ? 1 : -1;
    if (x === y) continue;
    return (x < y ? -1 : 1) * (ascending ? 1 : -1);
  }
  return 0;
}

/** O contato de um telefone, pela mesma regra do nono dígito do portal. */
function contatoDoTelefone(contatos, telefone) {
  const formas = new Set(variantesBR(telefone));
  return contatos.find((c) => variantesBR(c.phone).some((f) => formas.has(f))) || null;
}

/**
 * `public.nucleo_conversation_list`, pelo contrato da seção 4 do plano.
 * Só existe no banco `"escala"`.
 */
function listaDeConversas(banco, { target_organization, changed_since = null, max_rows = 1000 }) {
  const contatos = banco.tabelas.contacts.filter(
    (c) => c.organization_id === target_organization && c.deleted_at == null
  );
  let linhas = banco.tabelas.whatsapp_conversations
    .filter((c) => c.organization_id === target_organization)
    .map((conversa) => {
      const contato = conversa.chat_kind === "grupo" ? null : contatoDoTelefone(contatos, conversa.contact_phone);
      return { conversa, contato };
    });
  if (changed_since) {
    linhas = linhas
      .filter(({ conversa, contato }) => conversa.changed_at > changed_since || (contato && contato.updated_at > changed_since))
      .sort((a, b) => (a.conversa.changed_at < b.conversa.changed_at ? -1 : a.conversa.changed_at > b.conversa.changed_at ? 1 : 0));
  } else {
    linhas = [...linhas].sort((a, b) =>
      compararPor([{ coluna: "last_message_at", ascending: false, nullsFirst: false }], a.conversa, b.conversa)
    );
  }
  return linhas.slice(0, max_rows).map(({ conversa, contato }) => ({
    connection_id: conversa.connection_id,
    contact_phone: conversa.contact_phone,
    chat_kind: conversa.chat_kind,
    contact_name: conversa.contact_name,
    contact_photo_url: conversa.contact_photo_url,
    last_message_preview: conversa.last_message_preview,
    last_message_at: conversa.last_message_at,
    last_message_from_me: conversa.last_message_from_me,
    unread_count: conversa.unread_count,
    owner: conversa.owner,
    attendant_id: conversa.attendant_id,
    attendant_name: conversa.attendant_name,
    changed_at: conversa.changed_at,
    contact_id: contato?.id || null,
    crm_name: contato?.name || null,
    crm_company: contato?.company || null,
    crm_job_title: contato?.job_title || null,
    crm_avatar_path: contato?.avatar_path || null,
  }));
}

/**
 * Um cliente `supabase-js` falso: uma aba. Conta o que ela leu.
 *
 * `realtime` diz se o canal chega a se inscrever (`"ativo"`) ou não
 * (`"caido"`): no segundo caso nenhum aviso chega, e só os timers da tela
 * seguram a lista.
 */
export function criarClienteFalso(banco, { realtime = "ativo", agora = () => Date.now() } = {}) {
  const contagem = { pedidos: 0, linhas: 0, bytes: 0, porOrigem: {}, porMinuto: [] };
  const assinadas = new Map();
  const reassinaturas = { antesDeVencer: 0, total: 0 };
  let inicio = agora();

  const contar = (origem, resposta, linhas = Array.isArray(resposta.data) ? resposta.data.length : resposta.data ? 1 : 0) => {
    const bytes = bytesDe(resposta.data) + bytesDe(resposta.error);
    const minuto = Math.floor((agora() - inicio) / 60000);
    contagem.pedidos += 1;
    contagem.linhas += linhas;
    contagem.bytes += bytes;
    const o = (contagem.porOrigem[origem] ||= { pedidos: 0, linhas: 0, bytes: 0 });
    o.pedidos += 1;
    o.linhas += linhas;
    o.bytes += bytes;
    const m = (contagem.porMinuto[minuto] ||= { pedidos: 0, linhas: 0, bytes: 0, porOrigem: {} });
    m.pedidos += 1;
    m.linhas += linhas;
    m.bytes += bytes;
    const mo = (m.porOrigem[origem] ||= { pedidos: 0, linhas: 0, bytes: 0 });
    mo.pedidos += 1;
    mo.linhas += linhas;
    mo.bytes += bytes;
  };

  const canais = new Set();

  const cliente = {
    banco,
    contagem,
    reassinaturas,
    contar,
    /** Zera o relógio da contagem (o minuto 0 é o da montagem da aba). */
    zerarRelogio() { inicio = agora(); },

    from(tabela) {
      return new Consulta(cliente, tabela);
    },

    async rpc(nome, args) {
      let resposta;
      if (nome === "nucleo_conversation_list" && banco.esquema === "escala") {
        resposta = { data: listaDeConversas(banco, args || {}), error: null };
      } else {
        resposta = {
          data: null,
          error: erro("PGRST202", `Could not find the function public.${nome} in the schema cache`),
        };
      }
      contar(`rpc:${nome}`, resposta);
      return resposta;
    },

    storage: {
      from(bucket) {
        return {
          async createSignedUrls(caminhos, validade) {
            const momento = agora();
            const data = caminhos.map((path) => {
              const antes = assinadas.get(`${bucket}/${path}`);
              reassinaturas.total += antes ? 1 : 0;
              // "Antes de vencer": faltando mais de 5 min para a URL anterior expirar.
              if (antes && antes - momento > 5 * 60 * 1000) reassinaturas.antesDeVencer += 1;
              assinadas.set(`${bucket}/${path}`, momento + validade * 1000);
              return {
                path,
                signedUrl: `https://falso.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=${momento}`,
                error: null,
              };
            });
            const resposta = { data, error: null };
            contar(`storage:${bucket}`, resposta);
            return resposta;
          },
        };
      },
    },

    channel(nome) {
      const ouvintesDoCanal = [];
      let desligar = null;
      const canal = {
        nome,
        on(_tipo, filtro, aoMudar) {
          ouvintesDoCanal.push({ filtro, aoMudar });
          return canal;
        },
        subscribe(aoMudarEstado) {
          if (realtime !== "ativo") {
            setTimeout(() => aoMudarEstado?.("CHANNEL_ERROR"), 0);
            return canal;
          }
          desligar = banco.ouvir((evento) => {
            for (const { filtro, aoMudar } of ouvintesDoCanal) {
              if (filtro?.filter && filtro.filter !== `organization_id=eq.${evento.organization_id}`) continue;
              // O evento conta como leitura: é uma linha que chega à aba.
              contar("realtime:portal_realtime_events", { data: evento, error: null }, 1);
              aoMudar({ new: evento });
            }
          });
          setTimeout(() => aoMudarEstado?.("SUBSCRIBED"), 0);
          return canal;
        },
        unsubscribe() {
          desligar?.();
          return Promise.resolve("ok");
        },
      };
      canais.add(canal);
      return canal;
    },

    async removeChannel(canal) {
      canais.delete(canal);
      await canal?.unsubscribe?.();
      return "ok";
    },

    /** Desliga todos os canais: a aba fechou. */
    fechar() {
      for (const canal of canais) canal.unsubscribe();
      canais.clear();
    },
  };
  return cliente;
}
