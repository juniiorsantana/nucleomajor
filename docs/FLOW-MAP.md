# Mapa de fluxos operacionais

Status: referência canônica de caminhos ponta a ponta.

Este documento mostra onde uma solicitação entra, quem decide, onde ocorre a
validação e qual efeito comprova sucesso. Para significado dos nomes, consulte o
[Glossário](GLOSSARY.md); para propriedade dos dados, consulte o
[Mapa de domínio](DOMAIN-MAP.md).

## 1. Login e seleção da organização

```text
Pessoa abre o portal
  → Supabase Auth valida a conta
  → portal lista vínculos em organization_members
  → pessoa seleciona uma organização
  → provider conserva a seleção
  → cada operação valida novamente sessão, organização e papel
```

Sucesso: a operação retorna dados da organização selecionada sob RLS. Guardar um
`organization_id` no navegador não concede acesso.

## 2. Mensagem interna simples no WhatsApp

```text
Operador envia “Bom dia” ao WhatsApp principal
  → Bridge recebe e persiste a mensagem
  → runtime reconhece o telefone verificado
  → Supabase devolve profissional, papel e responsabilidade
  → assistente produz uma resposta conversacional
  → Bridge envia pelo WhatsApp principal
```

Sucesso comprova recepção, identificação, modelo e envio. Não comprova escrita de
tarefa, agenda, CRM ou conhecimento contextual.

## 3. Criação de tarefa por operador

```text
“Preciso criar uma tarefa hoje”
  → runtime identifica intenção de tarefa
  → contrato de inteligência permite a skill Tarefas
  → capacidade confirma task.prepare/task.confirm
  → assistente coleta título, prazo e responsável que estiverem ausentes
  → nucleo_preparar_tarefa_operador grava ação pendente
  → assistente mostra resumo e pede confirmação
  → nova mensagem confirma
  → nucleo_obter_tarefa_pendente recupera a proposta correta
  → nucleo_criar_tarefa_operador valida papel e idempotência
  → Supabase cria uma linha em tasks
  → assistente informa sucesso com base no retorno do banco
```

Falhas que devem ser diferenciadas:

- skill não publicada ou não vinculada: capacidade indisponível;
- runtime antigo: ferramenta não aparece para o modelo;
- credencial/MCP indisponível: contexto e permissão não podem ser validados;
- dados ausentes: o assistente deve perguntar, não emitir erro técnico;
- ação pendente ausente/expirada: pedir novo preparo;
- banco recusou: informar indisponibilidade sem alegar criação.

## 4. Consulta e criação de evento por operador

```text
Pedido de agenda
  → obter contexto e capacidades
  → resolver data absoluta, duração, responsável e participantes
  → consultar disponibilidade
  → preparar ação pendente
  → apresentar resumo
  → receber confirmação em outro turno
  → confirmar com chave de idempotência
  → gravar calendar_events e participantes
  → responder somente após retorno created/already_exists
```

Conflito não remove participante automaticamente. Grupo e cliente externo não
recebem escrita interna de agenda.

## 5. Publicação de uma skill oficial

```text
Desenvolvedor edita skill.json + instructions.md + tests.json
  → intelligence:validate verifica contrato e casos
  → intelligence:publish executa dry-run
  → revisão humana
  → intelligence:publish -- --apply cria versão no Supabase
  → perfil/campanha permite a skill
  → runtime resolve versão e hash em cada contexto
  → ferramentas técnicas são reduzidas à lista autorizada
```

Editar Markdown sem publicar não muda o atendimento. Publicar sem implantar um
runtime que reconheça as novas ferramentas também não conclui a capacidade.

## 6. Publicação e busca de conhecimento

```text
Administrador cria documento Markdown
  → escolhe escopo e público
  → conteúdo externo exige coleção externa
  → versão é publicada
  → coleção é vinculada ao perfil/campanha alcançável
  → mensagem chega com contexto resolvido
  → busca contextual seleciona poucos trechos relevantes
  → assistente recebe somente os trechos autorizados
  → leitura integral ocorre sob demanda e com limite
```

