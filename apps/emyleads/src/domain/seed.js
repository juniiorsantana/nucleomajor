/**
 * Dados fictícios para desenvolvimento.
 *
 * Nomes e empresas brasileiros plausíveis, e conversas em português: interface
 * povoada com "Lorem ipsum" ou "John Doe" esconde problema de layout que só
 * aparece com texto real — nome comprido, empresa com acento, telefone sem o
 * nono dígito.
 *
 * Nunca é semeado sozinho. Só entra pelo botão de configurações da gestão.
 */

import {
  criarContato,
  criarNegocio,
  criarNota,
  criarTarefa,
} from "./types.js";

const dia = 24 * 60 * 60 * 1000;
const agora = Date.now();

export function gerarSeed() {
  const pessoas = [
    {
      nome: "João Silva",
      telefone: "5565988124470",
      empresa: "Clínica Integrar",
      cargo: "Sócio-diretor",
      email: "joao@clinicaintegrar.com.br",
      origem: "Instagram",
      tags: ["lead-quente"],
      negocio: { titulo: "Site institucional", valor: 5000, stageId: "qualificacao" },
      tarefas: [
        { titulo: "Retornar para o João", venceEm: agora + dia },
        { titulo: "Enviar proposta revisada", venceEm: agora + 3 * dia },
        { titulo: "Briefing recebido", concluida: true, concluidaEm: agora - 2 * dia },
      ],
      notas: [
        "Precisa conversar com o sócio antes de fechar. Sensível a prazo.",
        "Indicado pelo Dr. Marcelo, da Odonto Prime.",
      ],
    },
    {
      nome: "Mariana Costa",
      // Sem o nono dígito de propósito: é o caso que mais quebra CRM no Brasil.
      telefone: "556593518362",
      empresa: "Agro Forte",
      cargo: "Gerente de marketing",
      email: "mariana@agroforte.com.br",
      origem: "Indicação",
      tags: ["indicacao"],
      negocio: { titulo: "Gestão de tráfego pago", valor: 3200, stageId: "proposta" },
      tarefas: [{ titulo: "Confirmar reunião", venceEm: agora - dia }],
      notas: ["Quer começar depois da colheita."],
    },
    {
      nome: "Lucas Almeida",
      telefone: "5565991204488",
      empresa: "Odonto Prime",
      cargo: "Proprietário",
      email: "lucas@odontoprime.com.br",
      origem: "Google",
      tags: ["cliente"],
      negocio: {
        titulo: "Social media mensal",
        valor: 1800,
        stageId: "fechado",
        status: "ganho",
      },
      tarefas: [],
      notas: ["Cliente desde março. Renovação em dezembro."],
    },
    {
      nome: "Fernanda Ribeiro",
      telefone: "5566996337712",
      empresa: "Vet Campo",
      cargo: "Veterinária",
      email: "fernanda@vetcampo.com.br",
      origem: "Instagram",
      tags: [],
      negocio: null,
      tarefas: [{ titulo: "Mandar apresentação", venceEm: agora + 2 * dia }],
      notas: ["Perguntou se atendemos em Rondonópolis."],
    },
    {
      nome: "Ricardo Nunes",
      telefone: "5565984450198",
      empresa: "Construtora Alvorada",
      cargo: "Diretor comercial",
      email: "ricardo@alvorada.com.br",
      origem: "Feira",
      tags: ["sem-interesse"],
      negocio: {
        titulo: "Campanha de lançamento",
        valor: 12000,
        stageId: "negociacao",
      },
      tarefas: [],
      notas: ["Vai verificar com o financeiro e retorna."],
    },
    {
      nome: "Patrícia Gomes",
      telefone: "5565992017744",
      empresa: "Studio Movimento",
      cargo: "Proprietária",
      email: "patricia@studiomovimento.com.br",
      origem: "Indicação",
      tags: [],
      negocio: { titulo: "Identidade visual", valor: 2500, stageId: "contato" },
      tarefas: [],
      notas: [],
    },
  ];

  const contatos = [];
  const negocios = [];
  const tarefas = [];
  const notas = [];

  pessoas.forEach((p, i) => {
    const contato = criarContato({
      nome: p.nome,
      telefone: p.telefone,
      empresa: p.empresa,
      cargo: p.cargo,
      email: p.email,
      origem: p.origem,
      tags: p.tags,
      responsavel: "Juniior",
      criadoEm: agora - (10 - i) * dia,
    });
    contatos.push(contato);

    if (p.negocio) {
      negocios.push(
        criarNegocio({
          ...p.negocio,
          contactId: contato.id,
          origem: p.origem,
          criadoEm: contato.criadoEm,
        })
      );
    }

    p.tarefas.forEach((t) =>
      tarefas.push(criarTarefa({ ...t, contactId: contato.id }))
    );

    p.notas.forEach((texto, n) =>
      notas.push(
        criarNota({
          contactId: contato.id,
          texto,
          autor: "Juniior",
          criadoEm: agora - (n + 1) * dia,
        })
      )
    );
  });

  return { contatos, negocios, tarefas, notas };
}
