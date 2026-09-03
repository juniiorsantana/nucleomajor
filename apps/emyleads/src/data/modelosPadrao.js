/**
 * Mensagens padrão — o conteúdo, separado de quem o serve.
 *
 * Saiu de `conversasMock.js` quando o portal passou a ler conversas de verdade:
 * o histórico era falso e virou real, mas os modelos nunca foram falsos. São
 * conteúdo do produto, e os dois providers precisam dos mesmos.
 *
 * O formato é o que `lib/template.js` espera — `variacoes` com id, e um
 * `baralho` que quem sorteia devolve para ser guardado. Um dia isto vira
 * tabela editável pela equipe; até lá, mora aqui, versionado.
 */

export const MODELOS = [
  {
    id: "t1",
    categoria: "primeiro",
    titulo: "Primeiro contato",
    variaveis: "{nome} {empresa}",
    variacoes: [
      {
        id: "t1a",
        texto:
          "Oi, {nome}! Aqui é da Major Hub. Obrigado pelo contato. Me conta rapidinho o que a {empresa} está precisando agora?",
      },
      {
        id: "t1b",
        texto:
          "Olá, {nome}! Vi que você chamou a gente. Pra eu já te mandar a coisa certa: o que a {empresa} está querendo resolver?",
      },
      {
        id: "t1c",
        texto:
          "{nome}, tudo bem? Aqui é da Major Hub. Me conta em duas linhas o momento da {empresa} que eu te respondo com o caminho.",
      },
    ],
  },
  {
    id: "t2",
    categoria: "proposta",
    titulo: "Enviar proposta",
    variaveis: "{nome} {empresa}",
    variacoes: [
      {
        id: "t2a",
        texto:
          "{nome}, segue a proposta da {empresa} em PDF. Qualquer dúvida me chama por aqui. A validade é de 15 dias.",
      },
      {
        id: "t2b",
        texto:
          "{nome}, mandei a proposta da {empresa} no seu e-mail. Dá uma olhada com calma — fico à disposição pra ajustar o escopo.",
      },
    ],
  },
  {
    id: "t3",
    categoria: "follow",
    titulo: "Sem resposta há 3 dias",
    variaveis: "{nome}",
    variacoes: [
      {
        id: "t3a",
        texto:
          "Oi, {nome}! Passando só pra saber se você chegou a ver a proposta. Se preferir, marco 15 minutos pra gente conversar.",
      },
      {
        id: "t3b",
        texto:
          "{nome}, tudo certo por aí? Não quero ser chato — só me diz se faz sentido seguir ou se prefere que eu volte mais pra frente.",
      },
    ],
  },
  {
    id: "t4",
    categoria: "proposta",
    titulo: "Confirmar reunião",
    variaveis: "{nome}",
    variacoes: [
      {
        id: "t4a",
        texto:
          "{nome}, confirmando nossa conversa de amanhã às 14h. Vou te chamar por aqui mesmo. Fica bom pra você?",
      },
    ],
  },
  {
    id: "t5",
    categoria: "pos",
    titulo: "Relatório do mês",
    variaveis: "{nome} {empresa}",
    variacoes: [
      {
        id: "t5a",
        texto:
          "{nome}, subi o relatório do mês na pasta da {empresa}. Quer que eu te explique os números numa call rápida?",
      },
    ],
  },
];

export const CATEGORIAS_DE_MODELO = [
  { id: "todas", rotulo: "Todas" },
  { id: "primeiro", rotulo: "Primeiro contato" },
  { id: "proposta", rotulo: "Proposta" },
  { id: "follow", rotulo: "Follow-up" },
  { id: "pos", rotulo: "Pós-venda" },
];
