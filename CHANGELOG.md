# Changelog

Mudanças relevantes são registradas por versão implantável. Commits continuam
sendo a fonte detalhada.

## Não lançado

- colocar alguém numa tarefa passa a AVISAR essa pessoa, e ela assume ou
  recusa. Quem delegou para de precisar perguntar no corredor se o outro
  viu; e quem recusa devolve a tarefa com o motivo, em vez de ela sumir;
- uma tarefa de três pessoas passa a lembrar as três. O índice da fila de
  lembretes não tinha o dono, então o segundo responsável não cabia nela —
  ele apareceria na agenda e nunca receberia lembrete nenhum;
- o aviso de atribuição deixa de fingir que é lembrete: ele chega na hora,
  vale para tarefa sem prazo, e não anuncia horário que não existe;
- qualquer pessoa da equipe cria evento da empresa na Agenda. Só dono e
  administrador criavam, e marcar reunião da empresa é o caso normal, não a
  exceção — quem não tinha o cargo pedia a um gestor que lançasse no lugar.
  Criar não é editar: o evento corporativo continua sendo mexido apenas por
  quem o criou, mais dono e administrador;
- o responsável da tarefa deixa de ser texto livre e passa a ser gente da
  equipe, com mais de uma pessoa por tarefa. O nome digitado nunca chegava a
  `tasks.owner_id`: toda tarefa caía em quem a criou, e a agenda mostrava o
  responsável errado sem nada na tela dizer isso;
- tarefa de várias pessoas aparece na faixa de CADA uma na visão por pessoa,
  e uma vez só no mês e na lista. É o que faz a faixa vazia significar "essa
  pessoa está livre", que é o motivo de a visão por pessoa existir;
- o contato do cliente deixa de ser obrigatório na tarefa, e o "Negócio
  relacionado" sai do formulário;
- a agenda pinta cada pessoa com a cor escolhida no perfil. Ela tinha uma
  paleta própria, derivada do id, então a mesma pessoa era de uma cor na
  Equipe e nas Conversas e de outra na agenda;
- Conversas passa a responder e a atribuir. Enfileirar não é enviar, e a tela
  diz isso: a bolha nasce com relógio, ganha o tique quando a mensagem volta do
  aparelho, e vira alerta com motivo quando o Bridge recusa;
- responder alcança **todas** as conversas. A allowlist do WhatsApp guarda quem
  o agente pode procurar sozinho, e passou a não valer para mensagem escrita
  por gente — são dois assuntos, e tratá-los como um só fazia a caixa de
  entrada recusar quase tudo. A resposta automática não mudou em nada;
- atribuir o atendimento a uma PESSOA da equipe, e não só a "atendente" — numa
  equipe de duas pessoas o rótulo genérico responde a pergunta errada. O nome
  de quem assumiu aparece na própria linha da lista;
- grupos entram na caixa de entrada, com o nome do grupo, e ganham filtro
  próprio: eram 94 das 169 conversas do WhatsApp da empresa, e nenhuma chegava
  ao portal. Grupo não tem telefone, ficha nem atendente, e a tela não finge
  que tem;
- o nome do contato deixa de ser o número na maioria das conversas, e o número
  passa a ser o telefone de verdade em quem chega por LID;
- documentação canônica, SPECs, ADRs e governança de contribuição;
- piloto externo controlado com modos off, pilot e active;
- fila humana em Chatbots → Atendimentos;
- gate do runtime por contato e comandos duráveis de handoff.
- ferramenta interna de tarefas com preparação, confirmação explícita,
  idempotência e atribuição conforme o cargo do operador.

## 0.1.1 — 2026-08

- portal web completo em `/app`;
- Central de Inteligência e skills oficiais;
- runtime transferido do WSL para VPS;
- operadores pessoais verificados no WhatsApp principal;
- Agenda Major integrada e criação confirmada pelo assistente;
- extensão MV3 atualizada como conector opcional.
