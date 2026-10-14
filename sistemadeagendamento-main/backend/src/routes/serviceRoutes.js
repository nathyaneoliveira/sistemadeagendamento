import { query, withTransaction } from '../db/index.js';
import { authenticateToken, authorizeRoles, requireClinicAccess } from '../middlewares/auth.js';
import { logAudit } from '../services/auditService.js';
import { requireActivePlanSubscription } from '../services/planAccess.js';
import { createServiceRouter as createServiceRouterWithDependencies } from './serviceRouterFactory.js';

export function createServiceRouter(options = {}) {
  return createServiceRouterWithDependencies({
    queryExecutor: query,
    transactionExecutor: withTransaction,
    authenticate: authenticateToken,
    authorizeRoles,
    requireClinicAccess,
    requireActiveSubscription: requireActivePlanSubscription(),
    logAudit,
    ...options,
  });
}

export default createServiceRouter();
