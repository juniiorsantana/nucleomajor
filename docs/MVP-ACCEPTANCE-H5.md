# Aceite do MVP H.5

Este roteiro conclui o MVP somente depois de dez jornadas controladas durante
48 horas. Compilação, migration aplicada e serviço ativo são pré-requisitos;
não substituem o aceite operacional.

## Fronteiras do piloto

- um único WhatsApp principal, final `8362`;
- runtime produtivo somente na VPS;
- Júnior e Lucas são operadores internos verificados;
- atendimento externo em modo `Piloto`;
- somente um contato controlado é liberado para a automação;
- API Oficial, Google Calendar, cobrança, Gemini e abertura pública ficam fora
  deste aceite.

Não registre neste documento telefones completos, mensagens, tokens ou
conteúdo privado. Use apenas identificadores curtos do teste.

## Pré-requisitos

- [x] portal publicado a partir da `main`;
- [x] migration `20260828183000_fase_h5_prontidao_modelo.sql` aplicada;
- [x] sete skills oficiais validadas e publicadas com versão e hash;
- [x] Bridge e assistente ativos na VPS, WSL desligado;
- [ ] painel mostra WhatsApp, MCP, agenda, modelo e notificações separadamente;
- [ ] Claude com uso disponível;
- [ ] documento interno e documento externo de teste publicados nos escopos
  corretos;
- [ ] campanha piloto ligada somente ao contato controlado;
- [x] notificações ainda em simulação.

## Aceite interno

Executar com Júnior e Lucas, separadamente:

- [ ] saudação identifica o profissional correto;
- [ ] consulta mostra somente a própria agenda e indisponibilidade de colegas;
- [ ] criação de evento exige confirmação e gera um único evento;
- [ ] criação de tarefa exige confirmação e gera uma única tarefa;
- [ ] repetir a confirmação não duplica evento nem tarefa;
- [ ] documento interno influencia a resposta correta;
- [ ] evento pessoal de colega não revela detalhes e não pode ser alterado.

## Aceite externo em simulação

- [ ] contato liberado recebe uma única resposta;
- [ ] contato não liberado não recebe automação;
- [ ] Receção seleciona somente uma skill por vez;
- [ ] qualificação aparece no CRM sem duplicidade;
- [ ] conhecimento externo publicado é usado;
- [ ] conhecimento interno nunca aparece;
- [ ] pedido por pessoa cria handoff e silencia a IA;
- [ ] solicitação de agenda cria somente bloqueio provisório;
- [ ] fila e aprovadores corretos aparecem sem envio real.

## Ativação das notificações reais

Somente depois do aceite em simulação, executar na VPS como usuário
`nucleo`:

```bash
cd ~/whatsapp-mcp-hardened
bash scripts/vps/set-agenda-notification-mode.sh live <connection-id>
```

O comando valida configuração e credencial restrita, altera apenas o modo do
trabalhador e reinicia somente o assistente. A sessão do WhatsApp e o Bridge
não são reiniciados.

Para voltar ao modo seguro:

```bash
bash scripts/vps/set-agenda-notification-mode.sh simulate <connection-id>
```

## Dez jornadas em 48 horas

| # | Jornada | Resultado esperado | Resultado | Horário |
|---|---|---|---|---|
| 1 | Júnior: agenda | consulta e cria uma vez | pendente | |
| 2 | Lucas: agenda | isolamento e criação | pendente | |
| 3 | Júnior: tarefa | confirma e cria uma vez | pendente | |
| 4 | Lucas: tarefa | confirma e cria uma vez | pendente | |
| 5 | Conhecimento interno | resposta sem vazamento | pendente | |
| 6 | Cliente: recepção e qualificação | CRM atualizado | pendente | |
| 7 | Cliente: handoff | IA silenciada | pendente | |
| 8 | Cliente: agenda aprovada | mesmo bloqueio vira evento | pendente | |
| 9 | Cliente: agenda recusada | bloqueio removido e aviso | pendente | |
| 10 | Reinício e falha controlada | estado recuperado e erro claro | pendente | |

## Critério final

O MVP é aprovado somente se, nas dez jornadas, não houver resposta dupla,
duplicidade, vazamento, escrita sem confirmação ou perda de estado. O portal
deve distinguir limite do Claude, MCP indisponível, agenda indisponível e
runtime parado.
