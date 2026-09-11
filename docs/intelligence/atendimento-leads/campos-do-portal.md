# Fase 0 — o que colar em cada campo do portal

> **Aplicado em produção em 11/09/2026** (itens 1–6 e 9), via REST com a
> chave de publicação, nos mesmos campos que a tela grava. Ficaram de fora:
> o item 7 (rollout continua `active`, decisão do usuário) e o item 8 (env
> da VPS, que exige acesso à máquina). Este arquivo continua valendo como
> referência do que está gravado e como refazer pela tela.

Tudo aqui é aplicado pela tela **Central de Inteligência** (`/app`,
`Inteligencia.jsx` → `inteligencia.salvarPerfil`, `inteligencia.salvarCampanha`)
ou pela tela de Conhecimento. Nenhum deploy. A ordem importa pouco, mas o
item 5 (campanha padrão) só faz sentido depois do 4 (documento externo),
porque a campanha vincula a coleção.

Depois de cada item, a prova é uma conversa do celular de teste. Antes de
começar, ler a seção 3 do documento principal: o que está entre `[[ ]]` nos
textos é decisão da empresa com padrão preenchido.

---

## 1. Agente `Assistente Major` → campo **Tom** (`tone`, máx. 500)

Hoje está corrompido (texto duplicado e cortado). Substituir por:

```
Cordial, natural e direto. Linguagem simples, interesse genuíno pelo negócio da pessoa, sem entusiasmo artificial. Mensagens curtas, uma pergunta por vez. Diagnostica antes de recomendar; não cita preço, prazo ou garantia; nunca anuncia uma ação que não executou. Sem emojis.
```

(282 caracteres.)

## 2. Agente `Assistente Major` → **Soul** (`soul_markdown`, máx. 8000)

Colar o texto de [`soul-assistente-major.md`](./soul-assistente-major.md),
do traço em diante (6.024 caracteres). Antes de colar, resolver os `[[ ]]`.

## 3. Agente `Assistente Major` → **Marca** e **Processo**

