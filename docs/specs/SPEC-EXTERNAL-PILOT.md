# SPEC — Piloto externo controlado

Status: banco e portal prontos; runtime `2c04e75` precisa ser implantado.

## Objetivo

Validar um atendimento real de cliente sem permitir que contatos não
selecionados recebam automação.

```text
Cliente → Recepção → Skill → Conhecimento externo → CRM → Agenda ou humano
```

## Modos

- **Desligado:** nenhum cliente recebe resposta automática.
- **Piloto:** somente contatos selecionados no CRM recebem automação.
- **Ativo:** todos os clientes da conexão podem entrar no roteamento.

Ausência ou erro do contrato resulta em bloqueio. Operadores verificados não
passam por essa guarda e continuam no assistente interno.

## Configuração do piloto

Ao salvar o modo Piloto, a RPC:

1. valida administrador e perfil externo;
2. valida os contatos da organização;
3. cria ou atualiza `Piloto Atendimento Major`;
4. exige as cinco skills oficiais publicadas;
5. vincula somente coleções externas e não pessoais;
6. persiste a seleção e retorna a campanha derivada.

O telefone recebido do WhatsApp é comparado com aliases brasileiros de forma
restrita. Telefone completo não é gravado no log.

## Propriedade da resposta

No piloto, o chatbot atua somente como porta de entrada. O runtime transfere
silenciosamente a mensagem à Recepção; apenas um componente pode responder.

## Fila humana

Estados visíveis:

- aguardando atendimento;
- em atendimento;
- concluído.

Donos e administradores podem assumir, concluir ou devolver à IA. Enquanto a
conversa estiver com humano, novas mensagens são ignoradas pela automação. A
VPS consome comandos duráveis do Supabase e confirma a transição.

## Jornada de agenda com aprovação

1. coletar título, data, horário e duração;
2. resolver contato e participantes;
3. consultar disponibilidade;
4. apresentar data absoluta e resumo;
5. pedir confirmação ao cliente;
6. criar uma única reserva provisória, mascarada e sem lembrete;
7. avisar donos e administradores verificados;
8. converter o mesmo evento em definitivo somente após a primeira aprovação;
9. avisar o cliente sobre aprovação, recusa ou expiração.

A skill `agenda` pertence somente ao assistente interno. Clientes usam
`solicitacao-agenda`, que expõe `calendar.request.prepare` e
`calendar.request.submit`, mas nunca a criação direta do evento.

O bloqueio dura no máximo duas horas ou até cinco minutos antes do compromisso.
Pedidos feitos com menos de trinta minutos de antecedência vão para atendimento
humano. Aprovação pode ocorrer no portal ou por `APROVAR ABCD-1234`; recusa usa
`RECUSAR ABCD-1234` com motivo opcional.

## Lacunas conhecidas

Levantadas em 27/08/2026 lendo `nucleo_contextual_knowledge_search`
(migration `20260823120000`) e `src/server.mjs`. Nenhuma bloqueia o piloto,
mas as três precisam fechar antes do modo Ativo. A busca do assistente web já
fechou; cada seção abaixo diz em que pé está.

### Documento externo sem coleção fica inacessível

A busca contextual exige, para `audience = 'customer'`, que o documento
esteja em uma `knowledge_collections` ativa e externa — e, se a coleção for
de campanha, que exista o vínculo em `campaign_knowledge_collections` com a
campanha do contexto. Marcar um documento como externo **não basta**.

Hoje nada na tela de Conhecimento avisa isso: dá para publicar para clientes
e o documento nunca ser lido, sem erro nem aviso. A correção é do lado da
interface — exigir a coleção externa ao escolher o público "Clientes", ou
selecionar uma automaticamente.

### O assistente web não pesquisa, despeja — fechada em 27/08/2026

Era um select direto em `src/server.mjs`: os doze documentos
`audience = internal` mais recentes, inteiros, sem relevância e sem relação
com a pergunta. O décimo terceiro era invisível e nada avisava, e o custo de
contexto crescia com o acervo, não com a necessidade.

No lugar dele, a migration `20260827160000_busca_conhecimento_web.sql` cria
duas funções autenticadas por `auth.uid()` via `private.is_org_member`:

- `public.nucleo_web_knowledge_search(target_organization, search_query,
  result_limit)` — full-text em português, até cinco trechos ordenados por
  `ts_rank`, com `ts_headline` recortando o pedaço que casou;
- `public.nucleo_web_knowledge_document(target_organization,
  target_document)` — o documento inteiro, sob demanda.

A semântica de audiência é a mesma de `nucleo_contextual_knowledge_search`,
inclusive a cadeia de coleção do conteúdo externo; só a autenticação muda,
porque o servidor web carrega token de usuário e não credencial de robô. Sem
campanha no contexto, a coleção `scope_type = 'campaign'` precisa ter ao menos
um vínculo em `campaign_knowledge_collections` — coleção sem vínculo nenhum é
conteúdo que nenhuma conversa alcança.

Isolamento: `organization_id` sempre; escopo `personal` só quando
`scope_user_id = auth.uid()`; `audience = 'external'` exige `published_at`
preenchido mais a coleção. Leitura é igual para owner, admin e member — a
diferença de cargo no conhecimento é de escrita, como já define a policy
`knowledge_documents_select`; as funções são `security definer` e ampliar ali
abriria um buraco que a tabela nega.

No servidor, `src/knowledgeSearch.mjs` monta a consulta (termos reunidos com
`or`, porque `websearch_to_tsquery` junta palavras soltas com E e a frase
inteira do usuário não casaria com nada), injeta apenas os três melhores
trechos com até 900 caracteres cada, e avisa no prompt quando a busca
encontrou mais do que coube. A ferramenta `ler_documento` lê o texto completo
durante a resposta, no máximo duas vezes por mensagem.

Coberto por `test/knowledge-search.test.mjs`, sem Supabase.

### Falta prova ponta a ponta do conhecimento externo

O aceite cobre "documento interno não aparece para cliente", mas não o
inverso. Sem um teste que percorra publicação → coleção externa → campanha →
resposta, a regressão mais provável do piloto — alguém desvincular a coleção
— passa silenciosa.

## Aceite

- contato selecionado recebe uma resposta;
- contato não selecionado não recebe automação;
- Júnior e Lucas continuam no fluxo interno;
- documento interno não aparece para cliente;
- documento externo publicado e vinculado a uma coleção externa aparece;
- documento externo sem coleção é recusado na publicação, não em silêncio;
- CRM recebe contato e qualificação sem duplicar;
- confirmação do cliente cria somente bloqueio provisório e não duplica;
- aprovação converte o mesmo bloqueio em evento definitivo;
- recusa, expiração ou ausência de aprovador remove o bloqueio;
- pedido humano aparece na fila e silencia a IA;
- devolver à IA retoma a conversa correta;
- reinício da VPS preserva campanha e handoff;
- dez conversas controladas passam durante 48 horas.

O modo Ativo é proibido antes desse aceite.
