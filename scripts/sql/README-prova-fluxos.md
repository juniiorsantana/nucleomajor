# FASE 3 — provas de execução persistida

Executar apenas em PostgreSQL 17.9 descartável. `setup-flow-proof.sh` prepara
binários de usuário e socket Unix privado em `/tmp/nucleo-flow-phase3-20260907`.
Não instala serviço nem abre TCP. `run-flow-proof.sh` aplica a cadeia completa
em `flow_control`, clona `flow_test`, aplica a migration da fase e executa a
prova transacional com ROLLBACK. A cadeia inclui as duas migrations da FASE 14.

`prova-fluxos-concorrencia.py` clona `flow_test` em `flow_concurrency`, usa duas
conexões independentes e testa a separação entre conexões/organizações. Remove
essa cópia em `finally`. Não executar simultaneamente com a prova de runtime,
que usa o mesmo nome de banco descartável.

`prova-fluxos-runtime.py` usa a mesma cópia, um Bridge HTTP fictício em loopback
e os módulos Python da branch `feature/flow-runtime-phase-3`, copiados para
`input/runtime`. Cada etapa roda em um processo novo. A sessão SQLite persiste
entre processos; nenhum browser ou modelo participa da prova. O transporte de
RPC usa psql com identidade de robô sintética, sem credencial de produção.

## Resultado observado em 07/09/2026

- A–F: início/ACK idempotentes, alteração de etiqueta, contexto atualizado,
  bifurcação, suspensão, callback duplicado, definição fixada, expiração,
  cancelamento e envio incerto. ROLLBACK removeu as fixtures.
- G–J: duas conexões disputaram a mesma revisão; exatamente uma venceu.
  Outra conexão ativa e outra organização não leram nem reservaram a execução.
  A cópia da prova foi removida.
- K–M: processos novos executaram etiqueta → condição → mensagem → IA →
  mensagem → fim. A conclusão repetida não duplicou avanço ou envio. Tomada
  humana seguida de devolução à IA invalidou a execução antiga pelo epoch.
- Corpos normalizados de `intelligence_payload`, `resolve_v2` e `resolve_v3`
  permaneceram iguais aos do banco de controle.
- N/O: condições inválidas recusadas, E/OU aninhados aceitos; o registro de
  atendimento humano no banco cancelou a suspensão e recusou conclusão tardia.
- P/Q: falha do modelo e expiração executaram o caminho de falha; confirmação
  incerta do Bridge deixou `needs_review`, sem reenvio no processo seguinte.
- R: os 15 corpos normalizados, permissões, tabela e trigger passaram a mesma
  consulta de aceite entregue para o SQL Editor.

Essas provas não são aplicação em produção, teste de Claude real ou envio real
de WhatsApp. A aplicação da migration continua exclusivamente pelo SQL Editor.

## Aplicação manual

1. Copiar o arquivo completo
   `supabase/migrations/20260907010000_fluxos_execucao_persistida.sql` para o
   SQL Editor. A transação recusa alterações nos corpos durante a cópia.
2. Executar `scripts/sql/validar-fluxos-execucao.sql`, somente leitura.
3. Exigir `tudo_confere: true`. Não habilitar o runtime se qualquer hash,
   permissão, tabela ou trigger divergir.
4. Conferir o HEAD da VPS antes de preparar o release e ativar
   `NUCLEO_FLOW_RUNTIME=1` junto de `EMYLEADS_CHATBOT_RUNTIME=1`.

Uma confirmação do SQL Editor não comprova funcionamento no WhatsApp. O aceite
operacional depende também do deploy, saúde dos serviços e jornada observada.
