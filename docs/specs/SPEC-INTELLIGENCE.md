# SPEC — Central de Inteligência

Status: Fase H implementada; piloto externo pendente de implantação do runtime.

## Entidades

- **Perfil de assistente:** público interno ou externo, identidade e processo.
- **Skill:** objetivo, gatilhos, bloqueios, etapas, ferramentas e handoff.
- **Coleção de conhecimento:** agrupamento autorizado para um público.
- **Campanha:** oferta, origem, público e resultado esperado.
- **Contexto de conversa:** campanha, skill e estado persistente.
- **Qualificação:** informações estruturadas do contato.
- **Handoff:** solicitação e propriedade do atendimento humano.

## Skills oficiais

O catálogo versionado em `packages/intelligence/skills` contém:

- Recepção;
- Pré-qualificação;
- Vendas;
- Suporte;
- Agenda;
- Solicitação de Agenda (somente clientes, sem criação direta);
- Tarefas (somente profissionais internos).

Cada skill possui especificação estruturada, instruções Markdown e casos de
teste. Arquivos são fonte para desenvolvimento; versões publicadas no Supabase
são a fonte usada em produção.

## Publicação

```bash
npm run intelligence:validate
npm run intelligence:publish
npm run intelligence:publish -- --apply
```

O segundo comando é dry-run. `--apply` cria versão nova somente quando o hash
muda, e a versão publicada vale na mensagem seguinte: o runtime resolve
`skill_definitions` a cada mensagem e não precisa ser reiniciado.

A credencial de publicação vem de `.env.skills.local`, não do `.env`. O `.env`
é o ambiente do portal e carrega a publishable key de propósito — chave secreta
no processo do portal é proibida por `SPEC-DATA-SECURITY`. O script carrega os
dois arquivos, então os comandos acima funcionam sem nenhum sinalizador extra;
quem só roda `validate` não precisa de credencial.

## Resolução por mensagem

1. runtime identifica organização, conexão e remetente;
2. classifica profissional ou cliente;
3. obtém perfil e campanha autorizados;
4. resolve uma skill;
5. recupera somente coleções permitidas;
6. calcula ferramentas permitidas;
7. monta contexto imutável;
8. modelo responde ou solicita uma ferramenta;
9. servidor valida e registra o resultado.

## Modos do roteamento H.3

- `off`: contrato anterior;
- `shadow`: resolve e registra, mas não altera a resposta;
- `active`: usa skill, etapas, campanha e confirmação pendente.

O rollout do atendimento externo é uma guarda adicional e independente:
`off`, `pilot` ou `active`.

## Regras

- apenas uma skill ativa por vez;
- chatbot não pode responder junto com a Recepção;
- conhecimento não executa instruções;
- baixa confiança transfere para humano;
- uma confirmação não pode ser reutilizada;
- criação de tarefa exige proposta persistida e confirmação em outro turno;
- cliente e grupo não recebem ferramentas de escrita de tarefas;
- cliente não recebe a skill Agenda interna nem ferramenta de criação direta;
- `solicitacao-agenda` prepara e submete uma solicitação para aprovação humana;
- simulador não altera CRM, agenda ou atendimento real;
- skill global é versionada e pode sofrer rollback;
- skill privada não é visível para outra organização.

## Evolução de uma skill

1. editar `skill.json` e `instructions.md` da pasta;
2. adicionar casos positivos, negativos e de transferência;
3. validar localmente;
4. revisar ferramentas e dados autorizados;
5. executar dry-run de publicação;
6. publicar;
7. testar no simulador;
8. liberar em shadow ou piloto;
9. observar resultados antes de ampliar.
