# Como contribuir

## Antes de começar

1. leia `docs/STATUS.md` e o SPEC do componente;
2. confirme qual repositório é a fonte;
3. verifique `git status` e preserve mudanças alheias;
4. não use produção para experimentar migrations ou mensagens.

## Branches e commits

- branch curta por mudança;
- commits pequenos, com verbo no imperativo ou Conventional Commits;
- não misturar formatação ampla com mudança funcional;
- migration, código e documentação do contrato entram juntos.

Exemplos:

```text
feat: add pilot contact selector
fix: preserve handoff after runtime restart
docs: describe extension release process
```

## Pull request

Toda PR deve informar problema, solução, riscos, testes e implantação. Mudança
visual inclui captura. Mudança de segurança explica fronteira e falha fechada.

Checklist mínimo:

- testes relevantes passaram;
- build da plataforma afetada passou;
- sem segredo ou dado real no diff;
- SPEC, runbook e changelog atualizados quando aplicável;
- migration é aditiva e compatível com o deploy anterior;
- há plano de rollback.

## Revisão

Nenhuma pessoa aprova a própria mudança sensível de Auth, RLS, credencial,
WhatsApp, cobrança ou envio externo. Bugs críticos devem ganhar teste de regressão.

## Definição de pronto

Código pronto não é necessariamente produção pronta. Uma mudança termina quando
foi testada, documentada, implantada no ambiente correto e validada sem
dependência acidental do computador do desenvolvedor.
