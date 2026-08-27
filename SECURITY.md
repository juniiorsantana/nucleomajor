# Segurança

## Como reportar

Não abra issue pública com vulnerabilidade, credencial ou dados de cliente.
Reporte diretamente ao responsável técnico da Major e informe componente,
impacto, reprodução segura e evidências sem segredo completo.

## Segredos proibidos no Git

- Supabase `service_role` ou secret key;
- SMTP e senha de caixa postal;
- tokens do Bridge, gateway, notificações ou instalações;
- arquivos `.env` reais;
- sessão ou banco do WhatsApp;
- credencial renovável do robô;
- configuração autenticada do Claude;
- telefones e conversas reais em fixtures.

## Resposta a incidente

1. revogar antes de investigar profundamente;
2. impedir novos acessos;
3. rotacionar e reprovisionar;
4. identificar exposição em logs, artefatos e histórico;
5. corrigir e criar teste de regressão;
6. documentar causa, alcance e prevenção.

Nunca “corrija” apenas apagando o segredo do último commit: ele continua no
histórico. Considere a credencial comprometida e rotacione.

## Requisitos de mudança

- Auth e RLS exigem teste com duas organizações;
- função privilegiada usa menor privilégio e `search_path` seguro;
- entrada do modelo não define identidade ou tenant;
- logs mascaram identificadores pessoais;
- envio ou escrita usa confirmação e idempotência;
- integrações externas têm timeout e resposta segura.

## Dependências

Atualizações de WA-JS, Supabase, Vite, React, Go ou Python devem passar por
testes e build. Dependência comprometida ou sem manutenção deve ser removida ou
isolada; atualizar automaticamente produção não é permitido.
