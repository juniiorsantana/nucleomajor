/**
 * chat-inject.js — roda no MUNDO PRINCIPAL da página (manifest world: "MAIN"),
 * que é o único lugar de onde dá para falar com o wa-js (`window.WPP`,
 * carregado antes deste arquivo).
 *
 * Descobrir QUEM é a conversa aberta é a única responsabilidade daqui.
 *
 * Sobre tempo: nada disto está pronto quando o arquivo executa. O wa-js é
 * injetado em document_start e define `window.WPP` depois; o WPP só fica
 * utilizável quando o WhatsApp termina de subir, o que leva segundos. Por isso
 * existem duas esperas encadeadas, e por isso quem pergunta cedo é ATENDIDO
 * DEPOIS em vez de receber erro.
 *
 * Protocolo:
 *   content script → página:  { source: "emyleads", cmd, id, ...args }
 *   página → content script:  { source: "emyleads-page", id, ok, dados }
 *                             { source: "emyleads-page", id, ok: false, erro }
 *   eventos espontâneos:      { evento: "pronto" }
 *                             { evento: "indisponivel", dados: { motivo } }
 *                             { evento: "conversa", dados: ConversaAtiva|null }
 *
 * Este arquivo nunca pode derrubar o carregamento do WhatsApp. Qualquer falha
 * vira resposta de erro, e quem chamou decide o que fazer.
 */
