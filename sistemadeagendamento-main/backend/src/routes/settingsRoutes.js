import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { isValidTimeZone } from '../services/clinicTime.js';
import { isPublicClinicSlug } from './publicBookingValidation.js';
import { requireActivePlanSubscription } from '../services/planAccess.js';

import { isClinicSettingsRequest } from './settingsValidation.js';

export function createSettingsRouter({
  queryExecutor = query,
  authenticate = authenticateToken,
  requireClinic = requireClinicAccess,
  requireActiveSubscription = requireActivePlanSubscription(),
  authorizeRolesMiddleware = authorizeRoles,
} = {}) {
  const router = Router();

  router.use(authenticate);
  router.use(requireClinic);
  router.use(requireActiveSubscription);

  router.get('/', authorizeRolesMiddleware('admin', 'reception'), async (req, res, next) => {
    try {
      const result = await queryExecutor(
        'SELECT * FROM clinic_configurations WHERE clinic_id = $1',
        [req.clinicId]
      );

      return res.status(200).json({ ok: true, data: result.rows[0] || null });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', authorizeRolesMiddleware('admin'), async (req, res, next) => {
    try {
      if (!isClinicSettingsRequest(req.body)) {
        return res.status(400).json({ ok: false, message: 'Dados de configuração inválidos.' });
      }
      const { name, logoUrl, phone, whatsapp, addressLine1, addressLine2, email, openingHours, serviceInfo, timezone } = req.body;
      if (
        timezone !== undefined &&
        (Array.from(timezone).length > 64 || !isValidTimeZone(timezone))
      ) {
        return res.status(400).json({ ok: false, message: 'Informe um fuso horário IANA válido, por exemplo America/Sao_Paulo.' });
      }
      const publicSlug = req.body.publicSlug;
      if (
        publicSlug !== undefined &&
        publicSlug !== null &&
        publicSlug !== '' &&
        !isPublicClinicSlug(publicSlug)
      ) {
        return res.status(400).json({ ok: false, message: 'Identificador público inválido. Use letras minúsculas, números e hífens.' });
      }
      const normalizedPublicSlug = typeof publicSlug === 'string' ? publicSlug.trim() || null : null;

      const existing = await queryExecutor(
        'SELECT id FROM clinic_configurations WHERE clinic_id = $1',
        [req.clinicId]
      );

      if (existing.rowCount > 0) {
        const result = await queryExecutor(
          `UPDATE clinic_configurations
           SET name = COALESCE($2, name), logo_url = COALESCE($3, logo_url), phone = COALESCE($4, phone),
               whatsapp = COALESCE($5, whatsapp), address_line1 = COALESCE($6, address_line1),
               address_line2 = COALESCE($7, address_line2), email = COALESCE($8, email),
               opening_hours = COALESCE($9, opening_hours), service_info = COALESCE($10, service_info),
               timezone = COALESCE($11, timezone),
               public_slug = CASE WHEN $12::boolean THEN $13::text ELSE public_slug END,
               updated_at = NOW()
           WHERE clinic_id = $1
           RETURNING *`,
          [req.clinicId, name || null, logoUrl || null, phone || null, whatsapp || null,
            addressLine1 || null, addressLine2 || null, email || null, openingHours || null, serviceInfo || null,
            timezone || null, publicSlug !== undefined, normalizedPublicSlug]
        );

        return res.status(200).json({ ok: true, data: result.rows[0] });
      }

      const result = await queryExecutor(
        `INSERT INTO clinic_configurations (clinic_id, name, logo_url, phone, whatsapp, address_line1, address_line2, email, opening_hours, service_info, timezone, public_slug)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [req.clinicId, name || null, logoUrl || null, phone || null, whatsapp || null, addressLine1 || null,
          addressLine2 || null, email || null, openingHours || null, serviceInfo || null, timezone || 'UTC', normalizedPublicSlug]
      );

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'uq_clinic_configurations_public_slug') {
        return res.status(409).json({ ok: false, message: 'Este identificador público já está em uso.' });
      }
      return next(error);
    }
  });

  return router;
}

export default createSettingsRouter();
