# Estratégia de testes

## Pirâmide

1. domínio e serialização;
2. providers e contratos;
3. migrations estáticas e SQL comportamental;
4. componentes e rotas;
5. build por plataforma;
6. testes operacionais controlados.

## Portal

```bash
npm run test:server
npm run test:app
npm run check
```

`npm run check` valida sintaxe do servidor e produz o build web. Mudanças na
extensão também exigem `npm run build:extension`.

## Supabase

Arquivos `supabase/test_*.py` verificam invariantes sem banco local. Arquivos
`supabase/tests/*.sql` cobrem RLS e comportamento e devem rodar contra um banco
de teste compatível.

Teste de segurança mínimo usa duas organizações e três papéis. Teste feliz em
uma única organização não comprova isolamento.

## Runtime

No repositório do runtime:

```bash
cd whatsapp-assistant
python -m unittest discover -s . -p "test*.py"
```

Também execute os testes Go e do MCP antes de publicar o pacote da VPS.

## Visual

Validar desktop, tablet e celular, além de:

- teclado e foco visível;
- estados vazio, carregando, offline e sem permissão;
- texto longo e nomes longos;
- movimento reduzido;
- ausência de erros no console.

## Aceite de integração

- portal e extensão retornam contratos equivalentes;
- operador e cliente entram em fluxos distintos;
- agenda respeita confirmação e idempotência;
- handoff silencia a IA;
- reiniciar a VPS preserva estado;
- logs não contêm segredo ou telefone completo.

Nenhum teste automatizado deve enviar mensagem real, criar cliente real ou
usar credenciais de produção sem uma etapa de aceite explicitamente marcada.

## Aceite H.5

O roteiro operacional, inclusive a ativação reversível das notificações e o
registro das dez jornadas em 48 horas, está em
`docs/MVP-ACCEPTANCE-H5.md`.
