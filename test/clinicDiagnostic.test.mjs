import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, questions, qualify } from '../public/clinicas/raio-x/diagnostic.js';
import { clinicLeadConfig, processClinicDiagnostic, resumoParaAEquipe, tokenDerivado } from '../src/clinicDiagnostic.mjs';
const best = [2,2,0,0,2,0,3,0,3,3,3,0];
const worst = [0,2,1,1,0,3,0,3,0,0,0,3];
test('qualificação exige orçamento confirmado', () => {
  assert.equal(questions.length,12);
  assert.equal(qualify([0,0,0,3]).eligible,true);
  assert.equal(qualify([3,3,1,2]).eligible,true);
  assert.equal(qualify([0,2,2,0]).reason,'budget-unconfirmed');
  assert.equal(qualify([0,2,3,0]).reason,'budget-unavailable');
  assert.throws(()=>qualify([0,0,null,0]));
  for (const budget of [2,3]) { const a=[...best]; a[2]=budget; assert.throws(()=>diagnose(a),/disponibilidade confirmada/); }
});
test('somente oito respostas operacionais pontuam, duas por área', () => {
  const a=[...best]; a[7]=3;
  const report=diagnose(a); assert.equal(report.score,88); assert.equal(report.scores[1].score,50); assert.equal(report.priorities[0].area,'Atendimento');
  a.splice(0,4,0,0,1,3); const changed=diagnose(a); assert.equal(changed.score,report.score); assert.deepEqual(changed.priorities,report.priorities);
  assert.equal(diagnose(worst).score,0); assert.equal(diagnose(best).score,100); assert.equal(diagnose(best).priorities.length,0);
  assert.throws(()=>diagnose(Array(20).fill(0))); assert.throws(()=>diagnose(Array(12).fill(null))); assert.throws(()=>diagnose(new Array(12)));
});
test('conclusão cruza anúncios, rastreamento, retornos e decisão', () => {
  const a=[...worst]; const report=diagnose(a); assert.match(report.conclusion,/já investe em anúncios/); assert.match(report.conclusion,/lacunas no acompanhamento/); assert.match(report.budget,/já investe/); assert.match(report.decision,/decisão é compartilhada/);
  a[5]=0; a[11]=0; assert.match(diagnose(a).conclusion,/algum acompanhamento dos resultados/);
  a[7]=0; a[8]=3; assert.doesNotMatch(diagnose(a).conclusion,/lacunas nos retornos/);
  a[1]=0; a[2]=1; const noAds=diagnose(a); assert.match(noAds.conclusion,/ainda não investe/); assert.ok(noAds.observations.some(text=>text.includes('diferença')));
});
const token='a'.repeat(64);
function harness({ fail=null, emailTo='' }={}) {
  const calls=[], emails=[];
  return { calls, emails, run: body => processClinicDiagnostic({ body, config:{ token, emailTo },
    receive: async payload => { calls.push(payload); if (fail) throw new Error(fail); },
    sendEmail: async message => { emails.push(message); } }) };
}
const payload={ name:'Ana Souza', clinic:'Clínica Exemplo', phone:'(65) 99999-1234', consent:true, answers:[...worst], utm_campaign:'raio-x' };

test('sem token da campanha a rota fica desligada e nada é gravado', async () => {
  const calls=[];
  const outcome=await processClinicDiagnostic({ body:payload, config:{ token:'', emailTo:'' }, receive: async p => calls.push(p) });
  assert.equal(outcome.status,503); assert.equal(calls.length,0);
});

test('orçamento recusado, sem consentimento ou telefone inválido não chegam à campanha', async () => {
  const h=harness();
  assert.equal((await h.run({...payload,consent:false})).status,400);
  assert.equal((await h.run({...payload,phone:'1099999999'})).status,400);
  const blocked=[...best]; blocked[2]=3;
  assert.equal((await h.run({...payload,answers:blocked})).status,400);
  assert.equal(h.calls.length,0);
  assert.deepEqual((await h.run({...payload,website:'robo'})).body,{received:true}); assert.equal(h.calls.length,0);
});

