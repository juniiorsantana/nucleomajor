import { describe, expect, it } from "vitest";
import { montarLinhaDoTempo } from "./registro";

const ESTAGIOS = [
  { id: "novo-lead", nome: "Novo lead", ordem: 0 },
  { id: "contato", nome: "Contato", ordem: 1 },
  { id: "proposta", nome: "Proposta", ordem: 2 },
];

const ficha = (partes = {}) => ({
  contato: { id: "c1" },
  negocios: [],
  tarefas: [],
  notas: [],
  eventos: [],
  ...partes,
});

describe("linha do tempo do painel", () => {
  it("junta notas, tarefas e negócios numa lista só, do mais recente para o mais antigo", () => {
    const itens = montarLinhaDoTempo(ficha({
      notas: [{ id: "n1", texto: "Pediu proposta", criadoEm: 300 }],
      tarefas: [{ id: "t1", titulo: "Retornar", venceEm: 500, concluida: false, criadoEm: 100 }],
      negocios: [{ id: "d1", titulo: "Pacote anual", stageId: "contato", criadoEm: 200 }],
    }), ESTAGIOS);

    expect(itens.map((i) => i.tipo)).toEqual(["tarefa", "nota", "negocio"]);
    expect(itens.map((i) => i.quando)).toEqual([500, 300, 200]);
  });

  it("posiciona a tarefa aberta pelo prazo, não pela criação", () => {
    // O bug que isto guarda: ordenando por criadoEm, o follow-up marcado para
    // semana que vem afunda no feed junto com o dia em que foi digitado — e
    // some justamente da parte do feed que a pessoa olha.
    const [item] = montarLinhaDoTempo(ficha({
      tarefas: [{ id: "t1", titulo: "Ligar", venceEm: 900, concluida: false, criadoEm: 10 }],
      notas: [{ id: "n1", texto: "antiga", criadoEm: 500 }],
    }), ESTAGIOS);

    expect(item.tipo).toBe("tarefa");
    expect(item.quando).toBe(900);
  });

  it("usa a conclusão como marco da tarefa concluída", () => {
    const [item] = montarLinhaDoTempo(ficha({
      tarefas: [{ id: "t1", titulo: "Ligar", venceEm: 100, concluida: true, concluidaEm: 800, criadoEm: 10 }],
    }), ESTAGIOS);

    expect(item.quando).toBe(800);
    expect(item.concluida).toBe(true);
    expect(item.meta).toBe("tarefa concluída");
  });

  it("traduz a mudança de estágio em nomes, não em ids", () => {
    const [item] = montarLinhaDoTempo(ficha({
      eventos: [{
        id: "e1",
        tipo: "deal.updated",
        carga: { campos: ["stageId"], estagio: { de: "novo-lead", para: "contato" } },
        ocorridoEm: 400,
      }],
    }), ESTAGIOS);

    expect(item.tipo).toBe("estagio");
    expect(item.texto).toBe("Novo lead → Contato");
  });

  it("não engole o evento antigo, que não guardava de-para", () => {
    // Eventos gravados antes de `atualizarNegocio` passar a registrar o par
    // têm só a lista de campos. Sumir com eles abriria um buraco no histórico.
    const [item] = montarLinhaDoTempo(ficha({
      eventos: [{ id: "e1", tipo: "deal.updated", carga: { campos: ["stageId"] }, ocorridoEm: 400 }],
    }), ESTAGIOS);

    expect(item.texto).toBe("Estágio alterado");
  });

  it("ignora atualização de negócio que não mexeu no estágio", () => {
    const itens = montarLinhaDoTempo(ficha({
      eventos: [{ id: "e1", tipo: "deal.updated", carga: { campos: ["valor"] }, ocorridoEm: 400 }],
    }), ESTAGIOS);

    expect(itens).toEqual([]);
  });

  it("aguenta ficha vazia e ficha ausente", () => {
    expect(montarLinhaDoTempo(null, ESTAGIOS)).toEqual([]);
    expect(montarLinhaDoTempo(ficha(), ESTAGIOS)).toEqual([]);
  });
});
