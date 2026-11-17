<?php
declare(strict_types=1);

$phase = null;
$baseUrl = null;
$concurrentBaseUrl = null;
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--help') {
        fwrite(STDOUT, "Usage: php security-integration.php --prepare|--test|--cleanup [--base-url=http://127.0.0.1:PORT]\n");
        exit(0);
    }
    if (str_starts_with($argument, '--base-url=')) {
        $baseUrl = substr($argument, strlen('--base-url='));
        continue;
    }
    if (str_starts_with($argument, '--concurrent-base-url=')) {
        $concurrentBaseUrl = substr($argument, strlen('--concurrent-base-url='));
        continue;
    }
    if ($argument === '--http-worker') {
        $phase = 'http-worker';
        continue;
    }
    if (in_array($argument, ['--prepare', '--test', '--cleanup'], true)) {
        if ($phase !== null) {
            fwrite(STDERR, "FAIL specify only one phase.\n");
            exit(2);
        }
        $phase = substr($argument, 2);
    }
}

if ($phase === null) {
    fwrite(STDERR, "FAIL a phase is required; use --help.\n");
    exit(2);
}

const IT_DATABASE = 'agendamento_php_security_test';
const IT_PORT = '5432';
const IT_SCHEMA_VERSION = 11;
const IT_PASSWORD = 'Synthetic-PHP-Integration-Password-2026!';
const IT_AUDIENCE = 'sistema-de-agendamentos-client';
const IT_PORTAL_TOKEN = 'Synthetic-Portal-Token-For-Isolated-Testing-Only';

const IT_IDS = [
    'clinicA' => '00000000-0000-4000-8000-000000000001',
    'clinicB' => '00000000-0000-4000-8000-000000000002',
    'adminA' => '00000000-0000-4000-8000-000000000011',
    'professionalUserA' => '00000000-0000-4000-8000-000000000012',
    'adminB' => '00000000-0000-4000-8000-000000000013',
    'selectionUserA' => '00000000-0000-4000-8000-000000000014',
    'selectionUserB' => '00000000-0000-4000-8000-000000000015',
    'patientA' => '00000000-0000-4000-8000-000000000021',
    'patientB' => '00000000-0000-4000-8000-000000000022',
    'specialtyA' => '00000000-0000-4000-8000-000000000031',
    'specialtyB' => '00000000-0000-4000-8000-000000000032',
    'professionalA' => '00000000-0000-4000-8000-000000000041',
    'professionalB' => '00000000-0000-4000-8000-000000000042',
    'serviceA' => '00000000-0000-4000-8000-000000000043',
    'appointmentA' => '00000000-0000-4000-8000-000000000051',
    'appointmentB' => '00000000-0000-4000-8000-000000000052',
    'paymentA' => '00000000-0000-4000-8000-000000000061',
    'paymentB' => '00000000-0000-4000-8000-000000000062',
];

function itAssert(bool $condition, string $message): void
{
    global $assertions;
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $assertions++;
}

