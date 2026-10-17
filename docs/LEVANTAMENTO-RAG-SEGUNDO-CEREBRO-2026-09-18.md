# Levantamento: segundo cérebro e RAG do Núcleo Major

Data: 18/09/2026. Levantamento local e somente leitura. Os números do grafo
vêm de `Grafo Núcleo Major/src/data/grafo.json`, gerado em 14/09/2026; podem
ter mudado desde então. Não houve consulta ao banco de produção nem uso de
credenciais. Portanto, a quantidade de documentos efetivamente publicados e
consultáveis pelos assistentes ainda não foi medida.

## Resposta curta

O grafo é uma visualização de nomes, caminhos e wikilinks do acervo local. O
RAG é o processo de buscar conteúdo autorizado para uma pergunta e fornecê-lo
ao modelo com sua fonte. O portal já implementa uma primeira versão desse
processo para documentos da tabela `knowledge_documents`. Não foi identificada
uma sincronização automática entre toda a árvore local e essa tabela.

O maior retorno agora tende a vir de curadoria e integração do conhecimento,
seguido de testes com perguntas reais. Polir a visualização do grafo pode
continuar como trabalho separado.

## Inventário observado

| Área | Evidência |
|---|---|
| Grafo local | 2.724 nós: 22 pastas de topo, 500 subpastas, 2.201 documentos e 1 raiz. Há 159 wikilinks e 6 alvos ausentes. |
| Distribuição | `07 - Projetos Internos` tem 850 nós; `nucleomajor`, 794; `05 - Clientes Ativos`, 788. Juntos são cerca de 89% do índice. O grafo inclui código e artefatos técnicos, além de material de conhecimento. |
| Tipos de arquivo | Entre os documentos indexados há 310 Markdown, 259 JavaScript, 188 TypeScript, 155 Python, 151 `.pyc`, 148 PNG e 43 PDF. Contagem do índice, não do disco inteiro. |
| Clientes | Há 11 pastas diretas em `05 - Clientes Ativos`. Nove têm `STATUS.md`; em sete desses nove, `Situação atual` ainda está como `(a preencher)`. Duas não têm `STATUS.md`. |
| Projetos internos | Há 10 pastas diretas. Quatro têm `STATUS.md` e oito têm `README.md`. Essas contagens são do disco em 18/09/2026. |
| Relações | 154 dos 159 wikilinks partem da área de clientes. O restante do acervo tem poucas relações explícitas. |

Os números não medem qualidade do conteúdo. Como amostras, o `STATUS.md` de
Adriani/Ademicon contém serviço, responsáveis, situação e links para planos; o
de DroneAgro contém escopo e links, mas ainda tem campos por preencher. Outros
sete `STATUS.md` de clientes conservam a situação genérica. Assim, possuir
arquivos não equivale a dar ao agente um estado confiável do cliente.

## Caminho atual da informação

```text
Pastas locais -> script do grafo -> JSON com nomes/caminhos -> mapa visual

Documento criado/publicado no portal -> knowledge_documents
    -> busca textual por pergunta e permissão -> trechos para o assistente
    -> leitura do documento completo sob demanda
```

O grafo (`scripts/gerar-grafo.mjs`) varre a árvore local e lê Markdown para
extrair wikilinks. Ele não publica o conteúdo dos arquivos na base do portal.
Seu JSON inclui nomes de arquivos potencialmente sensíveis e o caminho absoluto
da máquina; esse arquivo não deve ser publicado como está.

No portal, `src/knowledgeSearch.mjs` transforma a pergunta em busca textual;
a função SQL `nucleo_web_knowledge_search` devolve até cinco resultados, e o
servidor injeta os três melhores trechos de até 900 caracteres. A ferramenta
`ler_documento` consulta o documento selecionado sob demanda. Há escopo por
organização, pessoal e público externo, com publicação e coleção para
conteúdo de clientes. Isso é uma base útil, mas não equivale a busca semântica
em todo o acervo local nem prova cobertura da operação real.

## Lacunas prioritárias

1. **Cobertura desconhecida:** falta comparar os documentos publicados em
   `knowledge_documents` com os documentos de referência das pastas locais.
   Não inferir cobertura a partir da existência de uma pasta ou do grafo.