test('o lead entra pela campanha com o resumo que a equipe recebe', async () => {
  const h=harness({ emailTo:'equipe@example.com' });
  const outcome=await h.run({...payload,score:100});
  assert.equal(outcome.status,200); assert.equal(outcome.body.diagnostic.score,0);
  assert.equal(h.calls.length,1);
  const { intake_token, lead }=h.calls[0];
  assert.equal(intake_token,token); assert.equal(lead.telefone,'65999991234'); assert.equal(lead.consentimento,true);
  assert.equal(lead.diagnostico.notaGeral,0); assert.equal(lead.diagnostico.faixa,'A estruturar');
  assert.deepEqual(lead.diagnostico.categorias.map(c=>c.nome),['Captação','Atendimento','Conversão','Gestão']);
  assert.ok(lead.diagnostico.falhas.length>=1 && lead.diagnostico.falhas.every(f=>f.length<=90));
  assert.ok(lead.diagnostico.servico.length<=60); assert.match(lead.diagnostico.servico,/Clínica Exemplo · Odontologia/);
  assert.equal(h.emails.length,1); assert.ok(h.emails[0].text.includes('https://wa.me/5565999991234')); assert.ok(h.emails[0].text.includes('R$ 50 por dia')); assert.ok(h.emails[0].text.includes('utm_campaign: raio-x'));
});

test('as lacunas do aviso seguem as prioridades do diagnóstico', () => {
  const a=[...best]; a[6]=0; a[8]=0;
  const resumo=resumoParaAEquipe({ clinica:'X', answers:a }, diagnose(a));
  assert.deepEqual(resumo.falhas,['tempo de resposta','retorno pós-avaliação']);
});

test('falha da campanha não libera o diagnóstico; falha do e-mail não tira o diagnóstico', async () => {
  const broken=harness({ fail:'boom' });
  const failure=await broken.run(payload); assert.equal(failure.status,502); assert.equal(failure.body.diagnostic,undefined);
  assert.equal((await harness({ fail:'too many leads in the last hour' }).run(payload)).status,429);
  const calls=[];
  const ok=await processClinicDiagnostic({ body:payload, config:{ token, emailTo:'equipe@example.com' }, receive: async p => calls.push(p), sendEmail: async () => { throw new Error('SMTP'); } });
  assert.equal(ok.status,200); assert.ok(ok.body.diagnostic);
});

test('o token da campanha é derivado do token da Planos do Site, igual ao SQL', () => {
  // Conferido contra o Postgres de produção em 06/10/2026 com o mesmo valor de teste.
  assert.equal(tokenDerivado('b'.repeat(64)),'11b5d42d3915737f5222429548172cc14892cec0b392f8ce7d44ae2ecd8a6dd9');
  assert.equal(clinicLeadConfig({ NUCLEO_LEAD_TOKEN:'B'.repeat(64) }).token,tokenDerivado('b'.repeat(64)));
  assert.equal(clinicLeadConfig({ NUCLEO_LEAD_TOKEN:'b'.repeat(64), NUCLEO_CLINICAS_LEAD_TOKEN:'c'.repeat(64) }).token,'c'.repeat(64));
  assert.equal(clinicLeadConfig({}).token,'');
  assert.equal(clinicLeadConfig({ NUCLEO_LEAD_TOKEN:'curto' }).token,'');
});

test('só as páginas de /clinicas/ liberam o Pixel da Meta na CSP', async t => {
  const { createServer } = await import('../src/server.mjs');
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const csp = async path => (await fetch(`http://127.0.0.1:${server.address().port}${path}`)).headers.get('content-security-policy');
  assert.match(await csp('/clinicas'), /script-src[^;]*https:\/\/connect\.facebook\.net/);
  assert.match(await csp('/clinicas/raio-x/pixel.js'), /connect\.facebook\.net/);
  assert.doesNotMatch(await csp('/privacidade'), /facebook/);
  assert.doesNotMatch(await csp('/'), /facebook/);
});
