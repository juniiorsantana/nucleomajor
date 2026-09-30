# Agenda, compromissos e tarefas: briefing de UX/UI

Levantado em 30/09/2026 lendo o código, e implementado no mesmo dia na branch
`feat/agenda-ux-celular`. O pedido era melhorar a usabilidade, **principalmente no
celular**. Cada tela foi desenhada primeiro em 390px e depois estendida para o
computador. Agenda e Tarefas continuam como duas telas no menu, agora integradas.

## Decisões tomadas

- **Duas telas, integradas.** Uma tarefa abre por cima da Agenda, sem trocar de tela.
- **Dock do celular:** Conversas, Funil, Agenda e **Tarefas**. Tarefas entrou no
  lugar de Conhecimento, que é configuração e raramente se abre pelo telefone.
- **Horário da tarefa, sem migration.** O prazo continua em `due_at`. O formulário
  passou a mostrar a hora, com 09:00 como padrão (é a hora do lembrete que já
  existia). **A hora que já existe é preservada.** Tarefa "o dia todo" de verdade
  pede uma coluna `due_all_day`; fica para depois, se a equipe sentir falta.

## 1. Erros encontrados e o que foi feito

| # | Erro | Situação |
|---|------|---|
| E1 | Membro comum não conseguia marcar compromisso "da empresa" (o banco já deixava). Quem criou um evento da empresa também não conseguia editá-lo. | Corrigido: `DialogoEvento` libera para todos, e `eventoEditavel` aceita o autor |
| E2 | Toda tarefa vencia às 09:00, e às 10h "hoje · 09:00" já aparecia em vermelho | A hora agora aparece e pode ser escolhida; o rótulo diz "Hoje, 15:00" e só marca atraso depois da hora |
| E3 | Editar uma tarefa arrastada para 15h a devolvia para 09:00 | Corrigido: `dataHoraParaTimestamp` mantém a hora |
| E4 | Clicar numa tarefa na Agenda levava para outra tela | A tarefa abre em folha dentro da própria Agenda |
| E5 | `confirm()` nativo para excluir tarefa | Trocado por `DialogoConfirmar` |
| E6 | Concluir não tinha retorno; o erro ficava fixo na tela | Aviso com **Desfazer**; erros viram aviso que some sozinho |
| E7 | Mensagens técnicas: "migration da Fase D", status "sent", zoom "72px" | Textos em português; zoom em %; botão "Tentar de novo" |
| E8 | O Mês no celular rolava para o lado (760px) | Mês compacto com pontos e a lista do dia tocado |
| E9 | Tarefas sem layout de celular | Cartões, abas, chips e respiro para o "+" |
| M1 | Prazo e responsáveis sumiam no celular | Sempre visíveis |
| M2 | A barra da Agenda quebrava em 3 a 4 linhas | Cabeçalho de uma linha, seletor de vista e faixa de dias |
| M3 | Alvos de toque de 28 a 32px | 44px no celular (caixinhas, chips, botões) |
| M4 | Texto de 9,5 a 11px | Corpo com 15–16px no celular e horários com 13–15px |
| M5 | Botões só com ícone, explicados só ao passar o mouse | Menu "⋯" e painel de Filtros com nomes escritos |
| M6 | No celular não dava para mover um compromisso | Detalhe com "Mudar o horário": +30 min, +1 hora, Amanhã, +1 semana |
| M7 | Criar sugeria sempre 09:00 | `proximoHorarioLivre`: a próxima meia hora livre |
| M8 | Modais centralizados, com o Salvar atrás do teclado | `Folha`: sobe de baixo, com rodapé fixo e área segura |
| M9 | Tarefas escondida em "Mais seções" | No dock |
| M10 | `⌘K` aparecendo no celular | Escondido abaixo de 768px |

Encontrados durante a verificação e também corrigidos:

- Uma recarga da agenda com o formulário aberto apagava o que a pessoa estava digitando: os lembretes padrão chegavam num array novo a cada vez.
- Uma falha em "pedidos de horário" derrubava a agenda inteira.
- A semana de 7 dias rolava para o lado num notebook de 1366px.

