import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { requireActivePlanSubscription, requirePlanCapability } from '../services/planAccess.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);
router.use(requireActivePlanSubscription());

router.get('/', authorizeRoles('admin', 'reception'), requirePlanCapability('audit'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.*, u.name AS user_name
       FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id AND u.clinic_id = a.clinic_id
       WHERE a.clinic_id = $1
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [req.clinicId]
    );

    return res.status(200).json({ ok: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

export default router;
