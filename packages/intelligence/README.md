# Skills oficiais do Núcleo Major

Esta pasta é a fonte de desenvolvimento das skills oficiais. O runtime não lê
estes arquivos diretamente: versões validadas são publicadas em
`public.skill_definitions` e versionadas automaticamente em
`public.skill_versions`.

Cada skill contém:

- `skill.json`: metadados, gatilhos, dados obrigatórios, ferramentas e limites;
- `instructions.md`: instruções humanas usadas pelo assistente;
- `tests.json`: exemplos de mensagens que devem ou não ativar a skill.

## Fluxo

1. Edite os arquivos da skill.
2. Execute `npm run intelligence:validate`.
3. Revise a simulação com `npm run intelligence:publish`.
4. Publique conscientemente com `npm run intelligence:publish -- --apply`.

Para publicar, defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` somente no
terminal local. Não configure a `service_role` no navegador, no build Vite ou
nas variáveis da Hostinger. Remova a variável do terminal depois da publicação.

É possível limitar a operação a uma skill:

```powershell
npm run intelligence:validate -- --slug agenda
npm run intelligence:publish -- --slug agenda --apply
```

Skills privadas das empresas continuam sendo criadas e versionadas pelo portal.

