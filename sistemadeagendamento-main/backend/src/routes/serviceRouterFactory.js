import { Router } from 'express';
import { assertPlanResourceLimit, requireActivePlanSubscription } from '../services/planAccess.js';
import {
  isCreateServiceRequest,
  isProfessionalServiceAssignmentRequest,
  isServiceStatusRequest,
  isUpdateServiceRequest,
  isUuid,
} from './serviceValidation.js';

function serviceSelectSql(single = false) {
  const roleFilters = `
    AND (
      $${single ? 3 : 2}::text NOT IN ('patient', 'professional')
      OR (
        $${single ? 3 : 2}::text = 'patient'
        AND s.is_active
        AND EXISTS (
          SELECT 1
          FROM professional_services available_ps
          JOIN professionals available_pr
            ON available_pr.id = available_ps.professional_id
           AND available_pr.clinic_id = available_ps.clinic_id
          WHERE available_ps.clinic_id = s.clinic_id
            AND available_ps.service_id = s.id
            AND available_pr.status = 'active'
        )
      )
      OR (
        $${single ? 3 : 2}::text = 'professional'
        AND EXISTS (
          SELECT 1
          FROM professional_services own_ps
          JOIN professionals own_pr
            ON own_pr.id = own_ps.professional_id
           AND own_pr.clinic_id = own_ps.clinic_id
          WHERE own_ps.clinic_id = s.clinic_id
            AND own_ps.service_id = s.id
            AND own_pr.user_id = $${single ? 4 : 3}
            AND own_pr.status = 'active'
        )
      )
    )`;

  return `SELECT s.*,
            COALESCE(
              array_agg(ps.professional_id) FILTER (WHERE p.id IS NOT NULL),
              ARRAY[]::uuid[]
            ) AS professional_ids
          FROM services s
          LEFT JOIN professional_services ps
            ON ps.clinic_id = s.clinic_id AND ps.service_id = s.id
          LEFT JOIN professionals p
            ON p.clinic_id = ps.clinic_id
           AND p.id = ps.professional_id
           AND p.status = 'active'
          WHERE s.clinic_id = $1
            ${single ? 'AND s.id = $2' : ''}
            ${roleFilters}
          GROUP BY s.id
          ${single ? '' : 'ORDER BY s.name ASC'}`;
}

