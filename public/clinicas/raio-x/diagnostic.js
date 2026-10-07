export const areas = ['Captação', 'Atendimento', 'Conversão', 'Gestão'];
export const questions = [
['Qual opção representa sua clínica?', ['Odontologia', 'Dermatologia, estética ou cirurgia plástica', 'Clínica médica ou especialidade médica', 'Outra área da saúde']],
['Quanto sua clínica investe hoje somente em anúncios por mês?', ['Ainda não investimos em anúncios', 'Investimos menos de R$ 1.500', 'De R$ 1.500 até R$ 5.000', 'Acima de R$ 5.000']],
['Como esse investimento se encaixa no momento da sua clínica?', ['Já investimos esse valor ou mais em anúncios', 'Está dentro do orçamento que podemos disponibilizar', 'Podemos considerar, depois de entender a estratégia', 'Neste momento, precisamos de um investimento menor']],
['Se encontrarmos um caminho para melhorar os resultados, como a decisão de investir é tomada?', ['Eu decido esse investimento', 'Decido junto com sócio ou outro gestor', 'Eu avalio e levo a proposta para quem decide', 'Estou apenas pesquisando; ainda não temos uma decisão prevista']],
['Se as indicações diminuíssem no próximo mês, o que sustentaria a entrada de novos pacientes?', ['Não temos outro canal com resultado acompanhado', 'Temos anúncios ou outras ações, mas a entrada oscila e não medimos as etapas', 'Temos canais acompanhados, com metas e previsibilidade de entrada', 'Temos outros canais e acompanhamos a entrada, mas sem metas definidas']],
['Se você pedisse hoje o resultado dos anúncios do último mês, qual resposta conseguiria?', ['Quantos pacientes fecharam e quanto geraram de receita', 'Quantas mensagens, cliques ou contatos chegaram', 'Quais contatos agendaram ou chegaram à avaliação, mas sem receita vinculada', 'Não conseguiria relacionar os anúncios a pacientes; ou ainda não anunciamos']],
['Pense nos novos contatos que chegaram ontem. Como você verifica o tempo que esperaram pela primeira resposta?', ['Não verifico e não tenho uma referência confiável', 'Pergunto à equipe; não tenho registro ou conferência das conversas', 'Confiro conversas ou relatórios, mas só quando surge um problema', 'Acompanho o tempo nas conversas ou relatórios e temos responsáveis pela cobertura']],
['Escolha um contato que pediu informações e deixou de responder. Como você sabe se houve uma tentativa de retorno?', ['Consigo consultar quem ficou responsável, os retornos e o desfecho', 'Preciso perguntar à equipe se alguém lembrou de chamar', 'Existe uma lista ou registro de retornos, mas não verificamos o desfecho', 'Não temos como conferir o que aconteceu com esse contato']],
['Uma pessoa fez a avaliação, mas saiu sem fechar. O que fica definido antes de ela sair?', ['Nada; esperamos que ela entre em contato', 'A equipe pode retornar, mas sem data ou responsável definidos', 'Uma data de retorno, embora o acompanhamento nem sempre seja registrado', 'Responsável, data de retorno e registro do motivo de não fechamento']],
['Das avaliações realizadas no último mês, quantas viraram tratamentos fechados? Como você verifica isso?', ['Não consigo relacionar avaliações a fechamentos', 'Tenho uma estimativa baseada no que a equipe comenta', 'Consigo consultar a quantidade e a proporção de fechamentos', 'Consigo consultar a proporção e os motivos registrados de não fechamento']],
['Se você se ausentasse por uma semana, a equipe saberia quais oportunidades precisam de atenção?', ['Dependeria das conversas ou anotações de cada pessoa', 'Teria uma lista, mas precisaria perguntar o contexto e o próximo passo', 'Conseguiria consultar o status e o próximo passo, com algumas lacunas', 'Conseguiria consultar responsável, status, próxima ação e data de retorno']],
['O que você consegue consultar para decidir onde manter, reduzir ou aumentar o investimento em marketing?', ['Receita, pacientes e investimento por canal, com registros conferíveis', 'Principalmente cliques, alcance ou mensagens recebidas', 'Pacientes ou agendamentos por canal, mas sem receita vinculada', 'Não tenho um acompanhamento que ajude nessa decisão']],
].map(([title, options]) => ({ title, options }));
questions[2] = {
  title: 'Esse investimento diário se encaixa no orçamento atual da sua clínica?',
  context: 'Para atrair pacientes qualificados na sua região, recomendamos começar com ao menos R$ 50 por dia em anúncios.',
  options: [
    'Sim, podemos disponibilizar ao menos R$ 1.500 por mês.',
    'Já investimos ao menos R$ 1.500 por mês em anúncios.',
    'Precisamos revisar o orçamento antes de confirmar.',
    'Não. Hoje nosso orçamento disponível é menor.',
  ],
};
const actions = [
['Diversifique a entrada de pacientes', 'Registre a origem de novos contatos e teste um canal além das indicações.'],
['Conecte anúncios aos pacientes', 'Acompanhe o contato até o fechamento. Se não anuncia, comece medindo seus canais atuais.'],
['Organize o tempo de resposta', 'Defina responsáveis e horários de cobertura. Meça o tempo até a primeira resposta.'],
['Acompanhe quem deixou de responder', 'Crie uma fila de retornos com responsável, data e motivo de encerramento.'],
['Recupere avaliações sem fechamento', 'Combine o próximo contato ao fim da avaliação e registre objeções e datas de retorno.'],
['Acompanhe a conversão', 'Compare avaliações e tratamentos fechados. Registre motivos de perda.'],
['Centralize o processo comercial', 'Reúna contatos, responsáveis, status e próximos passos em um controle compartilhado.'],
['Conecte canais ao faturamento', 'Registre a origem de cada venda e compare receita e investimento por canal.'],
];
questions[2].context = 'Para planejar uma estratégia de anúncios, precisamos entender o orçamento disponível. Considere como referência R$ 50 por dia, aproximadamente R$ 1.500 em um mês de 30 dias.';
const points = [[0,1,3,2], [3,1,2,0], [0,1,2,3], [3,1,2,0], [0,1,2,3], [0,1,2,3], [0,1,2,3], [3,1,2,0]];
export function qualify(answers) {
  if (!Array.isArray(answers) || answers.length < 4 || Array.from(answers.slice(0,4)).some(a => !Number.isInteger(a) || a < 0 || a > 3)) throw new Error('Responda às quatro perguntas iniciais.');
  const budget = answers[2];
  return { eligible: budget === 0 || budget === 1, reason: budget === 3 ? 'budget-unavailable' : budget === 2 ? 'budget-unconfirmed' : null };
}
export function diagnose(answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length || Array.from(answers).some(a => !Number.isInteger(a) || a < 0 || a > 3)) throw new Error(`Responda às ${questions.length} perguntas para gerar o diagnóstico.`);
  if (!qualify(answers).eligible) throw new Error('Este fluxo exige disponibilidade confirmada para o orçamento de referência em anúncios.');
  const values = answers.slice(4).map((a, i) => points[i][a]);
  const scores = areas.map((name, i) => ({ name, score: Math.round(values.slice(i * 2, i * 2 + 2).reduce((a, b) => a + b, 0) / 6 * 100) }));
  const score = Math.round(values.reduce((a, b) => a + b, 0) / 24 * 100);
  const priorities = values.map((value, index) => ({ value, index })).filter(x => x.value < 3).sort((a, b) => a.value - b.value || a.index - b.index).slice(0, 3).map(x => ({ title: actions[x.index][0], action: actions[x.index][1], evidence: questions[x.index + 4].options[answers[x.index + 4]], area: areas[Math.floor(x.index / 2)] }));
  const advertising = answers[1] > 0;
  const trackingGap = values[1] < 2 || values[7] < 2;
  const followupGap = values[3] < 2 || values[4] < 2;
  let conclusion;
  if (advertising && trackingGap && followupGap) conclusion = 'Você já investe em anúncios, mas suas respostas indicam pouca visibilidade do retorno e lacunas no acompanhamento dos contatos ou das avaliações. Antes de decidir sobre aumentar a verba, a prioridade é conectar a origem do contato ao fechamento e organizar os retornos. Sem esses registros, ainda não dá para afirmar em qual etapa o investimento deixa de produzir resultado.';
  else if (advertising && trackingGap) conclusion = 'Sua clínica já investe em anúncios, mas os registros informados ainda não permitem relacionar esse investimento ao faturamento com clareza. A primeira prioridade é medir agendamentos, avaliações e fechamentos por origem para decidir com mais segurança onde investir.';
  else if (advertising && followupGap) conclusion = 'Sua clínica já investe em anúncios e informou algum acompanhamento dos resultados. As respostas também apontam lacunas nos retornos de contatos ou avaliações. Vale verificar essas oportunidades antes de buscar mais volume de novos contatos.';
  else if (!advertising) conclusion = 'Você informou que ainda não investe em anúncios. O plano deve partir dos canais que já trazem pacientes e da capacidade de acompanhar novos contatos até o fechamento. A referência de orçamento ajuda a avaliar um possível próximo passo, sem antecipar o resultado das campanhas.';
  else if (score === 100) conclusion = 'As respostas indicam processos estruturados nas quatro áreas e investimento atual em anúncios. Este questionário não identificou um gargalo evidente; a reunião pode confrontar essas respostas com os indicadores reais e avaliar oportunidades específicas.';
  else conclusion = `Sua clínica já investe em anúncios. Entre os processos avaliados, ${[...scores].sort((a, b) => a.score - b.score)[0].name.toLowerCase()} apresentou a menor pontuação. A próxima etapa é conferir os registros dessa área e validar as prioridades abaixo, antes de atribuir a causa dos resultados a um fornecedor ou canal.`;
  const budget = [
    'Você indicou que pode disponibilizar ao menos R$ 1.500 por mês para anúncios. A conversa pode avaliar um plano inicial e como medir seus resultados.',
    'Você informou que já investe ao menos R$ 1.500 por mês em anúncios. A conversa pode começar pelo uso e acompanhamento da verba atual.',
    'Você prefere entender a estratégia antes de decidir o orçamento. A conversa deve esclarecer o plano, as etapas e a forma de acompanhamento.',
    'Você sinalizou que precisa de um investimento menor. O próximo passo é avaliar o que cabe no orçamento e priorizar os processos e canais existentes.',
  ][answers[2]];
  const decision = [
    'Como você decide o investimento, a reunião pode focar nas prioridades e critérios para avançar.',
    'Como a decisão é compartilhada, vale incluir o sócio ou gestor na conversa sobre o plano.',
    'Como a decisão será levada a outra pessoa, vale envolver esse responsável na avaliação da proposta.',
    'Como você ainda está pesquisando, a conversa pode ajudar a esclarecer prioridades, sem pressupor uma contratação.',
  ][answers[3]];
  const observations = [];
  if (answers[2] === 1 && answers[1] < 2) observations.push('Há uma diferença entre a faixa de investimento atual e a resposta sobre já investir o valor de referência. Vale confirmar esse ponto na conversa.');
  return { score, scores, weakest: [...scores].sort((a, b) => a.score - b.score)[0].name, level: score < 34 ? 'Processos a estruturar' : score < 67 ? 'Operação em desenvolvimento' : score < 100 ? 'Base consistente, com oportunidades de melhoria' : 'Processos bem estruturados nas respostas', priorities, conclusion, budget, decision, observations, profile: { specialty: questions[0].options[answers[0]], advertising: questions[1].options[answers[1]] } };
}
