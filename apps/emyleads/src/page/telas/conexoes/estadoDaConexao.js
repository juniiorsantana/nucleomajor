/**
 * O estado de uma conexão em linguagem de gente.
 *
 * Duas telas precisam da mesma resposta — Conexões e o estado vazio de
 * Conversas — e a resposta não pode divergir entre elas: "está conectado?",
 * "em que fase está?", "há quanto tempo a VPS deu sinal?". A tela de Conexões
 * mostrava quinze linhas técnicas com o mesmo peso, e o estado que exigia
 * alguém com o celular na mão (sessão caída) tinha a cara de um rodapé.
 *
 * O que entra aqui é o objeto que `api.gateway.conexoes` devolve por conexão:
 * `runtime`, `connection.status`, `controlPlane.{heartbeat_at, fresh}`,
 * `remoteManaged`. O que sai é uma fase, um título e um detalhe prontos para
 * a tela, sem nome de sistema.
 */

export const FASES = {
  CONECTADO: "conectado",
  PAREANDO: "pareando",
  DESCONECTADO: "desconectado",
  DIVERGENTE: "divergente",
  RUNTIME_PARADO: "runtime_parado",
  PREPARANDO: "preparando",
  DESCONHECIDO: "desconhecido",
};

const EM_PAREAMENTO = new Set(["starting_pairing", "awaiting_qr", "qr_expired"]);

/**
 * "há 12 s", "há 3 min", "há 2 h". Sem sinal, vazio: não se inventa tempo.
 */
