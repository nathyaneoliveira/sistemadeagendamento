import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { isCreatePaymentRequest, isPaymentStatusUpdate } from './paymentValidation.js';
import { isUuid } from './serviceValidation.js';
import { requireActivePlanSubscription, requirePlanCapability } from '../services/planAccess.js';

export function createPaymentRouter({
  queryExecutor = query,
  authenticate = authenticateToken,
  requireClinic = requireClinicAccess,
  requireActiveSubscription = requireActivePlanSubscription(),
  requirePaymentsCapability = requirePlanCapability('payments'),
  authorizeRolesMiddleware = authorizeRoles,
} = {}) {
  const router = Router();

  router.use(authenticate);
  router.use(requireClinic);
  router.use(requireActiveSubscription);
  router.use(requirePaymentsCapability);

  router.get('/', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    try {
      const result = await queryExecutor(
        `SELECT p.*, a.code AS appointment_code
         FROM payments p
        LEFT JOIN appointments a ON a.id = p.appointment_id AND a.clinic_id = p.clinic_id
         WHERE p.clinic_id = $1
         ORDER BY p.created_at DESC`,
        [req.clinicId]
      );

      return res.status(200).json({ ok: true, data: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    try {
      if (!isCreatePaymentRequest(req.body)) {
        return res.status(400).json({ ok: false, message: 'Dados de pagamento inválidos.' });
      }

      const { appointmentId, amount, currency, paymentMode, provider, status } = req.body;
      const appointmentCheck = await queryExecutor(
        'SELECT id FROM appointments WHERE id = $1 AND clinic_id = $2',
        [appointmentId, req.clinicId]
      );

      if (appointmentCheck.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Agendamento não encontrado para esta clínica.' });
      }

      const result = await queryExecutor(
        `INSERT INTO payments (clinic_id, appointment_id, provider, amount, currency, payment_mode, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.clinicId, appointmentId, provider || 'internal', amount, currency || 'BRL', paymentMode || 'before', status || 'pending']
      );

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id/status', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    try {
      if (!isUuid(req.params.id) || !isPaymentStatusUpdate(req.body)) {
        return res.status(400).json({ ok: false, message: 'Status de pagamento inválido.' });
      }

      const result = await queryExecutor(
        `UPDATE payments
         SET status = $3, updated_at = NOW()
         WHERE id = $1 AND clinic_id = $2
         RETURNING *`,
        [req.params.id, req.clinicId, req.body.status]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, message: 'Pagamento não encontrado.' });
      }

      return res.status(200).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createPaymentRouter();