`brand_config.greeting` (hoje: "Olá! Sou o Assistente da Major. Como posso
ajudar você hoje?"):

```
Oi! Aqui é o assistente da Major. Me conta o que você precisa?
```

`brand_config.brandName`: manter `Assistente Major`.

`process_config.instructions` — substituir o texto atual por:

```
Atendimento externo de leads. Primeiro entenda o negócio, o objetivo e a situação atual da pessoa; só depois fale do que a Major faz. Use exclusivamente o conhecimento publicado para clientes ao falar da Major; se a informação não estiver lá, diga que não tem confirmada. Não cite preço, prazo, desconto ou garantia — a proposta sai depois do diagnóstico. Registre no CRM cada dado de qualificação assim que ele aparecer. Quando houver aderência e objetivo + momento claros, proponha o diagnóstico com o Júnior e deixe a marcação com a solicitação de agenda. Transfira para uma pessoa quando o cliente pedir, quando pedir o Júnior, em reclamação, contrato, cobrança ou dado pessoal, e nunca diga que transferiu sem a confirmação da transferência. Contato pessoal, fornecedor ou candidato: uma linha e deixe com a equipe.
```

`process_config.sessionPolicy`: manter `contextHours: 24`,
`confirmationMinutes: 30`; subir `subflowHours` para **24** (hoje 2 — o
lead que responde depois do almoço cai de volta na Recepção e recomeça).

`process_config.rollout.mode`: ver item 7.

## 4. Conhecimento → coleção **Conhecimento para clientes**

1. Criar documento `empresa/major-para-clientes.md`, título "A Major, para
   quem está chegando", audiência **externa**, com o texto de
   [`conhecimento-clientes-sobre-a-major.md`](./conhecimento-clientes-sobre-a-major.md)
   (do traço em diante, `[[ ]]` resolvidos). Publicar. Vincular à coleção
   `Conhecimento para clientes`.
2. Remover `empresa/sobre.md` da coleção `Conhecimento para clientes`
   (ele continua existindo como documento; só deixa de ser alcançável por
   cliente). Se a tela não permitir desvincular, mudar a audiência dele para
   interna.

Prova: pela tela de busca do conhecimento (assistente web) ou por uma
mensagem "o que vocês fazem?" depois da fase 1 — a resposta cita nichos e
diagnóstico, e não cita sócios, pró-labore, MotaBS ou stack.

## 5. Campanha padrão → **Atendimento Major**

Criar (não editar a do piloto):

| Campo | Valor |
|---|---|
| Nome | `Atendimento Major` |
| Status | `active` |
| Padrão | **sim** |
| Agente | `Assistente Major` |
| Objetivo | `Receber leads pelo WhatsApp, entender o negócio e o gargalo, qualificar com poucas perguntas e levar quem tem aderência a um diagnóstico com o Júnior.` |
| Oferta | `Diagnóstico de [[30 minutos, sem custo]], por chamada com o Júnior, para entender o caso e indicar por onde começar. A proposta com escopo e investimento vem depois do diagnóstico. Não há tabela de preço nem desconto por mensagem.` |
| Público | `Donos e gestores de clínicas odontológicas, escritórios de advocacia (agrário e ambiental) e clínicas de saúde, em Cuiabá e no Brasil; e outros negócios de serviço com problema de aquisição e conversão de clientes.` |
| Resultado esperado | `Lead qualificado no CRM (segmento, objetivo, situação atual, momento) e diagnóstico solicitado; ou transferência para a equipe quando pedido; ou encerramento transparente quando não houver aderência.` |
| Fontes | nenhuma (é a padrão) |
| Skills | `recepcao` (10), `pre-qualificacao` (20), `vendas` (30), `solicitacao-agenda` (40). **Sem** `suporte` (ver achado J). |
| Coleções | `Conhecimento para clientes` |

A campanha `Piloto Atendimento Major` pode ficar em `test` para o número de
teste, ou ser arquivada; com uma padrão ativa, ela deixa de ser necessária.

Prova: conversa nova do celular de teste → `conversation_intelligence_contexts`
da conversa mostra `campaign_id` da campanha nova (ou, sem consultar o
banco: a resposta a "quero saber sobre vocês" menciona o diagnóstico).

## 6. Etiquetas (CRM → Etiquetas)

Criar, com os slugs exatos: `lead-quente`, `lead-morno`, `sem-aderencia`,
`pediu-pessoa`, `nao-atender-ia`. A ferramenta de qualificação ignora
etiqueta que não existe, sem erro.

## 7. Quem recebe o agente (rollout)

Enquanto o número da empresa for também pessoal e o volume de leads for
baixo: rollout **`pilot`** com lista de inclusão (os contatos de teste e os
leads que chegarem por campanha, adicionados à mão). Quando houver
número/fluxo só de leads, ou a lista de exclusão da fase 3: `active`.

Se a decisão for manter `active` agora, aceitar que amigos e família
recebem o agente na primeira mensagem — e que a pausa de 30 min só entra
depois que alguém da equipe responder.

## 8. VPS — env da unit `whatsapp-assistant@` (paliativo até a fase 2)

Sem deploy de código. Editar o env da unit, reiniciar **só** o
`whatsapp-assistant@<connection-id>` (nunca o Bridge), conferir o
`service.started` no journal:

```
ASSISTANT_PROGRESS_MODEL=          # vazio: desliga a triagem e as duas "aberturas"
ASSISTANT_SIMPLE_MODEL=<mesmo valor de ASSISTANT_COMPLEX_MODEL>   # cliente nunca cai no modelo pequeno
```

Efeito colateral conhecido: sem triagem, toda mensagem que não é saudação
pura recebe o ACK fixo ("Entendi, já te retorno." / "Beleza, um instante." /
"Ok, deixa eu ver isso.") antes da resposta — uma mensagem a mais, não duas,
e sem promessa nem emoji. Some na fase 2 (presença "digitando" para
cliente).

## 9. Agente `SDR`

Decisão: **desativar** (`active = false`) até ter persona e roteiro
próprios. Enquanto as instruções publicadas de Recepção e Vendas apontarem
`sdr` como destino comercial, a transferência para ele falha fechado
(agente inativo → recusa) — o que hoje é melhor que cair num agente vazio.
Na fase 1, o destino sai das instruções ou o SDR ganha conteúdo.

---

## Checklist de prova da fase 0 (celular de teste)

| Mensagem | Esperado depois da fase 0 | Só passa depois da fase 1 |
|---|---|---|
| `oi` | uma mensagem, sem emoji, no tom do soul | — |
| `Kpa` / `Opa` | uma mensagem (ACK fixo + resposta = duas no máximo) | uma |
| `quero saber sobre vocês` | não descreve a Major como software; se não tem conhecimento, diz que não tem confirmado e pergunta do negócio | cita nichos e diagnóstico a partir do documento |
| `quanto custa um site?` | não cita valor; explica que a proposta sai depois do diagnóstico; pergunta qual função o site precisa cumprir | idem, com conhecimento consultado |
| `preciso gerar mais leads` | pergunta de onde vêm os clientes hoje (gargalo), uma pergunta só, sem "alavancar"/🚀 | registra `objetivo` no CRM |
| `quero falar com o Júnior` | **não** diz "vou conectar agora"; diz que deixa registrado e pergunta horário | transfere de verdade (dono `humano`, linha em `customer_handoff_requests`) |
| mensagem de amigo | uma linha, sem qualificar | — |