function itDatabase(): PDO
{
    $host = getenv('DB_HOST');
    $port = getenv('DB_PORT');
    $name = getenv('DB_NAME');
    $user = getenv('DB_USER');
    $password = getenv('DB_PASSWORD');
    if ($host !== '127.0.0.1' || $port !== IT_PORT || $name !== IT_DATABASE ||
        !is_string($user) || trim($user) === '' || !is_string($password) || $password === '') {
        throw new RuntimeException('Integration database guard rejected the connection configuration.');
    }
    if (getenv('NODE_ENV') !== 'test' || getenv('NOA_ENV_FILE') !== 'php://memory') {
        throw new RuntimeException('Integration runtime must use NODE_ENV=test and must not load backend/.env.');
    }

    $pdo = new PDO(
        "pgsql:host=$host;port=$port;dbname=$name;sslmode=prefer",
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
    $pdo->exec('SET search_path TO public');
    $identity = $pdo->query(
        'SELECT current_database() AS database_name, current_user AS database_user,
                inet_server_port() AS server_port,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser'
    )->fetch();
    if (($identity['database_name'] ?? null) !== IT_DATABASE ||
        ($identity['database_user'] ?? null) !== $user ||
        (int)($identity['server_port'] ?? 0) !== (int)IT_PORT ||
        ($identity['is_superuser'] ?? true) !== false) {
        throw new RuntimeException('Integration database identity check failed.');
    }
    return $pdo;
}

function itMarkerExists(PDO $pdo): bool
{
    $value = $pdo->query("SELECT to_regclass('public.php_security_test_marker')")->fetchColumn();
    return $value !== false && $value !== null;
}

function itAssertEmptySchema(PDO $pdo): void
{
    $count = (int)$pdo->query(
        "SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')"
    )->fetchColumn();
    if ($count !== 0) {
        throw new RuntimeException('The dedicated database is not empty and has no recognized test marker; refusing to alter it.');
    }
}

function itEnsureSchema(PDO $pdo): void
{
    if (!itMarkerExists($pdo)) {
        itAssertEmptySchema($pdo);
        $schema = file_get_contents(__DIR__ . DIRECTORY_SEPARATOR . 'security-integration-schema.sql');
        if (!is_string($schema) || trim($schema) === '') {
            throw new RuntimeException('The isolated integration schema file is missing or empty.');
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec($schema);
            $pdo->prepare('INSERT INTO php_security_test_marker (version) VALUES (:version)')
                ->execute(['version' => IT_SCHEMA_VERSION]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    } else {
        $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
        if ($version === 1) {
            foreach (['clinics', 'users', 'subscriptions', 'clinic_configurations', 'specialties', 'patients', 'professionals', 'appointments', 'payments', 'audit_logs'] as $table) {
                if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                    throw new RuntimeException("The isolated test table $table is not empty; refusing to extend the test schema.");
                }
            }
            $pdo->beginTransaction();
            try {
                $pdo->exec(
                    'CREATE TABLE platform_admin_accounts (
                        id UUID PRIMARY KEY,
                        email VARCHAR(255) NOT NULL UNIQUE,
                        name VARCHAR(200) NOT NULL,
                        password_hash VARCHAR(255) NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT \'active\',
                        token_version INTEGER NOT NULL DEFAULT 0,
                        last_login_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    CREATE TABLE platform_audit_logs (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        platform_admin_id UUID REFERENCES platform_admin_accounts(id),
                        action VARCHAR(100) NOT NULL,
                        entity_type VARCHAR(100) NOT NULL,
                        entity_id UUID,
                        details JSONB,
                        request_id UUID,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )'
                );
                $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                    ->execute(['version' => 2]);
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $error;
            }
        }

        $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
        if ($version === 2) {
            foreach (['clinics', 'users', 'subscriptions', 'clinic_configurations', 'specialties', 'patients', 'professionals', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs'] as $table) {
                if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                    throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
                }
            }
            $pdo->beginTransaction();
            try {
                $pdo->exec('ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()');
                $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                    ->execute(['version' => 3]);
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $error;
            }
        }

        $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
        if ($version === 3) {
            foreach (['clinics', 'users', 'subscriptions', 'clinic_configurations', 'specialties', 'patients', 'professionals', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs'] as $table) {
                if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                    throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
                }
            }
            $pdo->beginTransaction();
            try {
                $pdo->exec('ALTER TABLE payments ALTER COLUMN id SET DEFAULT gen_random_uuid()');
                $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                    ->execute(['version' => 4]);
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $error;
            }
        }

        $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
        if ($version === 4) {
            foreach (['clinics', 'users', 'subscriptions', 'clinic_configurations', 'specialties', 'patients', 'professionals', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs'] as $table) {
                if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                    throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
                }
            }
            $pdo->beginTransaction();
            try {
                $pdo->exec(
                    'CREATE TABLE password_reset_tokens (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
                        user_id UUID NOT NULL,
                        token_hash CHAR(64) NOT NULL UNIQUE,
                        expires_at TIMESTAMPTZ NOT NULL,
                        used_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        FOREIGN KEY (clinic_id, user_id) REFERENCES users(clinic_id, id) ON DELETE CASCADE
                    )'
                );
                $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                    ->execute(['version' => 5]);
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $error;
            }
        }
    }

    $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
    if ($version === 5) {
        foreach (['clinics', 'users', 'subscriptions', 'clinic_configurations', 'specialties', 'patients', 'professionals', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs'] as $table) {
            if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
            }
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec('ALTER TABLE clinic_configurations ADD COLUMN public_slug VARCHAR(63)');
            $pdo->exec(
                'CREATE TABLE settings (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
                    key VARCHAR(100) NOT NULL,
                    value JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (clinic_id, key)
                )'
            );
            $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                ->execute(['version' => 6]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
    if ($version === 6) {
        foreach (['clinics', 'users', 'subscriptions', 'clinic_configurations', 'specialties', 'patients', 'professionals', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs', 'settings'] as $table) {
            if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
            }
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec(
                'ALTER TABLE clinic_configurations
                    ADD COLUMN name VARCHAR(200),
                    ADD COLUMN phone VARCHAR(20),
                    ADD COLUMN whatsapp VARCHAR(20),
                    ADD COLUMN address_line1 VARCHAR(255),
                    ADD COLUMN email VARCHAR(255)'
            );
            $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                ->execute(['version' => 7]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
    if ($version === 7) {
        foreach (['clinics', 'users', 'subscriptions', 'clinic_configurations', 'specialties', 'patients', 'professionals', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs', 'settings'] as $table) {
            if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
            }
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec(
                'ALTER TABLE patients ALTER COLUMN id SET DEFAULT gen_random_uuid();
                 ALTER TABLE patients ADD COLUMN reminder_consent_at TIMESTAMPTZ;
                 ALTER TABLE appointments ALTER COLUMN id SET DEFAULT gen_random_uuid();
                 ALTER TABLE appointments ADD COLUMN public_idempotency_key UUID;
                 CREATE UNIQUE INDEX uq_test_appointments_clinic_idempotency_key
                    ON appointments(clinic_id, public_idempotency_key)
                    WHERE public_idempotency_key IS NOT NULL;
                 CREATE TABLE services (
                    id UUID PRIMARY KEY,
                    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
                    name VARCHAR(200) NOT NULL,
                    description TEXT,
                    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
                    price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    UNIQUE (clinic_id, id)
                 );
                 CREATE TABLE professional_services (
                    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
                    professional_id UUID NOT NULL,
                    service_id UUID NOT NULL,
                    PRIMARY KEY (clinic_id, professional_id, service_id),
                    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE,
                    FOREIGN KEY (clinic_id, service_id) REFERENCES services(clinic_id, id) ON DELETE CASCADE
                 );
                 CREATE TABLE professional_schedules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
                    professional_id UUID NOT NULL,
                    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
                    start_time TIME NOT NULL,
                    end_time TIME NOT NULL CHECK (end_time > start_time),
                    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
                    break_duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_duration_minutes >= 0),
                    status VARCHAR(20) NOT NULL DEFAULT \'active\',
                    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE
                 );
                 CREATE TABLE schedule_blocks (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
                    professional_id UUID NOT NULL,
                    block_type VARCHAR(30) NOT NULL CHECK (block_type IN (\'vacation\', \'holiday\', \'meeting\', \'absence\', \'custom\')),
                    start_datetime TIMESTAMPTZ NOT NULL,
                    end_datetime TIMESTAMPTZ NOT NULL CHECK (end_datetime > start_datetime),
                    reason TEXT,
                    status VARCHAR(20) NOT NULL DEFAULT \'active\',
                    FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals(clinic_id, id) ON DELETE CASCADE
                 )'
            );
            $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                ->execute(['version' => 8]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
    if ($version === 8) {
        foreach (['clinics', 'users', 'password_reset_tokens', 'subscriptions', 'clinic_configurations', 'specialties', 'services', 'professional_services', 'patients', 'professionals', 'professional_schedules', 'schedule_blocks', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs', 'settings'] as $table) {
            if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
            }
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec(
                'ALTER TABLE patients ALTER COLUMN id SET DEFAULT gen_random_uuid();
                 ALTER TABLE appointments ALTER COLUMN id SET DEFAULT gen_random_uuid()'
            );
            $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                ->execute(['version' => 9]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
    if ($version === 9) {
        foreach (['clinics', 'users', 'password_reset_tokens', 'subscriptions', 'clinic_configurations', 'specialties', 'services', 'professional_services', 'patients', 'professionals', 'professional_schedules', 'schedule_blocks', 'appointments', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs', 'settings'] as $table) {
            if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
            }
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec(
                'CREATE TABLE appointment_access_tokens (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    clinic_id UUID NOT NULL,
                    appointment_id UUID NOT NULL,
                    token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ \'^[0-9a-f]{64}$\'),
                    expires_at TIMESTAMPTZ NOT NULL,
                    revoked_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    FOREIGN KEY (clinic_id, appointment_id)
                        REFERENCES appointments(clinic_id, id) ON DELETE CASCADE
                );
                CREATE INDEX idx_test_appointment_access_tokens
                    ON appointment_access_tokens(clinic_id, appointment_id, expires_at DESC)'
            );
            $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                ->execute(['version' => 10]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    $version = (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
    if ($version === 10) {
        foreach (['clinics', 'users', 'password_reset_tokens', 'subscriptions', 'clinic_configurations', 'specialties', 'services', 'professional_services', 'patients', 'professionals', 'professional_schedules', 'schedule_blocks', 'appointments', 'appointment_access_tokens', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs', 'settings'] as $table) {
            if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
                throw new RuntimeException("The isolated test table $table is not empty; refusing to update the test schema.");
            }
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec('ALTER TABLE subscriptions ADD COLUMN cancelled_at TIMESTAMPTZ');
            $pdo->prepare('UPDATE php_security_test_marker SET version = :version')
                ->execute(['version' => IT_SCHEMA_VERSION]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    $version = $pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn();
    if ((int)$version !== IT_SCHEMA_VERSION) {
        throw new RuntimeException('The integration schema marker is not recognized.');
    }
    foreach (['clinics', 'users', 'password_reset_tokens', 'subscriptions', 'clinic_configurations', 'specialties', 'services', 'professional_services', 'patients', 'professionals', 'professional_schedules', 'schedule_blocks', 'appointments', 'appointment_access_tokens', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs', 'settings'] as $table) {
        $count = (int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn();
        if ($count !== 0) {
            throw new RuntimeException("The isolated test table $table is not empty; refusing to reuse or remove existing records.");
        }
    }
}

function itSeed(PDO $pdo): void
{
    $passwordHash = password_hash(IT_PASSWORD, PASSWORD_BCRYPT, ['cost' => 4]);
    if (!is_string($passwordHash)) {
        throw new RuntimeException('Could not generate the synthetic fixture password hash.');
    }

    $pdo->beginTransaction();
    try {
        $clinic = $pdo->prepare('INSERT INTO clinics (id, name, trade_name) VALUES (:id, :name, :trade_name)');
        $clinic->execute(['id' => IT_IDS['clinicA'], 'name' => 'Synthetic Clinic A', 'trade_name' => 'Synthetic A']);
        $clinic->execute(['id' => IT_IDS['clinicB'], 'name' => 'Synthetic Clinic B', 'trade_name' => 'Synthetic B']);

        $subscription = $pdo->prepare(
            "INSERT INTO subscriptions (id, clinic_id, plan, billing_cycle, status, started_at, current_period_start, current_period_end)
             VALUES (:id, :clinic, 'professional', 'monthly', 'active', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 year')"
        );
        $subscription->execute(['id' => '00000000-0000-4000-8000-000000000071', 'clinic' => IT_IDS['clinicA']]);
        $subscription->execute(['id' => '00000000-0000-4000-8000-000000000072', 'clinic' => IT_IDS['clinicB']]);

        $configuration = $pdo->prepare('INSERT INTO clinic_configurations (id, clinic_id, timezone, public_slug) VALUES (:id, :clinic, :timezone, :slug)');
        $configuration->execute(['id' => '00000000-0000-4000-8000-000000000081', 'clinic' => IT_IDS['clinicA'], 'timezone' => 'UTC', 'slug' => 'synthetic-clinic-a']);
        $configuration->execute(['id' => '00000000-0000-4000-8000-000000000082', 'clinic' => IT_IDS['clinicB'], 'timezone' => 'UTC', 'slug' => null]);

        $user = $pdo->prepare(
            "INSERT INTO users (id, clinic_id, name, email, password_hash, role)
             VALUES (:id, :clinic, :name, :email, :password, :role)"
        );
        $user->execute(['id' => IT_IDS['adminA'], 'clinic' => IT_IDS['clinicA'], 'name' => 'Synthetic Admin A', 'email' => 'admin-a@integration.invalid', 'password' => $passwordHash, 'role' => 'admin']);
        $user->execute(['id' => IT_IDS['professionalUserA'], 'clinic' => IT_IDS['clinicA'], 'name' => 'Synthetic Professional A', 'email' => 'professional-a@integration.invalid', 'password' => $passwordHash, 'role' => 'professional']);
        $user->execute(['id' => IT_IDS['adminB'], 'clinic' => IT_IDS['clinicB'], 'name' => 'Synthetic Admin B', 'email' => 'admin-b@integration.invalid', 'password' => $passwordHash, 'role' => 'admin']);
        $user->execute(['id' => IT_IDS['selectionUserA'], 'clinic' => IT_IDS['clinicA'], 'name' => 'Synthetic Selection User A', 'email' => 'selection-user@integration.invalid', 'password' => $passwordHash, 'role' => 'admin']);
        $user->execute(['id' => IT_IDS['selectionUserB'], 'clinic' => IT_IDS['clinicB'], 'name' => 'Synthetic Selection User B', 'email' => 'selection-user@integration.invalid', 'password' => $passwordHash, 'role' => 'admin']);

        $specialty = $pdo->prepare('INSERT INTO specialties (id, clinic_id, name) VALUES (:id, :clinic, :name)');
        $specialty->execute(['id' => IT_IDS['specialtyA'], 'clinic' => IT_IDS['clinicA'], 'name' => 'Synthetic Specialty A']);
        $specialty->execute(['id' => IT_IDS['specialtyB'], 'clinic' => IT_IDS['clinicB'], 'name' => 'Synthetic Specialty B']);

        $patient = $pdo->prepare('INSERT INTO patients (id, clinic_id, name, email) VALUES (:id, :clinic, :name, :email)');
        $patient->execute(['id' => IT_IDS['patientA'], 'clinic' => IT_IDS['clinicA'], 'name' => 'Synthetic Patient A', 'email' => 'patient-a@integration.invalid']);
        $patient->execute(['id' => IT_IDS['patientB'], 'clinic' => IT_IDS['clinicB'], 'name' => 'Synthetic Patient B', 'email' => 'patient-b@integration.invalid']);

        $professional = $pdo->prepare('INSERT INTO professionals (id, clinic_id, user_id, specialty_id, name) VALUES (:id, :clinic, :user, :specialty, :name)');
        $professional->execute(['id' => IT_IDS['professionalA'], 'clinic' => IT_IDS['clinicA'], 'user' => IT_IDS['professionalUserA'], 'specialty' => IT_IDS['specialtyA'], 'name' => 'Synthetic Professional A']);
        $professional->execute(['id' => IT_IDS['professionalB'], 'clinic' => IT_IDS['clinicB'], 'user' => IT_IDS['adminB'], 'specialty' => IT_IDS['specialtyB'], 'name' => 'Synthetic Professional B']);

        $pdo->prepare('INSERT INTO services (id, clinic_id, name, duration_minutes, price) VALUES (:id, :clinic, :name, :duration, :price)')
            ->execute(['id' => IT_IDS['serviceA'], 'clinic' => IT_IDS['clinicA'], 'name' => 'Synthetic Consultation', 'duration' => 30, 'price' => 150.00]);
        $pdo->prepare('INSERT INTO professional_services (clinic_id, professional_id, service_id) VALUES (:clinic, :professional, :service)')
            ->execute(['clinic' => IT_IDS['clinicA'], 'professional' => IT_IDS['professionalA'], 'service' => IT_IDS['serviceA']]);
        $schedule = $pdo->prepare(
            "INSERT INTO professional_schedules (clinic_id, professional_id, weekday, start_time, end_time, duration_minutes)
             SELECT :clinic, :professional, weekday, TIME '08:00', TIME '18:00', 30
             FROM generate_series(1, 7) AS days(weekday)"
        );
        $schedule->execute(['clinic' => IT_IDS['clinicA'], 'professional' => IT_IDS['professionalA']]);

        $appointment = $pdo->prepare(
            "INSERT INTO appointments (id, clinic_id, patient_id, professional_id, specialty_id, scheduled_start, scheduled_end, status, code)
             VALUES (:id, :clinic, :patient, :professional, :specialty, NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 30 minutes', 'scheduled', :code)"
        );
        $appointment->execute(['id' => IT_IDS['appointmentA'], 'clinic' => IT_IDS['clinicA'], 'patient' => IT_IDS['patientA'], 'professional' => IT_IDS['professionalA'], 'specialty' => IT_IDS['specialtyA'], 'code' => 'IT-A-0001']);
        $appointment->execute(['id' => IT_IDS['appointmentB'], 'clinic' => IT_IDS['clinicB'], 'patient' => IT_IDS['patientB'], 'professional' => IT_IDS['professionalB'], 'specialty' => IT_IDS['specialtyB'], 'code' => 'IT-B-0001']);
        $portalToken = $pdo->prepare(
            'INSERT INTO appointment_access_tokens (clinic_id, appointment_id, token_hash, expires_at)
             VALUES (:clinic, :appointment, :hash, NOW() + INTERVAL \'1 hour\')'
        );
        $portalToken->execute([
            'clinic' => IT_IDS['clinicA'],
            'appointment' => IT_IDS['appointmentA'],
            'hash' => hash('sha256', IT_PORTAL_TOKEN),
        ]);

        $payment = $pdo->prepare(
            "INSERT INTO payments (id, clinic_id, appointment_id, amount, status)
             VALUES (:id, :clinic, :appointment, :amount, 'pending')"
        );
        $payment->execute(['id' => IT_IDS['paymentA'], 'clinic' => IT_IDS['clinicA'], 'appointment' => IT_IDS['appointmentA'], 'amount' => 150.00]);
        $payment->execute(['id' => IT_IDS['paymentB'], 'clinic' => IT_IDS['clinicB'], 'appointment' => IT_IDS['appointmentB'], 'amount' => 225.00]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function itCleanup(PDO $pdo): void
{
    if (!itMarkerExists($pdo) || (int)$pdo->query('SELECT version FROM php_security_test_marker')->fetchColumn() !== IT_SCHEMA_VERSION) {
        throw new RuntimeException('Cleanup refused because the database is not marked as this integration-test schema.');
    }
    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM payments WHERE id IN (:payment_a, :payment_b) OR appointment_id IN (:appointment_a, :appointment_b)')
            ->execute([
                'payment_a' => IT_IDS['paymentA'],
                'payment_b' => IT_IDS['paymentB'],
                'appointment_a' => IT_IDS['appointmentA'],
                'appointment_b' => IT_IDS['appointmentB'],
            ]);
        $pdo->prepare('DELETE FROM appointments WHERE id IN (:appointment_a, :appointment_b)')
            ->execute(['appointment_a' => IT_IDS['appointmentA'], 'appointment_b' => IT_IDS['appointmentB']]);
        $pdo->prepare('DELETE FROM appointments WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM audit_logs WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->exec("DELETE FROM platform_audit_logs WHERE action = 'platform.auth.denied' AND details->>'reason' = 'invalid_or_missing_token'");
        $pdo->prepare('DELETE FROM patients WHERE id IN (:patient_a, :patient_b)')
            ->execute(['patient_a' => IT_IDS['patientA'], 'patient_b' => IT_IDS['patientB']]);
        $pdo->prepare('DELETE FROM patients WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM professional_schedules WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM schedule_blocks WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM professional_services WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM professionals WHERE id IN (:professional_a, :professional_b)')
            ->execute(['professional_a' => IT_IDS['professionalA'], 'professional_b' => IT_IDS['professionalB']]);
        $pdo->prepare('DELETE FROM specialties WHERE id IN (:specialty_a, :specialty_b)')
            ->execute(['specialty_a' => IT_IDS['specialtyA'], 'specialty_b' => IT_IDS['specialtyB']]);
        $pdo->prepare('DELETE FROM services WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM clinic_configurations WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM subscriptions WHERE clinic_id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->prepare('DELETE FROM password_reset_tokens WHERE user_id IN (:selection_user_a, :selection_user_b)')
            ->execute(['selection_user_a' => IT_IDS['selectionUserA'], 'selection_user_b' => IT_IDS['selectionUserB']]);
        $pdo->prepare('DELETE FROM users WHERE id IN (:admin_a, :professional_user_a, :admin_b, :selection_user_a, :selection_user_b)')
            ->execute([
                'admin_a' => IT_IDS['adminA'],
                'professional_user_a' => IT_IDS['professionalUserA'],
                'admin_b' => IT_IDS['adminB'],
                'selection_user_a' => IT_IDS['selectionUserA'],
                'selection_user_b' => IT_IDS['selectionUserB'],
            ]);
        $pdo->prepare('DELETE FROM users WHERE clinic_id = :clinic AND email = :email')
            ->execute(['clinic' => IT_IDS['clinicA'], 'email' => 'mass-assignment@integration.invalid']);
        $pdo->prepare('DELETE FROM clinics WHERE id IN (:clinic_a, :clinic_b)')
            ->execute(['clinic_a' => IT_IDS['clinicA'], 'clinic_b' => IT_IDS['clinicB']]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }

    foreach (['clinics', 'users', 'password_reset_tokens', 'subscriptions', 'clinic_configurations', 'specialties', 'services', 'professional_services', 'patients', 'professionals', 'professional_schedules', 'schedule_blocks', 'appointments', 'appointment_access_tokens', 'payments', 'audit_logs', 'platform_admin_accounts', 'platform_audit_logs', 'settings'] as $table) {
        if ((int)$pdo->query('SELECT COUNT(*) FROM public.' . $table)->fetchColumn() !== 0) {
            throw new RuntimeException("Cleanup verification found remaining rows in test table $table.");
        }
    }
}

function itJsonToken(array $claims, array $header = ['alg' => 'HS256', 'typ' => 'JWT']): string
{
    $encode = static fn(array $value): string => rtrim(strtr(base64_encode(json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');
    $input = $encode($header) . '.' . $encode($claims);
    $signature = hash_hmac('sha256', $input, (string)getenv('JWT_SECRET'), true);
    return $input . '.' . rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
}

function itRequest(string $baseUrl, string $method, string $path, ?string $token = null, mixed $body = null, int $timeoutSeconds = 5, ?string $origin = null): array
{
    $headers = ['Accept: application/json'];
    if (!in_array(strtoupper($method), ['GET', 'HEAD', 'OPTIONS'], true)) {
        $csrfToken = str_repeat('a', 43);
        $headers[] = 'Origin: ' . ($origin ?? 'http://localhost:5173');
        $headers[] = 'X-CSRF-Token: ' . $csrfToken;
        $headers[] = 'Cookie: clinic_csrf=' . $csrfToken . ($token !== null ? '; clinic_session=' . $token : '');
    } elseif ($token !== null) {
        $headers[] = 'Cookie: clinic_session=' . $token;
    }
    $content = '';
    if (is_string($body)) {
        $content = $body;
        $headers[] = 'Content-Type: application/json';
    } elseif ($body !== null) {
        $content = json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $headers[] = 'Content-Type: application/json';
    }

    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $content,
            'ignore_errors' => true,
            'timeout' => $timeoutSeconds,
            'protocol_version' => 1.1,
        ],
    ]);
    set_error_handler(static function (int $severity, string $message): never {
        throw new RuntimeException('HTTP test client failed: ' . $message);
    });
    try {
        $response = file_get_contents(rtrim($baseUrl, '/') . $path, false, $context);
        $responseHeaders = $http_response_header ?? [];
    } finally {
        restore_error_handler();
    }
    if (!is_string($response)) {
        throw new RuntimeException('HTTP test client received no response.');
    }
    $status = 0;
    if (isset($responseHeaders[0]) && preg_match('/\s(\d{3})\s/', $responseHeaders[0], $match)) {
        $status = (int)$match[1];
    }
    $decoded = json_decode($response, true);
    return ['status' => $status, 'headers' => $responseHeaders, 'body' => is_array($decoded) ? $decoded : null];
}

function itExpectResponse(array $response, int $status, string $message): array
{
    $apiMessage = is_array($response['body'] ?? null) && is_string($response['body']['message'] ?? null)
        ? '; API message: ' . $response['body']['message']
        : '';
    itAssert($response['status'] === $status, $message . ' (HTTP ' . $response['status'] . ', expected ' . $status . $apiMessage . ')');
    if ($status !== 204) {
        itAssert(is_array($response['body']), $message . ' returns a JSON object');
    }
    return is_array($response['body']) ? $response['body'] : [];
}

function itTokenFor(string $userId, string $clinicId, mixed $sessionVersion = 0): string
{
    return Noa\Jwt::sign([
        'sub' => $userId,
        'clinicId' => $clinicId,
        'sessionVersion' => $sessionVersion,
    ], 3600);
}

function itSessionToken(array $response): ?string
{
    foreach ($response['headers'] ?? [] as $header) {
        if (is_string($header) && preg_match('/^Set-Cookie:\s*clinic_session=([^;]+)/i', $header, $match)) {
            return rawurldecode($match[1]);
        }
    }
    return null;
}

function itAssertClinicSessionCookie(array $response, string $label): void
{
    $cookieHeader = '';
    foreach ($response['headers'] ?? [] as $header) {
        if (is_string($header) && stripos($header, 'Set-Cookie: clinic_session=') === 0) {
            $cookieHeader = $header;
            break;
        }
    }
    itAssert(
        $cookieHeader !== '' &&
        stripos($cookieHeader, 'httponly') !== false &&
        stripos($cookieHeader, 'samesite=lax') !== false &&
        stripos($cookieHeader, 'path=/api') !== false,
        $label . ' issues a scoped HttpOnly SameSite=Lax cookie'
    );
    $body = $response['body'] ?? null;
    itAssert(
        is_array($body) && !array_key_exists('token', $body['data'] ?? []),
        $label . ' does not expose a session token in JSON'
    );
}

function itResetIsolatedAuthRateLimit(): void
{
    itResetIsolatedRateLimit('auth-api');
}

function itResetIsolatedRateLimit(string $namespace): void
{
    $key = hash('sha256', $namespace . '|127.0.0.1');
    $path = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'noa-api-' . $namespace . '-' . $key . '.json';
    if (is_file($path) && !unlink($path)) {
        throw new RuntimeException("Could not reset the isolated integration $namespace rate-limit counter.");
    }
}

function itClinicSelectionToken(string $userId, string $clinicId, int $sessionVersion): string
{
    $now = time();
    $otherAccount = $userId === IT_IDS['selectionUserA']
        ? ['userId' => IT_IDS['selectionUserB'], 'clinicId' => IT_IDS['clinicB'], 'sessionVersion' => 0]
        : ['userId' => IT_IDS['selectionUserA'], 'clinicId' => IT_IDS['clinicA'], 'sessionVersion' => 0];
    return itJsonToken([
        'accounts' => [[
            'userId' => $userId,
            'clinicId' => $clinicId,
            'sessionVersion' => $sessionVersion,
        ], $otherAccount],
        'iss' => 'sistema-de-agendamentos-api',
        'aud' => 'sistema-de-agendamentos-clinic-selection',
        'iat' => $now,
        'exp' => $now + 300,
    ]);
}

function itStartHttpWorker(string $baseUrl, string $method, string $path, ?string $token, mixed $body): array
{
    $pipes = [];
    $process = proc_open(
        [PHP_BINARY, __FILE__, '--http-worker'],
        [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ],
        $pipes
    );
    if (!is_resource($process)) {
        throw new RuntimeException('Could not start concurrent HTTP request worker.');
    }
    $payload = json_encode([
        'baseUrl' => $baseUrl,
        'method' => $method,
        'path' => $path,
        'token' => $token,
        'body' => $body,
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    if (fwrite($pipes[0], $payload) !== strlen($payload)) {
        fclose($pipes[0]);
        proc_terminate($process);
        proc_close($process);
        throw new RuntimeException('Could not send request details to the concurrent HTTP worker.');
    }
    fclose($pipes[0]);
    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);
    return ['process' => $process, 'pipes' => $pipes, 'stdout' => '', 'stderr' => ''];
}

function itWaitForLockWait(PDO $monitor, int $minimumWaiters, array &$worker, string $label): void
{
    $deadline = microtime(true) + 10;
    do {
        $waiters = (int)$monitor->query(
            "SELECT COUNT(*) FROM pg_stat_activity
             WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'"
        )->fetchColumn();
        if ($waiters >= $minimumWaiters) {
            return;
        }
        $status = proc_get_status($worker['process']);
        if (!$status['running']) {
            $worker['stdout'] .= stream_get_contents($worker['pipes'][1]) ?: '';
            $worker['stderr'] .= stream_get_contents($worker['pipes'][2]) ?: '';
            throw new RuntimeException(
                "Concurrent $label request exited before waiting on the database row lock. " .
                trim($worker['stderr'] . ' ' . $worker['stdout'])
            );
        }
        usleep(25000);
    } while (microtime(true) < $deadline);
    $activity = $monitor->query(
        "SELECT state, wait_event_type, wait_event, left(query, 180) AS query
         FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()
         ORDER BY pid"
    )->fetchAll();
    throw new RuntimeException(
        "Timed out waiting for the concurrent $label request to block on the database row lock. " .
        json_encode($activity, JSON_UNESCAPED_SLASHES)
    );
}

function itFinishHttpWorker(array &$worker, string $label): array
{
    $deadline = microtime(true) + 15;
    do {
        $worker['stdout'] .= stream_get_contents($worker['pipes'][1]) ?: '';
        $worker['stderr'] .= stream_get_contents($worker['pipes'][2]) ?: '';
        $status = proc_get_status($worker['process']);
        if (!$status['running']) {
            break;
        }
        usleep(25000);
    } while (microtime(true) < $deadline);
    if ($status['running']) {
        proc_terminate($worker['process']);
        throw new RuntimeException("Concurrent $label request timed out; possible deadlock or stalled request.");
    }
    foreach ([1, 2] as $index) {
        $worker['stdout'] .= stream_get_contents($worker['pipes'][$index]) ?: '';
        $worker['stderr'] .= stream_get_contents($worker['pipes'][$index]) ?: '';
        fclose($worker['pipes'][$index]);
    }
    proc_close($worker['process']);
    $response = json_decode(trim($worker['stdout']), true);
    if (!is_array($response) || !isset($response['status'])) {
        throw new RuntimeException("Concurrent $label request returned no valid HTTP result.");
    }
    return $response;
}

function itRunConcurrentRace(
    PDO $pdo,
    string $userId,
    array $firstRequest,
    array $secondRequest,
    string $label
): array {
    global $concurrentBaseUrl;
    if (!is_string($concurrentBaseUrl) || !preg_match('#^http://127\.0\.0\.1:\d{1,5}$#', $concurrentBaseUrl)) {
        throw new RuntimeException('Concurrent tests require a second HTTP server bound to loopback.');
    }
    $workers = [];
    $monitor = itDatabase();
    $pdo->beginTransaction();
    try {
        $lock = $pdo->prepare('SELECT id FROM users WHERE id = :id FOR UPDATE');
        $lock->execute(['id' => $userId]);
        if (!$lock->fetchColumn()) {
            throw new RuntimeException("Concurrent $label fixture user was not found.");
        }
        $workers['first'] = itStartHttpWorker($GLOBALS['baseUrl'], $firstRequest['method'], $firstRequest['path'], $firstRequest['token'], $firstRequest['body']);
        itWaitForLockWait($monitor, 1, $workers['first'], "$label first");
        $workers['second'] = itStartHttpWorker($concurrentBaseUrl, $secondRequest['method'], $secondRequest['path'], $secondRequest['token'], $secondRequest['body']);
        itWaitForLockWait($monitor, 2, $workers['second'], "$label second");
        $pdo->commit();
    } finally {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    }

    $responses = [];
    foreach ($workers as $name => &$worker) {
        $responses[$name] = itFinishHttpWorker($worker, "$label $name");
    }
    unset($worker);
    $ungrantedLocks = (int)$monitor->query(
        "SELECT COUNT(*) FROM pg_locks WHERE NOT granted AND pid IN
         (SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user)"
    )->fetchColumn();
    $openTransactions = (int)$monitor->query(
        "SELECT COUNT(*) FROM pg_stat_activity
         WHERE datname = current_database() AND usename = current_user AND state = 'idle in transaction'"
    )->fetchColumn();
    itAssert($ungrantedLocks === 0, "$label leaves no pending database locks");
    itAssert($openTransactions === 0, "$label leaves no open idle transactions");
    return $responses;
}

function itRunConcurrentSecurityTests(PDO $pdo): void
{
    global $baseUrl;
    $selectionPath = '/api/auth/login/select-clinic';
    $logoutPath = '/api/auth/logout';
    $versionQuery = $pdo->prepare('SELECT token_version FROM users WHERE id = :id');

    $versionQuery->execute(['id' => IT_IDS['selectionUserA']]);
    $version = (int)$versionQuery->fetchColumn();
    $selectionToken = itClinicSelectionToken(IT_IDS['selectionUserA'], IT_IDS['clinicA'], $version);
    $userToken = itTokenFor(IT_IDS['selectionUserA'], IT_IDS['clinicA'], $version);
    itResetIsolatedAuthRateLimit();
    $responses = itRunConcurrentRace(
        $pdo,
        IT_IDS['selectionUserA'],
        ['method' => 'POST', 'path' => $selectionPath, 'token' => null, 'body' => ['selectionToken' => $selectionToken, 'clinicId' => IT_IDS['clinicA']]],
        ['method' => 'POST', 'path' => $logoutPath, 'token' => $userToken, 'body' => (object)[]],
        'selection-before-logout'
    );
    itAssert($responses['first']['status'] === 200, 'selection queued before logout succeeds');
    itAssert($responses['second']['status'] === 200, 'logout queued after selection succeeds');
    $selectedToken = itSessionToken($responses['first']);
    itAssertClinicSessionCookie($responses['first'], 'concurrent clinic selection');
    itAssert(is_string($selectedToken) && $selectedToken !== '', 'concurrent selection returns its new session token');
    itExpectResponse(itRequest($baseUrl, 'GET', '/api/auth/me', $selectedToken), 401, 'logout after selection revokes the newly created session');
    $versionQuery->execute(['id' => IT_IDS['selectionUserA']]);
    itAssert((int)$versionQuery->fetchColumn() === $version + 1, 'selection-then-logout race increments the session version once');

    $versionQuery->execute(['id' => IT_IDS['selectionUserA']]);
    $version = (int)$versionQuery->fetchColumn();
    $selectionToken = itClinicSelectionToken(IT_IDS['selectionUserA'], IT_IDS['clinicA'], $version);
    $userToken = itTokenFor(IT_IDS['selectionUserA'], IT_IDS['clinicA'], $version);
    $lastLogin = '2020-02-03 04:05:06+00';
    $pdo->prepare('UPDATE users SET last_login_at = :last_login WHERE id = :id')
        ->execute(['last_login' => $lastLogin, 'id' => IT_IDS['selectionUserA']]);
    itResetIsolatedAuthRateLimit();
    $responses = itRunConcurrentRace(
        $pdo,
        IT_IDS['selectionUserA'],
        ['method' => 'POST', 'path' => $logoutPath, 'token' => $userToken, 'body' => (object)[]],
        ['method' => 'POST', 'path' => $selectionPath, 'token' => null, 'body' => ['selectionToken' => $selectionToken, 'clinicId' => IT_IDS['clinicA']]],
        'logout-before-selection'
    );
    itAssert($responses['first']['status'] === 200, 'logout queued before selection succeeds');
    itExpectResponse($responses['second'], 401, 'selection queued after logout rejects the old token');
    $state = $pdo->prepare(
        'SELECT token_version, last_login_at = CAST(:last_login AS TIMESTAMPTZ) AS login_unchanged
         FROM users WHERE id = :id'
    );
    $state->execute(['last_login' => $lastLogin, 'id' => IT_IDS['selectionUserA']]);
    $state = $state->fetch();
    itAssert(
        $state !== false && (int)$state['token_version'] === $version + 1 &&
        in_array($state['login_unchanged'], [true, 't', '1', 1], true),
        'logout-first race rejects selection without creating a session'
    );

    itRunConcurrentPasswordResetRaces($pdo);
}

function itRunConcurrentPasswordResetRaces(PDO $pdo): void
{
    global $baseUrl;
    $selectionPath = '/api/auth/login/select-clinic';
    $resetPath = '/api/auth/password-reset/confirm';
    $versionQuery = $pdo->prepare('SELECT token_version FROM users WHERE id = :id');
    $insertResetToken = $pdo->prepare(
        'INSERT INTO password_reset_tokens (clinic_id, user_id, token_hash, expires_at)
         VALUES (:clinic, :user, :hash, NOW() + INTERVAL \'10 minutes\')'
    );
    $newPassword = 'Synthetic-Concurrent-Password-2026!';

    $versionQuery->execute(['id' => IT_IDS['selectionUserB']]);
    $version = (int)$versionQuery->fetchColumn();
    $selectionToken = itClinicSelectionToken(IT_IDS['selectionUserB'], IT_IDS['clinicB'], $version);
    $resetToken = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $insertResetToken->execute(['clinic' => IT_IDS['clinicB'], 'user' => IT_IDS['selectionUserB'], 'hash' => hash('sha256', $resetToken)]);
    itResetIsolatedAuthRateLimit();
    $responses = itRunConcurrentRace(
        $pdo,
        IT_IDS['selectionUserB'],
        ['method' => 'POST', 'path' => $selectionPath, 'token' => null, 'body' => ['selectionToken' => $selectionToken, 'clinicId' => IT_IDS['clinicB']]],
        ['method' => 'POST', 'path' => $resetPath, 'token' => null, 'body' => ['token' => $resetToken, 'password' => $newPassword, 'confirmPassword' => $newPassword]],
        'selection-before-password-reset'
    );
    itAssert($responses['first']['status'] === 200, 'selection queued before password reset succeeds');
    itAssert($responses['second']['status'] === 200, 'password reset queued after selection succeeds');
    $selectedToken = itSessionToken($responses['first']);
    itAssertClinicSessionCookie($responses['first'], 'concurrent clinic selection');
    itAssert(is_string($selectedToken) && $selectedToken !== '', 'selection-before-reset race returns a session token');
    itExpectResponse(itRequest($baseUrl, 'GET', '/api/auth/me', $selectedToken), 401, 'password reset after selection revokes the newly created session');
    $versionQuery->execute(['id' => IT_IDS['selectionUserB']]);
    itAssert((int)$versionQuery->fetchColumn() === $version + 1, 'selection-then-password-reset race increments the session version once');

    $versionQuery->execute(['id' => IT_IDS['selectionUserB']]);
    $version = (int)$versionQuery->fetchColumn();
    $selectionToken = itClinicSelectionToken(IT_IDS['selectionUserB'], IT_IDS['clinicB'], $version);
    $resetToken = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $insertResetToken->execute(['clinic' => IT_IDS['clinicB'], 'user' => IT_IDS['selectionUserB'], 'hash' => hash('sha256', $resetToken)]);
    itResetIsolatedAuthRateLimit();
    itResetIsolatedRateLimit('password-reset-ip');
    $responses = itRunConcurrentRace(
        $pdo,
        IT_IDS['selectionUserB'],
        ['method' => 'POST', 'path' => $resetPath, 'token' => null, 'body' => ['token' => $resetToken, 'password' => $newPassword, 'confirmPassword' => $newPassword]],
        ['method' => 'POST', 'path' => $selectionPath, 'token' => null, 'body' => ['selectionToken' => $selectionToken, 'clinicId' => IT_IDS['clinicB']]],
        'password-reset-before-selection'
    );
    itAssert($responses['first']['status'] === 200, 'password reset queued before selection succeeds');
    itExpectResponse($responses['second'], 401, 'selection queued after password reset rejects the old token');
    $versionQuery->execute(['id' => IT_IDS['selectionUserB']]);
    itAssert((int)$versionQuery->fetchColumn() === $version + 1, 'password-reset-first race increments the session version once');
}

function itRunClinicSuspensionAccessTest(PDO $pdo, string $token): void
{
    $clinicId = IT_IDS['clinicA'];
    $patientId = IT_IDS['patientA'];
    $statusQuery = $pdo->prepare('SELECT status FROM clinics WHERE id = :id');
    $statusQuery->execute(['id' => $clinicId]);
    $originalStatus = $statusQuery->fetchColumn();
    $subscriptionQuery = $pdo->prepare(
        'SELECT id, status, current_period_start, current_period_end, trial_ends_at
         FROM subscriptions WHERE clinic_id = :clinic ORDER BY created_at DESC LIMIT 1'
    );
    $subscriptionQuery->execute(['clinic' => $clinicId]);
    $originalSubscription = $subscriptionQuery->fetch(PDO::FETCH_ASSOC);
    itAssert($originalStatus === 'active', 'synthetic control clinic starts active');
    itAssert(is_array($originalSubscription) && $originalSubscription['status'] === 'active', 'synthetic control clinic has an active subscription');

    $patientQuery = $pdo->prepare('SELECT name FROM patients WHERE id = :id AND clinic_id = :clinic');
    $patientQuery->execute(['id' => $patientId, 'clinic' => $clinicId]);
    $originalPatientName = $patientQuery->fetchColumn();
    if (!is_string($originalPatientName)) {
        throw new RuntimeException('Synthetic clinic-suspension patient fixture was not found.');
    }
    $versionQuery = $pdo->prepare('SELECT token_version FROM users WHERE id = :id AND clinic_id = :clinic');
    $versionQuery->execute(['id' => IT_IDS['adminA'], 'clinic' => $clinicId]);
    $originalTokenVersion = (int)$versionQuery->fetchColumn();

    try {
        $activeRead = itRequest($GLOBALS['baseUrl'], 'GET', '/api/patients', $token);
        itExpectResponse($activeRead, 200, 'active clinic can read protected patient endpoint');
        $activeIds = array_column($activeRead['body']['data'] ?? [], 'id');
        itAssert(in_array($patientId, $activeIds, true), 'active clinic read returns its synthetic patient');
        itExpectResponse(
            itRequest($GLOBALS['baseUrl'], 'PUT', '/api/patients/' . $patientId, $token, ['name' => 'Synthetic Active Clinic Write']),
            200,
            'active clinic can write to protected patient endpoint'
        );

        foreach (['suspended', 'inactive', 'invalid'] as $clinicStatus) {
            $pdo->prepare('UPDATE clinics SET status = :status WHERE id = :id')
                ->execute(['status' => $clinicStatus, 'id' => $clinicId]);
            $statusQuery->execute(['id' => $clinicId]);
            itAssert($statusQuery->fetchColumn() === $clinicStatus, "synthetic clinic status is {$clinicStatus}");
            $subscriptionQuery->execute(['clinic' => $clinicId]);
            $currentSubscription = $subscriptionQuery->fetch(PDO::FETCH_ASSOC);
            itAssert(is_array($currentSubscription) && $currentSubscription['status'] === 'active', "{$clinicStatus} clinic still has an active subscription");

            itExpectResponse(
                itRequest($GLOBALS['baseUrl'], 'GET', '/api/patients', $token),
                403,
                "{$clinicStatus} clinic cannot read protected patients"
            );
            itExpectResponse(
                itRequest($GLOBALS['baseUrl'], 'GET', '/api/specialties', $token),
                403,
                "{$clinicStatus} clinic cannot access another protected route"
            );
            itExpectResponse(
                itRequest($GLOBALS['baseUrl'], 'PUT', '/api/patients/' . $patientId, $token, ['name' => 'Synthetic Denied Clinic Write']),
                403,
                "{$clinicStatus} clinic cannot write to protected patients"
            );
            $patientQuery->execute(['id' => $patientId, 'clinic' => $clinicId]);
            itAssert($patientQuery->fetchColumn() === 'Synthetic Active Clinic Write', "{$clinicStatus} clinic write is not persisted");
        }

        $pdo->prepare("UPDATE clinics SET status = 'active' WHERE id = :id")
            ->execute(['id' => $clinicId]);
        $pdo->prepare("UPDATE subscriptions SET status = 'expired' WHERE id = :id")
            ->execute(['id' => $originalSubscription['id']]);
        itExpectResponse(
            itRequest($GLOBALS['baseUrl'], 'GET', '/api/patients', $token),
            403,
            'active clinic with expired subscription remains blocked'
        );

        $pdo->prepare(
            "UPDATE subscriptions
             SET status = 'active',
                 current_period_start = NOW() - INTERVAL '2 days',
                 current_period_end = NOW() - INTERVAL '1 day'
             WHERE id = :id"
        )->execute(['id' => $originalSubscription['id']]);
        itExpectResponse(
            itRequest($GLOBALS['baseUrl'], 'GET', '/api/patients', $token),
            403,
            'active clinic with expired billing period remains blocked'
        );

        $versionQuery->execute(['id' => IT_IDS['adminA'], 'clinic' => $clinicId]);
        itAssert((int)$versionQuery->fetchColumn() === $originalTokenVersion, 'denied clinic access does not create or revoke a session');
        fwrite(STDOUT, "EVIDENCE clinic-status HTTP: active GET /api/patients=200, active PUT patient=200; suspended/inactive/invalid GET and PUT=403; denied writes not persisted; expired subscriptions remain blocked.\n");
    } finally {
        $pdo->prepare("UPDATE clinics SET status = 'active' WHERE id = :id")
            ->execute(['id' => $clinicId]);
        if (is_array($originalSubscription)) {
            $pdo->prepare(
                'UPDATE subscriptions
                 SET status = :status, current_period_start = :period_start,
                     current_period_end = :period_end, trial_ends_at = :trial_end
                 WHERE id = :id'
            )->execute([
                'status' => $originalSubscription['status'],
                'period_start' => $originalSubscription['current_period_start'],
                'period_end' => $originalSubscription['current_period_end'],
                'trial_end' => $originalSubscription['trial_ends_at'],
                'id' => $originalSubscription['id'],
            ]);
        }
        $pdo->prepare('UPDATE patients SET name = :name WHERE id = :id AND clinic_id = :clinic')
            ->execute(['name' => $originalPatientName, 'id' => $patientId, 'clinic' => $clinicId]);
    }
}

function itRunHttpTests(string $baseUrl, string $concurrentBaseUrl, PDO $pdo): void
{
    global $assertions;
    $GLOBALS['baseUrl'] = $baseUrl;
    $assertions = 0;
    $csrfResponse = itRequest($baseUrl, 'GET', '/api/auth/csrf');
    $csrfBody = itExpectResponse($csrfResponse, 200, 'CSRF bootstrap returns a token');
    $csrfCookie = implode("\n", $csrfResponse['headers'] ?? []);
    itAssert(
        preg_match('/^[A-Za-z0-9_-]{43}$/', $csrfBody['data']['csrfToken'] ?? '') === 1 &&
        stripos($csrfCookie, 'Set-Cookie: clinic_csrf=') !== false &&
        stripos($csrfCookie, 'httponly') === false,
        'CSRF bootstrap sets a browser-readable CSRF cookie'
    );
    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/auth/login', null, ['email' => 'selection-user@integration.invalid', 'password' => IT_PASSWORD], 5, 'https://attacker.invalid'),
        403,
        'login rejects a mismatched request origin'
    );
    itResetIsolatedAuthRateLimit();

    $selectionLogin = itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/auth/login', null, ['email' => 'selection-user@integration.invalid', 'password' => IT_PASSWORD]),
        200,
        'multi-clinic synthetic user receives a clinic-selection token'
    );
    itAssert(($selectionLogin['data']['requiresClinicSelection'] ?? false) === true, 'multi-clinic login requires clinic selection');
    $selectionToken = $selectionLogin['data']['selectionToken'] ?? null;
    itAssert(is_string($selectionToken) && $selectionToken !== '', 'multi-clinic login returns a selection token');

    $selectedSessionResponse = itRequest($baseUrl, 'POST', '/api/auth/login/select-clinic', null, [
            'selectionToken' => $selectionToken,
            'clinicId' => IT_IDS['clinicA'],
        ]);
    $selectedSession = itExpectResponse(
        $selectedSessionResponse,
        200,
        'current clinic-selection token creates a session'
    );
    $selectedSessionToken = itSessionToken($selectedSessionResponse);
    itAssertClinicSessionCookie($selectedSessionResponse, 'clinic selection');
    itAssert(
        ($selectedSession['data']['user']['id'] ?? null) === IT_IDS['selectionUserA'] &&
        is_string($selectedSessionToken) && $selectedSessionToken !== '',
        'clinic-selection session belongs to the selected account'
    );
    $selectedIdentity = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/auth/me', $selectedSessionToken),
        200,
        'session created by clinic selection authenticates normally'
    );
    itAssert(($selectedIdentity['data']['id'] ?? null) === IT_IDS['selectionUserA'], 'selected session identifies the selected user');

    itResetIsolatedAuthRateLimit();

    $expiredSelectionToken = itJsonToken([
        'accounts' => [[
            'userId' => IT_IDS['selectionUserA'],
            'clinicId' => IT_IDS['clinicA'],
            'sessionVersion' => 0,
        ]],
        'iss' => 'sistema-de-agendamentos-api',
        'aud' => 'sistema-de-agendamentos-clinic-selection',
        'iat' => time() - 600,
        'exp' => time() - 1,
    ]);
    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/auth/login/select-clinic', null, [
            'selectionToken' => $expiredSelectionToken,
            'clinicId' => IT_IDS['clinicA'],
        ]),
        401,
        'expired clinic-selection token is rejected'
    );

    $pdo->prepare("UPDATE users SET status = 'suspended' WHERE id = :id")
        ->execute(['id' => IT_IDS['selectionUserA']]);
    $inactiveResponse = itRequest($baseUrl, 'POST', '/api/auth/login/select-clinic', null, [
        'selectionToken' => $selectionToken,
        'clinicId' => IT_IDS['clinicA'],
    ]);
    $pdo->prepare("UPDATE users SET status = 'active' WHERE id = :id")
        ->execute(['id' => IT_IDS['selectionUserA']]);
    itExpectResponse($inactiveResponse, 401, 'inactive account cannot redeem a clinic-selection token');

    $sentinelLastLogin = '2020-01-02 03:04:05+00';
    $pdo->prepare('UPDATE users SET token_version = token_version + 1, last_login_at = :last_login WHERE id = :id')
        ->execute(['last_login' => $sentinelLastLogin, 'id' => IT_IDS['selectionUserA']]);
    $revokedResponse = itRequest($baseUrl, 'POST', '/api/auth/login/select-clinic', null, [
        'selectionToken' => $selectionToken,
        'clinicId' => IT_IDS['clinicA'],
    ]);
    $revocationState = $pdo->prepare(
        'SELECT token_version, last_login_at = CAST(:last_login AS TIMESTAMPTZ) AS login_unchanged
         FROM users WHERE id = :id'
    );
    $revocationState->execute(['last_login' => $sentinelLastLogin, 'id' => IT_IDS['selectionUserA']]);
    $revocationState = $revocationState->fetch();
    itExpectResponse($revokedResponse, 401, 'selection token issued before session revocation is rejected');
    itAssert(
        $revocationState !== false &&
        (int)$revocationState['token_version'] === 1 &&
        in_array($revocationState['login_unchanged'], [true, 't', '1', 1], true),
        'rejected revoked token does not create a new session or update last_login_at'
    );

    itRunConcurrentSecurityTests($pdo);
    itResetIsolatedAuthRateLimit();

    $loginResponse = itRequest($baseUrl, 'POST', '/api/auth/login', null, ['email' => 'admin-a@integration.invalid', 'password' => IT_PASSWORD]);
    $login = itExpectResponse(
        $loginResponse,
        200,
        'synthetic clinic admin login succeeds'
    );
    $adminToken = itSessionToken($loginResponse);
    itAssertClinicSessionCookie($loginResponse, 'clinic login');
    itAssert(is_string($adminToken) && $adminToken !== '', 'successful login issues an HttpOnly session cookie');

    $currentSubscription = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/subscriptions/current', $adminToken),
        200,
        'clinic dashboard can load the current subscription'
    );
    itAssert(
        ($currentSubscription['data']['status'] ?? null) === 'active' &&
        ($currentSubscription['data']['cancelledAt'] ?? null) === null,
        'current subscription exposes its active status and cancellation timestamp'
    );

    $privacyProfilePath = '/api/settings/privacy-profile';
    $emptyPrivacyProfile = itExpectResponse(
        itRequest($baseUrl, 'GET', $privacyProfilePath, $adminToken),
        200,
        'clinic admin can read its privacy profile'
    );
    itAssert(
        ($emptyPrivacyProfile['data']['legalName'] ?? null) === '' &&
        ($emptyPrivacyProfile['data']['privacyPolicyUrl'] ?? null) === '',
        'new clinic privacy profile starts empty'
    );
    $privacyProfile = [
        'legalName' => 'Synthetic Clinic A Ltda.',
        'cnpj' => '00.000.000/0001-00',
        'privacyEmail' => 'privacy@clinic.example.invalid',
        'privacyPolicyUrl' => 'https://clinic.example.invalid/privacy',
    ];
    $savedPrivacyProfile = itExpectResponse(
        itRequest($baseUrl, 'POST', $privacyProfilePath, $adminToken, $privacyProfile),
        200,
        'clinic admin can save its privacy profile'
    );
    itAssert(
        ($savedPrivacyProfile['data'] ?? null) === $privacyProfile,
        'privacy profile returns the saved clinic-provided values'
    );
    itExpectResponse(
        itRequest($baseUrl, 'POST', $privacyProfilePath, $adminToken, [
            ...$privacyProfile,
            'privacyPolicyUrl' => 'javascript:alert(1)',
        ]),
        400,
        'privacy profile rejects non-HTTPS policy URLs'
    );
    $publicPrivacyData = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/public/clinics/synthetic-clinic-a'),
        200,
        'public booking endpoint exposes the clinic policy link'
    )['data'] ?? [];
    itAssert(
        ($publicPrivacyData['privacyPolicyUrl'] ?? null) === $privacyProfile['privacyPolicyUrl'] &&
        !array_key_exists('privacyEmail', $publicPrivacyData) &&
        !array_key_exists('cnpj', $publicPrivacyData),
        'public booking exposes only the notice URL, not internal profile contact fields'
    );
    $publicServices = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/public/clinics/synthetic-clinic-a/services'),
        200,
        'public booking can list the clinic services'
    )['data'] ?? [];
    itAssert(
        count($publicServices) === 1 && ($publicServices[0]['id'] ?? null) === IT_IDS['serviceA'],
        'public services expose only the active synthetic clinic service'
    );
    $publicProfessionals = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/public/clinics/synthetic-clinic-a/services/' . IT_IDS['serviceA'] . '/professionals'),
        200,
        'public booking can list professionals for a service'
    )['data'] ?? [];
    itAssert(
        count($publicProfessionals) === 1 && ($publicProfessionals[0]['id'] ?? null) === IT_IDS['professionalA'],
        'public service exposes its eligible synthetic professional'
    );
    $availabilityDate = gmdate('Y-m-d', strtotime('+1 day'));
    $publicAvailability = itExpectResponse(
        itRequest(
            $baseUrl,
            'GET',
            '/api/public/clinics/synthetic-clinic-a/services/' . IT_IDS['serviceA'] .
                '/professionals/' . IT_IDS['professionalA'] . '/availability?date=' . $availabilityDate
        ),
        200,
        'public booking can load synthetic professional availability'
    )['data'] ?? [];
    itAssert(
        count($publicAvailability) > 0,
        'public availability returns synthetic bookable slots'
    );
    $patientPortalAppointment = itExpectResponse(
        itRequest(
            $baseUrl,
            'POST',
            '/api/public/appointment-management/lookup',
            null,
            ['token' => IT_PORTAL_TOKEN]
        ),
        200,
        'patient portal token can retrieve its synthetic appointment'
    )['data'] ?? [];
    itAssert(
        ($patientPortalAppointment['code'] ?? null) === 'IT-A-0001' &&
        ($patientPortalAppointment['status'] ?? null) === 'scheduled' &&
        ($patientPortalAppointment['clinic_name'] ?? null) === 'Synthetic A',
        'patient portal token is scoped to the expected appointment'
    );
    $publicBookingPayload = [
        'idempotencyKey' => '00000000-0000-4000-8000-000000000091',
        'serviceId' => IT_IDS['serviceA'],
        'professionalId' => IT_IDS['professionalA'],
        'scheduledStart' => $availabilityDate . 'T09:00:00.000Z',
        'name' => 'Synthetic Public Patient',
        'phone' => '+55 11 90000-0001',
        'email' => 'public-booking@integration.invalid',
        'reminderConsent' => false,
    ];
    $publicBooking = itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/public/clinics/synthetic-clinic-a/appointments', null, $publicBookingPayload),
        201,
        'public booking creates a synthetic appointment'
    )['data'] ?? [];
    itAssert(
        str_starts_with((string)($publicBooking['code'] ?? ''), 'PUB-') &&
        ($publicBooking['service']['name'] ?? null) === 'Synthetic Consultation' &&
        ($publicBooking['professional']['name'] ?? null) === 'Synthetic Professional A' &&
        ($publicBooking['customer']['name'] ?? null) === $publicBookingPayload['name'],
        'public booking returns the expected confirmation details'
    );
    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/public/clinics/synthetic-clinic-a/appointments', null, $publicBookingPayload),
        200,
        'public booking retries are idempotent'
    );
    $persistedPublicBooking = $pdo->prepare(
        'SELECT COUNT(*) FROM appointments a
         JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
         WHERE a.clinic_id = :clinic AND a.public_idempotency_key = :key
           AND p.email = :email AND a.status = \'scheduled\''
    );
    $persistedPublicBooking->execute([
        'clinic' => IT_IDS['clinicA'],
        'key' => $publicBookingPayload['idempotencyKey'],
        'email' => $publicBookingPayload['email'],
    ]);
    itAssert(
        (int)$persistedPublicBooking->fetchColumn() === 1,
        'public booking persists exactly one appointment for the idempotency key'
    );
    $otherClinicPrivacyProfile = itExpectResponse(
        itRequest($baseUrl, 'GET', $privacyProfilePath, itTokenFor(IT_IDS['adminB'], IT_IDS['clinicB'])),
        200,
        'a different clinic admin can read only its own privacy profile'
    );
    itAssert(
        ($otherClinicPrivacyProfile['data']['legalName'] ?? null) === '' &&
        ($otherClinicPrivacyProfile['data']['privacyPolicyUrl'] ?? null) === '',
        'clinic privacy profiles remain tenant-isolated'
    );

    itRunClinicSuspensionAccessTest($pdo, $adminToken);

    $adminBToken = itTokenFor(IT_IDS['adminB'], IT_IDS['clinicB']);
    $professionalToken = itTokenFor(IT_IDS['professionalUserA'], IT_IDS['clinicA']);

    $baseClaims = [
        'sub' => IT_IDS['adminA'],
        'clinicId' => IT_IDS['clinicA'],
        'sessionVersion' => 0,
        'iss' => 'sistema-de-agendamentos-api',
        'aud' => IT_AUDIENCE,
        'iat' => time(),
        'exp' => time() + 300,
    ];
    $tamperedParts = explode('.', $adminToken);
    $tamperedParts[2][0] = $tamperedParts[2][0] === 'A' ? 'B' : 'A';
    $invalidTokens = [
        'malformed' => 'not.a.valid.jwt.token',
        'signature adulteration' => implode('.', $tamperedParts),
        'unsupported algorithm' => itJsonToken($baseClaims, ['alg' => 'HS512', 'typ' => 'JWT']),
        'wrong issuer' => itJsonToken(array_replace($baseClaims, ['iss' => 'untrusted-issuer'])),
        'incompatible audience' => itJsonToken(array_replace($baseClaims, ['aud' => 'another-client'])),
        'expired token' => itJsonToken(array_replace($baseClaims, ['exp' => time() - 10])),
        'future nbf' => itJsonToken(array_replace($baseClaims, ['nbf' => time() + 120])),
        'invalid sessionVersion' => itJsonToken(array_replace($baseClaims, ['sessionVersion' => '0'])),
    ];
    foreach ($invalidTokens as $name => $token) {
        itExpectResponse(
            itRequest($baseUrl, 'GET', '/api/patients', $token),
            401,
            "HTTP authentication rejects $name"
        );
    }

    $patientList = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/patients', $adminToken),
        200,
        'clinic A can list its patients'
    );
    $patientIds = array_column($patientList['data'] ?? [], 'id');
    itAssert(in_array(IT_IDS['patientA'], $patientIds, true), 'clinic A patient is visible to clinic A admin');
    itAssert(!in_array(IT_IDS['patientB'], $patientIds, true), 'clinic B patient is absent from clinic A list');
    itExpectResponse(itRequest($baseUrl, 'GET', '/api/patients/' . IT_IDS['patientB'], $adminToken), 404, 'clinic A cannot read clinic B patient');
    itExpectResponse(itRequest($baseUrl, 'GET', '/api/patients/' . IT_IDS['patientB'], $adminBToken), 200, 'clinic B admin can read its own patient');
    itExpectResponse(
        itRequest($baseUrl, 'PUT', '/api/patients/' . IT_IDS['patientB'], $adminToken, ['name' => 'Cross-clinic mutation']),
        404,
        'clinic A cannot update clinic B patient'
    );
    itAssert(
        $pdo->query("SELECT name FROM patients WHERE id = '" . IT_IDS['patientB'] . "'")->fetchColumn() === 'Synthetic Patient B',
        'denied cross-clinic patient update leaves persisted data unchanged'
    );

    $professionalList = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/professionals', $adminToken),
        200,
        'clinic A can list its professionals'
    );
    $professionalIds = array_column($professionalList['data'] ?? [], 'id');
    itAssert(in_array(IT_IDS['professionalA'], $professionalIds, true), 'clinic A professional is visible to clinic A admin');
    itAssert(!in_array(IT_IDS['professionalB'], $professionalIds, true), 'clinic B professional is absent from clinic A list');
    itExpectResponse(itRequest($baseUrl, 'GET', '/api/professionals/' . IT_IDS['professionalB'], $adminToken), 404, 'clinic A cannot read clinic B professional');
    itExpectResponse(
        itRequest($baseUrl, 'PUT', '/api/professionals/' . IT_IDS['professionalB'], $adminToken, ['name' => 'Cross-clinic mutation']),
        404,
        'clinic A cannot update clinic B professional'
    );
    itAssert(
        $pdo->query("SELECT name FROM professionals WHERE id = '" . IT_IDS['professionalB'] . "'")->fetchColumn() === 'Synthetic Professional B',
        'denied cross-clinic professional update leaves persisted data unchanged'
    );

    $appointmentList = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/appointments', $adminToken),
        200,
        'clinic A can list its appointments'
    );
    $appointmentIds = array_column($appointmentList['data'] ?? [], 'id');
    itAssert(in_array(IT_IDS['appointmentA'], $appointmentIds, true), 'clinic A appointment is visible to clinic A admin');
    itAssert(!in_array(IT_IDS['appointmentB'], $appointmentIds, true), 'clinic B appointment is absent from clinic A list');
    itExpectResponse(itRequest($baseUrl, 'GET', '/api/appointments/' . IT_IDS['appointmentB'], $adminToken), 404, 'clinic A cannot read clinic B appointment');
    itExpectResponse(
        itRequest($baseUrl, 'PATCH', '/api/appointments/' . IT_IDS['appointmentB'] . '/status', $adminToken, ['status' => 'confirmed']),
        404,
        'clinic A cannot change clinic B appointment status'
    );
    itAssert(
        $pdo->query("SELECT status FROM appointments WHERE id = '" . IT_IDS['appointmentB'] . "'")->fetchColumn() === 'scheduled',
        'denied cross-clinic appointment mutation leaves persisted status unchanged'
    );

    $paymentList = itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/payments', $adminToken),
        200,
        'clinic A can list its payments'
    );
    $paymentIds = array_column($paymentList['data'] ?? [], 'id');
    itAssert(in_array(IT_IDS['paymentA'], $paymentIds, true), 'clinic A payment is visible to clinic A admin');
    itAssert(!in_array(IT_IDS['paymentB'], $paymentIds, true), 'clinic B payment is absent from clinic A list');
    itExpectResponse(
        itRequest($baseUrl, 'PATCH', '/api/payments/' . IT_IDS['paymentB'] . '/status', $adminToken, ['status' => 'paid']),
        404,
        'clinic A cannot change clinic B payment status'
    );
    itAssert(
        $pdo->query("SELECT status FROM payments WHERE id = '" . IT_IDS['paymentB'] . "'")->fetchColumn() === 'pending',
        'denied cross-clinic payment mutation leaves persisted status unchanged'
    );

    itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/payments', $professionalToken),
        403,
        'clinical professional cannot access financial routes'
    );
    itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/platform/clinics', $adminToken),
        401,
        'clinic admin cannot enter platform administration routes'
    );
    itExpectResponse(
        itRequest($baseUrl, 'GET', '/api/platform/clinics', $professionalToken),
        401,
        'clinical professional cannot enter platform administration routes'
    );

    $usersBeforeRegistration = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/auth/register', $adminToken, [
            'name' => 'Synthetic Platform Escalation',
            'email' => 'platform-escalation@integration.invalid',
            'password' => IT_PASSWORD,
            'role' => 'platform_admin',
        ]),
        400,
        'clinic registration rejects a platform-admin role'
    );
    itAssert(
        (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === $usersBeforeRegistration,
        'rejected platform-admin role creates no user'
    );

    $registered = itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/auth/register', $adminToken, [
            'name' => 'Synthetic Mass Assignment Account',
            'email' => 'mass-assignment@integration.invalid',
            'password' => IT_PASSWORD,
            'role' => 'admin',
            'clinic_id' => IT_IDS['clinicB'],
            'status' => 'suspended',
            'token_version' => 88,
        ]),
        201,
        'clinic admin registration uses the authenticated clinic and ignores protected extras'
    );
    itAssert(
        ($registered['data']['clinic_id'] ?? null) === IT_IDS['clinicA'] &&
        ($registered['data']['role'] ?? null) === 'admin',
        'registration persists the allowed clinic-local role and authenticated clinic'
    );
    $registeredAccount = $pdo->prepare('SELECT clinic_id, role, status, token_version FROM users WHERE email = :email');
    $registeredAccount->execute(['email' => 'mass-assignment@integration.invalid']);
    $registeredRow = $registeredAccount->fetch();
    itAssert(
        $registeredRow !== false &&
        $registeredRow['clinic_id'] === IT_IDS['clinicA'] &&
        $registeredRow['role'] === 'admin' &&
        $registeredRow['status'] === 'active' &&
        (int)$registeredRow['token_version'] === 0,
        'registration ignores client clinic_id, status and token_version fields'
    );

    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/patients', $adminToken, '{invalid-json'),
        400,
        'invalid JSON receives a client error'
    );
    $patientCount = (int)$pdo->query('SELECT COUNT(*) FROM patients')->fetchColumn();
    itExpectResponse(itRequest($baseUrl, 'POST', '/api/patients', $adminToken, ['email' => 'missing-name@integration.invalid']), 400, 'invalid patient input is rejected');
    itAssert((int)$pdo->query('SELECT COUNT(*) FROM patients')->fetchColumn() === $patientCount, 'invalid patient input creates no record');

    $patientMassAssignment = itRequest(
        $baseUrl,
        'PUT',
        '/api/patients/' . IT_IDS['patientA'],
        $adminToken,
        ['name' => 'Tampered Patient', 'clinic_id' => IT_IDS['clinicB'], 'clinicId' => IT_IDS['clinicB'], 'role' => 'admin', 'token_version' => 88]
    );
    itExpectResponse($patientMassAssignment, 400, 'patient write rejects clinic, role and token-version mass assignment');
    itAssert(
        $pdo->query("SELECT name FROM patients WHERE id = '" . IT_IDS['patientA'] . "'")->fetchColumn() === 'Synthetic Patient A',
        'rejected patient mass assignment leaves persisted data unchanged'
    );
    itAssert(
        (int)$pdo->query("SELECT token_version FROM users WHERE id = '" . IT_IDS['adminA'] . "'")->fetchColumn() === 0,
        'patient mass assignment cannot alter a user token version'
    );

    itExpectResponse(
        itRequest($baseUrl, 'PUT', '/api/professionals/' . IT_IDS['professionalA'], $adminToken, [
            'name' => 'Tampered Professional',
            'clinic_id' => IT_IDS['clinicB'],
            'role' => 'admin',
            'token_version' => 88,
        ]),
        400,
        'professional write rejects clinic, role and token-version mass assignment'
    );
    itAssert(
        $pdo->query("SELECT name FROM professionals WHERE id = '" . IT_IDS['professionalA'] . "'")->fetchColumn() === 'Synthetic Professional A',
        'rejected professional mass assignment leaves persisted data unchanged'
    );

    itExpectResponse(
        itRequest($baseUrl, 'PATCH', '/api/appointments/' . IT_IDS['appointmentA'] . '/status', $adminToken, [
            'status' => 'confirmed',
            'clinic_id' => IT_IDS['clinicB'],
            'amount' => 0,
        ]),
        400,
        'appointment status route rejects clinic and financial mass assignment'
    );
    itAssert(
        $pdo->query("SELECT status FROM appointments WHERE id = '" . IT_IDS['appointmentA'] . "'")->fetchColumn() === 'scheduled',
        'rejected appointment mass assignment leaves persisted status unchanged'
    );

    $paymentCount = (int)$pdo->query('SELECT COUNT(*) FROM payments')->fetchColumn();
    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/payments', $adminToken, [
            'appointmentId' => IT_IDS['appointmentB'],
            'amount' => 1.00,
            'status' => 'paid',
        ]),
        404,
        'payment creation cannot reference another clinic appointment'
    );
    itAssert((int)$pdo->query('SELECT COUNT(*) FROM payments')->fetchColumn() === $paymentCount, 'cross-clinic payment creation has no persisted effect');

    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/payments', $professionalToken, [
            'appointmentId' => IT_IDS['appointmentA'],
            'amount' => 1.00,
            'status' => 'paid',
        ]),
        403,
        'clinical professional cannot create or alter financial records'
    );
    itAssert((int)$pdo->query('SELECT COUNT(*) FROM payments')->fetchColumn() === $paymentCount, 'denied financial write has no persisted effect');

    itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/payments', $adminToken, [
            'appointmentId' => IT_IDS['appointmentA'],
            'amount' => 1.00,
            'status' => 'paid',
            'paid_at' => '2000-01-01T00:00:00Z',
        ]),
        400,
        'payment creation rejects a client-supplied paid_at timestamp'
    );
    itAssert((int)$pdo->query('SELECT COUNT(*) FROM payments')->fetchColumn() === $paymentCount, 'rejected payment fields create no record');

    itExpectResponse(
        itRequest($baseUrl, 'PATCH', '/api/payments/' . IT_IDS['paymentA'] . '/status', $adminToken, [
            'status' => 'paid',
            'amount' => 1.00,
            'paid_at' => '2000-01-01T00:00:00Z',
        ]),
        400,
        'payment status route rejects client-supplied amount and timestamp'
    );
    itAssert(
        $pdo->query("SELECT status FROM payments WHERE id = '" . IT_IDS['paymentA'] . "'")->fetchColumn() === 'pending',
        'rejected payment mass assignment leaves status unchanged'
    );

    $createdPayment = itExpectResponse(
        itRequest($baseUrl, 'POST', '/api/payments', $adminToken, [
            'appointmentId' => IT_IDS['appointmentA'],
            'amount' => 1.00,
            'status' => 'paid',
        ]),
        201,
        'authorized clinic admin can create a payment with allowed amount and status fields'
    );
    $createdPaymentId = $createdPayment['data']['id'] ?? null;
    itAssert(is_string($createdPaymentId) && $createdPaymentId !== '', 'created payment returns its persisted identifier');
    itAssert((float)($createdPayment['data']['amount'] ?? 0) === 1.0, 'payment endpoint persists the explicitly supplied synthetic amount');
    itAssert(($createdPayment['data']['status'] ?? null) === 'paid' && !empty($createdPayment['data']['paid_at']), 'payment endpoint derives paid_at from accepted status');
    $persistedPayment = $pdo->prepare('SELECT amount, status, paid_at FROM payments WHERE id = :id AND clinic_id = :clinic');
    $persistedPayment->execute(['id' => $createdPaymentId, 'clinic' => IT_IDS['clinicA']]);
    $stored = $persistedPayment->fetch();
    itAssert($stored !== false && (float)$stored['amount'] === 1.0 && $stored['status'] === 'paid' && $stored['paid_at'] !== null, 'financial creation effects are persisted in PostgreSQL');

    itExpectResponse(
        itRequest($baseUrl, 'PATCH', '/api/payments/' . IT_IDS['paymentA'] . '/status', $adminToken, ['status' => 'paid']),
        200,
        'authorized clinic admin can mark an own-clinic payment as paid'
    );
    $paidAt = $pdo->query("SELECT paid_at FROM payments WHERE id = '" . IT_IDS['paymentA'] . "'")->fetchColumn();
    itAssert($paidAt !== false && $paidAt !== null, 'payment status update sets paid_at on the server');

    $logoutResponse = itRequest($baseUrl, 'POST', '/api/auth/logout', $adminToken, (object)[]);
    itExpectResponse($logoutResponse, 200, 'logout revokes the active session');
    itAssert(
        (bool)array_filter(
            $logoutResponse['headers'] ?? [],
            static fn($header) => is_string($header) &&
                stripos($header, 'Set-Cookie: clinic_session=') === 0 &&
                stripos($header, 'expires=') !== false
        ),
        'logout expires the clinic session cookie'
    );
    itAssert(
        (int)$pdo->query("SELECT token_version FROM users WHERE id = '" . IT_IDS['adminA'] . "'")->fetchColumn() === 1,
        'logout increments the persisted token version'
    );
    itExpectResponse(itRequest($baseUrl, 'GET', '/api/auth/me', $adminToken), 401, 'revoked token cannot access the API');

    fwrite(STDOUT, sprintf("PASS %d PHP HTTP/PostgreSQL integration assertions.\n", $assertions));
}

