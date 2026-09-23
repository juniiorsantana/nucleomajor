-- Fluxos com caminhos: a função entra no catálogo, desligada para todos.
--
-- O construtor de fluxo passa a oferecer condição no meio do caminho,
-- "Encerrar" e as saídas Sucesso/Falha da IA (canvas v3). Um fluxo assim só
-- roda onde o executor de fluxos está ligado na conexão da VPS
-- (NUCLEO_FLOW_RUNTIME=1); sem ele, a conversa cai para atendimento humano.
-- Por isso a função nasce desligada — regra do catálogo desde 20260924100000 —
-- e a Major liga, pelo painel da plataforma, só para quem tem o executor.
--
-- O portal lê a chave `fluxos_ramificados` exigindo `true` explícito
-- (Gestao.jsx → ChatbotEditor). Mudar o nome aqui exige mudar lá.
--
-- Pré-requisitos, ambos já aplicados em produção:
--   20260907010000_fluxos_execucao_persistida.sql (execução durável)
--   20260924100000_funcoes_e_limites_por_empresa.sql (catálogo)
--
-- Só insere uma linha no catálogo. Não liga nada para empresa nenhuma.
-- Aplicar pelo SQL Editor. Conferir depois com
-- scripts/sql/validar-fluxos-com-caminhos.sql.

begin;

insert into public.platform_features (key, kind, name, description, category, is_ai, sort_order)
values (
  'fluxos_ramificados',
  'feature',
  'Fluxos com caminhos',
  'Construtor de fluxo com condicao no meio do caminho, Encerrar e retorno da IA por Sucesso ou Falha. So funciona onde o executor de fluxos esta ligado na conexao da VPS.',
  'atendimento',
  false,
  55
)
on conflict (key) do nothing;

commit;
