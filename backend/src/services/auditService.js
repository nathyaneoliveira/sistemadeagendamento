import { query } from '../db/index.js';

export async function logAudit({ clinicId, userId, entityType, entityId, action, details }) {
  await query(
    `INSERT INTO audit_logs (clinic_id, user_id, entity_type, entity_id, action, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [clinicId, userId || null, entityType, entityId || null, action, details ? JSON.stringify(details) : null]
  );
}
