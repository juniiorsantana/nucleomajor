# Roadmap — Núcleo Major na App Store e Google Play

**Base:** 02/10/2026. **Objetivo:** publicar um primeiro app para profissionais das organizações clientes nas duas lojas, com login, Conversas, Contatos, Tarefas e Agenda. A publicação depende da aprovação de cada loja.

## Ponto de partida e decisão

O produto já opera como portal React/Vite em `/app`, com Supabase Auth, API Node e runtime na VPS (`README.md`, `docs/STATUS.md`, `docs/specs/SPEC-PRODUCT.md`). Há navegação e teste de layout mobile, mas **não há projeto iOS/Android ou pipeline de builds de loja neste repositório**. A extensão Chrome e o Bridge não serão embarcados no app; o mobile consumirá os serviços remotos do portal.

**Rota recomendada para a v1:** avaliar Capacitor sobre o React existente por uma semana e seguir com ele se login, navegação, uploads, anexos e acesso aos serviços funcionarem em aparelhos reais. O app precisa ter experiência ajustada para telefone, estados de rede e recursos úteis no contexto mobile; um simples invólucro do site traz risco de rejeição pela Apple. Se a prova falhar, decidir por interface React Native antes de iniciar o restante. O prazo abaixo assume que a prova passe.

## Entrega em 10 semanas (estimativa de trabalho, não promessa de aprovação)

| Quando | Marco e responsável sugerido | Entregável e critério de conclusão |
| --- | --- | --- |
| Semana 1 | Produto + engenharia | Fechar público, países, nome, identificadores dos pacotes, titularidade das contas Apple/Google e escopo da v1. Prova Capacitor em iPhone e Android: login Supabase, troca de organização, Conversas, Agenda, anexos e API funcionando. Decisão técnica registrada. |
| Semanas 2–3 | Engenharia + design | Criar projetos iOS/Android, ícones, splash, build assinado, ambientes e fluxo de atualização. Adaptar telas do escopo para área segura, teclado, toque, botão voltar Android, orientação e perda de conexão. Testar em aparelhos físicos. |
| Semanas 3–5 | Engenharia + produto | Fechar jornadas essenciais: autenticação e recuperação, Conversas, Contatos, Tarefas, Agenda e notificações **somente se** houver caso de uso e infraestrutura pronta. Validar isolamento entre organizações, permissões e anexos. Ocultar ou corrigir fluxos do portal que não funcionem no mobile. |
| Semanas 4–6 | Produto + jurídico/privacidade + engenharia | Publicar política de privacidade e suporte; mapear dados coletados por app, Supabase, API e SDKs. Implementar solicitação de exclusão de conta e dados, com caminho no app e página externa. Definir retenções necessárias. Revisar modelo de venda/assinatura e regras de pagamento antes de expor qualquer compra no app. |
| Semanas 6–7 | QA + engenharia | Teste de ponta a ponta em iPhone e Android: instalação limpa, sessão expirada, convite, permissões, rede instável, anexos, troca de organização, exclusão, acessibilidade básica e regressão web. Resolver bloqueadores; gerar build candidato. |
| Semanas 7–8 | Produto + marketing + responsável pelas contas | Preparar página nas lojas: descrição, capturas reais, ícone, classificação etária, contato, URL de privacidade, declarações de dados, instruções e conta de demonstração para revisores. Enviar beta no TestFlight e teste interno/fechado na Play. |
| Semanas 8–10 | Produto + QA + engenharia | Corrigir retorno dos testadores, fechar versão, enviar para análise, responder exigências das lojas e liberar gradualmente. Monitorar falhas, login e ações críticas nas primeiras 72 horas. |

**Caminho crítico:** titularidade das contas → prova técnica → app utilizável → privacidade/exclusão e materiais → beta → análise → publicação. Design, textos das lojas e mapeamento de dados podem andar em paralelo ao desenvolvimento.

## Regras das lojas que afetam este plano

- **Apple:** a interface deve oferecer utilidade adequada ao iPhone; conteúdo web pouco adaptado pode ser rejeitado pela diretriz 4.2. Fornecer acesso de demonstração para análise. Apps com criação de conta devem permitir iniciar a exclusão no app. Informar URL de privacidade e práticas de dados. Em outubro de 2026, builds enviados ao App Store Connect exigem Xcode 26 ou superior e SDK iOS 26 ou superior. [Análise da Apple](https://developer.apple.com/app-store/review/), [exclusão de conta](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [privacidade](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/), [SDK mínimo](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).
- **Google:** novos apps e atualizações submetidos desde 31/08/2026 precisam mirar Android 16/API 36 ou superior. Preencher Data safety, fornecer política de privacidade e acesso de revisão. Se houver criação de conta, disponibilizar exclusão no app e em página externa. Contas **pessoais** de desenvolvedor abertas após 13/11/2023 precisam de teste fechado com 12 participantes inscritos continuamente por 14 dias antes de solicitar acesso à produção; confirmar o tipo e a data da conta já na semana 1. [API alvo](https://developer.android.com/google/play/requirements/target-sdk), [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469), [exclusão](https://support.google.com/googleplay/android-developer/answer/13327111), [teste fechado](https://support.google.com/googleplay/android-developer/answer/14151465), [acesso de revisão](https://support.google.com/googleplay/android-developer/answer/15748846).
- **Comercial:** se o app for apenas acesso para equipes de organizações contratantes, documentar esse modelo antes da submissão. Compra de funcionalidades digitais por usuários finais pode exigir outro fluxo de pagamento. [Diretrizes da Apple, seção 3.1](https://developer.apple.com/app-store/review/guidelines/br/).

## Portões de decisão

1. **Fim da semana 1:** aprovar a rota Capacitor apenas com prova em ambos os sistemas; se falhar, reestimar arquitetura e prazo.
2. **Fim da semana 6:** entrar em beta apenas com política publicada, exclusão funcional, conta demo, testes de isolamento e nenhum fluxo crítico quebrado.
3. **Fim da semana 8:** submeter apenas após testes em aparelhos reais, ficha das lojas coerente com o app e responsável disponível para responder revisões.

**Faixa de prazo:** 8–10 semanas de execução com escopo controlado e contas prontas; reservar 2–4 semanas adicionais para mudanças pedidas pelas lojas ou para o teste fechado obrigatório da conta Google, caso ele não tenha começado a tempo. Notificações push, acesso offline amplo, editor de fluxos e configuração avançada ficam para uma versão posterior se não forem essenciais ao uso diário em telefone.

**Pendências para confirmar sem travar o início:** quem será o titular jurídico das contas; se já existem contas Apple Developer e Play Console e qual o tipo da conta Google; países de lançamento; cobrança dentro do app ou só contrato B2B; prioridade exata dos módulos da v1; pessoa responsável por privacidade e suporte. Até essas respostas, o plano assume Brasil, app gratuito para usuários de organizações contratantes e escopo operacional acima.
