# Playbook comercial: plano

O playbook é a régua comercial de cada empresa, escrita uma vez e usada em três
lugares: pelo agente que atende, pelo Jev que lê as conversas e pelo Claude da
análise do botão. Ele trabalha junto com o **soul** do agente, sem entrar nele.

Contexto: `docs/coordenador-jev/PLANO.md` (o coordenador e o framework
`major-v1`).

## Decisões (01/10/2026)

- **O playbook é da empresa**, um só, com versões. A oferta e os preços são os
  mesmos para todos os agentes; cada agente escolhe que parte usa (o SDR usa
  objeções e próximo passo de venda; o de suporte, outra parte).
- **Não entra no soul.** O soul é o jeito (quem o agente é, como fala); o
  playbook é procedimento (o que oferecer, como tratar objeção, qual o próximo
  passo). Motivos: o soul tem teto de 8000 caracteres e vai em toda mensagem;
  o Jev precisa de listas fechadas, e texto livre não as dá; repetir o
  procedimento nos dois cria instrução contraditória.
- **Os dois ficam na mesma tela do agente** (abas Soul e Playbook), guardados
  separados.
- **O playbook gera a habilidade sozinho.** Ninguém mais escreve o texto da
  habilidade comercial à mão: publicar o playbook gera uma versão nova dela.
- **O soul entra na régua do Jev.** A pergunta "tom da empresa" deixa de ser
  genérica e passa a ser "a empresa seguiu o jeito definido para este agente?",
  usando a linha de `assistant_profiles.tone`.

## O que o playbook contém

| Parte | Forma | Limite | Quem usa |
|---|---|---|---|
| **Oferta** | lista de itens: nome, preço, o que inclui | 20 itens | agente, Claude |
| **Cliente ideal** | quem atende e quem não atende, em frases curtas | 10 + 10 | agente, Jev (pergunta nova `perfil_ideal`), Claude |
| **Objeções** | chave, nome, resposta esperada | 12 | agente, Jev (opções de `objecao_principal`), Claude |
| **Próximos passos** | chave, nome, quando oferecer | 6 | agente, Jev (opções de `proximo_passo`), Claude |
| **Critérios próprios** | pergunta sim/não com o que conta como sim | 8 | Jev, Claude |
| **Etapas do funil** | lidas do funil da empresa (`stages`), não digitadas | — | Jev (`etapa_sugerida`) |

Cada parte fica com chave fixa (`preco`, `aula_experimental`…) para os números
gerais conseguirem somar mesmo quando o nome exibido muda.

## Como a empresa cria

1. **Modelo por segmento** (primeira versão): academia, clínica, estética,
   agência, imobiliária e "outro". O modelo traz objeções e próximos passos
   comuns do segmento; o dono apaga, corrige e completa.
2. **Revisão guiada:** tela "Playbook comercial" em Inteligência, uma seção por
   parte, com prévia do texto da habilidade que será gerada.
3. **Rascunho automático** (etapa 4): o dono cola site, tabela de preços ou
   roteiro de vendas; o Claude (2ª conta, fila da análise) lê isso junto com a
   base de conhecimento, o funil, as etiquetas e a habilidade atual, e devolve
   o playbook preenchido para revisar.
4. **Ajuste pelo uso** (etapa 5): quando muitas leituras caem em "outra"
   objeção ou "outro" próximo passo, a tela sugere acrescentar.

Só dono e admin editam e publicam. A equipe vê.

## Para onde ele vai

```
              ┌──────────────── tela do agente ─────────────────┐
              │  Soul (o jeito)            Playbook (o que vender) │
              └───────┬──────────────────────────┬───────────────┘
                      │                          │ publicar
   tone (1 linha) ────┤                          ├─────────────────────────────┐
                      ▼                          ▼                             ▼
          prompt do agente            habilidade gerada            Jev: perguntas da empresa
          (já existe, 13C)            "Playbook comercial"         + "seguiu o jeito do agente?"
                                      (skill_definitions,                      │
                                       versão nova a cada                      ▼
                                       publicação)                 Claude da análise do botão
```

