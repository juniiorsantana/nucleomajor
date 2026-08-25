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

## Consumo pelo assistente

A migration `20260824153000_fase_h2_skill_runtime.sql` expõe um contrato
normalizado que resolve público, campanha e skill antes de cada resposta. O
runtime valida o hash e a versão, injeta `instructionsMarkdown` como instrução
confiável e converte `allowedTools` em uma lista técnica restrita. Portanto,
editar os arquivos não altera o atendimento sozinho: é preciso validar,
publicar e reiniciar o runtime atualizado.

## Orquestração H.3

A migration `20260824210000_fase_h3_orquestracao_contextual.sql` acrescenta a
Recepção como porta de entrada do atendimento. Ela mantém o skill ativo e sua
etapa por conversa, respeita palavras negativas, destinos confiáveis vindos do
chatbot e expira subfluxos para retornar com segurança à Recepção.

Ordem de implantação:

1. aplicar as migrations H.2 e H.3;
2. publicar as cinco skills, incluindo `recepcao`;
3. iniciar o runtime com `NUCLEO_INTELLIGENCE_ROUTING_MODE=shadow`;
4. validar os registros de decisão e então trocar para `active`.

O modo `shadow` calcula a rota H.3 sem mudar a resposta atual. O modo `active`
passa a usar etapas e ferramentas da H.3. Voltar para `off` restaura o contrato
H.2 sem apagar sessões ou versões publicadas.
