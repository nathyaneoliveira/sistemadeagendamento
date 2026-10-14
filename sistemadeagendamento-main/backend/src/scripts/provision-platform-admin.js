import { pool, withTransaction } from '../db/index.js';
import { hashPassword } from '../utils/password.js';
import { isValidNewPassword } from '../utils/passwordPolicy.js';
import { writePlatformAudit } from '../services/platformAdminAuthService.js';

const { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_PASSWORD } = process.env;

if (process.env.PLATFORM_ADMIN_PROVISIONING_CONFIRM !== 'CREATE_PLATFORM_ADMIN') {
  throw new Error('Provisionamento bloqueado: defina a confirmação explícita no ambiente do processo.');
}

if (
  typeof PLATFORM_ADMIN_EMAIL !== 'string' ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(PLATFORM_ADMIN_EMAIL.trim()) ||
  typeof PLATFORM_ADMIN_NAME !== 'string' ||
  !PLATFORM_ADMIN_NAME.trim() ||
  typeof PLATFORM_ADMIN_PASSWORD !== 'string' ||
  !isValidNewPassword(PLATFORM_ADMIN_PASSWORD)
) {
  throw new Error('Dados de provisionamento inválidos; senha deve conter ao menos 12 caracteres e no máximo 72 bytes em UTF-8.');
}

try {
  const passwordHash = await hashPassword(PLATFORM_ADMIN_PASSWORD);
  const adminId = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO platform_admin_accounts (email, name, password_hash)
       VALUES (LOWER($1), $2, $3)
       RETURNING id`,
      [PLATFORM_ADMIN_EMAIL.trim(), PLATFORM_ADMIN_NAME.trim(), passwordHash]
    );
    const id = result.rows[0].id;
    await writePlatformAudit({
      platformAdminId: id,
      action: 'platform.admin.provisioned',
      details: { source: 'operator_cli' },
    }, client);
    return id;
  });
  console.info(`Conta administrativa global provisionada. Identificador: ${adminId}`);
} catch {
  console.error('Falha no provisionamento administrativo. Verifique a migration, a conexão e se o e-mail já foi cadastrado.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
