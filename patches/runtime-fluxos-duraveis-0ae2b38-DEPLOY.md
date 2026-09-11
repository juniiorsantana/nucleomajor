# Deploy manual — runtime de fluxos duráveis

Base esperada: `0ae2b386d46a5ce00700177d3fae816ca38e633b`.

O patch deve ser aplicado em uma nova release, nunca diretamente no symlink
ativo. Antes de aplicar, confirme que o `HEAD` real ainda é a base esperada e
que a árvore está limpa.

```bash
git rev-parse HEAD
git status --short
git apply --check /caminho/runtime-fluxos-duraveis-0ae2b38.patch
git apply /caminho/runtime-fluxos-duraveis-0ae2b38.patch
cd whatsapp-assistant
python -B -m unittest \
  test_chatbot_runtime.py test_operator_verification.py \
  test_worker.py test_server.py test_config.py
```

Resultado local de referência: `99 tests`, `OK`.

Depois da troca manual do symlink e do restart da unit de usuário, validar:

```bash
systemctl --user is-active 'whatsapp-assistant@<instancia>.service'
journalctl --user -u 'whatsapp-assistant@<instancia>.service' -n 100 --no-pager
```

Critérios: serviço ativo, sem `flow.poll_failed`, `flow.start_failed` ou loop
de restart. Em caso de falha, repontar o symlink para a release anterior e
reiniciar a mesma unit.
