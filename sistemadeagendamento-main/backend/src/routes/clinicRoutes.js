import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { requireActivePlanSubscription, requirePlanCapability } from '../services/planAccess.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);
router.use(requireActivePlanSubscription());

router.get('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM clinics WHERE id = $1', [req.clinicId]);
    return res.status(200).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/users', authorizeRoles('admin', 'reception'), requirePlanCapability('userManagement'), async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, email, role, phone, status FROM users WHERE clinic_id = $1 ORDER BY created_at DESC',
      [req.clinicId]
    );

    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

export default router;
