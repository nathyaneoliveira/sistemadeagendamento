import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import authRoutes from './routes/authRoutes.js';
import clinicRoutes from './routes/clinicRoutes.js';
import professionalRoutes from './routes/professionalRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import specialtyRoutes from './routes/specialtyRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import { createPlatformAdminRouter } from './routes/platformAdminRoutes.js';
import { createServiceRouter } from './routes/serviceRoutes.js';
import { createPublicBookingRouter } from './routes/publicBookingRouterFactory.js';
import { pool, query, withTransaction } from './db/index.js';
import { logAudit } from './services/auditService.js';
import { createReadinessHandler } from './healthChecks.js';
import { createApiErrorHandler } from './httpErrorHandler.js';
import { requestIdMiddleware } from './requestContext.js';
import {
  apiLimiter,
  appointmentLimiter,
  loginLimiter,
  publicApiLimiter,
  publicAppointmentLimiter,
  rateLimitMiddleware,
} from './middlewares/rateLimiter.js';

export const app = express();

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      styleSrc: ["'self'"],
    },
  },
}));
app.use(cors({
  origin: env.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(requestIdMiddleware());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.get(['/api/health', '/api/health/live'], (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Sistema de agendamento online',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/ready', createReadinessHandler(() => pool.query('SELECT 1')));

app.use('/api/auth', rateLimitMiddleware(loginLimiter), authRoutes);
app.use('/api/clinics', rateLimitMiddleware(apiLimiter), clinicRoutes);
app.use('/api/professionals', rateLimitMiddleware(apiLimiter), professionalRoutes);
app.use('/api/patients', rateLimitMiddleware(apiLimiter), patientRoutes);
app.use('/api/schedules', rateLimitMiddleware(apiLimiter), scheduleRoutes);
app.use('/api/appointments', rateLimitMiddleware(appointmentLimiter), appointmentRoutes);
app.use('/api/specialties', rateLimitMiddleware(apiLimiter), specialtyRoutes);
app.use('/api/settings', rateLimitMiddleware(apiLimiter), settingsRoutes);
app.use('/api/audit', rateLimitMiddleware(apiLimiter), auditRoutes);
app.use('/api/payments', rateLimitMiddleware(apiLimiter), paymentRoutes);
app.use('/api/subscriptions', rateLimitMiddleware(apiLimiter), subscriptionRoutes);
app.use(
  '/api/platform',
  rateLimitMiddleware(apiLimiter),
  createPlatformAdminRouter({ loginRateLimit: rateLimitMiddleware(loginLimiter) })
);
app.use('/api/services', rateLimitMiddleware(apiLimiter), createServiceRouter());
app.use(
  '/api/public',
  rateLimitMiddleware(publicApiLimiter),
  createPublicBookingRouter({
    queryExecutor: query,
    transactionExecutor: withTransaction,
    auditLogger: logAudit,
    bookingRateLimit: rateLimitMiddleware(publicAppointmentLimiter),
  })
);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: 'Rota não encontrada',
  });
});

app.use(createApiErrorHandler({ isProduction: env.nodeEnv === 'production' }));
