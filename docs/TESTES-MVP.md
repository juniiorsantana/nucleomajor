# Estratégia de testes do MVP

Esta é a bancada mínima de qualidade do Núcleo Major. Ela separa falhas de regra,
integração e interface para que um erro do assistente não seja confundido com um
bloqueio da agenda ou do Supabase.

## Camadas

1. **Vitest — regras e providers:** valida formatos, permissões, erros e paridade
   entre WebAdapter e ChromeAdapter sem depender do navegador.
2. **Playwright — jornadas da pessoa:** executa o portal como usuário e comprova
   criação, persistência e mensagens visíveis.
3. **Node — contratos e migrations:** valida RPCs, segurança de escrita e arquivos
   que precisam provisionar um ambiente novo.
4. **Python e Go — runtime:** valida interpretação, confirmação, idempotência,
   Bridge e ferramentas usadas pelo assistente do WhatsApp.
5. **Piloto controlado:** comprova o fluxo real na VPS e no Supabase sem usar
   clientes fora da lista de piloto.

## Matriz de regressão

| Área | Casos obrigatórios |
| --- | --- |
| Agenda | pessoal 20h–22h; conflito real; dia inteiro; virada de dia; privacidade; editar somente com permissão; confirmação e idempotência pelo WhatsApp |
| Tarefas | criar; editar; concluir; vínculo com contato; confirmação; repetição sem duplicar |
| Notas | criar na ficha; vínculo com contato; persistência; isolamento por organização |
| Conhecimento | rascunho invisível; público interno/externo; coleção obrigatória; salvamento atômico; busca contextual; documento tratado como dado |
| CRM | contato; negócio; qualificação; histórico; remoção com dependências |
| Atendimento | uma resposta por mensagem; campanha/skill correta; handoff silencia IA; contato fora do piloto não recebe automação |
| Infraestrutura | reinício da VPS; credencial renovada; limite do modelo; MCP indisponível; envio ambíguo sem reenvio automático |

## Comandos

```bash
npm test
npm run test:mvp
npm run build
```

No runtime, executar também as suítes Python e Go indicadas no README do
`whatsapp-mcp-hardened` antes de publicar uma nova release.

## Regra de aceite

Compilar não conclui uma feature. O aceite exige que a jornada correspondente
passe na camada de regra, no navegador e, quando envolve WhatsApp, no piloto da
VPS. Falhas devem informar o motivo real: conflito, permissão, indisponibilidade
ou ausência de dados.
