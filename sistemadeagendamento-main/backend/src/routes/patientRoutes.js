import { Router } from 'express';
import { query, withTransaction } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import {
  assertPlanResourceLimit,
  requireActivePlanSubscription,
} from '../services/planAccess.js';
import { isCreatePatientRequest, isUpdatePatientRequest } from './patientValidation.js';

export function createPatientRouter({
  queryExecutor = query,
  transactionExecutor = withTransaction,
  authenticate = authenticateToken,
  checkPlanLimit = assertPlanResourceLimit,
  requireActiveSubscription = requireActivePlanSubscription(),
} = {}) {
  const router = Router();

  router.use(authenticate);
  router.use(requireClinicAccess);
  router.use(requireActiveSubscription);

  router.get('/', async (req, res, next) => {
    try {
      const { role } = req.user;
      let queryText = 'SELECT p.* FROM patients p WHERE p.clinic_id = $1';
      const values = [req.clinicId];

      if (role === 'patient') {
        queryText += ' AND p.user_id = $2';
        values.push(req.user.userId);
      }

      if (role === 'professional') {
        queryText += ` AND EXISTS (
          SELECT 1
          FROM appointments a
          JOIN professionals pr
            ON pr.id = a.professional_id
           AND pr.clinic_id = a.clinic_id
          WHERE a.patient_id = p.id
            AND a.clinic_id = p.clinic_id
            AND a.clinic_id = $1
            AND pr.user_id = $2
        )`;
        values.push(req.user.userId);
      }

      queryText += ' ORDER BY p.created_at DESC';

      const result = await queryExecutor(queryText, values);
      return res.status(200).json({ ok: true, data: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
    try {
      if (!isCreatePatientRequest(req.body)) {
        return res.status(400).json({ ok: false, message: 'Dados do paciente inválidos.' });
      }
      const { name, cpf, birthDate, phone, email, userId, status } = req.body;

      const result = await transactionExecutor(async (client) => {
        await checkPlanLimit(client, req.clinicId, 'patients');
        if (userId) {
          const userResult = await client.query(
            `SELECT id FROM users
             WHERE id = $1 AND clinic_id = $2 AND role = 'patient' AND status = 'active'`,
            [userId, req.clinicId]
          );

          if (userResult.rowCount === 0) {
            throw Object.assign(new Error('Usuário paciente inválido para esta clínica.'), { statusCode: 400 });
          }
        }

        return client.query(
          `INSERT INTO patients (clinic_id, user_id, name, cpf, birth_date, phone, email, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [req.clinicId, userId || null, name, cpf || null, birthDate || null, phone || null, email || null, status || 'active']
        );
      });

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { role } = req.user;
      let queryText = 'SELECT p.* FROM patients p WHERE p.id = $1 AND p.clinic_id = $2';
      const values = [req.params.id, req.clinicId];

      if (role === 'patient') {
        queryText += ' AND p.user_id = $3';
        values.push(req.user.userId);
      }

      if (role === 'professional') {
        queryText += ` AND EXISTS (
          SELECT 1
          FROM appointments a
          JOIN professionals pr
            ON pr.id = a.professional_id
           AND pr.clinic_id = a.clinic_id
          WHERE a.patient_id = p.id
            AND a.clinic_id = p.clinic_id
            AND a.clinic_id = $2
            AND pr.user_id = $3
        )`;
        values.push(req.user.userId);
      }

      const result = await queryExecutor(queryText, values);

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Paciente não encontrado.' });
      }

      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id', authorizeRoles('admin', 'reception'), async (req, res, next) => {
    try {
      if (!isUpdatePatientRequest(req.body)) {
        return res.status(400).json({ ok: false, message: 'Dados do paciente inválidos.' });
      }
      const { name, cpf, birthDate, phone, email, status } = req.body;

      const result = await queryExecutor(
        `UPDATE patients
         SET name = COALESCE($3, name), cpf = COALESCE($4, cpf), birth_date = COALESCE($5, birth_date),
             phone = COALESCE($6, phone), email = COALESCE($7, email), status = COALESCE($8, status), updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        [req.params.id, req.clinicId, name || null, cpf || null, birthDate || null, phone || null, email || null, status || null]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Paciente não encontrado.' });
      }

      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createPatientRouter();
