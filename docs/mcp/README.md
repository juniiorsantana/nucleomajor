# MCP do portal

Claude e ChatGPT, no computador e no celular, perguntam ao Núcleo Major em nome
de quem entrou: *quantas conversas hoje? quantos leads? tem lead esperando? tem
tarefa? compromisso hoje?* A v1 é **só leitura**.

Não confundir com o MCP do runtime da VPS (`whatsapp-mcp-hardened`), que serve
os agentes que atendem no WhatsApp e só escuta em loopback. Este fica no portal,
em `https://nucleomajor.com/mcp`, e serve a uma pessoa.

## Como funciona

```text
Claude / ChatGPT
  1. POST /mcp sem token        → 401 + WWW-Authenticate: resource_metadata=…
  2. GET /.well-known/oauth-protected-resource → servidor de autorização = Supabase Auth
  3. registro dinâmico + PKCE no Supabase → login → /app/oauth/consent ("Permitir acesso")
  4. POST /mcp com Bearer <JWT da pessoa>
        └─ src/mcp.mjs ─ /auth/v1/user ─ PostgREST/RPC com o MESMO token → RLS
```

- **Quem autentica é o Supabase Auth**, que funciona como servidor OAuth 2.1. O
  token é um JWT da própria pessoa, então a RLS vale como no portal. Não há
  `service_role` nem token global.
- **A trava dos destinos.**
  - **Por que existe:** o registro de aplicativos é aberto (registro dinâmico),
    então qualquer um pode cadastrar um "Claude" falso. O token emitido vale a
    sessão inteira da pessoa, não só a leitura do MCP: "só leitura" é das
    ferramentas, não do token.
  - **Como funciona:** a tela `/app/oauth/consent`, que é a única porta de
    aprovação, só aprova o que volta por https para `claude.ai`, `claude.com`
    ou `chatgpt.com` (e subdomínios). Para qualquer outro destino, a tela diz
    "Este aplicativo não é reconhecido" e só oferece Recusar, sem levar a
    pessoa ao site de quem pediu. O retorno automático de um pedido já
    aprovado passa pela mesma trava.
  - **Onde mexer:** `destinoConfiavel` em `ConsentimentoOAuth.jsx`. Um
    aplicativo novo exige incluir o domínio dele ali.
- **A empresa vem dos vínculos da pessoa** (`organization_members` ativo). O
  parâmetro `empresa` que o modelo envia só escolhe dentro dessa lista e nunca
  sai dela. Para quem tem uma empresa só, ela é usada direto.
- **O protocolo é Streamable HTTP sem sessão, com resposta JSON.** Cada POST se
  basta, sem SSE e sem conexão longa. Foi escrito à mão em `src/mcp.mjs`
  (`initialize`, `ping`, `tools/list`, `tools/call`) porque o SDK oficial
  traria express, hono e mais quinze pacotes.
- **"Hoje" é sempre o dia de Brasília** (`-03:00`), calculado no servidor.
- **O que sai da base:** nome do contato, prévia de até 80 caracteres da última
  mensagem do lead que espera, títulos de tarefas e de compromissos. Telefone
  completo nunca sai; sem nome, aparece `Contato …1234`.
- **Registro:** cada chamada vira uma linha `{"evento":"mcp.tool",…}` no log do
  Node, com usuário, ferramenta, empresa (8 caracteres de cada id), duração e
  resultado. O conteúdo não entra no registro.

## Ferramentas

Todas têm `readOnlyHint: true`. As regras são as mesmas das telas do portal.

| Ferramenta | Responde | Regra |
|---|---|---|
| `minhas_empresas` | empresas e papel | `organization_members` ativo |
| `resumo_do_dia` | as cinco abaixo, de uma vez | — |
| `conversas` | conversas com mensagem no dia (recebidas e enviadas), total de diretas e de grupos, não lidas, "precisa de você" | `whatsapp_messages` no dia, sem grupos; "precisa de você" = `unread_count > 0` e `owner = 'humano'` (`Conversas.jsx`) |
| `leads` | total, novos no dia, últimos 7 dias | `contacts.lead_at` não nulo, sem `deleted_at` (`domain/lead.js`) |
| `leads_esperando` | quem espera a equipe, há quanto tempo, quem atende | conversa direta com `last_message_from_me = false`, casada com o lead por `variantesBR`. É o que a tela Leads chama de **"Respondeu"**. Lista os últimos 7 dias, com a espera mais longa primeiro, e só conta os mais antigos |
| `tarefas` | pendentes, minhas, atrasadas, do dia, sem data | `tasks` não concluída e sem `deleted_at`; responsáveis em `task_assignees`, ou `owner_id` |
| `agenda` | compromissos do dia | RPC `calendar_events_list`, só `source_type = 'event'`; evento pessoal de outra pessoa chega mascarado |

