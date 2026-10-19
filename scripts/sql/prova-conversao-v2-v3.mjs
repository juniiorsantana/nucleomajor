// Prova da conversão v2 → v3 da Etapa 11 num Postgres embutido (PGlite).
// Banco em memória, nada de produção.
//
// Harness + TODAS as migrations reais. Grava os fluxos de
// `apps/emyleads/src/domain/casosDeConversaoV3.json` numa empresa, exporta com
// `scripts/fluxos/exportar-fluxos-da-empresa.sql`, gera o SQL com
// `scripts/fluxos/converter-v2-para-v3.mjs` e roda:
//
//   1. o ensaio relata e não grava nada;
//   2. a conversão de verdade grava só o que o conversor puro aceitou, igual
//      ao que ele calculou, e o banco aceita cada um (`flow_validate`);
//   3. a versão anterior fica em chatbot_versions (backup);
//   4. colar de novo não muda nada (idempotente);
//   5. o desfazer (ensaio e de verdade) volta ao v2 exportado;
//   6. as travas: conexão que não roda fluxo, fluxo mudado depois da
//      exportação, empresa que perdeu a função `chatbots`.
//
//   mkdir prova && cd prova && npm init -y && npm i @electric-sql/pglite@0.5.8
//   node <repo>/scripts/sql/prova-conversao-v2-v3.mjs <repo>   (rodar de dentro da pasta da prova)
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = process.argv[2];
if (!REPO) throw new Error("uso: node prova-conversao-v2-v3.mjs <repo>");
const ler = (rel) => readFileSync(`${REPO}/${rel}`, "utf8").replace(/\r/g, "");
const { gerarSqlDeConversao } = await import(pathToFileURL(`${REPO}/scripts/fluxos/converter-v2-para-v3.mjs`).href);
const { converterParaV3 } = await import(pathToFileURL(`${REPO}/apps/emyleads/src/domain/conversaoV3.js`).href);
const CASOS = JSON.parse(ler("apps/emyleads/src/domain/casosDeConversaoV3.json"));

const falhas = [];
const passou = [];
const confere = (nome, cond, detalhe = "") => (cond ? passou : falhas).push(`${nome}${detalhe ? " — " + detalhe : ""}`);

const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
await db.exec(ler("scripts/sql/harness-supabase-minimo.sql"));
await db.exec(`
  alter table auth.users add column if not exists email_confirmed_at timestamptz;
  alter table auth.users add column if not exists last_sign_in_at timestamptz;
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
`);
for (const f of readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(ler(`supabase/migrations/${f}`));
}

async function como(claims, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [claims?.sub || "", JSON.stringify(claims || { role: "anon" })],
    );
    await tx.exec(`set local role ${claims ? "authenticated" : "anon"}`);
    return tx.query(sql, params);
  });
}
const usuario = (sub) => ({ sub, role: "authenticated" });
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0];

// Roda um SQL do dono como o SQL Editor: as mensagens (NOTICE) e o erro final.
async function colar(sql) {
  const avisos = [];
  try {
    await db.exec(sql, { onNotice: (aviso) => avisos.push(aviso.message) });
    return { erro: "", avisos };
  } catch (e) {
    await db.exec("rollback");
    return { erro: String(e.message || e), avisos };
  }
}
const deVerdade = (sql) => sql.replace("ensaio constant boolean := true;", "ensaio constant boolean := false;");

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'cmo@majorhub.com.br', now());
  insert into public.platform_admins (user_id) values ('${ADMIN}') on conflict do nothing;
