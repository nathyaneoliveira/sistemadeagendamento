import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

export const loginLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
});

export const apiLimiter = new RateLimiterMemory({
  points: 100,
  duration: 60,
});

export const appointmentLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
});

export const publicApiLimiter = new RateLimiterMemory({
  points: 120,
  duration: 60,
});

export const publicAppointmentLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
});

export function rateLimitMiddleware(limiter) {
  return async (req, res, next) => {
    try {
      const key = req.ip || 'unknown';
      await limiter.consume(key);
      return next();
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        return res.status(429).json({
          ok: false,
          message: 'Muitas tentativas. Tente novamente mais tarde.',
        });
      }

      return next(error);
    }
  };
}
