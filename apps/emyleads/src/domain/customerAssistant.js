export const CUSTOMER_ROLLOUT_MODES = [
  { id: "off", label: "Desligado", description: "Clientes não recebem respostas automáticas." },
  { id: "pilot", label: "Piloto", description: "Somente contatos selecionados no CRM são atendidos." },
  { id: "active", label: "Ativo", description: "Todos os clientes podem receber atendimento automático." },
];

export const HANDOFF_GROUPS = {
  waiting: ["requested"],
  active: ["accepted", "completing", "returning"],
  finished: ["completed", "returned", "cancelled"],
};

export function rolloutMode(profile) {
  const value = profile?.process_config?.rollout?.mode;
  return CUSTOMER_ROLLOUT_MODES.some((item) => item.id === value) ? value : "off";
}

export function handoffGroup(status) {
  return Object.entries(HANDOFF_GROUPS).find(([, statuses]) => statuses.includes(status))?.[0] || "finished";
}

export function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "Número protegido";
}

