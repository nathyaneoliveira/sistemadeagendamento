import { Router } from 'express';
import { authenticatePlatformAdmin } from '../middlewares/platformAdminAuth.js';
import {
  loginPlatformAdmin,
  revokePlatformAdminSession,
  writePlatformAudit,
} from '../services/platformAdminAuthService.js';
import { createPlatformAdminService } from '../services/platformAdminService.js';
import { MAX_PASSWORD_INPUT_LENGTH } from '../utils/passwordPolicy.js';

export function createPlatformAdminRouter({
  authenticate = authenticatePlatformAdmin,
  login = loginPlatformAdmin,
  revokeSession = revokePlatformAdminSession,
  service = createPlatformAdminService(),
  auditLogger = writePlatformAudit,
  loginRateLimit = (req, res, next) => next(),
} = {}) {
  const router = Router();

  router.post('/auth/login', loginRateLimit, async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (
        typeof email !== 'string' ||
        !email.trim() ||
        email.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' ||
        password.length === 0 ||
        password.length > MAX_PASSWORD_INPUT_LENGTH
      ) {
        return res.status(400).json({ ok: false, message: 'Informe um e-mail e uma senha válidos.' });
      }

      const data = await login({ email: email.trim().toLowerCase(), password, requestId: req.requestId });
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/me', authenticate, async (req, res, next) => {
    try {
      await auditLogger({
        platformAdminId: req.platformAdmin.id,
        action: 'platform.auth.session_view',
        requestId: req.requestId,
      });
      return res.status(200).json({ ok: true, data: { user: req.platformAdmin } });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/auth/logout', authenticate, async (req, res, next) => {
    try {
      await revokeSession({
        platformAdminId: req.platformAdmin.id,
        requestId: req.requestId,
      });
      return res.status(200).json({ ok: true, message: 'Sessão administrativa encerrada.' });
    } catch (error) {
      return next(error);
    }
  });

  router.use(authenticate);

  router.get('/dashboard', async (req, res, next) => {
    try {
      const data = await service.getDashboard(
        { from: req.query.from, to: req.query.to },
        { id: req.platformAdmin.id, requestId: req.requestId }
      );
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/clinics', async (req, res, next) => {
    try {
      const result = await service.listClinics(req.query, {
        id: req.platformAdmin.id,
        requestId: req.requestId,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/clinics/:clinicId', async (req, res, next) => {
    try {
      const data = await service.getClinicDetails(req.params.clinicId, {
        id: req.platformAdmin.id,
        requestId: req.requestId,
      });
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/subscriptions', async (req, res, next) => {
    try {
      const result = await service.listSubscriptions(req.query, {
        id: req.platformAdmin.id,
        requestId: req.requestId,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/events', async (req, res, next) => {
    try {
      const result = await service.listRecentEvents(req.query, {
        id: req.platformAdmin.id,
        requestId: req.requestId,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
