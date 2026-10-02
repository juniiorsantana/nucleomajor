# Deploy: diagnóstico das falhas do analista, sem conteúdo

> **Estado em 02/10/2026:** publicado. Base: release `camada-de-inteligencia`.
> Patch `runtime-observabilidade-do-analista.patch`: 4 arquivos, 135 linhas a
> mais e 8 a menos, sha256 `57e9d57b20753726e62ce342a5791858702cbf0938ae90d1c14a7f5c80906dde`.
> Nesta máquina: 960 testes OK (fora `test_media_mirror` e
> `test_conversation_sync`, que quebram por data fixa — issue #21).

## Por quê

Em 02/10, duas análises da mesma conversa falharam com
`analysis_invalid_response` e não havia como saber a causa: o runtime não
guarda o texto da resposta, de propósito. Este patch só **observa**; parser,
prompt, banco e portal ficam iguais.

## O que muda

- `runner.RunResult` ganha `meta` (opcional, padrão `None`): os campos
  técnicos que a CLI devolve no JSON — `subtype`, `stop_reason`, `is_error`,
  `num_turns`, `output_tokens`, `models`. Nunca texto. O atendimento não usa.
- `AnaliseInvalida` diz a etapa: `json_ausente`, `json_invalido`,
  `schema_nao_objeto`, `schema_sem_resumo`. (A evidência nunca derruba a
  análise: número inválido é descartado.)
- O evento `analysis.failed` passa a levar: `stage`, `model`, `latency_ms`,
  `attempt` (sempre 1: não há nova tentativa), `reply_chars`, `exit_code` e
  `cli_*` (os campos do `meta`). Falha do Claude (`RunnerError`) leva
  `model`, `latency_ms` e `attempt`.
- O que vai para o banco não muda: `errorCode` continua o de sempre.

Exemplo do que a CLI real devolve (conferido na VPS):
`{'subtype': 'success', 'stop_reason': 'end_turn', 'is_error': False, 'num_turns': 1, 'output_tokens': 4, 'models': ['claude-sonnet-5']}`

## Ler uma falha

```bash
journalctl --user -u whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71 -o cat \
  | grep '"event": "analysis.failed"' | tail -5
```

`cli_stop_reason: max_tokens` = resposta cortada no limite; `end_turn` com
`stage: json_ausente` = o Claude respondeu em texto em vez de JSON.

## Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/camada-de-inteligencia ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71
```

## Registro do que já rodou

- 02/10/2026 16:16 UTC: base conferida pelos 4 hashes, `git apply --check`
  OK, release `observabilidade-do-analista` criada, testes do analista, do
  runner, dos comandos e do worker OK na VPS, symlink virado, só o
  assistente da Major reiniciado (`active`, `NRestarts=0`). Chamada de teste
  pelo `runner` com a conta de análise: `meta` preenchido como acima.
