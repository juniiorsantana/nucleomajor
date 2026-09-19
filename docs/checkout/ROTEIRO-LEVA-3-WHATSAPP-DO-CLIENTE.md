# Leva 3: o cliente pede o WhatsApp, a Major monta com um comando

Antes desta leva, é preciso aplicar as Levas 1 e 2
([ROTEIRO-LEVA-1-CHECKOUT-ASAAS.md](ROTEIRO-LEVA-1-CHECKOUT-ASAAS.md) e
[ROTEIRO-LEVA-2-PLANO-SEM-IA.md](ROTEIRO-LEVA-2-PLANO-SEM-IA.md)).

## Como fica para o cliente

1. Em Conversas (ou em Conexões), o dono ou o administrador vê **"Conecte o
   WhatsApp da empresa"**, informa o número e clica em **"Conectar meu
   WhatsApp"**. Antes disso, a tela ficava presa em "Consultando a conexão…"
   para sempre, e Conexões mandava abrir `127.0.0.1:8090`.
2. A tela passa a mostrar **"Estamos preparando o seu WhatsApp"**.
3. Quando a VPS dá o primeiro sinal, aparece **"Conectar WhatsApp"**, com o QR
   de sempre. O cliente lê o código com o celular daquele número.

O atendente vê "Quem administra a empresa pede a conexão". O limite de
conexões vem do plano: o Base tem uma. Empresa bloqueada não pede.

## Como fica para a Major

1. Chega um e-mail em `OPS_NOTIFY_EMAILS` com o comando pronto, parecido com:

   ```bash
   bash scripts/vps/provision-connection.sh <org> <conexão> --plano base --telefone 55659...
   ```

2. O mesmo pedido aparece em Configurações → Administração do Núcleo Major →
   "WhatsApps aguardando a VPS", com botão de copiar. O comando copiado de lá
   não traz o telefone, e o script pergunta.
3. Na VPS, rode primeiro com `--dry-run` e depois sem ele. Os detalhes estão
   na seção 8 de `scripts/vps/README.md`, no repositório
   `whatsapp-mcp-hardened`, branch `feat/provisionar-conexao-de-cliente`,
   commit `5af5919`.

## O que muda no banco

A migration é `20260921100000_pedido_de_conexao_do_whatsapp.sql`:

- **`nucleo_connection_request(org, nome, telefone)`** cria o pedido. Só dono
  ou administrador pode chamar, e a função confere o plano, o limite e se a
  assinatura está ativa. O número vai para `expected_phone_hash`, com sal da
  própria conexão (o mesmo formato do Bridge), e para
  `expected_phone_last4`. Pedir de novo o mesmo número devolve o mesmo
  pedido.
- **`platform_connection_requests_list()`** lista os pedidos, só para a
  administração da plataforma. Os que ainda não têm sinal vêm primeiro.
- **`private.conexao_da_organizacao`** deixa de usar `min(uuid)`, que não
  existe no Postgres. A função é plpgsql e só quebrava quando chamada sem id
  de conexão, o que passa a acontecer com clientes novos.

## Provas

- `scripts/sql/prova-pedido-de-conexao.mjs`: **23 verificações, PASS**. Reaplica
  o harness e todas as migrations reais em PGlite 0.5.8, e mostra o defeito do
  `min(uuid)` antes da migration e a correção depois.
- `test/connection-request.test.mjs`: o pedido e o comando. Um id malformado ou
  um número com `$(…)` não entram no comando.
- `apps/emyleads/src/page/telas/conversas/ConexaoDoWhatsApp.interactive.test.jsx`:
  o formulário, a recusa do servidor, o atendente sem formulário e a fase
  "preparando".
- `scripts/vps/test_provision_connection.py` (no runtime): **9 testes** com
  dublês de `curl`, `systemctl` e do provisionador do robô. Cobrem:
  - as portas escolhidas;
  - a idempotência;
  - número errado;
  - plano com IA;
  - conexão de outra organização ou revogada;
  - a simulação;
  - a garantia de que a `service_role` não vaza nem para a linha de comando
    nem para arquivo.

## Aplicar

1. **SQL Editor.** Abra o **arquivo** da migration, copie tudo e rode. Para
   conferir, rode esta consulta; todas as linhas precisam voltar `true`:

   ```sql
   select 'pedido existe' as conferencia,
          to_regprocedure('public.nucleo_connection_request(uuid, text, text)') is not null as ok
   union all
   select 'lista existe', to_regprocedure('public.platform_connection_requests_list()') is not null
   union all
   select 'sem min(uuid)',
          (select prosrc not like '%min(connection.id)%'
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'conexao_da_organizacao');
   ```

2. **Portal.** Publicado junto com a branch `feat/checkout-asaas`.
3. **VPS.** Leve o `scripts/vps/provision-connection.sh` para a release ativa.
   O arquivo é novo e não mexe em nada da Major. Com sua autorização, eu
   mando o arquivo e rodo o `--dry-run`.

## Limites conhecidos (ficam para a leva da IA)

- **O número do cliente só é conferido pelos 4 últimos dígitos.** O banco
  ainda não recebe a identidade verificada de volta, então o índice que
  impede o mesmo número em duas empresas ainda não vale. Por enquanto, quem
  roda o script confere o número.
- **O MCP do WhatsApp fixa a porta 8080.** Isso só importa quando um cliente
  tiver IA, e o script recusa plano com IA.
