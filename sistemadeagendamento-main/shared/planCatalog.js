export const BILLING_CYCLES = Object.freeze({
  monthly: Object.freeze({ label: 'Mensal', period: 'mês', months: 1 }),
  quarterly: Object.freeze({ label: 'Trimestral', period: 'trimestre', months: 3 }),
  yearly: Object.freeze({ label: 'Anual', period: 'ano', months: 12 }),
});

export const PLAN_CAPABILITIES = Object.freeze({
  basicScheduling: Object.freeze({ label: 'Agenda, disponibilidade e bloqueios', status: 'available' }),
  appointments: Object.freeze({ label: 'Agendamentos, reagendamentos e cancelamentos', status: 'available' }),
  serviceManagement: Object.freeze({ label: 'Gestão de serviços', status: 'available' }),
  publicBooking: Object.freeze({ label: 'Agendamento público', status: 'available' }),
  basicDashboard: Object.freeze({ label: 'Dashboard básico', status: 'available' }),
  themes: Object.freeze({ label: 'Tema claro e escuro', status: 'available' }),
  userManagement: Object.freeze({ label: 'Gestão de usuários administrativos', status: 'available' }),
  basicPermissions: Object.freeze({ label: 'Permissões básicas por perfil', status: 'available' }),
  payments: Object.freeze({ label: 'Registros internos de pagamento', status: 'available' }),
  audit: Object.freeze({ label: 'Consulta de registros de auditoria', status: 'available' }),
  completeDashboard: Object.freeze({ label: 'Dashboard completo', status: 'planned' }),
  reports: Object.freeze({ label: 'Relatórios', status: 'planned' }),
  advancedPermissions: Object.freeze({ label: 'Permissões avançadas', status: 'planned' }),
  advancedAudit: Object.freeze({ label: 'Auditoria avançada', status: 'planned' }),
  advancedReports: Object.freeze({ label: 'Relatórios avançados', status: 'planned' }),
  exports: Object.freeze({ label: 'Exportações', status: 'planned' }),
  advancedCustomization: Object.freeze({ label: 'Personalização avançada', status: 'planned' }),
});

const CORE_CAPABILITIES = Object.freeze({
  basicScheduling: true,
  appointments: true,
  serviceManagement: true,
  publicBooking: true,
  basicDashboard: true,
  themes: true,
});

const PROFESSIONAL_CAPABILITIES = Object.freeze({
  ...CORE_CAPABILITIES,
  userManagement: true,
  basicPermissions: true,
  payments: true,
  audit: true,
});

const PREMIUM_CAPABILITIES = Object.freeze({
  ...PROFESSIONAL_CAPABILITIES,
  advancedPermissions: false,
  advancedAudit: false,
  advancedReports: false,
  exports: false,
  advancedCustomization: false,
});

const COMPLETE_PLAN_COMPATIBILITY = Object.freeze({
  commercialPlanId: 'professional',
  preserveExistingTerms: true,
});
const PRESERVED_LEGACY_COMPATIBILITY = Object.freeze({
  commercialPlanId: null,
  preserveExistingTerms: true,
});

export const PLAN_CATALOG = Object.freeze({
  essential: Object.freeze({
    id: 'essential',
    name: 'Essencial',
    description: 'Para clínicas com até 5 funcionários ativos.',
    pricesInCents: Object.freeze({ monthly: 15000, quarterly: 40000, yearly: 140000 }),
    limits: Object.freeze({
      professionals: 5,
      patients: null,
      appointments: null,
      services: null,
      users: null,
    }),
    capabilities: CORE_CAPABILITIES,
    roadmapCapabilities: Object.freeze([]),
  }),
  professional: Object.freeze({
    id: 'professional',
    name: 'Profissional',
    description: 'Para clínicas com mais de 5 funcionários ativos, sem limite de equipe.',
    pricesInCents: Object.freeze({ monthly: 25000, quarterly: 67500, yearly: 240000 }),
    limits: Object.freeze({
      professionals: null,
      patients: null,
      appointments: null,
      services: null,
      users: null,
    }),
    capabilities: PROFESSIONAL_CAPABILITIES,
    roadmapCapabilities: Object.freeze([]),
  }),
  premium: Object.freeze({
    id: 'premium',
    name: 'Premium',
    description: 'Limites ampliados para clínicas maiores.',
    pricesInCents: Object.freeze({ monthly: 40000, quarterly: 108000, yearly: 384000 }),
    limits: Object.freeze({
      professionals: null,
      patients: null,
      appointments: null,
      services: null,
      users: null,
    }),
    capabilities: PREMIUM_CAPABILITIES,
    roadmapCapabilities: Object.freeze([
      'completeDashboard',
      'reports',
      'advancedPermissions',
      'advancedAudit',
      'advancedReports',
      'exports',
      'advancedCustomization',
    ]),
    legacy: true,
    compatibility: PRESERVED_LEGACY_COMPATIBILITY,
  }),
  complete: Object.freeze({
    id: 'complete',
    name: 'Completo (legado)',
    description: 'Plano anterior mantido para compatibilidade com assinaturas existentes.',
    pricesInCents: Object.freeze({ monthly: 14999, quarterly: 39999, yearly: 139999 }),
    limits: Object.freeze({
      professionals: null,
      patients: null,
      appointments: null,
      services: null,
      users: null,
    }),
    capabilities: PROFESSIONAL_CAPABILITIES,
    roadmapCapabilities: Object.freeze(['completeDashboard', 'reports']),
    legacy: true,
    compatibility: COMPLETE_PLAN_COMPATIBILITY,
  }),
});

export const PLAN_IDS = Object.freeze(Object.keys(PLAN_CATALOG));
export const COMMERCIAL_PLAN_IDS = Object.freeze(['essential', 'professional']);
export const PLAN_LIMIT_RESOURCES = Object.freeze({
  professionals: Object.freeze({
    table: 'professionals',
    label: 'funcionários ativos',
    where: " AND status = 'active'",
  }),
  patients: Object.freeze({
    table: 'patients',
    label: 'pacientes',
  }),
  appointments: Object.freeze({
    table: 'appointments',
    label: 'agendamentos',
  }),
  services: Object.freeze({
    table: 'services',
    label: 'serviços',
  }),
  users: Object.freeze({
    table: 'users',
    label: 'usuários administrativos',
    where: " AND role IN ('admin', 'reception')",
  }),
});

export function getPlanPriceInCents(plan, billingCycle) {
  return PLAN_CATALOG[plan]?.pricesInCents[billingCycle] ?? null;
}

export function getPlanBillingSummary(planId, billingCycle) {
  const plan = PLAN_CATALOG[planId];
  const cycle = BILLING_CYCLES[billingCycle];
  const priceInCents = getPlanPriceInCents(planId, billingCycle);

  if (!plan || !cycle || priceInCents === null) return null;

  return {
    billingCycle,
    months: cycle.months,
    priceInCents,
    monthlyEquivalentInCents: Math.round(priceInCents / cycle.months),
    savingsInCents: plan.pricesInCents.monthly * cycle.months - priceInCents,
  };
}
