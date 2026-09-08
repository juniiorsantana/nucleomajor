# Plano de melhoria das Conversas

Última atualização: **08/09/2026**  
Estado geral: **P0 e P1.1–P1.3 implementadas e verificadas**  
Próxima ação: **continuar P1/P2 conforme a lista de problemas da feature**

Este é o ponto de continuidade da feature. Use `[ ]` para não iniciado, `[-]`
para em andamento, `[x]` para concluído e verificado e `[!]` para bloqueado.
Antes de iniciar um item, registre responsável e data no final do arquivo.

## P0 — estabilidade e isolamento

- [x] **P0.1 Troca de organização:** estado antigo é ocultado imediatamente;
  respostas atrasadas de outra organização são descartadas.
- [x] **P0.2 Recuperação de leitura:** uma leitura bem-sucedida limpa o erro
  fatal anterior; falha transitória com lista carregada vira aviso.
- [x] **P0.3 Conciliação de envio:** retorno é correlacionado por `message_id`;
  mensagens já conhecidas são ignoradas e retornos iguais são consumidos um a um.
- [x] **P0.4 Comando demorado:** acompanhamento rápido dura 40 segundos e segue
  em intervalo reduzido até a validade de dez minutos da RPC.
- [x] **P0.5 Testes do hook:** troca de organização, resposta atrasada, polling,
  Realtime, desmontagem, repetição e concorrência estão cobertos.

## P1 — correções visíveis e locais

- [x] **P1.1 Abrir no fim:** controlar o container após renderizar o histórico;
  preservar posição quando o usuário estiver lendo acima.
- [x] **P1.2 Preservar nome de grupo:** não substituir nome válido por vazio e
  usar “Grupo sem nome” quando nunca houve nome conhecido.
- [x] **P1.3 Fotos de contatos:** ler `avatar_path`, assinar URLs em lote e usar
  iniciais como fallback.
- [ ] **P1.4 Baralho de modelos (fora do escopo atual):** usar no painel aberto
  o baralho atualizado. Não está relacionado às falhas de identidade, mídia ou
  rolagem listadas para esta rodada; pode ser priorizado depois.

## P2 — identidade de grupos e remetentes

- [!] **P2.1 Confirmar contrato externo:** obter `conversation_sync.py` e a
  origem do Bridge; esses arquivos não estão neste repositório.
- [ ] **P2.2 Definir contrato:** nome/foto do grupo e identidade reduzida do
  remetente, sem persistir JID sensível desnecessariamente.
- [ ] **P2.3 Persistir e proteger:** migration aditiva, índices, RLS por
  organização, compatibilidade e testes de isolamento.
- [ ] **P2.4 Renderizar remetente:** mapear o provider e usar `Bolha.autor`.
- [ ] **P2.5 Foto de grupo:** caminho privado, URL assinada e fallback.

## P3 — imagens e áudios

- [ ] **P3.1 ADR de mídia:** limites, formatos, retenção, miniaturas e remoção.
- [ ] **P3.2 Armazenamento:** bucket privado e RLS por organização; não guardar
  URL assinada, `blob:` ou base64 na tabela.
- [ ] **P3.3 Runtime:** upload idempotente e sincronização de caminho, MIME type,
  tamanho, duração e estado.
- [ ] **P3.4 Interface:** mídia sob demanda, retry, imagem responsiva e player
  acessível.
- [ ] **P3.5 Retenção:** excluir objetos e metadados vencidos após 90 dias.

## P4 — escala e acabamento

- [ ] **P4.1 Paginar conversas e contatos.**
- [ ] **P4.2 Paginar histórico com âncora e ordenação estável.**
- [ ] **P4.3 Completar estados de loading, falha e Realtime desconectado.**

## Regras de integração

1. A branch desta frente é `feature/conversas-p0`, criada de `origin/main` no
   commit `77ef3bf`; não houve push nem merge automático.
2. A Fase 14 trabalha em `feature/fase-14-handoff` e não altera os arquivos da
   P0. Antes de integrar, atualizar referências e revisar o diff das duas branches.
3. Não editar migrations aplicadas; banco novo entra em migration aditiva.
4. P2 e P3 só terminam com mudança coordenada no runtime externo.

## Evidências acumuladas

- `npm.cmd test --workspace @nucleomajor/emyleads`: **598/598 testes**.
- Testes focados de Conversas: **46/46 testes**.
- Rolagem da conversa: **4/4 comportamentos** cobertos.
- Fotos de contatos: assinatura privada em lote e fallback visual cobertos por
  **4 testes** no provider/componente; nenhuma migration nova foi necessária.
- Migrations Supabase: **129/129 testes**; proteção de nome: **3/3 testes**.
- `npm.cmd run check`: verificações Node e build Vite de produção aprovados.
- `git diff --check`: aprovado.
- Lint runner local: não há linter configurado para esse recorte; o script
  encerrou com sucesso e o build fez a validação sintática do frontend.

## Registro de andamento

| Data | Responsável | Item | Estado | Evidência / observação |
|---|---|---|---|---|
| 08/09/2026 | Codex | P0.1–P0.5 | concluído | Branch isolada; testes e build verdes; sem push. |
| 08/09/2026 | Codex | P1.1 | concluído | Abertura no fim e leitura acima preservada; 4/4 testes. |
| 08/09/2026 | Codex | P1.2 | concluído | Migration aditiva + fallback; não aplicada no banco remoto. |
| 08/09/2026 | Codex | P1.3 | concluído | Bucket privado existente; assinatura em lote por 1 hora; falha mantém iniciais; 598/598 testes. |
| 08/09/2026 | — | P1.4 | posterior | Mensagens rápidas; pendência independente, não bloqueia a publicação desta frente. |