2. **Estado incompleto:** sete clientes com `Situação atual` genérica podem
   produzir respostas desatualizadas ou vazias, mesmo com busca funcionando.
3. **Seleção do material:** código, builds, cópias, arquivos temporários e
   documentos sensíveis aparecem no índice visual. Uma fonte para RAG precisa
   de seleção explícita, público, responsável e revisão.
4. **Busca e avaliação:** a implementação atual usa busca textual do Postgres.
   Antes de mudar de tecnologia, medir se ela encontra os documentos certos
   para perguntas reais, se a resposta cita a fonte e se admite ausência.
5. **Trabalho entre agentes:** o contrato de conhecimento existe, mas a
   documentação local de múltiplos agentes contém seções de estado
   contraditórias. Não pressupor que roteamento entre vários agentes esteja
   ativo sem verificar a implantação.
6. **Separação entre clientes internos:** a busca examinada filtra por
   organização, escopo pessoal e audiência. Não identifiquei nela um filtro de
   leitura por cliente para membros da mesma organização. Se a equipe precisar
   desse isolamento, ele deve ser definido e testado antes de importar
   documentos de todos os clientes.

## Onde isso agrega valor

| Uso | Benefício esperado | Limite de acesso |
|---|---|---|
| Preparar reunião ou entrega | Recuperar estado, decisões, pendências e documentos do cliente com fontes. | Equipe autorizada; isolamento interno por cliente ainda precisa ser definido. |
| Atendimento ao cliente | Responder perguntas repetidas com informações aprovadas e encaminhar o que não estiver documentado. | Somente material publicado para público externo e coleção correta. |
| Consistência entre agentes | Um agente registra decisão; outro encontra a versão atual e sua origem. | Escrita com revisão e trilha de versão. |
| Reuso de aprendizados | Transformar experiência de um projeto em playbook para outros. | Curadoria e remoção de dados próprios do cliente antes de compartilhar. |

## Piloto recomendado

1. Escolher um cliente com documentação mais completa, como
   Adriani/Ademicon, para um piloto **interno**, sem exposição ao cliente.
2. Definir 15 a 20 perguntas reais da equipe: estado atual, próxima entrega,
   responsáveis, decisões, regras de marca e documentos relacionados.
3. Listar as fontes que devem responder a cada pergunta. Corrigir primeiro o
   `STATUS.md` e os documentos canônicos; separar rascunhos e segredos.
4. Comparar essa lista com o que está publicado na base de conhecimento do
   portal, usando uma conta autorizada. Publicar somente o material aprovado.
5. Executar as perguntas no assistente. Registrar: documento correto
   encontrado, resposta sustentada pela fonte, informação ausente reconhecida,
   tempo para obter resposta e qualquer vazamento entre públicos.
6. Só depois testar um conjunto pequeno de perguntas externas com documentos
   específicos para clientes e coleções publicadas corretamente.

Critério de sucesso sugerido para o piloto: pelo menos 80% das perguntas
internas recuperam a fonte esperada; nenhuma resposta externa usa documento
interno; toda resposta factual importante apresenta sua origem; as falhas são
registradas para correção. Esses são alvos de piloto, não métricas já medidas.

## Decisão sugerida

Tratar o grafo como mapa e diagnóstico do acervo. Tratar a base de
conhecimento do portal como a porta de leitura dos agentes. Priorizar
qualidade dos documentos, cobertura, permissões e avaliação com perguntas
reais antes de investir em um grafo visual mais sofisticado ou trocar a busca
textual por embeddings.

## Fontes locais examinadas

- `../../LEIA-ME.md` (estrutura e regras do acervo)
- `../../07 - Projetos Internos/Grafo Núcleo Major/README.md`
- `../../07 - Projetos Internos/Grafo Núcleo Major/scripts/gerar-grafo.mjs`
- `docs/FLOW-MAP.md`
- `src/knowledgeSearch.mjs`
- `apps/emyleads/src/web/knowledgeProvider.js`
- `docs/specs/SPEC-EXTERNAL-PILOT.md`
- `docs/intelligence/CONTINUACAO-MULTI-AGENT.md`
