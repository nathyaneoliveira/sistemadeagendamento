import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireClinicAccess);

router.get('/', authorizeRoles('admin', 'reception'), async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM clinic_configurations WHERE clinic_id = $1',
      [req.clinicId]
    );

    return res.status(200).json({ ok: true, data: result.rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authorizeRoles('admin'), async (req, res, next) => {
  try {
    const { name, logoUrl, phone, whatsapp, addressLine1, addressLine2, email, openingHours, serviceInfo } = req.body;

    const existing = await query(
      'SELECT id FROM clinic_configurations WHERE clinic_id = $1',
      [req.clinicId]
    );

    if (existing.rowCount > 0) {
      const result = await query(
        `UPDATE clinic_configurations
         SET name = COALESCE($3, name), logo_url = COALESCE($4, logo_url), phone = COALESCE($5, phone),
             whatsapp = COALESCE($6, whatsapp), address_line1 = COALESCE($7, address_line1),
             address_line2 = COALESCE($8, address_line2), email = COALESCE($9, email),
             opening_hours = COALESCE($10, opening_hours), service_info = COALESCE($11, service_info), updated_at = NOW()
         WHERE clinic_id = $1
         RETURNING *`,
        [req.clinicId, req.clinicId, name || null, logoUrl || null, phone || null, whatsapp || null,
          addressLine1 || null, addressLine2 || null, email || null, openingHours || null, serviceInfo || null]
      );

      return res.status(200).json({ ok: true, data: result.rows[0] });
    }

    const result = await query(
      `INSERT INTO clinic_configurations (clinic_id, name, logo_url, phone, whatsapp, address_line1, address_line2, email, opening_hours, service_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.clinicId, name || null, logoUrl || null, phone || null, whatsapp || null, addressLine1 || null,
        addressLine2 || null, email || null, openingHours || null, serviceInfo || null]
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