Conhecimento interno pode combinar organização, equipe e espaço pessoal do
profissional. Conteúdo pessoal de um colega nunca entra no contexto.

## 7. Atendimento externo em piloto

```text
Cliente envia mensagem ao 8362
  → Bridge confirma que não é operador
  → nucleo_customer_assistant_access consulta rollout
  → modo pilot exige contato selecionado
  → Recepção assume como skill inicial
  → campanha e conhecimento externo são derivados
  → uma skill por vez conduz a jornada
  → ferramentas permitidas atualizam CRM/qualificação
  → resposta sai uma única vez
```

Contato fora do piloto não recebe automação. Erro ao consultar a guarda externa
falha fechado. O modo `active` só pode ser liberado após o aceite registrado no
SPEC do piloto.

## 8. Chatbot, assistente e humano

```text
Mensagem externa
  → árbitro determina o dono do turno
      ├─ chatbot: executa passo determinístico
      ├─ assistente: resolve skill e responde
      └─ humano: automação permanece silenciosa
```

O chatbot pode transferir silenciosamente para Recepção. Quando há handoff humano,
um owner/admin assume a conversa; apenas um comando durável pode devolvê-la à IA.

## 9. Verificação de operador

```text
Administrador seleciona profissional e informa telefone
  → portal enfileira comando para a conexão
  → VPS envia instrução e código em mensagens legíveis
  → profissional responde somente com o código
  → Bridge normaliza JID/LID e identifica a conexão
  → RPC valida código, validade, tentativas e posse
  → operador passa a ativo
  → confirmação é enviada pelo WhatsApp principal
  → portal atualiza por Realtime ou polling
```

O telefone do operador é identidade de entrada. O número de saída continua sendo
o WhatsApp principal.

## 10. Saúde da conexão no portal

```text
Bridge/assistente/workers na VPS
  → heartbeat registra estados separados
  → Supabase conserva o último sinal
  → portal consulta connection_runtime_status
  → interface mostra Bridge, WhatsApp, Assistente, MCP, Agenda e Chatbot
```

“Não foi possível consultar” significa ausência de observação atual, não queda
comprovada da sessão. “WhatsApp conectado” não autoriza a interface a afirmar que
Agenda ou MCP estão disponíveis.

## 11. Assistente do portal web

```text
Profissional envia mensagem em /app/assistente
  → API Node valida bearer do Supabase
  → servidor deriva usuário, papel e organização
  → busca conhecimento contextual para a pergunta
  → modelo responde ou prepara execução de ferramenta
  → ação sensível cria tool run pendente
  → usuário confirma ou nega no portal
  → servidor executa sob a sessão autorizada
```

A conversa web e a conversa do WhatsApp podem acessar os mesmos dados, mas não
compartilham implicitamente histórico textual ou identidade de turno.

## 12. Persistência durante reinício

| Estado | Onde permanece | Deve sobreviver? |
| --- | --- | --- |
| Organização, CRM, agenda, conhecimento | Supabase | sim |
| Contexto, campanha, skill e handoff | Supabase | sim |
| Sessão do WhatsApp | estado protegido do Bridge | sim |
| Fila de mensagens | SQLite do assistente | sim |
| Credencial técnica renovável | arquivo `0600` + Supabase | sim |
| Processo em memória | systemd reinicia | não precisa |
| Estado visual do portal | recarregado do Supabase | sim, por reconstrução |

## 13. Como provar que uma capacidade funciona

Uma capacidade só deve ser chamada de funcional quando o teste comprovar:

1. entrada correta;
2. identidade e organização corretas;
3. skill resolvida e publicada;
4. ferramenta presente no runtime implantado;
5. permissão validada no banco;
6. efeito confirmado na fonte de verdade;
7. resposta coerente ao usuário;
8. repetição sem duplicidade;
9. falha segura quando uma dependência cai;
10. observabilidade suficiente para localizar a etapa que falhou.

No exemplo “criar uma tarefa”, uma saudação respondida cobre apenas parte dos
itens 1, 2 e 7. Ela não valida os demais.
