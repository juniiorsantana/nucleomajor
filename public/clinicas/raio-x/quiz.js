import { questions, areas, diagnose, qualify } from './diagnostic.js';
const $ = id => document.getElementById(id);
const storageKey = 'major-raio-x-v3';
let index = 0, answers = Array(questions.length).fill(null), report;
try { const saved = JSON.parse(sessionStorage.getItem(storageKey)); if (Array.isArray(saved) && saved.length === questions.length && saved.every(v => v === null || (Number.isInteger(v) && v >= 0 && v <= 3))) answers = saved; } catch {}
function show(id, focus) { for (const section of ['intro','quiz','qualification-end','preview','result']) $(section).hidden = section !== id; if (focus) $(focus).focus(); window.scrollTo({ top: 0, behavior: 'instant' }); }
function checkQualification() {
  const result = qualify(answers);
  if (result.eligible) return true;
  answers.fill(null, 4);
  try { sessionStorage.setItem(storageKey, JSON.stringify(answers)); } catch {}
  $('qualification-message').textContent = result.reason === 'budget-unavailable'
    ? 'Você indicou que precisa de um investimento menor. Este fluxo considera uma disponibilidade de aproximadamente R$ 1.500 por mês para anúncios, por isso vamos encerrar por aqui. Neste momento, vale organizar os contatos, acompanhar os retornos e medir os canais que sua clínica já utiliza.'
    : 'Você prefere entender a estratégia antes de decidir o orçamento. Este fluxo considera disponibilidade confirmada de aproximadamente R$ 1.500 por mês para anúncios. Como isso ainda não está definido, vamos encerrar por aqui. Você pode retomar quando tiver clareza sobre o orçamento disponível.';
  show('qualification-end', 'qualification-title'); return false;
}
function render() {
  if (index >= 4 && !checkQualification()) return;
  const q = questions[index]; $('category').textContent = index < 4 ? 'Sobre sua clínica' : areas[Math.floor((index - 4) / 2)]; $('counter').textContent = `${index + 1} de ${questions.length}`; $('progress').max = questions.length; $('progress').value = answers.filter(v => v !== null).length; $('question-title').textContent = q.title;
  $('question-context').textContent = q.context || ''; $('question-context').hidden = !q.context;
  $('options').replaceChildren();
  q.options.forEach((text, value) => { const label = document.createElement('label'); label.className = 'option'; const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'answer'; radio.value = value; radio.checked = answers[index] === value; radio.addEventListener('change', () => { answers[index] = value; $('next').disabled = false; $('progress').value = answers.filter(v => v !== null).length; try { sessionStorage.setItem(storageKey, JSON.stringify(answers)); } catch {} }); const span = document.createElement('span'); span.textContent = text; label.append(radio, span); $('options').append(label); });
  $('next').disabled = answers[index] === null; $('next').textContent = index === questions.length - 1 ? 'Ver meu resumo →' : 'Continuar →';
  show('quiz', 'question-title');
}
function summary(r) { const container = document.createElement('div'); container.className = 'summary'; const number = document.createElement('div'); number.className = 'score'; number.innerHTML = `${r.score}<small> / 100</small>`; const level = document.createElement('p'); level.textContent = r.level; const text = document.createElement('p'); text.textContent = r.score === 100 ? 'Suas respostas indicam processos consistentes nas quatro áreas.' : `A primeira área a revisar é ${r.weakest.toLowerCase()}.`; container.append(number, level, text); return container; }
$('start').onclick = () => { index = Math.max(0, answers.findIndex(v => v === null)); render(); };
$('back').onclick = () => { if (index === 0) show('intro'); else { index--; render(); } };
$('next').onclick = () => { if (answers[index] === null) return; if (index === 3 && !checkQualification()) return; if (index < questions.length - 1) { index++; render(); } else { report = diagnose(answers); $('summary').replaceChildren(summary(report)); show('preview','preview-title'); } };
$('qualification-review').onclick = () => { index = 0; render(); };
$('review').onclick = () => { index = 0; render(); };
$('lead-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const fields = Object.fromEntries(new FormData(form)); const phone = fields.phone.replace(/\D/g, ''); if (!/^(?:55)?[1-9]\d{9,10}$/.test(phone)) { $('form-status').textContent = 'Informe um WhatsApp válido com DDD.'; return; }
  const button = form.querySelector('button[type=submit]'); button.disabled = true; $('form-status').textContent = 'Enviando seus dados e preparando a análise…';
  try {
    const tracking = Object.fromEntries([...new URLSearchParams(location.search)].filter(([key]) => ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid'].includes(key)));
    const response = await fetch('/api/clinic-diagnostic', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...fields, ...tracking, consent:true, answers }), signal:AbortSignal.timeout(30000) });
    const data = await response.json(); if (!response.ok || !data.diagnostic) throw new Error(data.error || 'Não foi possível liberar a análise. Tente novamente.');
    report = data.diagnostic; const root = $('full-result'); root.replaceChildren(summary(report)); const scores = document.createElement('div'); scores.className='scores';
    report.scores.forEach(s => { const article = document.createElement('article'); const name = document.createElement('span'); name.textContent=s.name; const value=document.createElement('strong'); value.textContent=`${s.score}/100`; const p=document.createElement('p'); p.textContent=s.score < 34 ? 'Prioridade de estruturação' : s.score < 67 ? 'Processo em desenvolvimento' : s.score < 100 ? 'Base consistente' : 'Processo estruturado'; article.append(name,value,p); scores.append(article); }); root.append(scores);
    const explanation=document.createElement('p'); explanation.className='note'; explanation.textContent='A pontuação mede a estrutura dos processos declarados. Não estima perdas financeiras nem garante crescimento. Perfil, orçamento e decisão não alteram a nota.'; root.append(explanation);
    const conclusion = document.createElement('article'); conclusion.className = 'priority'; const heading = document.createElement('h2'); heading.textContent = 'O que suas respostas mostram'; const narrative = document.createElement('p'); narrative.textContent = report.conclusion; conclusion.append(heading, narrative); root.append(conclusion);
    report.priorities.forEach((p,i) => { const article=document.createElement('article'); article.className='priority'; const label=document.createElement('p'); label.textContent=`Prioridade ${i+1} · ${p.area}`; const title=document.createElement('h3'); title.textContent=p.title; const evidence=document.createElement('blockquote'); evidence.textContent=`Sua resposta: “${p.evidence}”`; const action=document.createElement('p'); action.textContent=p.action; article.append(label,title,evidence,action); root.append(article); });
    if (!report.priorities.length) { const p=document.createElement('p'); p.textContent='O próximo passo é validar estes processos com os indicadores reais e acompanhar sua consistência ao longo do tempo.'; root.append(p); }
    const nextStep = document.createElement('article'); nextStep.className = 'priority'; const title = document.createElement('h2'); title.textContent = 'Como avançar no seu momento'; nextStep.append(title);
    for (const text of [report.budget, report.decision, ...report.observations]) { const p = document.createElement('p'); p.textContent = text; nextStep.append(p); } root.append(nextStep);
    $('form-status').textContent = ''; show('result','result-title'); try { sessionStorage.removeItem(storageKey); } catch {}
  } catch (error) { $('form-status').textContent = error.name === 'TimeoutError' ? 'O envio demorou mais que o esperado. Tente novamente em instantes.' : error.message; } finally { button.disabled=false; }
});
$('print').onclick = () => window.print();
