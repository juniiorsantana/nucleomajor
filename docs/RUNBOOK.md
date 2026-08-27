# Runbook operacional

## Diagnóstico por camada

Verifique nesta ordem:

1. **Portal:** site e sessão Auth carregam?
2. **Supabase:** RPC e RLS respondem?
3. **Heartbeat:** a VPS enviou sinal recente?
4. **Assistente:** serviço está ativo e sem loop?
5. **MCP:** contexto do Núcleo foi resolvido?
6. **Bridge:** processo responde localmente?
7. **WhatsApp:** identidade esperada está conectada?

“Não foi possível consultar” não significa “WhatsApp desconectado”.

## Comandos na VPS

Como usuário `nucleo`:

```bash
CONNECTION_ID=<uuid>
systemctl --user is-active whatsapp-bridge@$CONNECTION_ID
systemctl --user is-active whatsapp-assistant@$CONNECTION_ID
journalctl --user -u whatsapp-assistant@$CONNECTION_ID -n 100 --no-pager
bash ~/whatsapp-mcp-hardened/scripts/vps/check-runtime.sh $CONNECTION_ID
```

Não cole tokens ou mensagens completas ao compartilhar logs.

## Assistente não responde

1. confirmar que somente a VPS está ativa;
2. conferir assistente e Bridge separadamente;
3. procurar `customer_rollout`, `credential`, `intelligence` e `run.completed`;
4. testar um operador verificado;
5. testar um contato permitido no piloto;
6. não reiniciar o Bridge se a falha estiver no assistente ou MCP.

## Agenda indisponível

1. conferir credencial do robô e renovação;
2. conferir MCP do Núcleo;
3. validar migration requerida;
4. consultar agenda sem escrita;
5. só depois testar criação confirmada.

## Extensão não abre

1. conferir erro em `chrome://extensions`;
2. confirmar build completo em três etapas;
3. confirmar `.env.local` com URL e publishable key;
4. recarregar e abrir console do service worker;
5. comparar o carimbo de build;
6. não diagnosticar a VPS pela disponibilidade do gateway local.

## Handoff travado

1. verificar status da solicitação no Supabase;
2. conferir comando do runtime e prazo de expiração;
3. verificar poller na VPS;
4. não mudar diretamente a linha para `returned` ou `completed`;
5. repetir a ação pelo portal, que é idempotente.

## Incidente de segredo

1. revogar imediatamente a credencial;
2. preservar logs sem copiar o segredo;
3. rotacionar token/chave e reprovisionar identidade técnica;
4. procurar exposição no histórico Git e artefatos;
5. seguir `SECURITY.md`;
6. registrar causa e prevenção em ADR ou post-mortem.
