# Plano futuro — reduzir Log Ingestion do Supabase

## Objetivo e decisão

Reduzir requisições, escritas e eventos repetidos sem perder atualização da interface nem capacidade de diagnosticar falhas. **Vale implementar:** o trabalho repetido também consome banco, Realtime e recursos dos clientes. Ainda não há medição por fonte que permita prometer uma redução específica.

Contexto da auditoria de código: 300–600 MB/dia informados pelo usuário, ou cerca de 9–18 GB em 30 dias. Para caber em 1 GB/mês, a queda necessária é de aproximadamente 89–94%; tratar isso como meta a verificar, não como resultado garantido. A auditoria foi somente do repositório: configuração hospedada, logs e versão efetiva do runtime da VPS não foram consultados.

## Etapas de implementação

- [ ] **1. Medir antes de mudar.** No Logs Explorer, obter 24–48 h de contagem e volume aproximado por fonte, caminho, método e status. Conferir `log_statement`, `log_min_duration_statement`, `log_min_messages` e pgAudit; confirmar migrations aplicadas, versão do runtime e cadência/tamanho dos lotes de `nucleo_conversation_sync`. **Concluído quando:** estiverem identificadas as fontes e rotas dominantes, requests por hora e bytes ingeridos por dia em períodos comparáveis.
- [ ] **2. Evitar atualização de conversa sem mudança real.** Revisar o `ON CONFLICT DO UPDATE` de `whatsapp_conversations` em `supabase/migrations/20260916110000_midia_das_conversas_no_storage.sql` e a seleção de lotes do runtime. Preservar mudanças de nome, prévia, leitura e responsável. **Concluído quando:** reenviar um lote idêntico não atualizar a linha nem emitir novo evento `conversas`; uma alteração real ainda chega ao portal.
- [ ] **3. Reduzir o polling da tela de Conexões.** Revisar `apps/emyleads/src/page/telas/Conexoes.jsx` e `apps/emyleads/src/web/gatewayProvider.js`: eliminar consultas remotas repetidas por conexão no fallback, compartilhar dados já recebidos, impedir ciclos sobrepostos e ajustar a cadência ao heartbeat. **Concluído quando:** requests por hora de uma aba aberta caírem sem atrasar indevidamente QR, status e atendimento.
- [ ] **4. Reduzir releituras na tela de Conversas.** Revisar `useConversas.js` e `web/conversasProvider.js`: não buscar todos os contatos, até 300 mensagens e URLs assinadas em toda volta de 20 s quando nada mudou; manter recuperação após perda do Realtime. **Concluído quando:** mensagem nova, troca de responsável e reconexão atualizarem a tela, com menos chamadas REST/Storage por hora.
- [ ] **5. Consolidar a sincronização da extensão, se relevante na medição.** Revisar `data/remoteProvider.js` para impedir `sync.executar` simultâneos e agrupar operações próximas, preservando outbox, modo offline e resolução de conflitos. **Concluído quando:** uma sequência curta de ações não dispara pulls completos sobrepostos e os dados convergem após reconexão.
- [ ] **6. Ajustar verbosidade do Postgres apenas se os logs a apontarem como fonte dominante.** Escolher limiares que preservem erros e consultas lentas; evitar statements com conteúdo integral de conversas e credenciais. **Concluído quando:** o volume de `postgres_logs` cair sem perder evidências necessárias para investigar falhas.
- [ ] **7. Verificação final.** Comparar 48 h antes/depois em dias com uso semelhante: bytes por fonte, requests por rota, erros, eventos Realtime por mensagem nova e atraso de atualização das telas. **Concluído quando:** houver queda sustentada sem regressão funcional documentada. Reavaliar então se 1 GB/mês é viável ou se o uso legítimo exige outro plano.

## Prioridade e vantagens

Executar **1 → 2 → 3 → 4** primeiro. A etapa 2 ataca a multiplicação estrutural de escrita → Realtime → leitura. As etapas 3 e 4 atacam logs automáticos do API Gateway ao reduzir requests. A etapa 5 depende do peso observado da extensão; a 6 depende da configuração real do Postgres. Benefícios adicionais: menor carga de banco, menos tráfego e menos trabalho nas abas abertas.

## Cuidados

Os `console.*` do navegador, da extensão e do servidor Node não explicam diretamente `function_logs` do Supabase; removê-los não é a estratégia central. Não desabilitar observabilidade para mascarar retries ou RPCs com erro. O runtime completo da VPS não está neste repositório e precisa ser inspecionado antes de alterar sua sincronização. Implantar mudanças de SQL e interface em etapas, com comparação de métricas após cada uma.