export function haQuanto(iso, agora = Date.now()) {
  if (!iso) return "";
  const instante = new Date(iso).getTime();
  if (!Number.isFinite(instante)) return "";
  const segundos = Math.max(0, Math.round((agora - instante) / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

/**
 * O sinal da VPS, como a tela deve dizer.
 *
 * `fresh` é decidido pelo provedor (heartbeat dentro da janela). Sem sinal
 * fresco a tela NUNCA afirma "conectado": a única coisa que ela sabe é o
 * último estado, e a data dele.
 */
export function textoDoSinal(controlPlane, agora = Date.now()) {
  const quando = controlPlane?.heartbeat_at;
  if (!quando) return "";
  const tempo = haQuanto(quando, agora);
  return controlPlane.fresh ? `Sinal da VPS ${tempo}` : `Sem sinal da VPS desde ${tempo.replace(/^há /, "")}`;
}

/**
 * Resume a conexão para as duas telas.
 *
 * Precedência: número divergente vence tudo (o envio está bloqueado); runtime
 * parado vence a sessão (sem runtime não há como saber a sessão); depois a
 * sessão em si. `remoteManaged` só muda o texto de ajuda — a VPS é quem
 * pareia, e o QR chega pela fila.
 */
export function resumirConexao(conexao, agora = Date.now()) {
  const sessao = conexao?.connection || {};
  const status = String(sessao.status || "");
  const runtimeOnline = conexao?.runtime === "online";
  const numero = sessao.phoneMasked || conexao?.expectedPhoneMasked || "";
  const sinal = textoDoSinal(conexao?.controlPlane, agora);
  const final4 = String(conexao?.expectedPhoneMasked || sessao.phoneMasked || "").replace(/\D/g, "").slice(-4);

  if (status === "identity_mismatch") {
    return {
      fase: FASES.DIVERGENTE,
      tom: "erro",
      selo: "Número divergente",
      titulo: "O aparelho pareado não é o número desta conexão.",
      detalhe: `Esperava ${conexao?.expectedPhoneMasked || "outro número"}; o envio está bloqueado até um administrador corrigir.`,
      numero,
      sinal,
      podeConectar: false,
    };
  }
  // Pedida pelo portal e ainda sem runtime na VPS: nunca deu sinal nenhum.
  // Não é "o serviço caiu" — é "a Major ainda está montando".
  if (!conexao?.controlPlane && !runtimeOnline && ["created", "provisioning"].includes(status)) {
    return {
      fase: FASES.PREPARANDO,
      tom: "atencao",
      selo: "Em preparação",
      titulo: "Estamos preparando o seu WhatsApp.",
      detalhe: `Quando estiver pronto, o QR aparece aqui para você ler com o celular${final4 ? ` do número final ${final4}` : ""}.`,
      numero,
      sinal,
      podeConectar: false,
    };
  }
  if (!runtimeOnline) {
    return {
      fase: FASES.RUNTIME_PARADO,
      tom: "erro",
      selo: "Sem sinal do runtime",
      titulo: "O serviço que atende o WhatsApp não deu sinal.",
      detalhe: status === "connected"
        ? "O último estado conhecido era conectado, mas o portal não pode afirmar que continua."
        : "Sem o serviço de pé, não há como conectar nem atender.",
      numero,
      sinal,
      podeConectar: false,
    };
  }
  if (status === "connected") {
    return {
      fase: FASES.CONECTADO,
      tom: "sucesso",
      selo: "Conectado",
      titulo: "Conectado e recebendo mensagens.",
      detalhe: sessao.updatedAt ? `Última atividade ${haQuanto(sessao.updatedAt, agora)}.` : "",
      numero,
      sinal,
      podeConectar: false,
    };
  }
  if (EM_PAREAMENTO.has(status)) {
    return {
      fase: FASES.PAREANDO,
      tom: "atencao",
      selo: status === "qr_expired" ? "Código expirado" : "Aguardando leitura do QR",
      titulo: status === "qr_expired"
        ? "O código expirou. Gere um novo e leia com o celular."
        : `Leia o QR com o celular do número${final4 ? ` final ${final4}` : ""}.`,
      detalhe: "WhatsApp › Aparelhos conectados › Conectar aparelho.",
      numero,
      sinal,
      podeConectar: true,
      qrExpirado: status === "qr_expired",
    };
  }
  if (status === "connecting" || status === "reconnecting") {
    return {
      fase: FASES.PAREANDO,
      tom: "atencao",
      selo: "Conectando",
      titulo: "Conectando ao WhatsApp.",
      detalhe: "Leva alguns segundos.",
      numero,
      sinal,
      podeConectar: false,
    };
  }
  return {
    fase: FASES.DESCONECTADO,
    tom: "neutro",
    selo: "Desconectado",
    titulo: "O WhatsApp não está conectado.",
    detalhe: "Conecte para receber conversas e deixar a IA atender.",
    numero,
    sinal,
    podeConectar: true,
  };
}

/**
 * O nome da conexão sem o número.
 *
 * O número tem linha própria no cartão. Um nome como "WhatsApp principal
 * (8362)" continuou dizendo 8362 depois da troca para outro número, em
 * 10/10/2026, e quem olhava concluiu que a troca não tinha pegado.
 */
export function nomeSemNumero(nome) {
  const original = String(nome || "").trim();
  const limpo = original
    .replace(/\s*[([]\s*(?:•+\s*)?\+?\d[\d\s.-]{2,}\s*[)\]]\s*$/, "")
    .replace(/\s*[-–—·]\s*(?:•+\s*)?\+?\d[\d\s.-]{2,}$/, "")
    .trim();
  return limpo || original || "WhatsApp";
}

// O que a VPS devolve quando o QR não sai, em língua de gente. O código cru
// ("pairing_in_progress") apareceu no topo da tela em 10/10/2026, e quem
// estava com o celular na mão não tinha o que fazer com ele.
const MOTIVOS_DO_PAREAMENTO = [
  ["pairing_in_progress", "Já existe um QR aberto para esta conexão. Espere alguns segundos e toque em Conectar WhatsApp de novo."],
  ["session_exists", "Este WhatsApp já está conectado. Não é preciso ler outro QR."],
  ["bridge_offline", "A VPS desta conexão não respondeu. Tente de novo em alguns segundos."],
  ["bridge_unavailable", "A VPS desta conexão não respondeu. Tente de novo em alguns segundos."],
  ["bridge_credentials_unavailable", "A VPS desta conexão está sem credencial. Fale com a equipe do Núcleo Major."],
  ["pairing_unsupported", "A VPS desta conexão precisa ser atualizada para mostrar o QR. Fale com a equipe do Núcleo Major."],
  ["connection_not_registered", "Esta conexão não está registrada na VPS. Fale com a equipe do Núcleo Major."],
  ["too many pairing requests", "Muitos pedidos de QR em pouco tempo. Espere um minuto e tente de novo."],
  ["organization admin required", "Conectar o número é permissão de administrador."],
  ["connection is not available", "Esta conexão não está disponível para esta empresa."],
  ["expired", "A VPS demorou para responder. Tente de novo."],
];

/**
 * A recusa de um QR em português; o código cru nunca vai para a tela.
 *
 * O pareamento remoto (`pareamento-*` no provider) devolve o slug da VPS ou a
 * frase da RPC, em inglês: esses são traduzidos. O serviço local já fala
 * português, e a frase dele passa como veio.
 */
export function mensagemDoPareamento(erro) {
  const texto = String(erro?.message || erro || "").trim();
  const remoto = String(erro?.codigo || "").startsWith("pareamento-");
  if (texto && !remoto) return texto;
  for (const [trecho, frase] of MOTIVOS_DO_PAREAMENTO) {
    if (texto.includes(trecho)) return frase;
  }
  return "Não foi possível mostrar o QR agora. Tente de novo em alguns segundos.";
}

/**
 * A conexão que a caixa de entrada considera "a" conexão da empresa.
 *
 * Hoje existe uma. Se houver mais de uma, a remota (VPS) vem antes da local,
 * e entre iguais a primeira da lista — critério estável, sem adivinhação.
 */
export function conexaoPrincipal(conexoes) {
  const lista = Array.isArray(conexoes) ? conexoes : [];
  return lista.find((c) => c?.remoteManaged) || lista[0] || null;
}