- **Agente:** a habilidade gerada é uma `skill_definitions` da empresa
  (`slug = playbook-comercial`), com `spec.instructionsMarkdown` montado do
  playbook (até 20000 caracteres). Cada agente liga a habilidade e escolhe as
  partes em `assistant_profile_skills.configuration` (`{"partes": ["oferta",
  "objecoes", "proximos_passos"]}`). O runtime já entrega habilidades no
  prompt. **A conferir na etapa 1:** o filtro por partes. O caminho mais
  provável é o banco montar o texto só com as partes ligadas na hora de
  resolver o contexto do agente, sem mexer no runtime; se não couber, a
  alternativa é gerar uma habilidade por parte.
- **Jev:** `nucleo_insights_pending` passa a devolver, junto com cada
  conversa, a versão do playbook, as opções da empresa e o `tone` do agente da
  conversa (`conversation_intelligence_contexts.assistant_profile_id`). O
  coordenador monta as perguntas como `major-v1` + playbook: opções de
  objeção e próximo passo da empresa, os critérios próprios como perguntas
  sim/não e a pergunta de tom com o jeito do agente. A versão gravada vira
  `major-v1+pb3`.
- **Claude:** recebe o playbook inteiro como referência do que a empresa
  espera. Entra junto com o botão "Analisar conversa".

## Etapas

| # | Etapa | O que entrega |
|---|---|---|
| 1 | **Banco** | `organization_playbooks` (rascunho e publicado, `content jsonb` validado por limite) e `playbook_versions`; RPCs `playbook_save_draft` e `playbook_publish` (só dono/admin), que valida, grava a versão e gera a versão nova da habilidade `playbook-comercial` |
| 2 | **Portal** | Tela "Playbook comercial" com os modelos por segmento e a prévia; aba Playbook no agente com as partes que ele usa, ao lado do Soul |
| 3 | **Jev com o playbook** | `nucleo_insights_pending` devolve playbook e tom; `jev_framework` junta base + empresa; versão `major-v1+pbN` nas leituras |
| 4 | **Rascunho automático** | Job na fila da 2ª conta do Claude: lê o material colado e o que já existe no portal, devolve o playbook preenchido |
| 5 | **Sugestões pelo uso** | A tela mostra objeções e próximos passos que caem muito em "outra" e oferece acrescentar |

As etapas 1 a 3 entregam o playbook funcionando de ponta a ponta. A 4 e a 5
tornam ele mais fácil de criar e manter.

## Para a Major

A Major já tem uma habilidade comercial escrita à mão (venda de site e
tráfego, `docs/atendimento/instrucao-venda-site-e-trafego.md`). O primeiro
playbook nasce dela: a escada de perguntas vira objeções e próximos passos, e
a habilidade gerada substitui a manual quando for publicada. O soul atual não
muda.

## Riscos e limites

- **Prompt maior:** a habilidade gerada tem teto de 20000 caracteres, igual às
  outras. Cada agente leva só as partes que liga.
- **Perguntas demais para o Jev:** base (19) + critérios próprios (até 8) +
  tom = 28, abaixo do teto de 40 respostas por leitura que o banco aceita.
- **Mudar o playbook muda a régua:** por isso a versão vai em cada leitura, e
  os números gerais comparam só leituras da mesma versão, ou avisam a troca.
- **Chaves que somem:** apagar uma objeção não apaga as leituras antigas que a
  usaram; a chave fica marcada como arquivada.

## Em aberto

- Quais segmentos entram nos modelos da primeira versão.
- Se a habilidade gerada substitui de vez a manual da Major ou convive por um
  tempo (a recomendação é substituir, para não haver duas instruções de venda
  no mesmo prompt).
