import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db/index.js';
import { comparePassword, hashPassword } from '../utils/password.js';

export async function loginUser({ email, password, clinicId }) {
  const result = await query(
    `SELECT id, clinic_id, name, email, password_hash, role, status
     FROM users
     WHERE LOWER(email) = LOWER($1)
       AND clinic_id = $2`,
    [email, clinicId]
  );

  if (result.rowCount === 0) {
    throw Object.assign(new Error('Credenciais inválidas.'), { statusCode: 401 });
  }

  const user = result.rows[0];

  if (user.status !== 'active') {
    throw Object.assign(new Error('Usuário inativo.'), { statusCode: 403 });
  }

  const passwordMatches = await comparePassword(password, user.password_hash);

  if (!passwordMatches) {
    throw Object.assign(new Error('Credenciais inválidas.'), { statusCode: 401 });
  }

  const token = jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      clinicId: user.clinic_id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

  await query(
    'UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
    [user.id]
  );

  return {
    token,
    user: {
      id: user.id,
      clinicId: user.clinic_id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

export async function createUserAccount({ clinicId, name, email, password, role, phone }) {
  const existingUser = await query(
    'SELECT id FROM users WHERE clinic_id = $1 AND LOWER(email) = LOWER($2)',
    [clinicId, email]
  );

  if (existingUser.rowCount > 0) {
    throw Object.assign(new Error('Usuário já cadastrado nesta clínica.'), { statusCode: 409 });
  }

  const passwordHash = await hashPassword(password);

  const inserted = await query(
    `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     RETURNING id, clinic_id, name, email, phone, role`,
    [clinicId, name, email, passwordHash, phone, role]
  );

  return inserted.rows[0];
}
