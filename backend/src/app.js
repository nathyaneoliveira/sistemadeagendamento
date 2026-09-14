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
import { apiLimiter, appointmentLimiter, loginLimiter, rateLimitMiddleware } from './middlewares/rateLimiter.js';

export const app = express();

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors({
  origin: env.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Sistema de agendamento online',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

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

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: 'Rota não encontrada',
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  const statusCode = err.statusCode || 500;
  const message = env.nodeEnv === 'production'
    ? 'Erro interno do servidor'
    : err.message || 'Erro interno do servidor';

  res.status(statusCode).json({
    ok: false,
    message,
  });
});
