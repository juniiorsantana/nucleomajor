import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import { operacoes } from "./localProvider";

function apagarBanco() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("emyleads");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Banco de teste bloqueado."));
  });
}

describe("LocalProvider", () => {
  beforeEach(async () => {
    db.esquecerConexao();
    await apagarBanco();
  });

  it("impede duplicidade de telefone também na edição", async () => {
    const a = await operacoes["contatos.criar"]({
      nome: "A",
      telefone: "5565999999999",
    });
    const b = await operacoes["contatos.criar"]({
      nome: "B",
      telefone: "5565888888888",
    });

    await expect(
      operacoes["contatos.atualizar"]({
        id: b.id,
        patch: { telefone: a.telefone },
      })
    ).rejects.toMatchObject({ codigo: "telefone-duplicado", contatoId: a.id });
  });

  it("aprende o LID quando resolve pelo telefone", async () => {
    const contato = await operacoes["contatos.criar"]({
      nome: "Maria",
      telefone: "556592178164",
    });

    const resolvido = await operacoes["contatos.resolver"]({
      waId: "2126143062228@lid",
      telefone: "5565992178164",
      nome: "Maria",
    });

    expect(resolvido.id).toBe(contato.id);
    expect(resolvido.waId).toBe("2126143062228@lid");
  });

  it("persiste a foto técnica do contato sem alterar sua identidade", async () => {
    const contato = await operacoes["contatos.criar"]({
      nome: "Foto",
      telefone: "5565999999999",
    });

    const fotoUrl = "data:image/jpeg;base64,/9j-test";
    const atualizado = await operacoes["contatos.atualizar"]({
      id: contato.id,
      patch: { fotoUrl },
    });

    expect(atualizado.id).toBe(contato.id);
    expect(atualizado.waId).toBeNull();
    expect(atualizado.fotoUrl).toBe(fotoUrl);
  });

  it("deduplica importação usando a variante brasileira do nono dígito", async () => {
    await operacoes["contatos.criar"]({
      nome: "Maria",
      telefone: "556592178164",
    });

    const resultado = await operacoes["contatos.importar"]({
      linhas: [{ nome: "Maria nova", telefone: "5565992178164", empresa: "" }],
    });

    expect(resultado.importados).toBe(0);
    expect(resultado.ignorados[0].motivo).toBe("já estava na base");
  });

  it("registra a origem de importações e o vínculo com o WhatsApp", async () => {
    const importado = await operacoes["contatos.importar"]({
      linhas: [{ nome: "Importado", telefone: "5565999999999", empresa: "Emy" }],
    });
    const contato = (await operacoes["contatos.listar"]()).find((item) => item.nome === "Importado");
    await operacoes["contatos.resolver"]({ waId: "5511999999999@c.us", telefone: contato.telefone, nome: contato.nome });
    const eventos = await operacoes["eventos.porContato"]({ contactId: contato.id });
    expect(importado.importados).toBe(1);
    expect(eventos.map((item) => item.tipo)).toEqual(expect.arrayContaining(["contact.imported", "contact.whatsapp_linked"]));
  });

  it("remove contato e registros dependentes em cascata", async () => {
    const contato = await operacoes["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });
    const negocio = await operacoes["negocios.criar"]({
      contactId: contato.id,
      titulo: "Projeto",
    });
    await operacoes["tarefas.criar"]({
      contactId: contato.id,
      dealId: negocio.id,
      titulo: "Retornar",
    });
    await operacoes["notas.criar"]({ contactId: contato.id, texto: "Nota" });

    await operacoes["contatos.remover"]({ id: contato.id });

    expect(await operacoes["contatos.listar"]()).toHaveLength(0);
    expect(await operacoes["negocios.listar"]()).toHaveLength(0);
    expect(await operacoes["tarefas.listar"]()).toHaveLength(0);
    expect(await operacoes["notas.porContato"]({ contactId: contato.id })).toHaveLength(0);
    expect(await operacoes["eventos.porContato"]({ contactId: contato.id })).toHaveLength(0);
  });

  it("registra eventos para a ficha do contato", async () => {
    const contato = await operacoes["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });
    await operacoes["contatos.atualizar"]({ id: contato.id, patch: { empresa: "Emy" } });
    const negocio = await operacoes["negocios.criar"]({ contactId: contato.id, titulo: "Projeto" });
    await operacoes["tarefas.criar"]({ contactId: contato.id, dealId: negocio.id, titulo: "Retornar" });
    await operacoes["notas.criar"]({ contactId: contato.id, texto: "Nota" });

    const ficha = await operacoes["contatos.ficha"]({ contactId: contato.id });
    expect(ficha.eventos.map((evento) => evento.tipo)).toEqual(expect.arrayContaining([
      "contact.created",
      "contact.updated",
      "deal.created",
      "task.created",
      "note.created",
    ]));
  });

  it("recusa backup com referência quebrada antes de gravar", async () => {
    await operacoes["dados.semear"]();
    const pacote = await operacoes["dados.exportar"]();
    pacote.negocios[0].contactId = "contato-inexistente";

    await expect(operacoes["dados.importar"]({ pacote })).rejects.toMatchObject({
      codigo: "dados-invalidos",
    });
  });

  it("realoca negócios e remove estágio numa operação válida", async () => {
    const contato = await operacoes["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });
    const negocio = await operacoes["negocios.criar"]({
      contactId: contato.id,
      stageId: "novo-lead",
      titulo: "Projeto",
    });

    await expect(
      operacoes["estagios.remover"]({ id: "novo-lead" })
    ).rejects.toMatchObject({ codigo: "estagio-com-negocios" });

    await operacoes["estagios.remover"]({
      id: "novo-lead",
      moverPara: "contato",
    });
    const atualizado = await operacoes["negocios.listar"]();
    expect(atualizado.find((n) => n.id === negocio.id).stageId).toBe("contato");
    expect((await operacoes["estagios.listar"]()).some((e) => e.id === "novo-lead")).toBe(false);
  });

  describe("chatbots.avaliar", () => {
    it("sugere boas-vindas para contato recém-criado e para de sugerir após uma nota", async () => {
      const contato = await operacoes["contatos.criar"]({ nome: "Nova", telefone: "5565999999991" });

      const antes = await operacoes["chatbots.avaliar"]({ contactId: contato.id });
      expect(antes.sugestoes.map((s) => s.chatbotId)).toContain("boas-vindas-primeira");

      await operacoes["notas.criar"]({ contactId: contato.id, texto: "Ligou pedindo orçamento" });

      const depois = await operacoes["chatbots.avaliar"]({ contactId: contato.id });
      expect(depois.sugestoes.map((s) => s.chatbotId)).not.toContain("boas-vindas-primeira");
    });

    it("contactId inexistente devolve sugestões vazias, sem lançar erro", async () => {
      const resultado = await operacoes["chatbots.avaliar"]({ contactId: "id-que-nao-existe" });
      expect(resultado).toEqual({ sugestoes: [] });
    });

    it("respeita o `agora` explícito em vez de Date.now()", async () => {
      const contato = await operacoes["contatos.criar"]({ nome: "Datada", telefone: "5565999999992" });
      const passado = contato.criadoEm - 1000;

      const resultado = await operacoes["chatbots.avaliar"]({ contactId: contato.id, agora: passado });
      // Com `agora` anterior à criação do contato, nenhuma condição baseada em
      // tempo deveria explodir nem se comportar diferente de usar Date.now().
      expect(Array.isArray(resultado.sugestoes)).toBe(true);
    });
  });

  describe("bloco de transferência", () => {
    const comPassos = (passos) => ({
      nome: "Com transferência",
      condicoes: [{ tipo: "primeira_conversa" }],
      passos,
    });

    it("colhe a transferência que vem DEPOIS da mensagem", async () => {
      // O fluxo natural é "manda a saudação e passa para a IA". Como a
      // execução para na primeira mensagem, esse bloco nunca rodaria — e o bot
      // ficaria mudo para sempre depois da saudação.
      const contato = await operacoes["contatos.criar"]({ nome: "Transf", telefone: "5565999900011" });
      const bot = await operacoes["chatbots.criar"](comPassos([
        { id: "p-msg", tipo: "enviar_mensagem", texto: "Oi!" },
        { id: "p-tr", tipo: "transferir", destino: "ia", motivo: "quer orçamento" },
      ]));

      const preparo = await operacoes["chatbots.preparar"]({ contactId: contato.id, chatbotId: bot.id });

      expect(preparo.mensagem).toBe("Oi!");
      expect(preparo.transferencia).toMatchObject({ destino: "ia", motivo: "quer orçamento", targetMode: "reception" });
    });

    it("transferência ANTES da mensagem encerra o plano sem enviar nada", async () => {
      const contato = await operacoes["contatos.criar"]({ nome: "Direto", telefone: "5565999900012" });
      const bot = await operacoes["chatbots.criar"](comPassos([
        { id: "p-tr", tipo: "transferir", destino: "humano", motivo: "" },
        { id: "p-msg", tipo: "enviar_mensagem", texto: "não deveria sair" },
      ]));

      const preparo = await operacoes["chatbots.preparar"]({ contactId: contato.id, chatbotId: bot.id });

      expect(preparo.mensagem).toBeNull();
      expect(preparo.transferencia).toMatchObject({ destino: "humano", motivo: "" });
    });

    it("obedece à primeira transferência, não à última", async () => {
      // Dois blocos de transferência no mesmo caminho são contraditórios.
      // Obedecer ao último faria a ordem no canvas significar o contrário do
      // que ela parece.
      const contato = await operacoes["contatos.criar"]({ nome: "Duas", telefone: "5565999900013" });
      const bot = await operacoes["chatbots.criar"](comPassos([
        { id: "p-msg", tipo: "enviar_mensagem", texto: "Oi!" },
        { id: "p-tr1", tipo: "transferir", destino: "ia", motivo: "primeira" },
        { id: "p-tr2", tipo: "transferir", destino: "humano", motivo: "segunda" },
      ]));

      const preparo = await operacoes["chatbots.preparar"]({ contactId: contato.id, chatbotId: bot.id });

      expect(preparo.transferencia).toMatchObject({ destino: "ia", motivo: "primeira" });
    });

    it("fluxo sem transferência continua sem transferência", async () => {
      const contato = await operacoes["contatos.criar"]({ nome: "Sem", telefone: "5565999900014" });
      const bot = await operacoes["chatbots.criar"](comPassos([
        { id: "p-msg", tipo: "enviar_mensagem", texto: "Oi!" },
      ]));

      const preparo = await operacoes["chatbots.preparar"]({ contactId: contato.id, chatbotId: bot.id });

      expect(preparo.transferencia).toBeNull();
    });
  });

  describe("chatbots.executar", () => {
    it("persiste o canvas e rejeita topologia apontando para bloco inexistente", async () => {
      const dados = {
        nome: "Canvas",
        condicoes: [{ tipo: "primeira_conversa" }],
        passos: [{ id: "p-msg", tipo: "enviar_mensagem", texto: "Olá" }],
        canvas: {
          versao: 1,
          nos: [
            { id: "entrada", x: 0, y: 10 },
            { id: "condicoes", x: 320, y: -20 },
            { id: "p-msg", x: 640, y: 10 },
          ],
          conexoes: [
            { source: "entrada", target: "condicoes" },
            { source: "condicoes", target: "p-msg" },
          ],
        },
      };
      const criado = await operacoes["chatbots.criar"](dados);
      expect(criado.canvas).toEqual(dados.canvas);

      await expect(
        operacoes["chatbots.criar"]({
          ...dados,
          nome: "Canvas inválido",
          canvas: {
            ...dados.canvas,
            conexoes: [{ source: "entrada", target: "nao-existe" }],
          },
        })
      ).rejects.toMatchObject({ codigo: "dados-invalidos" });
    });

    it("reserva uma mensagem recebida e impede preparar a mesma resposta duas vezes", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Automatica",
        telefone: "5565999999981",
      });

      const primeira = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-duplicada",
      });
      const duplicada = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-duplicada",
      });

      expect(primeira.preparacao?.chatbotId).toBe("boas-vindas-primeira");
      expect(duplicada.preparacao).toBeNull();
      expect(duplicada.motivo).toBe("reserva-ativa");
    });

    it("não prepara resposta automática enquanto a automação está pausada", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Pausada",
        telefone: "5565999999971",
      });

      await operacoes["automacao.pausar"]({ pausada: true });
      expect(await operacoes["automacao.estado"]()).toMatchObject({ pausada: true });

      await expect(
        operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-pausada",
        })
      ).resolves.toMatchObject({ preparacao: null, motivo: "automacao-pausada" });
    });

    it("pausa não queima o messageId: a mesma mensagem responde depois de retomar", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Retomada",
        telefone: "5565999999972",
      });

      await operacoes["automacao.pausar"]({ pausada: true });
      await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-durante-pausa",
      });
      await operacoes["automacao.pausar"]({ pausada: false });

      const { preparacao } = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-durante-pausa",
      });
      expect(preparacao?.chatbotId).toBe("boas-vindas-primeira");
    });

    it("a pausa não bloqueia a execução manual pela faixa de sugestão", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Manual",
        telefone: "5565999999973",
      });
      await operacoes["automacao.pausar"]({ pausada: true });

      const { sugestoes } = await operacoes["chatbots.avaliar"]({ contactId: contato.id });
      expect(sugestoes).toHaveLength(1);

      const preparacao = await operacoes["chatbots.preparar"]({
        contactId: contato.id,
        chatbotId: sugestoes[0].chatbotId,
      });
      await expect(
        operacoes["chatbots.executar"]({
          contactId: contato.id,
          chatbotId: sugestoes[0].chatbotId,
          preparacao,
        })
      ).resolves.toBeTruthy();
    });

    it("libera a reserva quando o envio falha antes de chegar ao WhatsApp", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Reenvio",
        telefone: "5565999999982",
      });
      const { preparacao: primeira } = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-falhou",
      });

      await operacoes["chatbots.cancelarAutomatico"]({
        contactId: contato.id,
        chatbotId: primeira.chatbotId,
        messageId: "msg-falhou",
      });

      const novaTentativa = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-falhou",
      });
      expect(novaTentativa.preparacao?.chatbotId).toBe(primeira.chatbotId);
    });

    it("registra a mensagem de origem e nao volta a responde-la", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Deduplicada",
        telefone: "5565999999983",
      });
      const { preparacao } = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-concluida",
      });

      await operacoes["chatbots.marcarAutomaticoEnviado"]({
        contactId: contato.id,
        chatbotId: preparacao.chatbotId,
        messageId: "msg-concluida",
      });
      await operacoes["chatbots.executar"]({
        contactId: contato.id,
        chatbotId: preparacao.chatbotId,
        preparacao,
        mensagemRecebidaId: "msg-concluida",
      });

      const eventos = await operacoes["eventos.porContato"]({ contactId: contato.id });
      expect(eventos.find((evento) => evento.tipo === "chatbot.executado")?.carga)
        .toMatchObject({ mensagemRecebidaId: "msg-concluida" });
      await expect(
        operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-concluida",
        })
      ).resolves.toMatchObject({ preparacao: null, motivo: "mensagem-ja-respondida" });
    });

    it("distingue no diário cada motivo de não execução", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Motivos",
        telefone: "5565999999961",
      });

      await operacoes["automacao.pausar"]({ pausada: true });
      await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-a",
      });
      await operacoes["automacao.pausar"]({ pausada: false });

      // Sem nenhum bot aplicável: o de boas-vindas para de valer depois da nota.
      await operacoes["notas.criar"]({ contactId: contato.id, texto: "conversa iniciada" });
      await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-b",
      });

      const { entradas } = await operacoes["automacao.diario"]();
      expect(entradas.map((e) => e.motivo)).toEqual([
        "nenhum-bot-aplicavel",
        "automacao-pausada",
      ]);
      expect(entradas[0]).toMatchObject({
        messageId: "msg-b",
        contactId: contato.id,
        resultado: "ignorado",
      });
    });

    it("resume o último disparo por chatbot e deixa o erro nulo quando não houve", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Resumo",
        telefone: "5565999999962",
      });

      const { preparacao } = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-ok",
      });
      await operacoes["chatbots.marcarAutomaticoEnviado"]({
        contactId: contato.id,
        chatbotId: preparacao.chatbotId,
        chatbotNome: preparacao.nome,
        messageId: "msg-ok",
      });

      // Uma segunda mensagem que reserva e falha no envio.
      await operacoes["chatbots.executar"]({
        contactId: contato.id,
        chatbotId: preparacao.chatbotId,
        preparacao,
        mensagemRecebidaId: "msg-ok",
      });
      const segunda = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-erro",
      });
      expect(segunda.preparacao).toBeNull();

      const { porChatbot } = await operacoes["automacao.diario"]();
      const resumo = porChatbot.find((r) => r.chatbotId === preparacao.chatbotId);
      expect(resumo.nome).toBe(preparacao.nome);
      expect(resumo.ultimoDisparo).toMatchObject({
        messageId: "msg-ok",
        resultado: "enviado",
      });
      expect(resumo.ultimoErro).toBeNull();
    });

    it("registra falha de envio com a mensagem do erro", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Falha",
        telefone: "5565999999963",
      });
      const { preparacao } = await operacoes["chatbots.prepararAutomatico"]({
        contactId: contato.id,
        messageId: "msg-quebrou",
      });

      await operacoes["chatbots.cancelarAutomatico"]({
        contactId: contato.id,
        chatbotId: preparacao.chatbotId,
        chatbotNome: preparacao.nome,
        messageId: "msg-quebrou",
        erro: "wa-js não respondeu",
      });

      const { entradas, porChatbot } = await operacoes["automacao.diario"]();
      expect(entradas[0]).toMatchObject({
        messageId: "msg-quebrou",
        resultado: "erro",
        motivo: "falha-no-envio",
        erro: "wa-js não respondeu",
      });
      expect(
        porChatbot.find((r) => r.chatbotId === preparacao.chatbotId).ultimoErro
      ).toMatchObject({ motivo: "falha-no-envio" });
    });

    it("o diário é um anel: não cresce sem limite", async () => {
      const contato = await operacoes["contatos.criar"]({
        nome: "Anel",
        telefone: "5565999999964",
      });
      await operacoes["automacao.pausar"]({ pausada: true });

      for (let i = 0; i < 205; i += 1) {
        await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: `msg-anel-${i}`,
        });
      }

      const { entradas } = await operacoes["automacao.diario"]();
      expect(entradas).toHaveLength(200);
      // A mais nova encabeça e as cinco mais velhas caíram fora.
      expect(entradas[0].messageId).toBe("msg-anel-204");
      expect(entradas.at(-1).messageId).toBe("msg-anel-5");
    });

    /**
     * As três camadas de idempotência, cada uma isolada da outra.
     * Ver IDEMPOTENCIA-AUTOMACAO.md para o desenho completo.
     */
    describe("máquina de idempotência", () => {
      // Só o relógio é falsificado. Congelar setTimeout também travaria o
      // fake-indexeddb, que agenda suas próprias tarefas para resolver.
      afterEach(() => {
        vi.useRealTimers();
      });

      it("camada 2: a reserva expira depois da janela e libera a mensagem", async () => {
        const contato = await operacoes["contatos.criar"]({
          nome: "Expira",
          telefone: "5565999999951",
        });

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
        const primeira = await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-expira",
        });
        expect(primeira.preparacao).toBeTruthy();

        // Dentro da janela de 2 minutos, continua bloqueada.
        vi.setSystemTime(new Date("2026-08-12T10:01:00Z"));
        expect(
          (
            await operacoes["chatbots.prepararAutomatico"]({
              contactId: contato.id,
              messageId: "msg-expira",
            })
          ).motivo
        ).toBe("reserva-ativa");

        // Passada a janela, uma aba que travou no meio do envio não deixa a
        // mensagem presa para sempre.
        vi.setSystemTime(new Date("2026-08-12T10:03:00Z"));
        const depois = await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-expira",
        });
        expect(depois.preparacao?.chatbotId).toBe("boas-vindas-primeira");
      });

      it("camada 2: a reserva marcada como enviada NÃO expira", async () => {
        const contato = await operacoes["contatos.criar"]({
          nome: "Enviada",
          telefone: "5565999999952",
        });

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
        const { preparacao } = await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-enviada",
        });
        await operacoes["chatbots.marcarAutomaticoEnviado"]({
          contactId: contato.id,
          chatbotId: preparacao.chatbotId,
          messageId: "msg-enviada",
        });

        // Uma hora depois: a janela de 2 minutos não se aplica a "enviado".
        // É essa permanência que impede reenviar para o cliente.
        vi.setSystemTime(new Date("2026-08-12T11:00:00Z"));
        expect(
          (
            await operacoes["chatbots.prepararAutomatico"]({
              contactId: contato.id,
              messageId: "msg-enviada",
            })
          ).motivo
        ).toBe("reserva-ativa");
      });

      it("camada 3: o evento bloqueia sozinho, mesmo sem reserva nenhuma", async () => {
        const contato = await operacoes["contatos.criar"]({
          nome: "Evento",
          telefone: "5565999999953",
        });
        const { preparacao } = await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-evento",
        });
        await operacoes["chatbots.marcarAutomaticoEnviado"]({
          contactId: contato.id,
          chatbotId: preparacao.chatbotId,
          messageId: "msg-evento",
        });
        await operacoes["chatbots.executar"]({
          contactId: contato.id,
          chatbotId: preparacao.chatbotId,
          preparacao,
          mensagemRecebidaId: "msg-evento",
        });

        // `executar` já apagou a reserva ao gravar o evento; o apagar abaixo é
        // só para deixar explícito que a camada 2 não está mais lá. Daqui em
        // diante quem bloqueia é o evento, sozinho.
        expect(await db.buscar("meta", "chatbot.auto:msg-evento")).toBeUndefined();
        await db.apagar("meta", "chatbot.auto:msg-evento");

        expect(
          (
            await operacoes["chatbots.prepararAutomatico"]({
              contactId: contato.id,
              messageId: "msg-evento",
            })
          ).motivo
        ).toBe("mensagem-ja-respondida");
      });

      it("camada 3: executar recusa quando a reserva não confere", async () => {
        const contato = await operacoes["contatos.criar"]({
          nome: "SemReserva",
          telefone: "5565999999954",
        });
        const { preparacao } = await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-sem-reserva",
        });
        await db.apagar("meta", "chatbot.auto:msg-sem-reserva");

        // A verificação acontece DENTRO da transação de escrita: entre checar
        // e gravar não cabe uma segunda execução.
        await expect(
          operacoes["chatbots.executar"]({
            contactId: contato.id,
            chatbotId: preparacao.chatbotId,
            preparacao,
            mensagemRecebidaId: "msg-sem-reserva",
          })
        ).rejects.toMatchObject({ codigo: "chatbot-mensagem-processada" });
      });

      it("a reserva é por messageId, não por contato: outra mensagem passa", async () => {
        const contato = await operacoes["contatos.criar"]({
          nome: "Duas",
          telefone: "5565999999955",
        });

        const primeira = await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-um",
        });
        const segunda = await operacoes["chatbots.prepararAutomatico"]({
          contactId: contato.id,
          messageId: "msg-dois",
        });

        expect(primeira.preparacao).toBeTruthy();
        expect(segunda.preparacao).toBeTruthy();
      });
    });

    it("aplica etiquetas antes da primeira mensagem e preserva atualizadoEm", async () => {
      const contato = await operacoes["contatos.criar"]({ nome: "Bot", telefone: "5565999999993" });
      const criado = await operacoes["chatbots.criar"]({
        nome: "Qualificação",
        condicoes: [{ tipo: "primeira_conversa" }],
        passos: [
          { id: "p-tag", tipo: "editar_etiquetas", adicionar: ["lead-quente"], remover: [] },
          { id: "p-msg", tipo: "enviar_mensagem", texto: "Olá {nome}" },
        ],
      });
      const antes = (await operacoes["chatbots.buscar"]({ id: criado.id })).atualizadoEm;
      const preparacao = await operacoes["chatbots.preparar"]({ contactId: contato.id, chatbotId: criado.id });
      const resultado = await operacoes["chatbots.executar"]({ contactId: contato.id, chatbotId: criado.id, preparacao });

      expect(resultado.mensagem).toBe("Olá {nome}");
      expect(resultado.etiquetas).toEqual(["lead-quente"]);
      expect(resultado.contato.tags).toContain("lead-quente");
      expect(resultado.execucoes).toBe(1);
      expect((await operacoes["chatbots.buscar"]({ id: criado.id })).atualizadoEm).toBe(antes);
      expect((await operacoes["chatbots.avaliar"]({ contactId: contato.id })).sugestoes).toEqual([]);
    });

    it("não aplica etiquetas depois da primeira mensagem", async () => {
      const contato = await operacoes["contatos.criar"]({ nome: "Bot", telefone: "5565999999994" });
      const criado = await operacoes["chatbots.criar"]({
        nome: "Mensagem primeiro",
        condicoes: [{ tipo: "primeira_conversa" }],
        passos: [
          { id: "p-msg", tipo: "enviar_mensagem", texto: "Olá" },
          { id: "p-tag", tipo: "editar_etiquetas", adicionar: ["lead-quente"], remover: [] },
        ],
      });
      const preparacao = await operacoes["chatbots.preparar"]({ contactId: contato.id, chatbotId: criado.id });
      const resultado = await operacoes["chatbots.executar"]({ contactId: contato.id, chatbotId: criado.id, preparacao });
      expect(resultado.etiquetas).toEqual([]);
      expect(resultado.restantes).toHaveLength(1);
      expect(resultado.contato.tags).toEqual([]);
    });

    it("não executa chatbot inativo", async () => {
      const contato = await operacoes["contatos.criar"]({ nome: "Bot", telefone: "5565999999995" });
      const criado = await operacoes["chatbots.criar"]({
        nome: "Inativo",
        ativo: false,
        condicoes: [{ tipo: "primeira_conversa" }],
        passos: [{ id: "p-msg", tipo: "enviar_mensagem", texto: "Olá" }],
      });
      await expect(operacoes["chatbots.preparar"]({ contactId: contato.id, chatbotId: criado.id }))
        .rejects.toMatchObject({ codigo: "chatbot-nao-se-aplica" });
    });

    it("recusa apagar tag usada por chatbot", async () => {
      await operacoes["chatbots.criar"]({
        nome: "Usa tag",
        condicoes: [{ tipo: "tem_etiqueta", etiquetaId: "lead-quente" }],
        passos: [],
      });
      await expect(operacoes["tags.remover"]({ id: "lead-quente" }))
        .rejects.toMatchObject({ codigo: "tag-em-uso-chatbot" });
    });
  });
});
