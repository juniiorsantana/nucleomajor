# Changelog

Mudanças relevantes são registradas por versão implantável. Commits continuam
sendo a fonte detalhada.

## Não lançado

- Conversas passa a responder e a atribuir. Enfileirar não é enviar, e a tela
  diz isso: a bolha nasce com relógio, ganha o tique quando a mensagem volta do
  aparelho, e vira alerta com motivo quando o Bridge recusa;
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
