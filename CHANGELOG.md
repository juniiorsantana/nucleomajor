# Changelog

Mudanças relevantes são registradas por versão implantável. Commits continuam
sendo a fonte detalhada.

## Não lançado

- três planos à venda, com nomes padrão Base, Atendimento com IA e Completo, e
  um Link de Pagamento por plano e ciclo (mensal ou anual). O período pago
  segue o ciclo, então cancelar um plano anual vale até o fim dos 12 meses. No
  Asaas, o cliente escolhe entre cartão (cobrança automática) e Pix/boleto;
- a IA vira dois interruptores: `ai_customer`, a IA respondendo os clientes
  finais, e `ai_team`, o assistente da equipe pelo WhatsApp. O turno de
  operador exige o segundo; todos os outros, o primeiro. O plano Atendimento
  com IA, que tem só o primeiro, deixa de abrir o que não vendeu: em Equipe,
  vincular o WhatsApp pessoal aparece como do plano Completo, e o assistente
  do portal responde que é do Completo;
- empresa nova nasce com Recepção, Pré-qualificação, Vendas, Suporte e
  Solicitação de agenda no agente de clientes, e Agenda e Tarefas no interno.
  Sem a Recepção, o roteador recusava todo turno de cliente e a pessoa do
  outro lado ouvia "atendimento temporariamente indisponível" — e até aqui
  isso só se resolvia passando pelo modo Piloto;
- a liberação manual do painel da plataforma passa a escolher o plano, em vez
  de ativar sempre o Full;
- quem compra o Núcleo pelo Link de Pagamento do Asaas recebe por e-mail o
  link de ativação, cria a conta e ativa a empresa sozinho. Antes, o código
  só nascia pela mão de um administrador da plataforma e chegava ao cliente
  copiado à mão. A venda que chega sem e-mail, ou cujo e-mail não foi
  entregue, aparece no painel da plataforma com "Reenviar ativação";
- a assinatura passa a valer: atraso vira aviso por 7 dias e depois
  suspensão; estorno e contestação suspendem; cancelamento vale até o fim do
  período pago. Os dados da empresa continuam guardados — o que fecha é a
  porta. As empresas que já existiam seguem ativas como sempre;
- o plano Base (sem IA) tira Inteligência e Chatbots do menu;
- criar empresa passa a exigir e-mail confirmado, como o aceite de convite;
- plano sem IA (e empresa bloqueada) nunca chega ao Claude: o portão do
  atendimento a clientes recusa, os resolvedores de contexto não entregam
  contrato, a Liberação recusa piloto/ativo e o assistente web responde 402.
  As quatro funções vivas foram movidas intactas para `private`; a Major não
  sente diferença (provado antes/depois);
- a empresa nova pede o WhatsApp pelo portal (Conversas ou Conexões) em vez
  de ficar presa em "Consultando a conexão…" ou ser mandada para
  127.0.0.1:8090. A equipe recebe o comando que monta a conexão na VPS
  (scripts/vps/provision-connection.sh, no runtime), e o portal mostra
  "Estamos preparando o seu WhatsApp" até o primeiro sinal; aí o QR de
  sempre. `conexao_da_organizacao` deixa de usar min(uuid), que não existe;
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
