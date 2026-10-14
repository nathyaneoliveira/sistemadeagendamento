import { PLAN_CATALOG, getPlanPriceInCents } from '../../../shared/planCatalog.js';
import { query } from '../db/index.js';
import { writePlatformAudit } from './platformAdminAuthService.js';

const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];
const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly'];
const CLINIC_STATUSES = ['active', 'inactive', 'suspended'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validationError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizePagination({ page = '1', pageSize = '20' } = {}) {
  if (
    !['string', 'number'].includes(typeof page) ||
    !['string', 'number'].includes(typeof pageSize)
  ) {
    throw validationError('Parâmetros de paginação inválidos.');
  }
  const normalizedPage = Number(page);
  const normalizedPageSize = Number(pageSize);
  if (
    !Number.isSafeInteger(normalizedPage) ||
    normalizedPage < 1 ||
    !Number.isSafeInteger(normalizedPageSize) ||
    normalizedPageSize < 1 ||
    normalizedPageSize > 100
  ) {
    throw validationError('Parâmetros de paginação inválidos.');
  }
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    offset: (normalizedPage - 1) * normalizedPageSize,
  };
}

function validateDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`O filtro ${field} deve usar AAAA-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw validationError(`O filtro ${field} contém uma data inválida.`);
  }
  return value;
}

function validateDateRange({ from, to } = {}) {
  const normalizedFrom = validateDate(from, 'from');
  const normalizedTo = validateDate(to, 'to');
  if (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo) {
    throw validationError('A data inicial deve ser anterior ou igual à data final.');
  }
  if (
    normalizedFrom &&
    normalizedTo &&
    (Date.parse(`${normalizedTo}T00:00:00Z`) - Date.parse(`${normalizedFrom}T00:00:00Z`)) >
      366 * 24 * 60 * 60 * 1000
  ) {
    throw validationError('O período não pode exceder 367 dias.');
  }
  return { from: normalizedFrom, to: normalizedTo };
}

function validateEnum(value, allowed, field) {
  if (value !== undefined && value !== '' && !allowed.includes(value)) {
    throw validationError(`Filtro ${field} inválido.`);
  }
  return value || null;
}

function appendFilter(clauses, values, condition, value) {
  if (value === null || value === undefined) return;
  values.push(value);
  clauses.push(condition.replace('?', `$${values.length}`));
}

function makeWhere(filters, { includeClinicStatus = false } = {}) {
  const clauses = [];
  const values = [];
  appendFilter(clauses, values, 's.status = ?', validateEnum(filters.status, SUBSCRIPTION_STATUSES, 'status'));
  appendFilter(clauses, values, 's.plan = ?', validateEnum(filters.plan, Object.keys(PLAN_CATALOG), 'plan'));
  appendFilter(clauses, values, 's.billing_cycle = ?', validateEnum(filters.billingCycle, BILLING_CYCLES, 'billingCycle'));
  if (includeClinicStatus) {
    appendFilter(clauses, values, 'c.status = ?', validateEnum(filters.clinicStatus, CLINIC_STATUSES, 'clinicStatus'));
  }
  const { from, to } = validateDateRange(filters);
  appendFilter(clauses, values, 's.created_at >= ?::date', from);
  appendFilter(clauses, values, "s.created_at < (?::date + INTERVAL '1 day')", to);
  if (filters.search !== undefined && typeof filters.search !== 'string') {
    throw validationError('O parâmetro de pesquisa é inválido.');
  }
  const search = typeof filters.search === 'string' ? filters.search.trim() : '';
  if (search.length > 100) throw validationError('A pesquisa deve ter no máximo 100 caracteres.');
  if (search) {
    values.push(`%${search}%`);
    const searchParam = `$${values.length}`;
    clauses.push(`(
      c.name ILIKE ${searchParam} OR c.trade_name ILIKE ${searchParam}
      OR c.email ILIKE ${searchParam} OR c.phone ILIKE ${searchParam}
      OR admin.name ILIKE ${searchParam} OR admin.email ILIKE ${searchParam}
    )`);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

function countRows(result) {
  return Number(result.rows[0]?.total || 0);
}

async function recordView(auditLogger, { platformAdminId, action, entityId = null, requestId = null }) {
  await auditLogger({
    platformAdminId,
    action,
    entityType: entityId ? 'clinic' : 'platform',
    entityId,
    requestId,
  });
}

export function createPlatformAdminService({
  queryExecutor = query,
  auditLogger = writePlatformAudit,
} = {}) {
  async function getDashboard({ from, to } = {}, admin = {}) {
    const requestedRange = validateDateRange({ from, to });
    const effectiveTo = requestedRange.to || new Date().toISOString().slice(0, 10);
    const defaultFromDate = new Date(`${effectiveTo}T00:00:00.000Z`);
    defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
    const dateRange = validateDateRange({
      from: requestedRange.from || defaultFromDate.toISOString().slice(0, 10),
      to: effectiveTo,
    });
    const durationDays = dateRange.from && dateRange.to
      ? (Date.parse(`${dateRange.to}T00:00:00Z`) - Date.parse(`${dateRange.from}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000)
      : 30;
    const timelineGranularity = durationDays > 62 ? 'month' : 'day';
    const [summaryResult, activeSubscriptionsResult, distributionResult, timelineResult, eventsResult] = await Promise.all([
      queryExecutor(
        `WITH latest AS (
           SELECT DISTINCT ON (clinic_id) clinic_id, plan, status, current_period_end
           FROM subscriptions
           ORDER BY clinic_id, created_at DESC, id DESC
         )
         SELECT
           (SELECT COUNT(*) FROM clinics)::integer AS total_clinics,
           (SELECT COUNT(*) FROM latest
             WHERE status = 'active' AND current_period_end > NOW())::integer AS active_subscriptions,
           (SELECT COUNT(*) FROM subscriptions
             WHERE ($1::date IS NULL OR created_at >= $1::date)
               AND ($2::date IS NULL OR created_at < ($2::date + INTERVAL '1 day')))::integer AS new_contracts,
           (SELECT COUNT(*) FROM latest WHERE status = 'cancelled')::integer AS cancelled_subscriptions,
           (SELECT COUNT(*) FROM latest WHERE status = 'past_due')::integer AS delinquent_subscriptions,
           (SELECT COUNT(*) FROM latest
             WHERE status = 'expired'
                OR (status IN ('active', 'trialing', 'past_due') AND current_period_end <= NOW()))::integer AS expired_subscriptions`,
        [dateRange.from, dateRange.to]
      ),
      queryExecutor(
        `SELECT plan, billing_cycle
         FROM subscriptions
         WHERE status = 'active' AND current_period_end > NOW()`
      ),
      queryExecutor(
        `SELECT latest.plan, COUNT(*)::integer AS clinics
         FROM (
           SELECT DISTINCT ON (clinic_id) clinic_id, plan
           FROM subscriptions
           ORDER BY clinic_id, created_at DESC, id DESC
         ) latest
         GROUP BY latest.plan
         ORDER BY latest.plan`
      ),
      queryExecutor(
        `WITH buckets AS (
           SELECT generate_series(
             date_trunc('${timelineGranularity}', $1::date::timestamp),
             date_trunc('${timelineGranularity}', $2::date::timestamp),
             INTERVAL '1 ${timelineGranularity}'
           ) AS period
         )
         SELECT buckets.period::date AS period, COUNT(sub.id)::integer AS contracts
         FROM buckets
         LEFT JOIN subscriptions sub
           ON sub.created_at >= buckets.period
          AND sub.created_at < buckets.period + INTERVAL '1 ${timelineGranularity}'
         GROUP BY buckets.period
         ORDER BY buckets.period`,
        [dateRange.from, dateRange.to]
      ),
      queryExecutor(
        `SELECT *
         FROM (
           SELECT c.id AS event_id, c.created_at AS occurred_at,
                  'clinic.created'::text AS event_type,
                  COALESCE(c.trade_name, c.name) AS clinic_name,
                  NULL::text AS plan, NULL::text AS status
           FROM clinics c
           UNION ALL
           SELECT a.id AS event_id, a.created_at AS occurred_at,
                  a.action AS event_type,
                  COALESCE(c.trade_name, c.name) AS clinic_name,
                  a.details->>'plan' AS plan,
                  COALESCE(a.details->>'status', a.details->>'previousStatus') AS status
           FROM audit_logs a
           JOIN clinics c ON c.id = a.clinic_id
           WHERE a.entity_type = 'subscriptions'
             AND a.action IN (
               'subscription.created', 'subscription.updated',
               'subscription.cancelled', 'subscription.trial_started',
               'subscription.trial_ended'
             )
         ) events
         ORDER BY occurred_at DESC, event_id DESC
         LIMIT 20`
      ),
    ]);

    let mrrEstimateInCents = 0;
    for (const subscription of activeSubscriptionsResult.rows) {
      const priceInCents = getPlanPriceInCents(subscription.plan, subscription.billing_cycle);
      const months = { monthly: 1, quarterly: 3, yearly: 12 }[subscription.billing_cycle];
      if (!Number.isSafeInteger(priceInCents) || !months) {
        throw new Error('Uma assinatura ativa possui plano ou ciclo sem preço comercial definido.');
      }
      mrrEstimateInCents += Math.round(priceInCents / months);
    }

    await recordView(auditLogger, {
      platformAdminId: admin.id,
      action: 'platform.dashboard.view',
      requestId: admin.requestId,
    });
    const summary = summaryResult.rows[0];
    const activeSubscriptions = Number(summary.active_subscriptions);
    return {
      period: dateRange,
      metrics: {
        totalClinics: Number(summary.total_clinics),
        activeSubscriptions,
        newContracts: Number(summary.new_contracts),
        pendingSubscriptions: { count: null, supported: false },
        cancelledSubscriptions: Number(summary.cancelled_subscriptions),
        delinquentSubscriptions: Number(summary.delinquent_subscriptions),
        expiredSubscriptions: Number(summary.expired_subscriptions),
        mrrEstimateInCents,
        arrEstimateInCents: mrrEstimateInCents * 12,
        activeSubscriptionsWithoutPaymentConfirmation: activeSubscriptions,
        confirmedSubscriptionPayments: { amountInCents: null, count: null, supported: false },
        pendingSubscriptionCharges: { amountInCents: null, count: null, supported: false },
      },
      planDistribution: distributionResult.rows.map((row) => ({
        plan: row.plan,
        planName: PLAN_CATALOG[row.plan]?.name || row.plan,
        clinics: Number(row.clinics),
      })),
      contractsTimeline: timelineResult.rows.map((row) => ({
        period: row.period,
        contracts: Number(row.contracts),
      })),
      recentEvents: eventsResult.rows,
      financialNotes: [
        'MRR estimado soma apenas assinaturas active dentro do período vigente, normalizadas pelo preço do catálogo compartilhado: mensal = preço mensal; trimestral = preço total / 3; anual = preço total / 12.',
        'ARR estimado = MRR estimado × 12. Valores estimados não representam dinheiro recebido.',
        'Não existe integração ou registro de pagamentos de assinatura. Pagamentos existentes são vinculados a agendamentos das clínicas e não são receita da plataforma.',
        'O estado pending não existe no domínio de assinaturas atual; cobranças pendentes da plataforma não podem ser determinadas.',
      ],
    };
  }

  async function listClinics(filters = {}, admin = {}) {
    const { page, pageSize, offset } = normalizePagination(filters);
    const where = makeWhere(filters, { includeClinicStatus: true });
    const params = [...where.values, pageSize, offset];
    const result = await queryExecutor(
      `SELECT c.id, c.name, c.trade_name, c.status, c.email AS contact_email,
              c.phone AS contact_phone, c.created_at,
              admin.name AS administrator_name, admin.email AS administrator_email,
              s.plan, s.billing_cycle, s.status AS subscription_status,
              s.started_at AS subscription_started_at,
              s.current_period_end AS renewal_at,
              COUNT(*) OVER()::integer AS total
       FROM clinics c
       LEFT JOIN LATERAL (
         SELECT u.name, u.email
         FROM users u
         WHERE u.clinic_id = c.id AND u.role = 'admin' AND u.status = 'active'
         ORDER BY u.created_at, u.id
         LIMIT 1
       ) admin ON TRUE
       LEFT JOIN LATERAL (
         SELECT sub.plan, sub.billing_cycle, sub.status, sub.started_at,
                sub.current_period_end, sub.created_at
         FROM subscriptions sub
         WHERE sub.clinic_id = c.id
         ORDER BY sub.created_at DESC, sub.id DESC
         LIMIT 1
       ) s ON TRUE
       ${where.sql ? where.sql.replace('s.created_at', 's.created_at') : ''}
       ORDER BY c.created_at DESC, c.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countResult = result.rows.length
      ? null
      : await queryExecutor(
        `SELECT COUNT(*)::integer AS total
         FROM clinics c
         LEFT JOIN LATERAL (
           SELECT u.name, u.email FROM users u
           WHERE u.clinic_id = c.id AND u.role = 'admin' AND u.status = 'active'
           ORDER BY u.created_at, u.id LIMIT 1
         ) admin ON TRUE
         LEFT JOIN LATERAL (
           SELECT sub.plan, sub.billing_cycle, sub.status, sub.created_at
           FROM subscriptions sub
           WHERE sub.clinic_id = c.id
           ORDER BY sub.created_at DESC, sub.id DESC LIMIT 1
         ) s ON TRUE
         ${where.sql}`,
        where.values
      );
    const total = result.rows.length
      ? Number(result.rows[0].total)
      : countRows(countResult);
    await recordView(auditLogger, {
      platformAdminId: admin.id,
      action: 'platform.clinics.list',
      requestId: admin.requestId,
    });
    return {
      data: result.rows.map(({ total: _total, ...clinic }) => ({
        ...clinic,
        planName: clinic.plan ? PLAN_CATALOG[clinic.plan]?.name || clinic.plan : null,
        subscriptionPaymentStatus: 'unavailable',
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async function getClinicDetails(clinicId, admin = {}) {
    if (!UUID_PATTERN.test(clinicId || '')) throw validationError('Identificador de clínica inválido.');
    const result = await queryExecutor(
      `SELECT c.id, c.name, c.trade_name, c.status, c.email AS contact_email,
              c.phone AS contact_phone, c.whatsapp, c.city, c.state, c.created_at, c.updated_at,
              admin.id AS administrator_id, admin.name AS administrator_name,
              admin.email AS administrator_email, admin.phone AS administrator_phone,
              s.id AS subscription_id, s.plan, s.billing_cycle,
              s.status AS subscription_status, s.started_at AS subscription_started_at,
              s.current_period_start, s.current_period_end, s.trial_ends_at,
              s.cancelled_at
       FROM clinics c
       LEFT JOIN LATERAL (
         SELECT u.id, u.name, u.email, u.phone FROM users u
         WHERE u.clinic_id = c.id AND u.role = 'admin' AND u.status = 'active'
         ORDER BY u.created_at, u.id LIMIT 1
       ) admin ON TRUE
       LEFT JOIN LATERAL (
         SELECT sub.* FROM subscriptions sub
         WHERE sub.clinic_id = c.id
         ORDER BY sub.created_at DESC, sub.id DESC LIMIT 1
       ) s ON TRUE
       WHERE c.id = $1`,
      [clinicId]
    );
    if (result.rowCount === 0) {
      throw Object.assign(new Error('Clínica não encontrada.'), { statusCode: 404 });
    }

    const [historyResult, eventsResult] = await Promise.all([
      queryExecutor(
        `SELECT id, plan, billing_cycle, status, started_at, current_period_start,
                current_period_end, trial_ends_at, cancelled_at, created_at, updated_at
         FROM subscriptions
         WHERE clinic_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [clinicId]
      ),
      queryExecutor(
        `SELECT a.id, a.action, a.entity_id,
                jsonb_strip_nulls(jsonb_build_object(
                  'plan', a.details->>'plan',
                  'billingCycle', a.details->>'billingCycle',
                  'status', a.details->>'status',
                  'previousStatus', a.details->>'previousStatus',
                  'trialEndsAt', a.details->>'trialEndsAt',
                  'priceInCents', a.details->>'priceInCents'
                )) AS details,
                a.created_at, u.name AS actor_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id AND u.clinic_id = a.clinic_id
         WHERE a.clinic_id = $1 AND a.entity_type = 'subscriptions'
           AND a.action LIKE 'subscription.%'
         ORDER BY a.created_at DESC
         LIMIT 50`,
        [clinicId]
      ),
    ]);
    await recordView(auditLogger, {
      platformAdminId: admin.id,
      action: 'platform.clinic.view',
      entityId: clinicId,
      requestId: admin.requestId,
    });
    const clinic = result.rows[0];
    return {
      clinic: {
        ...clinic,
        planName: clinic.plan ? PLAN_CATALOG[clinic.plan]?.name || clinic.plan : null,
        subscriptionPaymentStatus: 'unavailable',
      },
      subscriptions: historyResult.rows.map((subscription) => ({
        ...subscription,
        planName: PLAN_CATALOG[subscription.plan]?.name || subscription.plan,
        priceInCents: getPlanPriceInCents(subscription.plan, subscription.billing_cycle),
      })),
      subscriptionEvents: eventsResult.rows,
      financialNote: 'Pagamentos SaaS não estão integrados; os registros de pagamento existentes referem-se a agendamentos.',
    };
  }

  async function listSubscriptions(filters = {}, admin = {}) {
    const { page, pageSize, offset } = normalizePagination(filters);
    const where = makeWhere(filters);
    const values = [...where.values, pageSize, offset];
    const result = await queryExecutor(
      `SELECT s.id, s.clinic_id, COALESCE(c.trade_name, c.name) AS clinic_name,
              c.email AS clinic_email, admin.name AS administrator_name,
              s.plan, s.billing_cycle, s.status, s.started_at, s.current_period_start,
              s.current_period_end, s.trial_ends_at, s.cancelled_at,
              s.created_at, s.updated_at, COUNT(*) OVER()::integer AS total
       FROM subscriptions s
       JOIN clinics c ON c.id = s.clinic_id
       LEFT JOIN LATERAL (
         SELECT u.name FROM users u
         WHERE u.clinic_id = c.id AND u.role = 'admin' AND u.status = 'active'
         ORDER BY u.created_at, u.id LIMIT 1
       ) admin ON TRUE
       ${where.sql}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const countResult = result.rows.length
      ? null
      : await queryExecutor(
        `SELECT COUNT(*)::integer AS total FROM subscriptions s
         JOIN clinics c ON c.id = s.clinic_id
         LEFT JOIN LATERAL (
           SELECT u.name, u.email FROM users u
           WHERE u.clinic_id = c.id AND u.role = 'admin' AND u.status = 'active'
           ORDER BY u.created_at, u.id LIMIT 1
         ) admin ON TRUE
         ${where.sql}`,
        where.values
      );
    const total = result.rows.length ? Number(result.rows[0].total) : countRows(countResult);
    await recordView(auditLogger, {
      platformAdminId: admin.id,
      action: 'platform.subscriptions.list',
      requestId: admin.requestId,
    });
    return {
      data: result.rows.map(({ total: _total, ...subscription }) => {
        const priceInCents = getPlanPriceInCents(subscription.plan, subscription.billing_cycle);
        const months = { monthly: 1, quarterly: 3, yearly: 12 }[subscription.billing_cycle];
        return {
          ...subscription,
          planName: PLAN_CATALOG[subscription.plan]?.name || subscription.plan,
          priceInCents,
          monthlyEquivalentInCents: Number.isSafeInteger(priceInCents) && months
            ? Math.round(priceInCents / months)
            : null,
          subscriptionPaymentStatus: 'unavailable',
        };
      }),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async function listRecentEvents({ page = '1', pageSize = '20' } = {}, admin = {}) {
    const pagination = normalizePagination({ page, pageSize });
    const values = [pagination.pageSize, pagination.offset];
    const eventSource = `SELECT c.id AS event_id, c.created_at AS occurred_at,
                                'clinic.created'::text AS event_type,
                                COALESCE(c.trade_name, c.name) AS clinic_name,
                                NULL::text AS plan, NULL::text AS status
                         FROM clinics c
                         UNION ALL
                         SELECT a.id AS event_id, a.created_at AS occurred_at, a.action AS event_type,
                                COALESCE(c.trade_name, c.name) AS clinic_name,
                                a.details->>'plan' AS plan,
                                COALESCE(a.details->>'status', a.details->>'previousStatus') AS status
                         FROM audit_logs a
                         JOIN clinics c ON c.id = a.clinic_id
                         WHERE a.entity_type = 'subscriptions'
                           AND a.action IN (
                             'subscription.created', 'subscription.updated',
                             'subscription.cancelled', 'subscription.trial_started',
                             'subscription.trial_ended'
                           )`;
    const [result, countResult] = await Promise.all([
      queryExecutor(
        `SELECT * FROM (${eventSource}) events
         ORDER BY occurred_at DESC, event_id DESC
         LIMIT $1 OFFSET $2`,
        values
      ),
      queryExecutor(`SELECT COUNT(*)::integer AS total FROM (${eventSource}) events`),
    ]);
    await recordView(auditLogger, {
      platformAdminId: admin.id,
      action: 'platform.events.list',
      requestId: admin.requestId,
    });
    return {
      data: result.rows,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: countRows(countResult),
        totalPages: Math.ceil(countRows(countResult) / pagination.pageSize),
      },
    };
  }

  return { getDashboard, listClinics, getClinicDetails, listSubscriptions, listRecentEvents };
}