export function createServiceRouter({
  queryExecutor,
  transactionExecutor,
  authenticate,
  authorizeRoles: authorizeRolesMiddleware,
  requireClinicAccess: requireClinicMiddleware,
  logAudit: auditLogger,
  requireActiveSubscription = null,
  checkPlanLimit = assertPlanResourceLimit,
} = {}) {
  if (
    typeof queryExecutor !== 'function' ||
    typeof transactionExecutor !== 'function' ||
    typeof authenticate !== 'function' ||
    typeof authorizeRolesMiddleware !== 'function' ||
    typeof requireClinicMiddleware !== 'function' ||
    typeof auditLogger !== 'function'
  ) {
    throw new TypeError('Service router dependencies must be provided explicitly.');
  }
  const router = Router();

  router.use(authenticate);
  router.use(requireClinicMiddleware);
  if (requireActiveSubscription) router.use(requireActiveSubscription);

  router.get('/', async (req, res, next) => {
    try {
      const values = [req.clinicId, req.user.role];
      values.push(req.user.userId);
      const result = await queryExecutor(serviceSelectSql(), values);
      return res.status(200).json({ ok: true, data: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, message: 'Identificador de serviço inválido.' });
    }

    try {
      const values = [req.clinicId, req.params.id, req.user.role];
      values.push(req.user.userId);
      const result = await queryExecutor(serviceSelectSql(true), values);
      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Serviço não encontrado.' });
      }
      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    if (!isCreateServiceRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de serviço inválidos ou campos não permitidos.' });
    }

    try {
      const result = await transactionExecutor(async (client) => {
        await checkPlanLimit(client, req.clinicId, 'services');
        const professionalIds = req.body.professionalIds || [];
        if (professionalIds.length > 0) {
          const professionals = await client.query(
            `SELECT id FROM professionals
             WHERE clinic_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
            [req.clinicId, professionalIds]
          );
          if (professionals.rowCount !== professionalIds.length) {
            throw Object.assign(new Error('Um ou mais profissionais não pertencem a esta clínica ou estão inativos.'), { statusCode: 400 });
          }
        }

        const inserted = await client.query(
          `INSERT INTO services (clinic_id, name, description, duration_minutes, price)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            req.clinicId,
            req.body.name.trim(),
            req.body.description?.trim() || null,
            req.body.durationMinutes,
            req.body.price,
          ]
        );

        for (const professionalId of professionalIds) {
          await client.query(
            `INSERT INTO professional_services (clinic_id, professional_id, service_id)
             VALUES ($1, $2, $3)`,
            [req.clinicId, professionalId, inserted.rows[0].id]
          );
          await auditLogger({
            clinicId: req.clinicId,
            userId: req.user.userId,
            entityType: 'services',
            entityId: inserted.rows[0].id,
            action: 'professional_assigned',
            details: { professionalId },
          }, client);
        }

        await auditLogger({
          clinicId: req.clinicId,
          userId: req.user.userId,
          entityType: 'services',
          entityId: inserted.rows[0].id,
          action: 'created',
          details: { name: inserted.rows[0].name },
        }, client);

        return inserted;
      });

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ ok: false, message: 'Já existe um serviço com este nome nesta clínica.' });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ ok: false, message: error.message });
      }
      return next(error);
    }
  });

  router.put('/:id', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    if (!isUuid(req.params.id) || !isUpdateServiceRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de serviço inválidos ou campos não permitidos.' });
    }

    const fieldMap = {
      name: ['name', (value) => value.trim()],
      description: ['description', (value) => value?.trim() || null],
      durationMinutes: ['duration_minutes', (value) => value],
      price: ['price', (value) => value],
    };

    try {
      const result = await transactionExecutor(async (client) => {
        const values = [req.params.id, req.clinicId];
        const assignments = Object.entries(fieldMap)
          .filter(([key]) => Object.prototype.hasOwnProperty.call(req.body, key))
          .map(([key, [column, normalize]]) => {
            values.push(normalize(req.body[key]));
            return `${column} = $${values.length}`;
          });
        assignments.push('updated_at = NOW()');

        if (Object.prototype.hasOwnProperty.call(req.body, 'professionalIds')) {
          const { professionalIds } = req.body;
          if (professionalIds.length > 0) {
            const professionals = await client.query(
              `SELECT id FROM professionals
               WHERE clinic_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
              [req.clinicId, professionalIds]
            );
            if (professionals.rowCount !== professionalIds.length) {
              throw Object.assign(new Error('Um ou mais profissionais não pertencem a esta clínica ou estão inativos.'), { statusCode: 400 });
            }
          }

          const serviceStatus = await client.query(
            'SELECT is_active FROM services WHERE id = $1 AND clinic_id = $2 FOR UPDATE',
            [req.params.id, req.clinicId]
          );
          if (serviceStatus.rowCount === 0) return { status: 404 };
          if (!serviceStatus.rows[0].is_active && professionalIds.length > 0) {
            const existing = await client.query(
              `SELECT professional_id FROM professional_services
               WHERE clinic_id = $1 AND service_id = $2`,
              [req.clinicId, req.params.id]
            );
            const existingIds = new Set(existing.rows.map((row) => row.professional_id));
            if (professionalIds.some((professionalId) => !existingIds.has(professionalId))) {
              return { status: 409 };
            }
          }
        }

        const updated = await client.query(
          `UPDATE services
           SET ${assignments.join(', ')}
           WHERE id = $1 AND clinic_id = $2
           RETURNING *`,
          values
        );

        if (updated.rowCount === 0) return updated;

        if (Object.prototype.hasOwnProperty.call(req.body, 'professionalIds')) {
          const existing = await client.query(
            `SELECT professional_id FROM professional_services
             WHERE clinic_id = $1 AND service_id = $2
             FOR UPDATE`,
            [req.clinicId, req.params.id]
          );
          const existingIds = new Set(existing.rows.map((row) => row.professional_id));
          const requestedIds = new Set(req.body.professionalIds);
          await client.query(
            'DELETE FROM professional_services WHERE clinic_id = $1 AND service_id = $2',
            [req.clinicId, req.params.id]
          );
          for (const professionalId of req.body.professionalIds) {
            await client.query(
              `INSERT INTO professional_services (clinic_id, professional_id, service_id)
               VALUES ($1, $2, $3)`,
              [req.clinicId, professionalId, req.params.id]
            );
            if (!existingIds.has(professionalId)) {
              await auditLogger({
                clinicId: req.clinicId,
                userId: req.user.userId,
                entityType: 'services',
                entityId: req.params.id,
                action: 'professional_assigned',
                details: { professionalId },
              }, client);
            }
          }
          for (const professionalId of existingIds) {
            if (!requestedIds.has(professionalId)) {
              await auditLogger({
                clinicId: req.clinicId,
                userId: req.user.userId,
                entityType: 'services',
                entityId: req.params.id,
                action: 'professional_unassigned',
                details: { professionalId },
              }, client);
            }
          }
        }

        await auditLogger({
          clinicId: req.clinicId,
          userId: req.user.userId,
          entityType: 'services',
          entityId: updated.rows[0].id,
          action: 'updated',
          details: { fields: Object.keys(req.body) },
        }, client);
        return updated;
      });

      if (result.status === 404) {
        return res.status(404).json({ ok: false, message: 'Serviço não encontrado.' });
      }
      if (result.status === 409) {
        return res.status(409).json({ ok: false, message: 'Não é possível associar profissionais a um serviço inativo.' });
      }
      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Serviço não encontrado.' });
      }
      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ ok: false, message: 'Já existe um serviço com este nome nesta clínica.' });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({ ok: false, message: error.message });
      }
      return next(error);
    }
  });

  router.patch('/:id/status', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    if (!isUuid(req.params.id) || !isServiceStatusRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Status de serviço inválido.' });
    }

    try {
      const result = await transactionExecutor(async (client) => {
        const updated = await client.query(
          `UPDATE services
           SET is_active = $3, updated_at = NOW()
           WHERE id = $1 AND clinic_id = $2
           RETURNING *`,
          [req.params.id, req.clinicId, req.body.isActive]
        );

        if (updated.rowCount === 0) return updated;

        await auditLogger({
          clinicId: req.clinicId,
          userId: req.user.userId,
          entityType: 'services',
          entityId: updated.rows[0].id,
          action: req.body.isActive ? 'activated' : 'deactivated',
        }, client);
        return updated;
      });

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Serviço não encontrado.' });
      }
      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id/professionals', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    if (!isUuid(req.params.id) || !isProfessionalServiceAssignmentRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Lista de profissionais inválida.' });
    }

    try {
      const result = await transactionExecutor(async (client) => {
        const serviceResult = await client.query(
          'SELECT id, is_active FROM services WHERE id = $1 AND clinic_id = $2 FOR UPDATE',
          [req.params.id, req.clinicId]
        );
        if (serviceResult.rowCount === 0) return { status: 404 };

        const { professionalIds } = req.body;
        if (professionalIds.length > 0) {
          if (!serviceResult.rows[0].is_active) return { status: 409 };
          const professionals = await client.query(
            `SELECT id FROM professionals
             WHERE clinic_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
            [req.clinicId, professionalIds]
          );
          if (professionals.rowCount !== professionalIds.length) return { status: 400 };
        }

        const existing = await client.query(
          `SELECT professional_id FROM professional_services
           WHERE clinic_id = $1 AND service_id = $2
           FOR UPDATE`,
          [req.clinicId, req.params.id]
        );
        const existingIds = new Set(existing.rows.map((row) => row.professional_id));
        const requestedIds = new Set(professionalIds);

        await client.query(
          'DELETE FROM professional_services WHERE clinic_id = $1 AND service_id = $2',
          [req.clinicId, req.params.id]
        );

        for (const professionalId of professionalIds) {
          await client.query(
            `INSERT INTO professional_services (clinic_id, professional_id, service_id)
             VALUES ($1, $2, $3)`,
            [req.clinicId, professionalId, req.params.id]
          );
          if (!existingIds.has(professionalId)) {
            await auditLogger({
              clinicId: req.clinicId,
              userId: req.user.userId,
              entityType: 'services',
              entityId: req.params.id,
              action: 'professional_assigned',
              details: { professionalId },
            }, client);
          }
        }

        for (const professionalId of existingIds) {
          if (!requestedIds.has(professionalId)) {
            await auditLogger({
              clinicId: req.clinicId,
              userId: req.user.userId,
              entityType: 'services',
              entityId: req.params.id,
              action: 'professional_unassigned',
              details: { professionalId },
            }, client);
          }
        }
        return { status: 200 };
      });

      if (result.status === 404) {
        return res.status(404).json({ ok: false, message: 'Serviço não encontrado.' });
      }
      if (result.status === 409) {
        return res.status(409).json({ ok: false, message: 'Não é possível associar profissionais a um serviço inativo.' });
      }
      if (result.status === 400) {
        return res.status(400).json({ ok: false, message: 'Um ou mais profissionais não pertencem a esta clínica ou estão inativos.' });
      }
      return res.status(200).json({ ok: true, data: { professionalIds: req.body.professionalIds } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