`);
async function empresa(nome, plano, { executor = true } = {}) {
  const dono = randomUUID();
  const robo = randomUUID();
  const conexao = randomUUID();
  const email = `${dono}@exemplo.invalido`;
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())",
    [dono, email, robo, `robot+${robo}@invalid.emyleads.local`]);
  const codigo = (await como(usuario(ADMIN), "select * from public.issue_onboarding_access($1, $2, 7)", [email, plano])).rows[0].access_code;
  const org = (await como(usuario(dono), "select public.create_organization($1, $2) as id", [nome, codigo])).rows[0].id;
  await db.query("insert into public.whatsapp_connections (id, organization_id, name) values ($1, $2, 'WhatsApp')", [conexao, org]);
  await db.query("insert into public.connection_robot_credentials (connection_id, organization_id, auth_user_id) values ($1, $2, $3)", [conexao, org, robo]);
  const claims = { sub: robo, role: "authenticated", app_metadata: { is_robot: "true", organization_id: org, connection_id: conexao } };
  await como(claims, "select public.nucleo_runtime_heartbeat($1::jsonb)", [JSON.stringify({
    instanceId: randomUUID(), bridge: "online", whatsapp: "connected", assistant: "online", chatbot: "online",
    flowRuntime: executor ? "online" : "not_configured",
  })]);
  return { org, dono };
}
const grava = async ({ org, dono }, nome, definicao) => {
  const id = randomUUID();
  await db.query("insert into public.chatbot_definitions(id,organization_id,name,created_by,updated_by,definition) values($1,$2,$3,$4,$4,$5::jsonb)",
    [id, org, nome, dono, JSON.stringify(definicao)]);
  return id;
};
const exportar = async (org) =>
  (await um(ler("scripts/fluxos/exportar-fluxos-da-empresa.sql").replace("00000000-0000-0000-0000-000000000000", org))).exportacao;
const definicaoDe = async (id) => (await um("select definition from public.chatbot_definitions where id=$1", [id])).definition;
const versaoDe = async (id) => Number((await um("select version from public.chatbot_definitions where id=$1", [id])).version);
const igual = (a, b) => JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object") return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, ordenar(valor[k])]));
  return valor;
}

// ---------------------------------------------------------- a empresa Base
const base = await empresa("Clínica Base", "base");
const ids = {};
for (const caso of CASOS.filter((c) => !c.recursos)) ids[caso.nome] = await grava(base, caso.nome, caso.definicao);
const exportacao = await exportar(base.org);
confere("exportação: todos os fluxos, com as funções da empresa",
  exportacao.fluxos.length === Object.keys(ids).length && exportacao.recursos.chatbots === true && exportacao.recursos.ai_customer === false);

const { relatorio, converter, desfazer } = gerarSqlDeConversao(exportacao);
const aceitos = CASOS.filter((c) => !c.recursos && c.esperado === "convertido").map((c) => c.nome);
confere("o gerador decide como o conversor puro",
  relatorio.every((item) => item.estado === CASOS.find((c) => c.nome === item.nome).esperado), JSON.stringify(relatorio.map((r) => r.estado)));

const retrato = async () => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([n, id]) => [n, { def: await definicaoDe(id), v: await versaoDe(id) }])));
const antes = await retrato();

// 1. Ensaio
const ensaio = await colar(converter);
confere("1. o ensaio termina com o erro proposital", /ENSAIO: nada gravado\. Seriam convertidos 3, já estavam 0, pulados 0/.test(ensaio.erro), ensaio.erro);
confere("1. e relata cada fluxo", ensaio.avisos.filter((a) => a.startsWith("convertido:")).length === 3, ensaio.avisos.join(" | "));
confere("1. nada mudou no banco", igual(await retrato(), antes));

// 2. De verdade
const gravou = await colar(deVerdade(converter));
confere("2. a conversão de verdade passa", gravou.erro === "", gravou.erro);
for (const caso of CASOS.filter((c) => !c.recursos)) {
  const def = await definicaoDe(ids[caso.nome]);
  if (aceitos.includes(caso.nome)) {
    const esperado = converterParaV3(caso.definicao).definicao;
    confere(`2. "${caso.nome}" virou o v3 calculado`, igual(def, esperado));
    const validacao = await db.query("select private.flow_validate($1::jsonb, $2)", [JSON.stringify(def), base.org])
      .then(() => ({ ok: true }), (e) => ({ ok: false, e: e.message }));
    confere(`2. "${caso.nome}" passa em flow_validate`, validacao.ok !== false, validacao.e || "");
    // 3. Backup
    const guardada = await um("select definition from public.chatbot_versions where chatbot_id=$1 and version=$2", [ids[caso.nome], antes[caso.nome].v]);
    confere(`3. "${caso.nome}" tem o v2 em chatbot_versions`, guardada && igual(guardada.definition, antes[caso.nome].def));
  } else {
    confere(`2. "${caso.nome}" ficou intocado`, igual(def, antes[caso.nome].def) && (await versaoDe(ids[caso.nome])) === antes[caso.nome].v);
  }
}

// 4. Idempotente
const depoisDeConverter = await retrato();
const deNovo = await colar(deVerdade(converter));
confere("4. colar de novo passa", deNovo.erro === "" && deNovo.avisos.filter((a) => a.startsWith("já convertido")).length === 3, deNovo.erro || deNovo.avisos.join(" | "));
confere("4. e não muda versão nenhuma", igual(await retrato(), depoisDeConverter));

// 5. Desfazer
const ensaioDesfazer = await colar(desfazer);
confere("5. o ensaio do desfazer não grava", /ENSAIO: nada gravado\. Voltariam 3/.test(ensaioDesfazer.erro) && igual(await retrato(), depoisDeConverter), ensaioDesfazer.erro);
const desfez = await colar(deVerdade(desfazer));
confere("5. o desfazer de verdade passa", desfez.erro === "", desfez.erro);
for (const nome of aceitos) confere(`5. "${nome}" voltou ao v2 exportado`, igual(await definicaoDe(ids[nome]), antes[nome].def));
const desfazDeNovo = await colar(deVerdade(desfazer));
confere("5. desfazer de novo não muda nada", desfazDeNovo.erro === "" && desfazDeNovo.avisos.filter((a) => a.startsWith("já estava")).length === 3, desfazDeNovo.erro);

// 6a. Fluxo mudado depois da exportação: pulado, não sobrescrito.
const nomeMudado = aceitos[0];
await db.query("update public.chatbot_definitions set definition = jsonb_set(definition, '{condicoes}', '[{\"tipo\":\"primeira_conversa\"},{\"tipo\":\"primeira_conversa\"}]') where id=$1", [ids[nomeMudado]]);
const mudado = await definicaoDe(ids[nomeMudado]);
const comMudanca = await colar(deVerdade(converter));
confere("6. fluxo mudado depois da exportação é pulado", comMudanca.avisos.some((a) => a.includes("mudou desde a exportação")) && igual(await definicaoDe(ids[nomeMudado]), mudado),
  comMudanca.avisos.join(" | "));

// 6b. Conexão sem executor: o ensaio avisa, a conversão de verdade para.
const semExecutor = await empresa("Sem executor", "base", { executor: false });
const fluxoSem = await grava(semExecutor, "Linear", CASOS[0].definicao);
const sqlSem = gerarSqlDeConversao(await exportar(semExecutor.org)).converter;
const ensaioSem = await colar(sqlSem);
confere("6. sem executor, o ensaio avisa e segue", ensaioSem.avisos.some((a) => a.includes("não diz que roda fluxo")) && /Seriam convertidos 1/.test(ensaioSem.erro), ensaioSem.erro);
const verdadeSem = await colar(deVerdade(sqlSem));
confere("6. sem executor, a conversão de verdade para", /Ligue o executor de fluxos/.test(verdadeSem.erro) && igual(await definicaoDe(fluxoSem), CASOS[0].definicao), verdadeSem.erro);

// 6c. Empresa que perdeu `chatbots` depois da exportação: o banco pula.
const perdeu = await empresa("Perdeu chatbots", "base");
const fluxoPerdeu = await grava(perdeu, "Linear", CASOS[0].definicao);
const sqlPerdeu = gerarSqlDeConversao(await exportar(perdeu.org)).converter;
await como(usuario(ADMIN), "select public.platform_entitlement_set($1, 'chatbots', false, null, null, 'prova', true)", [perdeu.org]);
const verdadePerdeu = await colar(deVerdade(sqlPerdeu));
confere("6. sem chatbots no banco, o fluxo é pulado pelo plano", verdadePerdeu.avisos.some((a) => a.includes("plano não libera")) && igual(await definicaoDe(fluxoPerdeu), CASOS[0].definicao),
  verdadePerdeu.erro || verdadePerdeu.avisos.join(" | "));
// E o conversor puro já recusa quando a exportação diz que não há chatbots.
const casoPlano = CASOS.find((c) => c.recursos);
confere("6. com a exportação sem chatbots, nem entra no SQL",
  gerarSqlDeConversao({ ...(await exportar(perdeu.org)) }).relatorio[0].motivo === casoPlano.motivo);

console.log(passou.map((p) => `PASS ${p}`).join("\n"));
if (falhas.length) {
  console.log(falhas.map((f) => `FALHA ${f}`).join("\n"));
  console.log(`\n${passou.length} conferências, ${falhas.length} falhas`);
  process.exit(1);
}
console.log(`\n${passou.length} conferências, 0 falhas`);
