import { describe, expect, it } from "vitest";
import { planejarMigracao } from "./migrationMapper";

const pacote = {
  estagios: [{ id: "novo", nome: "Novo", ordem: 0 }],
  tags: [{ id: "vip", nome: "VIP", cor: "#123456" }],
  contatos: [{
    id: "c1", nome: "Ana", telefone: "5511999999999", waId: "1@c.us",
    fotoUrl: "data:image/jpeg;base64,abc", ultimaEm: 2000, empresa: "Acme",
    cargo: "CEO", email: "ana@acme.com", origem: "WhatsApp", tags: ["vip"],
    responsavel: "João", criadoEm: 1000, atualizadoEm: 3000,
  }],
  negocios: [{
    id: "n1", contactId: "c1", stageId: "novo", titulo: "Plano", valor: 100,
    origem: "WhatsApp", status: "aberto", motivoPerda: "", criadoEm: 4000, atualizadoEm: 5000,
  }],
  tarefas: [{
    id: "t1", contactId: "c1", dealId: "n1", titulo: "Retornar", venceEm: 6000,
    concluida: false, concluidaEm: null, responsavel: "João", criadoEm: 5000,
  }],
  notas: [{ id: "o1", contactId: "c1", texto: "Prefere manhã", autor: "João", criadoEm: 7000 }],
};

describe("planejamento da migração local", () => {
  it("preserva todos os registros e remapeia as referências", () => {
    let sequencia = 0;
    const plano = planejarMigracao({
      pacote,
      organizationId: "org-1",
      gerarUuid: () => `uuid-${++sequencia}`,
    });

    expect(plano.totais).toEqual({
      contatos: 1, negocios: 1, tarefas: 1, notas: 1, estagios: 1, tags: 1, fotos: 1, eventos: 0,
    });
    expect(plano.tabelas.deals[0].contact_id).toBe(plano.tabelas.contacts[0].id);
    expect(plano.tabelas.deals[0].stage_id).toBe(plano.tabelas.stages[0].id);
    expect(plano.tabelas.tasks[0].deal_id).toBe(plano.tabelas.deals[0].id);
    expect(plano.tabelas.notes[0].contact_id).toBe(plano.tabelas.contacts[0].id);
    expect(plano.tabelas.contactTags[0]).toMatchObject({
      contact_id: plano.tabelas.contacts[0].id,
      tag_id: plano.tabelas.tags[0].id,
    });
  });

  it("reutiliza IDs remotos encontrados por legacy_id", () => {
    const plano = planejarMigracao({
      pacote,
      organizationId: "org-1",
      existentes: { contacts: [{ id: "remoto-c1", legacy_id: "c1" }] },
      gerarUuid: () => "novo-id",
    });

    expect(plano.tabelas.contacts[0].id).toBe("remoto-c1");
    expect(plano.tabelas.deals[0].contact_id).toBe("remoto-c1");
  });

  it("reutiliza o contato remoto encontrado pelo telefone", () => {
    const plano = planejarMigracao({
      pacote,
      organizationId: "org-1",
      existentes: { contacts: [{ id: "remoto-telefone", legacy_id: null, phone: "5511999999999", deleted_at: null }] },
      gerarUuid: () => "novo-id",
    });

    expect(plano.tabelas.contacts[0].id).toBe("remoto-telefone");
    expect(plano.tabelas.deals[0].contact_id).toBe("remoto-telefone");
  });

  it("consolida duplicatas do backup e preserva as referências", () => {
    const pacoteComDuplicata = {
      ...pacote,
      contatos: [
        ...pacote.contatos,
        { ...pacote.contatos[0], id: "c2", nome: "", empresa: "Outra empresa", tags: ["vip"], fotoUrl: null },
      ],
      negocios: [...pacote.negocios, { ...pacote.negocios[0], id: "n2", contactId: "c2" }],
    };
    const plano = planejarMigracao({
      pacote: pacoteComDuplicata,
      organizationId: "org-1",
      gerarUuid: (() => { let n = 0; return () => `uuid-${++n}`; })(),
    });

    expect(plano.ids.contacts.get("c1")).toBe(plano.ids.contacts.get("c2"));
    expect(plano.tabelas.contacts).toHaveLength(1);
    expect(plano.tabelas.contacts[0]).toMatchObject({ name: "Ana", company: "Acme" });
    expect(plano.tabelas.deals.find((item) => item.legacy_id === "n2").contact_id)
      .toBe(plano.tabelas.contacts[0].id);
    expect(plano.tabelas.contactTags).toHaveLength(1);
  });

  it("preserva o caminho remoto da foto ao retomar a migração", () => {
    const plano = planejarMigracao({
      pacote,
      organizationId: "org-1",
      existentes: { contacts: [{ id: "remoto-c1", legacy_id: "c1", avatar_path: "organizations/org-1/contacts/remoto-c1/avatar.jpg" }] },
      gerarUuid: () => "novo-id",
    });

    expect(plano.tabelas.contacts[0].avatar_path).toBe("organizations/org-1/contacts/remoto-c1/avatar.jpg");
  });
});