## 2. O que foi criado

**Agenda (computador)**
- Coluna lateral recolhível com mini-calendário (pontos por dia) e **Hoje**: próximos compromissos e tarefas do dia, com caixinha para concluir, "Tarefa para hoje" e um alerta de tarefas atrasadas.
- A barra ficou numa linha: Hoje, ‹ ›, período, Dia/Semana/Mês, **Filtros (n)**, zoom em % e o menu **⋯** (pedidos de horário, preferências, ver todas as tarefas).
- **Criação rápida:** arrastar na grade abre um cartão ao lado, com título e Enter. O mesmo cartão cria compromisso ou tarefa; "Mais opções" abre o formulário completo.
- **Detalhe em gaveta** com ações: editar, excluir, abrir o cliente, concluir a tarefa e mudar o horário.
- Mês: o número do dia abre o dia, e o "+" (ao passar o mouse) marca um compromisso.

**Agenda (celular)**
- Cabeçalho: período (um toque abre o calendário), busca, avisos e "⋯".
- Dia, Semana e Mês em lista legível. A faixa da semana tem pontos nos dias ocupados, e **deslizar para o lado** troca de dia, semana ou mês.
- Botão **"+"** acima do dock, com duas escolhas: Compromisso ou Tarefa.
- Aviso ativo quando há filtro ou busca, com "Limpar".

**Formulário de compromisso**
- Ordem: título, tipo (Compromisso / Evento / Bloqueio), **início e término** com atalhos de duração, cliente **com busca**, "Quem vê" (Só eu / Toda a equipe) e lembrete.
- Categoria, situação, local, etiquetas e descrição ficam em "Mais detalhes".

**Tarefas**
- Abas **Minhas · Equipe · Concluídas**. A aba padrão é Minhas.
- Chips de prazo com contagem: Atrasadas, Hoje, Próximos 7 dias, Sem prazo. Na aba Equipe, chips por pessoa.
- **Adicionar rápido** no topo. O prazo segue o chip ativo.
- Grupos: Atrasadas, Hoje, Amanhã, Próximos 7 dias, Mais adiante, Sem prazo.
- A linha inteira abre a tarefa. Editar e excluir aparecem ao passar o mouse; no celular, ficam dentro da folha.
- Assumir e Recusar aparecem só quando é a sua vez de responder.
- A folha de tarefa tem atalhos de prazo (Hoje, Amanhã, Próx. semana, Sem prazo), data e hora, cliente com busca, "Quem faz", Concluir e Excluir.

**Compartilhado** (`page/telas/agenda/componentes.jsx`)
- `Folha`, `Aviso`, `Segmentado`, `Chip`, `SeletorContato` e `CaixaConcluir`, além do hook `useEstreito`.

## 3. O que ficou de fora e por quê

- **Desfazer ao excluir tarefa:** não existe rota para restaurar uma exclusão (`softDelete`). Por isso ficou só a confirmação.
- **Arrastar no celular:** substituído pelo "Mudar o horário" do detalhe. Arrastar num telefone briga com a rolagem.
- **`reagendarTarefa` grava `owner_id` de quem arrasta** (`web/agendaProvider.js`): numa tarefa com vários responsáveis, isso troca o principal. É comportamento do backend, não foi mexido aqui e merece revisão à parte.

## 4. Como foi verificado

- `npm test` na raiz (servidor + app, com o build): 909 testes passando. Testes novos em `tarefas/tarefasUtils.test.js` e `agenda/agendaUtils.test.js`, cobrindo o horário livre e a edição por quem criou.
- Bancada local (`dev-gestao.html?tela=agenda|tarefas`) em 390px e 1366px:
  - criar pelo "+" e pela criação rápida;
  - mudar o horário com Desfazer;
  - concluir e desfazer uma tarefa;
  - buscar cliente;
  - Semana e Mês no celular;
  - Filtros e detalhe em gaveta.
