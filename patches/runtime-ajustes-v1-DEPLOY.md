# Deploy: ajustes do Analista antes de fechar a v1

> **Estado em 03/10/2026:** base = release ativa **`atendimento-score-v1`**.
> Patch `runtime-ajustes-v1.patch`: 2 arquivos (`analista.py`, `test_analista.py`),
> 184 linhas a mais e 13 a menos, sha256 `34a26af9267c5c5474cc9801db61502d5c73acb066b012ab5ee17e1b78450693`.
> Nesta máquina: 981 testes OK (fora os dois da issue #21). Sem migration.

## O que muda (pedido do dono em 03/10/2026)

1. **Cobertura da nota** vai no contexto do Claude ("cobertura de 10%"); abaixo
   de 50%, ele é avisado de que a nota não é conclusiva. (O destaque visual é
   do portal, no mesmo PR.)
2. **Jev abaixo de 0,6 (CONFIANCA_MINIMA)** não vai como classificação: entra
   numa linha separada, como incerto e proibido para conclusão.
3. **Estados estruturados são a verdade.** Depois da resposta, o código tira
   o alerta cujo critério não confirma (ex.: `overdue_follow_up` com follow-up
   não aplicável), o "porquê" de critério não avaliado e a referência do
   gargalo a critério não avaliado. Log: `analysis.reconciled` com as
   contagens, sem conteúdo.
4. **Números internos (#N)** saem do texto visível; ficam só em
   `evidence_message_ids`.

## Aplicar

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)   # .../atendimento-score-v1
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/ajustes-v1
cd "$ATIVA" && git apply --check -p1 /tmp/runtime-ajustes-v1.patch
cp -a "$ATIVA" "$NOVA" && cd "$NOVA" && git apply -p1 /tmp/runtime-ajustes-v1.patch
cd whatsapp-assistant && ~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_analista test_atendimento_v1 2>&1 | tail -2
ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
```

Voltar: `ln -sfn .../atendimento-score-v1 ~/whatsapp-mcp-hardened` e reiniciar.

## Registro

- (nada ainda)
