import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { assertPlanResourceLimit, requireActivePlanSubscription } from '../services/planAccess.js';
import { logAudit } from '../services/auditService.js';
import { isCreateProfessionalRequest, isUpdateProfessionalRequest } from './professionalValidation.js';

const router = Router();
const PROFESSIONAL_STATUSES = new Set(['active', 'inactive']);

router.use(authenticateToken);
router.use(requireClinicAccess);
router.use(requireActivePlanSubscription());

router.get('/', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = `
      SELECT p.*, s.name AS specialty_name
      FROM professionals p
      LEFT JOIN specialties s ON s.id = p.specialty_id AND s.clinic_id = p.clinic_id
      WHERE p.clinic_id = $1
    `;
    const values = [req.clinicId];

    if (role === 'professional') {
      queryText += ' AND p.user_id = $2';
      values.push(req.user.userId);
    }

    queryText += ' ORDER BY p.name ASC';

    const result = await query(queryText, values);
    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    if (!isCreateProfessionalRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de profissional inválidos.' });
    }
    const { name, specialtyId, userId, crm, phone, status } = req.body;

    const professionalStatus = status === undefined ? 'active' : status;

    const result = await withTransaction(async (client) => {
      if (professionalStatus === 'active') {
        await assertPlanResourceLimit(client, req.clinicId, 'professionals');
      }
      const specialtyResult = await client.query(
        'SELECT id FROM specialties WHERE id = $1 AND clinic_id = $2',
        [specialtyId, req.clinicId]
      );

      if (specialtyResult.rowCount === 0) {
        throw Object.assign(new Error('Especialidade inválida para esta clínica.'), { statusCode: 400 });
      }

      if (userId) {
        const userResult = await client.query(
          `SELECT id FROM users
           WHERE id = $1 AND clinic_id = $2 AND role = 'professional' AND status = 'active'`,
          [userId, req.clinicId]
        );

        if (userResult.rowCount === 0) {
          throw Object.assign(new Error('Usuário profissional inválido para esta clínica.'), { statusCode: 400 });
        }
      }

      const result = await client.query(
        `INSERT INTO professionals (clinic_id, user_id, specialty_id, name, crm, phone, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.clinicId, userId || null, specialtyId, name, crm || null, phone || null, professionalStatus]
      );
      const professional = result.rows[0];

      await logAudit({
        clinicId: req.clinicId,
        userId: req.user.userId,
        entityType: 'professionals',
        entityId: professional.id,
        action: 'professional.created',
        details: { status: professional.status },
      }, client);

      return result;
    });

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { role } = req.user;
    let queryText = `
      SELECT p.*, s.name AS specialty_name
      FROM professionals p
      LEFT JOIN specialties s ON s.id = p.specialty_id AND s.clinic_id = p.clinic_id
      WHERE p.id = $1 AND p.clinic_id = $2
    `;
    const values = [req.params.id, req.clinicId];

    if (role === 'professional') {
      queryText += ' AND p.user_id = $3';
      values.push(req.user.userId);
    }

    const result = await query(queryText, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    if (!isUpdateProfessionalRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de profissional inválidos.' });
    }
    const { name, specialtyId, crm, phone, status } = req.body;

    const updated = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT id, status FROM professionals WHERE id = $1 AND clinic_id = $2 FOR UPDATE',
        [req.params.id, req.clinicId]
      );
      if (existing.rowCount === 0) return null;

      const current = existing.rows[0];
      if (status === 'active' && current.status !== 'active') {
        await assertPlanResourceLimit(client, req.clinicId, 'professionals');
      }

      if (specialtyId) {
        const specialtyResult = await client.query(
          'SELECT id FROM specialties WHERE id = $1 AND clinic_id = $2',
          [specialtyId, req.clinicId]
        );
        if (specialtyResult.rowCount === 0) {
          throw Object.assign(new Error('Especialidade inválida para esta clínica.'), { statusCode: 400 });
        }
      }

      const fields = [];
      const values = [req.params.id, req.clinicId];
      let index = 3;

      if (name) {
        fields.push(`name = $${index}`); values.push(name); index += 1;
      }
      if (specialtyId) {
        fields.push(`specialty_id = $${index}`); values.push(specialtyId); index += 1;
      }
      if (crm !== undefined) {
        fields.push(`crm = $${index}`); values.push(crm); index += 1;
      }
      if (phone !== undefined) {
        fields.push(`phone = $${index}`); values.push(phone); index += 1;
      }
      if (status !== undefined) {
        fields.push(`status = $${index}`); values.push(status); index += 1;
      }

      const result = await client.query(
        `UPDATE professionals
         SET ${fields.join(', ')}
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        values
      );
      const professional = result.rows[0];

      await logAudit({
        clinicId: req.clinicId,
        userId: req.user.userId,
        entityType: 'professionals',
        entityId: professional.id,
        action: status && status !== current.status
          ? `professional.${status === 'active' ? 'activated' : 'deactivated'}`
          : 'professional.updated',
        details: {
          changedFields: Object.keys(req.body),
          previousStatus: current.status,
          status: professional.status,
        },
      }, client);

      return professional;
    });

    if (!updated) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: updated });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
});

router.patch('/:id/status', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ ok: false, message: 'Status é obrigatório.' });
    }
    if (!PROFESSIONAL_STATUSES.has(status)) {
      return res.status(400).json({ ok: false, message: 'Status de profissional inválido.' });
    }

    const professional = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT id, status FROM professionals WHERE id = $1 AND clinic_id = $2 FOR UPDATE',
        [req.params.id, req.clinicId]
      );
      if (existing.rowCount === 0) return null;

      const current = existing.rows[0];
      if (status === 'active' && current.status !== 'active') {
        await assertPlanResourceLimit(client, req.clinicId, 'professionals');
      }

      const result = await client.query(
        `UPDATE professionals
         SET status = $3, updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        [req.params.id, req.clinicId, status]
      );
      const updated = result.rows[0];

      if (status !== current.status) {
        await logAudit({
          clinicId: req.clinicId,
          userId: req.user.userId,
          entityType: 'professionals',
          entityId: updated.id,
          action: `professional.${status === 'active' ? 'activated' : 'deactivated'}`,
          details: { previousStatus: current.status, status: updated.status },
        }, client);
      }

      return updated;
    });

    if (!professional) {
      return res.status(404).json({ ok: false, message: 'Profissional não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: professional });
  } catch (error) {
    return next(error);
  }
});

export default router;
