# Deploy: Analysis Schema v1 no runtime (Atendimento Score)

> **Estado em 02/10/2026, ao fechar o roteiro:** nada aplicado.
> - Base: a release ativa **`observabilidade-do-analista`**.
> - Patch `runtime-atendimento-score-v1.patch`: 7 arquivos, 866 linhas a mais
>   e 308 a menos, sha256 `a6668139941528a3cc1abd0c745f57cb79dcdbc075b5e19a07142485a40f1619`.
> - Base + patch, nesta máquina: **975 testes OK** (fora `test_media_mirror` e
>   `test_conversation_sync`, que quebram por data fixa — issue #21).
> - Par da migration `20261004100000_atendimento_score_v1.sql` e do portal
>   (PR da branch `feat/atendimento-score-v1`).

## A ordem importa

1. **Migration** `20261004100000` (SQL Editor, com ensaio). Sozinha ela já
   publica o atendimento.v1: leituras novas do Jev ganham nota (as respostas
   att_* ainda não existem, então a nota fica nula até o passo 3).
2. **Merge do PR** (portal). O portal novo lê os DOIS formatos de análise.
3. **Este runtime.** Por último, porque o analista novo grava o formato
   `analysis_report.v1`, que o portal atual (antes do passo 2) não sabe
   mostrar: uma análise feita antes do merge apareceria vazia.

Runtime novo com banco antigo também funciona: a chamada
`nucleo_analysis_classify` falha, o analista registra `analysis.classify_failed`
e segue com o que veio no pedido.

## O que muda

- **Jev, `major-v2`:** + 8 perguntas do Atendimento Score (att_discovery,
  att_conversation_coherence, att_communication_adaptation,
  att_qualification, att_playbook_adherence, att_objection_handling,
  att_next_step, att_follow_up). Qualificação e playbook recebem o playbook
  efetivo (o da empresa, ou o Base Major); o follow-up recebe a data de hoje.
  Vale para a leitura automática e para a aba Testar.
- **Analista:** antes do Claude, pergunta ao Jev (cliente próprio) e grava em
  `nucleo_analysis_classify`; o banco devolve a nota. O Claude recebe a nota
  pronta, critério por critério, e devolve `analysis_report.v1`. Resposta
  conferida campo a campo; evidência só com `message_id` que existe.
- **Log:** `analysis.classified` / `analysis.classify_failed` (sem conteúdo);
  `analysis.done` passa a contar `actions`, `red_flags` e `service_score`.
  A observabilidade das falhas (`stage`, `cli_*`...) continua igual.

Nenhuma variável nova. O Bridge não muda.

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../observabilidade-do-analista
sha256sum /tmp/runtime-atendimento-score-v1.patch
cd "$ATIVA" && git apply --check -p1 /tmp/runtime-atendimento-score-v1.patch && echo CHECK_OK
```

## 2. Release nova, testes, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/atendimento-score-v1
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply -p1 /tmp/runtime-atendimento-score-v1.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_analista test_atendimento_v1 test_coordenador test_runtime_commands test_runner 2>&1 | tail -3
ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$UUID
```

## 3. Conferir

```bash
journalctl --user -u whatsapp-assistant@$UUID --since "30 min ago" -o cat \
  | grep -E '"event": "(insights\.(read|cycle)|analysis\.)' | tail -10
```

```sql
-- leituras novas: major-v2, com as respostas att_* e a nota
select framework_version, service_score, lead_score, schema_version, facts_version, created_at
from public.conversation_insight_runs
where organization_id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
order by created_at desc limit 5;
```

## 4. Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/observabilidade-do-analista ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
```

O analista antigo volta a gravar o formato anterior, que o portal novo também
mostra.

## 5. Registro do que já rodou

- 02/10/2026: migration `20261004100000` aplicada e conferida (ver
  `docs/STATUS.md`); portal do PR #23 no ar antes do runtime, como pede a ordem.
- 02/10/2026, 18:49 UTC: release `atendimento-score-v1` no ar na VPS (rollback:
  `observabilidade-do-analista`). Serviço ativo, `NRestarts=0`, sem erro no log.
- Validação pelo botão: análise `228af13f…` classificada na hora
  (`analysis.classified` → `analysis.done`), relatório `analysis_report.v1` no
  portal. Achados que viraram os ajustes de `runtime-ajustes-v1`: cobertura
  baixa (o Jev abaixo de 0,6 em vários critérios), alerta contraditório e `#N`
  no texto.
