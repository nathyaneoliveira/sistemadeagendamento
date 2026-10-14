import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { requireActivePlanSubscription } from '../services/planAccess.js';
import { isCreateSpecialtyRequest, isUpdateSpecialtyRequest, isUuid } from './specialtyValidation.js';

export function createSpecialtyRouter({
  queryExecutor = query,
  authenticate = authenticateToken,
  authorizeRolesMiddleware = authorizeRoles,
  requireClinicAccessMiddleware = requireClinicAccess,
  requireActiveSubscriptionMiddleware = requireActivePlanSubscription(),
} = {}) {
  const router = Router();

  router.use(authenticate);
  router.use(requireClinicAccessMiddleware);
  router.use(requireActiveSubscriptionMiddleware);

  router.get('/', async (req, res, next) => {
    try {
      const result = await queryExecutor(
        'SELECT * FROM specialties WHERE clinic_id = $1 ORDER BY name ASC',
        [req.clinicId]
      );

      return res.status(200).json({ ok: true, data: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    if (!isCreateSpecialtyRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de especialidade inválidos ou campos não permitidos.' });
    }

    try {
      const { name, description, status } = req.body;

      const result = await queryExecutor(
        `INSERT INTO specialties (clinic_id, name, description, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [req.clinicId, name, description || null, status || 'active']
      );

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, message: 'Identificador de especialidade inválido.' });
    }

    try {
      const result = await queryExecutor(
        'SELECT * FROM specialties WHERE id = $1 AND clinic_id = $2',
        [req.params.id, req.clinicId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Especialidade não encontrada.' });
      }

      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, message: 'Identificador de especialidade inválido.' });
    }
    if (!isUpdateSpecialtyRequest(req.body)) {
      return res.status(400).json({ ok: false, message: 'Dados de especialidade inválidos ou campos não permitidos.' });
    }

    try {
      const { name, description, status } = req.body;
      const result = await queryExecutor(
        `UPDATE specialties
         SET name = COALESCE($3, name), description = COALESCE($4, description), status = COALESCE($5, status), updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        [req.params.id, req.clinicId, name || null, description || null, status || null]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Especialidade não encontrada.' });
      }

      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createSpecialtyRouter();