`conversas`, `leads`, `tarefas` e `agenda` aceitam `dia` (AAAA-MM-DD).

## Ligar em produção (uma vez)

**Passos 1 e 2 feitos em 09/10/2026**, no painel, com o dono acompanhando.
O Supabase pediu a confirmação de risco do registro dinâmico, e ela foi aceita
junto com a trava dos destinos. A resposta da conferência traz
`registration_endpoint`. Falta o passo 3.

1. **Supabase → Authentication → OAuth Server:**
   - ligar o servidor OAuth;
   - ligar **Allow dynamic client registration**, porque Claude e ChatGPT se
     registram sozinhos;
   - em **Authorization path**, pôr `/oauth/consent`. O Site URL é
     `https://nucleomajor.com/app`, então a tela fica em
     `https://nucleomajor.com/app/oauth/consent`.
2. **Conferir:**
   `https://lwoqcvuspsmfowiuipmv.supabase.co/.well-known/oauth-authorization-server/auth/v1`
   deve responder JSON, e não `OAuth server is disabled`, que era a resposta em
   09/10/2026.
3. **Merge e deploy do portal**, depois conferir:
   - `GET https://nucleomajor.com/.well-known/oauth-protected-resource` responde
     200;
   - `POST https://nucleomajor.com/mcp` sem token responde 401 com
     `WWW-Authenticate`.

   Em 09/10/2026 o caminho `/.well-known/` já chegava ao Node na Hostinger: o
   404 vinha com os cabeçalhos do portal.

## Conectar

O portal mostra o caminho em **Conexões → Claude e ChatGPT**
(`page/telas/conexoes/ClaudeEChatGPT.jsx`). Ali ficam:

- o endereço, com o botão Copiar;
- o passo a passo de cada aplicativo;
- perguntas de exemplo;
- **os aplicativos que a pessoa já autorizou**, com o botão Desconectar.

A lista vem do próprio Supabase Auth (`auth.oauth.listGrants` e
`revokeGrant`), sem tabela nossa. Desconectar apaga o consentimento, as sessões
e os tokens daquele aplicativo.

Com o OAuth Server desligado, o bloco diz "Ainda não liberado" em vez de mostrar
passos que terminariam em erro. O bloco aparece só no portal, não na extensão, e
a lista é da pessoa, não da empresa.

- **Claude** (qualquer plano; o gratuito aceita um conector personalizado só): no claude.ai, em Configurações →
  Conectores → **Adicionar conector personalizado**. Nome `Núcleo Major`, URL
  `https://nucleomajor.com/mcp`. Depois clique em Conectar, entre com a conta do
  portal e escolha Permitir. Feito na web, o conector aparece também no app do
  celular.
- **ChatGPT:** ative o **Modo desenvolvedor** em Configurações → Apps e
  Conectores → Avançado e crie o conector com a mesma URL. Plus e Pro só aceitam
  conectores de leitura, o que basta para a v1. O plano de cada pessoa decide o
  que aparece.
- **Para cortar o acesso**, use Desconectar em Conexões ou desconecte o
  conector no Claude ou no ChatGPT.

## Testar

- `node --test test/mcp.test.mjs` cobre:
  - 401 e `.well-known`;
  - o protocolo;
  - as cinco perguntas, com a virada do dia às 21h UTC;
  - a paginação além de mil linhas;
  - o nono dígito;
  - duas empresas: a pessoa A pede a B e recebe recusa, e nenhuma consulta sai
    com o token de A para a B.
- `apps/emyleads/src/page/ConsentimentoOAuth.interactive.test.jsx` cobre a tela
  "Permitir acesso".
- `apps/emyleads/src/page/telas/conexoes/ClaudeEChatGPT.interactive.test.jsx` e
  `apps/emyleads/src/web/authProvider.aplicativos.test.js` cobrem o bloco de
  Conexões:
  - sem nada conectado, conectado e desconectar;
  - falha ao desconectar;
  - OAuth desligado;
  - lista que não carrega.
- **Ponta a ponta:**
  - conecte com a conta da Major e compare as respostas com as telas Conversas,
    Leads, Tarefas e Agenda;
  - repita no app do celular;
  - depois, com a conta da Adriani, confira que só a empresa dela aparece.

## Fora da v1

- Escritas (tarefa, funil, nota, agenda), pelo padrão `assistant_tool_runs`:
  proposta, confirmação e idempotência.
- Interruptor "permitir acesso por MCP" por empresa, antes de abrir para todos
  os clientes. Exige migration. A lista dos acessos da própria pessoa já existe,
  em Conexões.
- Tabela de auditoria das chamadas, no lugar do log.
- Envio de WhatsApp continua fora.