(() => {
  const ESPERA_WPP = 20000; // até o objeto existir
  const ESPERA_PRONTO = 60000; // até o WhatsApp terminar de subir
  const INTERVALO = 600;

  const responder = (id, ok, carga) =>
    window.postMessage(
      {
        source: "emyleads-page",
        id,
        ok,
        ...(ok ? { dados: carga } : { erro: carga }),
      },
      "*"
    );

  const emitir = (evento, dados = null) =>
    window.postMessage({ source: "emyleads-page", evento, dados }, "*");

  const digitos = (s) => String(s || "").replace(/\D/g, "");

  /* ---------------------------------------------------------------- */
  /* Espera                                                            */
  /* ---------------------------------------------------------------- */

  function esperarWPP() {
    return new Promise((resolve, reject) => {
      const inicio = Date.now();
      (function tenta() {
        if (window.WPP) return resolve(window.WPP);
        if (Date.now() - inicio > ESPERA_WPP)
          return reject(new Error("wa-js não carregou nesta aba."));
        setTimeout(tenta, 200);
      })();
    });
  }

  let promessaPronto = null;

  /**
   * Resolve quando o wa-js está utilizável. Memoizada: todo mundo espera a
   * mesma promessa, então perguntar dez vezes não cria dez temporizadores.
   */
  function esperarPronto() {
    if (promessaPronto) return promessaPronto;

    promessaPronto = esperarWPP().then(
      (WPP) =>
        new Promise((resolve, reject) => {
          if (WPP.isReady) return resolve(WPP);

          // 4.x expõe em WPP.loader; versões antigas usavam WPP.webpack
          const onReady = WPP.loader?.onReady || WPP.webpack?.onReady;
          if (!onReady)
            return reject(new Error("API do wa-js não reconhecida."));

          const relogio = setTimeout(
            () => reject(new Error("O WhatsApp não ficou pronto a tempo.")),
            ESPERA_PRONTO
          );
          onReady(() => {
            clearTimeout(relogio);
            resolve(WPP);
          });
        })
    );

    return promessaPronto;
  }

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Converte um valor "tipo wid" (string, Wid, ou objeto com _serialized) em
   * telefone — recusando o que não for telefone.
   *
   * A recusa é o ponto principal. Um LID como "2126143062228@lid" tem 13
   * dígitos e passaria por número internacional válido em qualquer validação
   * ingênua. Só aceitamos quando o domínio é de telefone, ou quando não há
   * domínio nenhum para conferir.
   */
  function widParaTelefone(valor) {
    if (!valor || typeof valor?.then === "function") return null;

    const texto =
      typeof valor === "string"
        ? valor
        : valor._serialized ||
          (valor.user && valor.server ? `${valor.user}@${valor.server}` : valor.user) ||
          "";

    const s = String(texto);
    if (!s) return null;
    if (s.includes("@") && !/@(c\.us|s\.whatsapp\.net)$/.test(s)) return null;

    const d = digitos(s.split("@")[0]);
    return d.length >= 10 && d.length <= 15 ? d : null;
  }

  /**
   * Telefone real de um contato endereçado por LID.
   *
   * `pnForLid` é a tradução que o próprio WhatsApp mantém — é o equivalente,
   * do lado do navegador, da tabela de mapeamento que o bridge lê do
   * whatsmeow. Pode vir vazia quando o WhatsApp ainda não recebeu o
   * mapeamento daquele contato; nesse caso ficamos sem telefone, e quem
   * resolve é o vínculo manual na ficha.
   */
  function telefonePeloContato(WPP, wid) {
    const candidatos = [];

    const coletar = (c) => {
      if (!c) return;
      candidatos.push(c.pnForLid, c.phoneNumber, c.formattedPhone);
      // c.id só entra por último e só passa se for domínio de telefone —
      // em contato por LID ele É o LID.
      candidatos.push(c.id);
    };

    try {
      coletar(WPP.whatsapp?.ContactStore?.get?.(wid));
    } catch {
      /* store indisponível nesta versão */
    }
    try {
      coletar(WPP.contact?.get?.(wid));
    } catch {
      /* idem */
    }

    for (const c of candidatos) {
      const tel = widParaTelefone(c);
      if (tel) return tel;
    }
    return null;
  }

  function lerConversaAtiva(WPP) {
    const chat = WPP.chat?.getActiveChat?.();
    if (!chat) return null;

    const wid = chat.id?._serialized || String(chat.id || "");
    if (!wid) return null;

    const grupo = wid.endsWith("@g.us");
    // O wid já é o telefone quando é "@c.us"; quando é "@lid", widParaTelefone
    // recusa e a tradução vem do contato.
    const telefone = grupo
      ? null
      : widParaTelefone(wid) || telefonePeloContato(WPP, wid);

    return {
      waId: wid,
      telefone,
      nome: chat.formattedTitle || chat.name || chat.contact?.pushname || "",
      grupo,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Comandos e ciclo de vida                                          */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* Importação da agenda                                              */
  /* ---------------------------------------------------------------- */

  const ehPessoa = (wid) =>
    typeof wid === "string" &&
    !wid.endsWith("@g.us") &&
    !wid.endsWith("@newsletter") &&
    !wid.startsWith("status@") &&
    wid.includes("@");

  /**
   * Reduz um ContactModel ou um ChatModel à forma que o EmyLeads guarda.
   *
   * Os dois modelos são aceitos porque os escopos vêm de origens diferentes —
   * `contact.list` e `chat.list` —, mas o que a ficha precisa é o mesmo.
   */
  function normalizar(WPP, m) {
    const wid = m?.id?._serialized || String(m?.id || "");
    if (!ehPessoa(wid)) return null;
    if (m.isMe) return null;

    const contato = m.contact || m;
    const nome =
      contato.name ||
      contato.verifiedName ||
      contato.pushname ||
      m.formattedTitle ||
      contato.formattedName ||
      "";

    const telefone = widParaTelefone(wid) || telefonePeloContato(WPP, wid);

    // Nome que é só o próprio número não ajuda ninguém na lista.
    const soDigitos = /^[\d\s+()-]+$/.test(nome.trim());

    return {
      waId: wid,
      nome: soDigitos ? "" : nome.trim(),
      telefone,
      empresa: contato.isBusiness ? contato.verifiedName || "" : "",
      ehMeuContato: !!contato.isMyContact,
      ultimaEm: typeof m.t === "number" ? m.t * 1000 : null,
    };
  }

  async function listarContatos(d) {
    const WPP = await esperarPronto();
    const limite = d.limite || 500;
    let brutos = [];

    if (d.escopo === "conversas") {
      brutos = await WPP.chat.list({ onlyUsers: true, count: limite });
    } else if (d.escopo === "etiqueta") {
      brutos = await WPP.contact.list({ withLabels: [String(d.etiquetaId)] });
    } else {
      brutos = await WPP.contact.list({ onlyMyContacts: true });
    }

    const vistos = new Set();
    const saida = [];
    for (const m of brutos) {
      const item = normalizar(WPP, m);
      if (!item || vistos.has(item.waId)) continue;
      vistos.add(item.waId);
      saida.push(item);
    }

    // Conversas já vêm por recência; agenda e etiqueta, por nome.
    if (d.escopo !== "conversas")
      saida.sort((a, b) => (a.nome || "~").localeCompare(b.nome || "~", "pt-BR"));

    return saida;
  }

  async function listarEtiquetas() {
    const WPP = await esperarPronto();
    const todas = (await WPP.labels?.getAllLabels?.()) || [];
    return todas.map((l) => ({
      id: String(l.id),
      nome: l.name || `Etiqueta ${l.id}`,
      cor: l.hexColor || null,
      quantidade: typeof l.count === "number" ? l.count : null,
    }));
  }

  /** Aceita apenas mensagens novas recebidas em conversas individuais. */
  function normalizarMensagemRecebida(WPP, msg) {
    const id = msg?.id;
    if (!id || id.fromMe || msg.isSentByMe || !msg.isNewMsg) return null;
    if (msg.isGroupMsg || msg.isStatusV3 || msg.isNotification) return null;

    const waId =
      id.remote?._serialized ||
      msg.from?._serialized ||
      String(id.remote || msg.from || "");
    if (!ehPessoa(waId) || waId.endsWith("@g.us") || waId.includes("@broadcast"))
      return null;

    const messageId = id._serialized || id.toString?.() || id.id;
    if (!messageId) return null;

    return {
      messageId: String(messageId),
      waId,
      telefone: widParaTelefone(waId) || telefonePeloContato(WPP, id.remote || msg.from),
      nome: msg.notifyName || "",
      texto: msg.body || msg.caption || "",
      tipo: msg.type || "chat",
      recebidoEm: Number.isFinite(msg.t) ? msg.t * 1000 : Date.now(),
    };
  }

  async function enviarMensagemAutomatica(d) {
    const WPP = await esperarPronto();
    const waId = String(d.waId || "");
    const texto = String(d.texto || "").trim();
    if (!ehPessoa(waId) || waId.endsWith("@g.us") || waId.includes("@broadcast"))
      throw new Error("Destino automatico invalido.");
    if (!texto) throw new Error("A resposta automatica esta vazia.");

    const resultado = await WPP.chat.sendTextMessage(waId, texto);
    return {
      messageId: resultado?.id?._serialized || resultado?.id?.toString?.() || null,
    };
  }

  /**
   * Quem está logado NESTA aba do WhatsApp Web.
   *
   * Serve para a tela de Conexões dizer se a sessão do bridge é do mesmo
   * número que o operador já usa — que é o caso hoje e não é duplicidade.
   * Devolve só os quatro últimos dígitos: para responder "é o mesmo número?"
   * isso basta, e o número inteiro não precisa atravessar mais nenhuma
   * fronteira do que já atravessa.
   */
  async function sessaoWeb() {
    const WPP = await esperarPronto();
    let wid = null;
    try {
      wid = WPP.conn?.getMyUserId?.() || WPP.whatsapp?.UserPrefs?.getMaybeMeUser?.();
    } catch {
      return { conectado: false, last4: null };
    }
    const telefone = widParaTelefone(wid);
    return {
      conectado: Boolean(wid),
      last4: telefone ? telefone.slice(-4) : null,
    };
  }

  const CMDS = {
    // Espera o wa-js ficar pronto em vez de recusar: quem pergunta durante o
    // carregamento quer a resposta, não um erro.
    conversaAtiva: async () => lerConversaAtiva(await esperarPronto()),
    listarContatos,
    listarEtiquetas,
    enviarMensagemAutomatica,
    sessaoWeb,
  };

  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (!d || d.source !== "emyleads" || !CMDS[d.cmd]) return;
    try {
      responder(d.id, true, await CMDS[d.cmd](d));
    } catch (err) {
      responder(d.id, false, err?.message || String(err));
    }
  });

  /**
   * Assim que o wa-js estiver utilizável, avisa e passa a vigiar a conversa.
   *
   * A troca é detectada por sondagem, e não por evento do wa-js, de propósito:
   * nome de evento interno muda entre versões do WhatsApp e é a primeira coisa
   * a quebrar. Ler uma propriedade de um objeto em memória a cada 600ms não
   * pesa e não tem nome para mudar.
   */
  esperarPronto()
    .then((WPP) => {
      emitir("pronto");

      WPP.on?.("chat.new_message", (msg) => {
        try {
          const mensagem = normalizarMensagemRecebida(WPP, msg);
          if (mensagem) emitir("mensagemRecebida", mensagem);
        } catch (err) {
          console.warn("[EmyLeads] falha ao ler nova mensagem:", err);
        }
      });

      let ultimo = " "; // sentinela: força a primeira emissão, mesmo null
      setInterval(() => {
        let atual = null;
        try {
          atual = lerConversaAtiva(WPP);
        } catch {
          return; // uma leitura ruim não derruba a vigilância
        }
        const chave = atual?.waId || "";
        if (chave === ultimo) return;
        ultimo = chave;
        emitir("conversa", atual);
      }, INTERVALO);
    })
    .catch((err) => {
      // Falhar aqui é esperado quando o WhatsApp muda por dentro. O painel
      // continua vivo pelo cabeçalho — mas precisa saber o porquê para dizer.
      emitir("indisponivel", { motivo: err?.message || String(err) });
    });
})();
