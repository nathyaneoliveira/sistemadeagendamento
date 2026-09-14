import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);

router.get('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, a.code AS appointment_code
       FROM payments p
       LEFT JOIN appointments a ON a.id = p.appointment_id
       WHERE p.clinic_id = $1
       ORDER BY p.created_at DESC`,
      [req.clinicId]
    );

    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { appointmentId, amount, currency, paymentMode, provider, status } = req.body;

    if (!appointmentId || !amount) {
      return res.status(400).json({ ok: false, message: 'appointmentId e amount são obrigatórios.' });
    }

    const appointmentCheck = await query(
      'SELECT id FROM appointments WHERE id = $1 AND clinic_id = $2',
      [appointmentId, req.clinicId]
    );

    if (appointmentCheck.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Agendamento não encontrado para esta clínica.' });
    }

    const result = await query(
      `INSERT INTO payments (clinic_id, appointment_id, provider, amount, currency, payment_mode, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.clinicId, appointmentId, provider || 'internal', Number(amount), currency || 'BRL', paymentMode || 'before', status || 'pending']
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['pending', 'paid', 'cancelled', 'refunded'];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, message: 'Status de pagamento inválido.' });
    }

    const result = await query(
      `UPDATE payments
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND clinic_id = $2
       RETURNING *`,
      [req.params.id, req.clinicId, status]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Pagamento não encontrado.' });
    }

    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