try {
    if (getenv('NOA_ENV_FILE') !== 'php://memory') {
        throw new RuntimeException('Set NOA_ENV_FILE=php://memory to prevent loading backend/.env.');
    }
    if (getenv('NODE_ENV') !== 'test') {
        throw new RuntimeException('Set NODE_ENV=test for the integration test process.');
    }
    require_once dirname(__DIR__) . '/src/bootstrap.php';
    if ($phase === 'http-worker') {
        $request = json_decode(stream_get_contents(STDIN));
        if (!is_object($request) ||
            !is_string($request->baseUrl ?? null) ||
            !preg_match('#^http://127\.0\.0\.1:\d{1,5}$#', $request->baseUrl) ||
            !is_string($request->method ?? null) ||
            !is_string($request->path ?? null) ||
            (($request->token ?? null) !== null && !is_string($request->token))) {
            throw new RuntimeException('Concurrent HTTP worker request was invalid.');
        }
        echo json_encode(
            itRequest($request->baseUrl, $request->method, $request->path, $request->token ?? null, $request->body ?? null, 30),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES
        );
        exit(0);
    }
    $pdo = itDatabase();

    if ($phase === 'prepare') {
        itEnsureSchema($pdo);
        itSeed($pdo);
        fwrite(STDOUT, "PASS isolated test schema prepared with synthetic fixtures.\n");
    } elseif ($phase === 'cleanup') {
        itCleanup($pdo);
        fwrite(STDOUT, "PASS synthetic fixture cleanup and row-count verification.\n");
    } else {
        if (!is_string($baseUrl) || !preg_match('#^http://127\.0\.0\.1:\d{1,5}$#', $baseUrl)) {
            throw new RuntimeException('--test requires an HTTP base URL bound to loopback.');
        }
        if (!is_string($concurrentBaseUrl) || !preg_match('#^http://127\.0\.0\.1:\d{1,5}$#', $concurrentBaseUrl)) {
            throw new RuntimeException('--test requires a second HTTP base URL bound to loopback for concurrent tests.');
        }
        itRunHttpTests($baseUrl, $concurrentBaseUrl, $pdo);
    }
} catch (Throwable $error) {
    fwrite(STDERR, 'FAIL ' . $error->getMessage() . "\n");
    if ($error instanceof PDOException) {
        fwrite(STDERR, 'Database error SQLSTATE=' . (string)$error->getCode() . " (details withheld).\n");
    }
    exit(1);
}
