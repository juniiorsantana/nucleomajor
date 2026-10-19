/**
 * O cenário da bancada de carga: os dados de uma empresa e o que acontece com
 * eles durante a rodada.
 *
 * Tudo sai de uma semente (mulberry32): a mesma semente dá a mesma empresa e a
 * mesma linha do tempo, e é isso que deixa medir uma aba de cada vez sobre o
 * mesmo dia. As abas só leem — nenhuma muda o que a outra vê —, então somar as
 * abas medidas em sequência dá a mesma carga que elas abertas juntas.
 */

export const ORGANIZACAO = "00000000-0000-4000-8000-0000000000aa";
export const CONEXAO = "00000000-0000-4000-8000-0000000000c1";

export function mulberry32(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALAVRAS = (
  "oi bom dia tudo bem queria saber o valor da consulta pode ser amanhã às dez " +
  "obrigado perfeito combinado vou confirmar com meu marido qual o endereço tem " +
  "estacionamento aceita cartão parcela em quantas vezes vocês atendem sábado"
).split(" ");

const frase = (sorte, min, max) => {
  const n = min + Math.floor(sorte() * (max - min));
  return Array.from({ length: n }, () => PALAVRAS[Math.floor(sorte() * PALAVRAS.length)]).join(" ");
};

const digitos = (sorte, n) => Array.from({ length: n }, () => Math.floor(sorte() * 10)).join("");

/** Celular brasileiro com o nono dígito: 55 + DDD + 9 + 8 dígitos. */
const celular = (sorte) => `55${11 + Math.floor(sorte() * 88)}9${6 + Math.floor(sorte() * 4)}${digitos(sorte, 7)}`;

/** O mesmo número como alguém digitaria no CRM: às vezes sem o 9, às vezes formatado. */
function comoNoCrm(sorte, telefone) {
  const ddd = telefone.slice(2, 4);
  const local = telefone.slice(4);
  const r = sorte();
  if (r < 0.3) return `55${ddd}${local.slice(1)}`;
  if (r < 0.6) return `+55 (${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`;
  return telefone;
}

/**
 * A empresa: `conversas` conversas (10% grupos), o dobro de contatos e as
 * mensagens. As `pesadas` primeiras conversas de gente têm 350 mensagens, acima
 * do teto de 300 da tela: são as que as abas abrem.
 */
export function gerarEmpresa({ conversas: total, semente = 20261019, inicio, pesadas = 15 }) {
  const sorte = mulberry32(semente);
  const iso = (ms) => new Date(ms).toISOString();
  const conversas = [];
  const contatos = [];
  const mensagens = [];
  const usados = new Set();
  const atendentes = [
    ["u-ana", "Ana"],
    ["u-bia", "Bia"],
    ["u-caio", "Caio"],
  ];

  for (let i = 0; i < total; i += 1) {
    const grupo = i % 10 === 9;
    let telefone;
    do telefone = grupo ? `120363${digitos(sorte, 12)}` : celular(sorte);
    while (usados.has(telefone));
    usados.add(telefone);

    const pesada = !grupo && conversas.filter((c) => c.pesada).length < pesadas;
    const quantas = pesada ? 350 : 3 + Math.floor(sorte() ** 2 * 60);
    // A última mensagem: as pesadas mais recentes, o resto espalhado em 30 dias.
    let quando = inicio - (pesada ? 60_000 + i * 90_000 : Math.floor(sorte() * 30 * 86_400_000));
    let ultima = null;
    for (let m = 0; m < quantas; m += 1) {
      const saiu = sorte() < 0.45;
      const midia = sorte() < 0.15 ? (sorte() < 0.5 ? "image" : "ptt") : null;
      const autor = saiu ? ["bot", "ia", "humano", null][Math.floor(sorte() * 4)] : null;
      const linha = {
        organization_id: ORGANIZACAO,
        connection_id: CONEXAO,
        contact_phone: telefone,
        message_id: `3EB0${i.toString(16).padStart(4, "0")}${m.toString(16).padStart(4, "0")}`,
        content: midia && sorte() < 0.6 ? "" : frase(sorte, 2, 28),
        sent_at: iso(quando),
        is_from_me: saiu,
        media_type: midia,
        media_filename: midia ? `${m}.${midia === "image" ? "jpg" : "ogg"}` : null,
        media_path: midia && sorte() < 0.8 ? `${ORGANIZACAO}/${CONEXAO}/${telefone}/${m}.bin` : null,
        media_mime: midia ? (midia === "image" ? "image/jpeg" : "audio/ogg") : null,
        author_kind: autor,
        author_name: autor === "humano" ? "Ana" : autor === "ia" ? "Emy" : null,
        transcribed_at: midia === "ptt" && sorte() < 0.5 ? iso(quando + 20_000) : null,
        created_at: iso(quando),
      };
      if (!ultima) ultima = linha;
      mensagens.push(linha);
      quando -= 30_000 + Math.floor(sorte() * 3_600_000);
    }

    const dono = ["bot", "ia", "humano"][Math.floor(sorte() * 3)];
    const atendente = dono === "humano" ? atendentes[Math.floor(sorte() * atendentes.length)] : null;
    conversas.push({
      pesada,
      organization_id: ORGANIZACAO,
      connection_id: CONEXAO,
      contact_phone: telefone,
      chat_kind: grupo ? "grupo" : "pessoa",
      contact_name: grupo ? `Grupo ${i}` : sorte() < 0.7 ? frase(sorte, 1, 3) : "",
      contact_photo_url: null,
      last_message_preview: (ultima?.content || "📎 Anexo").slice(0, 120),
      last_message_at: ultima?.sent_at || null,
      last_message_from_me: ultima?.is_from_me === true,
      unread_count: sorte() < 0.2 ? 1 + Math.floor(sorte() * 5) : 0,
      owner: dono,
      attendant_id: atendente?.[0] || null,
      attendant_name: atendente?.[1] || null,
      updated_at: iso(inicio - 15_000),
    });

    if (!grupo && sorte() < 0.7) {
      contatos.push({
        id: `c-${String(contatos.length).padStart(5, "0")}`,
        organization_id: ORGANIZACAO,
        name: frase(sorte, 2, 4),
        phone: comoNoCrm(sorte, telefone),
        company: sorte() < 0.4 ? frase(sorte, 1, 3) : null,
        job_title: sorte() < 0.2 ? frase(sorte, 1, 2) : null,
        avatar_path: sorte() < 0.6 ? `${ORGANIZACAO}/avatar-${contatos.length}.jpg` : null,
        deleted_at: null,
        updated_at: iso(inicio - 86_400_000),
      });
    }
  }

  // O resto dos contatos até o dobro das conversas: gente do CRM que nunca
  // escreveu (formulário, importação). É o que a lista de hoje baixa à toa.
  while (contatos.length < total * 2) {
    contatos.push({
      id: `c-${String(contatos.length).padStart(5, "0")}`,
      organization_id: ORGANIZACAO,
      name: frase(sorte, 2, 4),
      phone: celular(sorte),
      company: sorte() < 0.4 ? frase(sorte, 1, 3) : null,
      job_title: null,
      avatar_path: sorte() < 0.6 ? `${ORGANIZACAO}/avatar-${contatos.length}.jpg` : null,
      deleted_at: sorte() < 0.05 ? iso(inicio - 86_400_000) : null,
      updated_at: iso(inicio - 86_400_000),
    });
  }

  return { conversas, contatos, mensagens };
}

/** Carrega a empresa no banco falso. */
export function popular(banco, empresa) {
  const iso = (ms) => new Date(ms).toISOString();
  for (const { pesada: _p, ...conversa } of empresa.conversas) {
    banco.tabelas.whatsapp_conversations.push(
      banco.colunas.whatsapp_conversations.has("changed_at")
        ? { ...conversa, changed_at: conversa.last_message_at || iso(0) }
        : conversa
    );
  }
  for (const mensagem of empresa.mensagens) {
    banco.tabelas.whatsapp_messages.push(
      banco.colunas.whatsapp_messages.has("changed_at") ? { ...mensagem, changed_at: mensagem.created_at } : mensagem
    );
  }
  banco.tabelas.contacts.push(...empresa.contatos.map((c) => ({ ...c })));
}

/**
 * O que cada aba abre e quando: a primeira conversa da lista na montagem, uma
 * pesada logo depois, outra aos 3 min e outra aos 7 min. Cada aba abre as
 * suas, como cinco atendentes diferentes.
 */
export function rotinaDasAbas({ empresa, abas, minutos }) {
  const pesadas = empresa.conversas.filter((c) => c.pesada).map((c) => `${c.connection_id}:${c.contact_phone}`);
  const momentos = [3_000, 180_000, 420_000].filter((t) => t < minutos * 60_000);
  return Array.from({ length: abas }, (_, aba) =>
    momentos.map((t, i) => ({ t: t + aba * 500, id: pesadas[(aba * momentos.length + i) % pesadas.length] }))
  );
}

/**
 * A linha do tempo do banco durante a rodada, em milissegundos desde o início.
 *
 * - a cada 10 s, o heartbeat da conexão (aviso de `connections`);
 * - a cada 15 s, a sincronia da VPS regravando `updated_at` de todas as
 *   conversas, mudando ou não (o que produção faz hoje);
 * - uma mensagem a cada 4 a 16 s (média de 6 por minuto na empresa), um terço
 *   delas numa conversa que alguma aba está lendo; 15% com mídia, cujo arquivo
 *   chega 15 s depois (a mensagem muda depois de chegar);
 * - aos 5 min, um contato renomeado no CRM.
 */
export function linhaDoTempo({ empresa, rotinas, minutos, semente = 7 }) {
  const sorte = mulberry32(semente);
  const fim = minutos * 60_000;
  const eventos = [];
  for (let t = 10_000; t < fim; t += 10_000) eventos.push({ t, tipo: "heartbeat" });
  for (let t = 15_000; t < fim; t += 15_000) eventos.push({ t, tipo: "sincronia" });

  const abertasEm = (t) =>
    rotinas.map((rotina) => [...rotina].reverse().find((passo) => passo.t <= t)?.id).filter(Boolean);
  const todas = empresa.conversas.map((c) => `${c.connection_id}:${c.contact_phone}`);

  let n = 0;
  for (let t = 6_000 + Math.floor(sorte() * 4_000); t < fim; t += 4_000 + Math.floor(sorte() * 12_000)) {
    const abertas = abertasEm(t);
    const id = abertas.length && sorte() < 0.33
      ? abertas[Math.floor(sorte() * abertas.length)]
      : todas[Math.floor(sorte() * todas.length)];
    const midia = sorte() < 0.15;
    eventos.push({
      t,
      tipo: "mensagem",
      id,
      messageId: `BANCADA${String(n).padStart(5, "0")}`,
      saiu: sorte() < 0.2,
      texto: frase(sorte, 2, 20),
      midia,
    });
    if (midia) eventos.push({ t: t + 15_000, tipo: "arquivo", messageId: `BANCADA${String(n).padStart(5, "0")}` });
    n += 1;
  }

  const comContato = empresa.conversas.find((c) => c.chat_kind !== "grupo" && empresa.contatos.some((k) => k.phone === c.contact_phone));
  if (comContato && fim > 300_000) eventos.push({ t: 300_000, tipo: "renomear", telefone: comContato.contact_phone });

  return eventos.sort((a, b) => a.t - b.t);
}

/** Aplica um evento da linha do tempo no banco. */
export function aplicar(banco, evento) {
  const iso = new Date(Date.now()).toISOString();
  if (evento.tipo === "heartbeat") {
    banco.avisarTopico(ORGANIZACAO, "connections", CONEXAO);
  } else if (evento.tipo === "sincronia") {
    // `on conflict do update ... updated_at = now()` no lote inteiro.
    banco.atualizar("whatsapp_conversations", (c) => c.organization_id === ORGANIZACAO, { updated_at: iso });
  } else if (evento.tipo === "mensagem") {
    const [connectionId, telefone] = evento.id.split(":");
    banco.inserir("whatsapp_messages", {
      organization_id: ORGANIZACAO,
      connection_id: connectionId,
      contact_phone: telefone,
      message_id: evento.messageId,
      content: evento.texto,
      sent_at: iso,
      is_from_me: evento.saiu,
      media_type: evento.midia ? "image" : null,
      media_filename: evento.midia ? "foto.jpg" : null,
      media_path: null,
      media_mime: evento.midia ? "image/jpeg" : null,
      author_kind: evento.saiu ? "ia" : null,
      author_name: evento.saiu ? "Emy" : null,
      transcribed_at: null,
      created_at: iso,
    });
    banco.atualizar(
      "whatsapp_conversations",
      (c) => c.connection_id === connectionId && c.contact_phone === telefone,
      (c) => ({
        last_message_preview: evento.texto.slice(0, 120),
        last_message_at: iso,
        last_message_from_me: evento.saiu,
        unread_count: evento.saiu ? c.unread_count : c.unread_count + 1,
      })
    );
  } else if (evento.tipo === "arquivo") {
    banco.atualizar("whatsapp_messages", (m) => m.message_id === evento.messageId, (m) => ({
      media_path: `${ORGANIZACAO}/${m.connection_id}/${m.contact_phone}/${evento.messageId}.jpg`,
    }));
  } else if (evento.tipo === "renomear") {
    banco.atualizar("contacts", (c) => c.phone === evento.telefone, { name: "Contato renomeado na bancada" });
  }
}
