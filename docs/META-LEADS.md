# Lead do formulário do Meta

O lead que preenche o formulário instantâneo de um anúncio (Lead Ads) entra no
CRM da organização e recebe a primeira mensagem no WhatsApp dela, sem esperar
que ele chame.

```
Formulário do anúncio → aviso "leadgen" do Meta → POST /api/webhooks/meta-leads
  → o servidor confere a assinatura e busca o lead no Graph
  → nucleo_site_lead_receive(token da campanha, lead)
  → contato + etiqueta, e então, conforme a ligação:
      modo 'flow'  → o fluxo do chatbot de gatilho "campanha" manda a mensagem (sem IA)
      modo 'agent' → primeira mensagem fixa (site_lead_welcome) e a IA da campanha segue
```

A segunda metade é o **lead do site**: teto de leads por hora, nada de
mensagem repetida para o mesmo telefone, nada sem consentimento. O modo
'agent' depende da migration `20260915000000` e do runtime
`site_lead_welcome` (já em produção) e avisa a equipe pela VPS. O modo 'flow'
é o de `20260926180000`: nenhum comando para a VPS além do `flow_trigger`,
que a release `fluxos-aguardar` já atende, e nenhum aviso à equipe (o lead
aparece no CRM com a etiqueta). É o modo da Adriani, no plano Base.

Código: `src/metaLeads.mjs`. Testes: `test/meta-leads.test.mjs`,
`test/formulario-pelo-fluxo-migration.test.mjs` e a prova em PGlite
`scripts/sql/prova-formulario-pelo-fluxo.mjs`.

## Regras do webhook

- Sem assinatura `X-Hub-Signature-256` válida: 401, e nada é chamado.
- Página sem campanha ligada, telefone inválido, lead sem nome: 200, registrado
  no log. O Meta não reenvia, porque reenviar não conserta.
- Graph ou banco fora, teto da hora atingido, ou o Graph recusando por
  permissão: 500. O Meta reenvia (por até cerca de um dia e meio); os leads do
  mesmo aviso que já entraram voltam como repetidos e não recebem nada. Só o
  lead apagado no Meta é descartado. Permissão errada aparece no log como
  `failed` com `code: graph-<código do Meta>`.
- Consentimento: enviar o formulário é pedir o contato. Se o formulário tiver
  uma pergunta com `consent` ou `autoriz` no nome, vale a resposta dela, e só
  "Sim" conta.
- Log: só a página, o id do lead no Meta e o desfecho. Nome, telefone e e-mail
  não entram (LGPD).

## Ligar uma organização

1. **WhatsApp pareado.** A conexão da organização precisa estar `connected`,
   com o runtime da VPS rodando com `NUCLEO_FLOW_RUNTIME=1`.
2. **Campanha e token.** Rodar `scripts/sql/ligar-formulario-meta.sql` no SQL
   Editor, com os nomes da organização e da campanha. Ele cria a campanha
   (ativa) e a liga em modo 'flow'. Guardar o `token_para_o_servidor`, que
   só aparece uma vez.
3. **Fluxo.** No portal da organização, Chatbots: fluxo com gatilho "Lead da
   campanha" = essa campanha, ativo. O primeiro bloco é a mensagem
   (`{nome}` vira o primeiro nome); depois, as perguntas. O texto precisa da
   aprovação do cliente, porque sai no WhatsApp dele. Sem fluxo ativo, o lead
   entra no CRM e ninguém chama.
4. **Servidor.** Na Hostinger, `META_LEADS_INTAKES` recebe
   `{"<id da página>": "<token>"}`. Uma entrada por página; mais clientes são
   mais entradas no mesmo JSON.
5. **Meta.** Assinar a página nos avisos de lead (abaixo).
6. **Teste.** Lead Ads Testing Tool
   (developers.facebook.com/tools/lead-ads-testing), com um número de teste.
   Conferir o contato no CRM e a mensagem no WhatsApp.

## O app no Meta Developers

Uma vez, no app da Major:

1. Produto **Webhooks** → objeto **Page** → URL de retorno
   `https://nucleomajor.com/api/webhooks/meta-leads`, token de verificação =
   `META_WEBHOOK_VERIFY_TOKEN`. Assinar o campo **leadgen**.
2. `META_APP_SECRET` = Configurações do app → Básico → Chave secreta.
3. **Token de acesso.** No portfólio (Business Manager), criar um usuário do
   sistema, dar a ele acesso às páginas dos clientes e gerar um token do app com
   `leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata` e `pages_manage_ads`. Vai para
   `META_LEADS_ACCESS_TOKEN`. Token de usuário do sistema não expira quando
   alguém troca a senha do Facebook.
4. **Página nos avisos.** Para cada página:
   `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` com o token da
   página (Graph API Explorer resolve).
5. No Centro de Leads da página (Configurações → Acesso a leads), o app precisa
   estar liberado.

### Modo de desenvolvimento ou publicado

Com o app **em desenvolvimento**, o Meta só manda avisos de leads de teste e de
quem tem função no app. Lead de anúncio de verdade só chega com o app
**publicado** (Live). Publicar exige URL de política de privacidade,
categoria e ícone; as permissões acima, usadas nas páginas que o próprio
portfólio administra, costumam bastar com acesso padrão. Acesso avançado e
análise do app só entram quando o app for ler páginas de terceiros que não
estão no portfólio.

## Variáveis

| Variável | O que é |
|---|---|
| `META_APP_SECRET` | Chave secreta do app, para a assinatura e o `appsecret_proof` |
| `META_WEBHOOK_VERIFY_TOKEN` | Texto qualquer, igual ao cadastrado no Webhooks do app |
| `META_LEADS_ACCESS_TOKEN` | Token do usuário do sistema com `leads_retrieval` |
| `META_LEADS_INTAKES` | JSON página → token da campanha |
| `META_GRAPH_VERSION` | Opcional; vazio usa a versão padrão do app |

Todas só no servidor. Nenhuma vai para o navegador nem para o repositório.
