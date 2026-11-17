<?php
declare(strict_types=1);

$emptyEnvFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'noa-p0-env-' . getmypid();
putenv('NOA_ENV_FILE=' . $emptyEnvFile);
putenv('NODE_ENV=test');
putenv('DB_SSL=false');
putenv('JWT_SECRET=synthetic-security-p0-test-secret-value');
putenv('JWT_EXPIRES_IN=8h');
putenv('JWT_AUDIENCE');

require dirname(__DIR__) . '/src/bootstrap.php';

$passed = 0;

function p0Assert(bool $condition, string $message): void
{
    global $passed;
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $passed++;
}

function p0Rejects(callable $operation, string $message): void
{
    try {
        $operation();
    } catch (Throwable) {
        p0Assert(true, $message);
        return;
    }
    p0Assert(false, $message);
}

function p0ExpectApiStatus(callable $operation, int $status, string $message): void
{
    try {
        $operation();
    } catch (Noa\ApiException $error) {
        p0Assert($error->status === $status, $message);
        return;
    }
    p0Assert(false, $message);
}

function p0Encode(array $value): string
{
    return rtrim(strtr(base64_encode(json_encode($value, JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
}

function p0Token(array $claims, array $header = ['alg' => 'HS256', 'typ' => 'JWT'], ?string $secret = null): string
{
    $input = p0Encode($header) . '.' . p0Encode($claims);
    $signature = hash_hmac('sha256', $input, $secret ?? (string)getenv('JWT_SECRET'), true);
    return $input . '.' . rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
}

function p0ExtractBlock(string $source, string $start, string $end): string
{
    $startAt = strpos($source, $start);
    $endAt = strpos($source, $end, $startAt === false ? 0 : $startAt + strlen($start));
    if ($startAt === false || $endAt === false) {
        throw new RuntimeException("Could not locate source block: $start");
    }
    return substr($source, $startAt, $endAt - $startAt);
}

function p0Test(string $name, callable $test): void
{
    try {
        $test();
        fwrite(STDOUT, "PASS $name\n");
    } catch (Throwable $error) {
        fwrite(STDERR, "FAIL $name: {$error->getMessage()}\n");
        exit(1);
    }
}

$now = time();
$claims = [
    'sub' => 'synthetic-user',
    'clinicId' => 'synthetic-clinic',
    'sessionVersion' => 4,
    'iss' => 'sistema-de-agendamentos-api',
    'aud' => 'sistema-de-agendamentos-client',
    'iat' => $now,
    'exp' => $now + 300,
];

p0Test('JWT rejects malformed, adulterated, unsupported-algorithm, wrong-issuer and invalid-time tokens', static function () use ($claims, $now): void {
    p0Rejects(
        static fn() => Noa\Jwt::verify('not.a.jwt.with.extra.parts', 'sistema-de-agendamentos-client'),
        'malformed JWT is rejected'
    );

    $validToken = p0Token($claims);
    $parts = explode('.', $validToken);
    $parts[2][0] = $parts[2][0] === 'A' ? 'B' : 'A';
    p0Rejects(
        static fn() => Noa\Jwt::verify(implode('.', $parts), 'sistema-de-agendamentos-client'),
        'signature adulteration is rejected'
    );

    p0Rejects(
        static fn() => Noa\Jwt::verify(
            p0Token($claims, ['alg' => 'HS384', 'typ' => 'JWT']),
            'sistema-de-agendamentos-client'
        ),
        'unsupported JWT algorithm is rejected'
    );

    p0Rejects(
        static fn() => Noa\Jwt::verify(
            p0Token(array_replace($claims, ['iss' => 'untrusted-issuer'])),
            'sistema-de-agendamentos-client'
        ),
        'wrong JWT issuer is rejected'
    );

    p0Rejects(
        static fn() => Noa\Jwt::verify(
            p0Token(array_replace($claims, ['exp' => $now - 1])),
            'sistema-de-agendamentos-client'
        ),
        'expired JWT is rejected'
    );

    p0Rejects(
        static fn() => Noa\Jwt::verify(
            p0Token(array_replace($claims, ['nbf' => $now + 60])),
            'sistema-de-agendamentos-client'
        ),
        'future nbf is rejected'
    );
});

p0Test('JWT rejects a wrong audience and accepts its configured audience only', static function () use ($claims): void {
    $token = p0Token($claims);
    p0Rejects(
        static fn() => Noa\Jwt::verify($token, 'noa-connect-platform-admin'),
        'clinic token cannot be verified for platform administration'
    );
    p0Assert(
        Noa\Jwt::verify($token, 'sistema-de-agendamentos-client')['sub'] === 'synthetic-user',
        'clinic token verifies for its own audience'
    );
});

p0Test('session version mismatch revokes the token after token_version changes', static function (): void {
    p0Assert(Noa\isSessionVersionCurrent(4, 4), 'current session version is accepted');
    p0Assert(Noa\isSessionVersionCurrent(4, '4'), 'PostgreSQL integer string is accepted');
    p0Assert(!Noa\isSessionVersionCurrent(4, 5), 'incremented token_version revokes the old token');
    p0Assert(!Noa\isSessionVersionCurrent(-1, 4), 'invalid session version is rejected');

    $bootstrap = file_get_contents(dirname(__DIR__) . '/src/bootstrap.php');
    $platformAdmin = file_get_contents(dirname(__DIR__) . '/src/PlatformAdmin.php');
    $api = file_get_contents(dirname(__DIR__) . '/public/index.php');
    p0Assert(is_string($bootstrap) && str_contains($bootstrap, 'function isSessionVersionCurrent('), 'session comparison helper exists');
    p0Assert(is_string($api) && str_contains($api, 'Noa\\validateAuthenticatedClinicUser($claims, $user ?: null)'), 'clinic authentication uses the tested identity, role, and revocation validator');
    p0Assert(is_string($api) && str_contains($api, '\'sessionVersion\' => (int)$u[\'token_version\']'), 'clinic-selection tokens capture the current session version');
    p0Assert(is_string($api) && str_contains($api, 'Noa\\isSessionVersionCurrent($selected[\'sessionVersion\'], $user[\'token_version\'])'), 'clinic-selection redemption rejects a revoked session version');
    p0Assert(is_string($api) && str_contains($api, 'FOR UPDATE'), 'clinic-selection redemption locks the user row against concurrent revocation');
    p0Assert(is_string($platformAdmin) && str_contains($platformAdmin, 'isSessionVersionCurrent($claims[\'sessionVersion\'],$account[\'token_version\'])'), 'admin authentication uses the tested revocation comparison');
});

p0Test('clinic roles are explicitly allowlisted and session claims remain tenant-bound', static function (): void {
    foreach (['admin', 'reception', 'professional', 'patient'] as $role) {
        p0Assert(Noa\isKnownClinicRole($role), "$role is an allowed clinic role");
    }
    foreach (['platform_admin', 'owner', '', null, 7] as $role) {
        p0Assert(!Noa\isKnownClinicRole($role), 'unknown roles fail closed');
    }

    $api = file_get_contents(dirname(__DIR__) . '/public/index.php');
    $bootstrap = file_get_contents(dirname(__DIR__) . '/src/bootstrap.php');
    p0Assert(is_string($api) && str_contains($api, "WHERE u.id = :id AND u.clinic_id = :clinic"), 'clinic authentication binds both user and clinic claims');
    p0Assert(is_string($api) && str_contains($api, 'Noa\\isKnownClinicRole($user[\'role\'] ?? null)'), 'authenticated clinic users require a known role');
    p0Assert(is_string($api) && str_contains($api, 'u.phone, u.status, u.last_login_at'), 'the /auth/me query preserves its response fields');
    p0Assert(is_string($api) && str_contains($api, 'Noa\\selectClinicLoginAccount($claims, $clinicId)'), 'clinic switching validates the requested clinic against the signed selection token');
    p0Assert(is_string($bootstrap) && str_contains($bootstrap, 'function selectClinicLoginAccount(array $claims, string $clinicId): array'), 'selection validation is covered by the isolated contract test');
    p0Assert(is_string($api) && str_contains($api, "WHERE u.id = :user_id AND u.clinic_id = :clinic_id AND u.status = 'active'"), 'clinic selection reloads the account within the selected tenant');
    p0Assert(is_string($api) && str_contains($api, 'UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = :id AND clinic_id = :clinic'), 'logout revokes only the authenticated tenant-bound account');
});

p0Test('mocked clinic sessions reject IDOR, revoked users, invalid roles, and unlisted clinic switches', static function () use ($claims): void {
    $user = [
        'id' => 'synthetic-user',
        'clinic_id' => 'synthetic-clinic',
        'status' => 'active',
        'token_version' => '4',
        'role' => 'admin',
    ];
    $valid = Noa\validateAuthenticatedClinicUser($claims, $user);
    p0Assert($valid['clinic_id'] === $claims['clinicId'], 'authenticated session returns only the claim-bound clinic fixture');

    p0ExpectApiStatus(
        static fn() => Noa\validateAuthenticatedClinicUser($claims, array_replace($user, ['clinic_id' => 'other-clinic'])),
        401,
        'user fixture from another clinic cannot satisfy the authenticated tenant claim'
    );
    p0ExpectApiStatus(
        static fn() => Noa\validateAuthenticatedClinicUser($claims, array_replace($user, ['token_version' => 5])),
        401,
        'revoked token version is denied'
    );
    p0ExpectApiStatus(
        static fn() => Noa\validateAuthenticatedClinicUser($claims, array_replace($user, ['status' => 'inactive'])),
        401,
        'inactive account is denied'
    );
    p0ExpectApiStatus(
        static fn() => Noa\validateAuthenticatedClinicUser($claims, array_replace($user, ['role' => 'platform_admin'])),
        403,
        'unknown clinic role is denied'
    );
    p0ExpectApiStatus(
        static fn() => Noa\validateAuthenticatedClinicUser($claims, null),
        401,
        'missing account fixture is denied'
    );

    $selectionClaims = ['accounts' => [
        ['userId' => 'user-a', 'clinicId' => 'clinic-a', 'sessionVersion' => 2],
        ['userId' => 'user-b', 'clinicId' => 'clinic-b', 'sessionVersion' => 7],
    ]];
    p0Assert(
        Noa\selectClinicLoginAccount($selectionClaims, 'clinic-b')['userId'] === 'user-b',
        'clinic switch selects only the account bound to the requested signed choice'
    );
    p0ExpectApiStatus(
        static fn() => Noa\selectClinicLoginAccount($selectionClaims, 'clinic-c'),
        401,
        'clinic not present in the signed selection cannot be selected'
    );
    p0ExpectApiStatus(
        static fn() => Noa\selectClinicLoginAccount(['accounts' => [
            ['userId' => 'user-a', 'clinicId' => 'clinic-a', 'sessionVersion' => -1],
            ['userId' => 'user-b', 'clinicId' => 'clinic-b', 'sessionVersion' => 7],
        ]], 'clinic-b'),
        401,
        'malformed clinic selection session version invalidates the challenge'
    );
});

p0Test('PHP auth contracts preserve frontend response fields and password-reset revocation', static function (): void {
    $api = file_get_contents(dirname(__DIR__) . '/public/index.php');
    p0Assert(is_string($api), 'PHP auth contract is readable');
    p0Assert(str_contains($api, "'clinic_timezone' => \$user['clinic_timezone'] ?? 'UTC'"), 'PHP login retains the frontend timezone field');
    p0Assert(str_contains($api, "Http::json(200, ['ok' => true, 'data' => \$user])"), 'PHP /auth/me returns its documented data envelope');
    p0Assert(str_contains($api, 'u.phone, u.status, u.last_login_at'), 'PHP /auth/me includes phone and last-login fields');
    p0Assert(str_contains($api, 'UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = :id AND clinic_id = :clinic'), 'PHP logout revokes only the current tenant account');
    p0Assert(str_contains($api, 'hash(\'sha256\',$token)'), 'PHP password reset persists only a token hash');
    p0Assert(str_contains($api, 'token_version=token_version+1'), 'PHP password reset revokes issued sessions');
    p0Assert(str_contains($api, 'expires_at>NOW()'), 'PHP password reset rejects expired tokens');
    p0Assert(str_contains($api, 'Se o endereço estiver associado a uma conta ativa'), 'PHP recovery request preserves a generic response');
});

$apiPath = dirname(__DIR__) . '/public/index.php';
$apiSource = file_get_contents($apiPath);
$adminSource = file_get_contents(dirname(__DIR__) . '/src/PlatformAdmin.php');
if (!is_string($apiSource) || !is_string($adminSource)) {
    fwrite(STDERR, "FAIL could not read PHP route sources.\n");
    exit(1);
}

p0Test('clinical roles cannot enter platform administration routes', static function () use ($apiSource, $adminSource): void {
    $adminRoutes = p0ExtractBlock(
        $apiSource,
        'if ($path===\'/api/platform/auth/login\'',
        'if ($path===\'/api/payments\''
    );
    p0Assert(substr_count($adminRoutes, 'PlatformAdmin::authenticate($requestId)') >= 3, 'all protected platform route groups use separate admin authentication');
    p0Assert(str_contains($adminSource, 'Jwt::verify($token,self::AUDIENCE)'), 'admin auth requires dedicated audience');
    p0Assert(str_contains($adminSource, '($claims[\'scope\'] ?? null)!==\'platform_admin\''), 'admin auth requires platform scope');
});

p0Test('patient, professional, appointment and payment SQL retains clinic scoping', static function () use ($apiSource): void {
    $patients = p0ExtractBlock($apiSource, 'if (str_starts_with($path, \'/api/patients\')) {', 'if (str_starts_with($path, \'/api/specialties\')) {');
    p0Assert(str_contains($patients, 'p.id = :id AND p.clinic_id = :clinic'), 'patient reads filter by tenant');
    p0Assert(str_contains($patients, 'UPDATE patients SET'), 'patient update path exists');
    p0Assert(str_contains($patients, 'WHERE id = :id AND clinic_id = :clinic RETURNING *'), 'patient updates filter by tenant');
    p0Assert(str_contains($patients, 'INSERT INTO patients (clinic_id,user_id'), 'patient creation assigns authenticated clinic');

    $professionals = p0ExtractBlock($apiSource, 'if (str_starts_with($path, \'/api/professionals\')) {', 'if (str_starts_with($path, \'/api/services\')) {');
    p0Assert(str_contains($professionals, 'WHERE p.id = :id AND p.clinic_id = :clinic'), 'professional reads filter by tenant');
    p0Assert(str_contains($professionals, 'UPDATE professionals SET'), 'professional update path exists');
    p0Assert(str_contains($professionals, 'WHERE id = :id AND clinic_id = :clinic RETURNING *'), 'professional updates filter by tenant');
    p0Assert(str_contains($professionals, 'INSERT INTO professionals (clinic_id,user_id'), 'professional creation assigns authenticated clinic');

    $appointments = p0ExtractBlock($apiSource, 'if (str_starts_with($path, \'/api/appointments\')) {', 'if ($path===\'/api/platform/auth/login\'');
    p0Assert(str_contains($appointments, 'WHERE a.clinic_id=:clinic'), 'appointment lists filter by tenant');
    p0Assert(str_contains($appointments, 'WHERE a.id=:id AND a.clinic_id=:clinic'), 'appointment reads filter by tenant');
    p0Assert(str_contains($appointments, 'WHERE id=:id AND clinic_id=:clinic'), 'appointment mutations filter by tenant');
    p0Assert(str_contains($appointments, 'INSERT INTO appointments (clinic_id,'), 'appointment creation assigns authenticated clinic');
    p0Assert(str_contains($appointments, 'AND clinic_id=:clinic'), 'appointment deletion/status paths include tenant filter');

    $payments = p0ExtractBlock($apiSource, 'if ($path===\'/api/payments\' || str_starts_with($path,\'/api/payments/\')) {', 'if ($method===\'POST\' && $path===\'/api/checkout\')');
    p0Assert(str_contains($payments, 'WHERE p.clinic_id=:clinic'), 'payment list filters by tenant');
    p0Assert(str_contains($payments, 'WHERE p.id=:id AND p.clinic_id=:clinic'), 'payment checkout lookup filters by tenant');
    p0Assert(str_contains($payments, 'WHERE id=:id AND clinic_id=:clinic RETURNING *'), 'payment status mutation filters by tenant');
    p0Assert(str_contains($payments, 'INSERT INTO payments (clinic_id,'), 'payment creation assigns authenticated clinic');
    p0Assert(str_contains($payments, "requireClinicAccess(['admin','reception'])"), 'payment routes restrict clinical roles');
    p0Assert(str_contains($patients, 'requireRole($user, [\'admin\', \'reception\'])'), 'patient writes require authorized staff roles');
    p0Assert(str_contains($professionals, 'requireRole($user, [\'admin\', \'reception\'])'), 'professional writes require authorized staff roles');
    p0Assert(str_contains($appointments, 'requireRole($user, [\'admin\', \'reception\'])'), 'appointment staff mutations require authorized roles');
});

p0Test('write routes reject protected fields through explicit allowlists', static function () use ($apiSource): void {
    $patientValidator = p0ExtractBlock($apiSource, 'function validatePatientBody(', 'function enforceRequestRateLimit(');
    $professionalValidator = p0ExtractBlock($apiSource, 'function validateProfessionalBody(', 'function validateServiceBody(');
    $serviceValidator = p0ExtractBlock($apiSource, 'function validateServiceBody(', 'function appointmentSelectSql(');
    $appointmentValidator = p0ExtractBlock($apiSource, 'function validateCreateAppointment(', 'function validWaitlistEntry(');
    $registration = p0ExtractBlock($apiSource, 'if ($method === \'POST\' && $path === \'/api/auth/register\') {', 'if ($method === \'POST\' && $path === \'/api/auth/login\') {');
    $payments = p0ExtractBlock($apiSource, 'if ($path===\'/api/payments\' || str_starts_with($path,\'/api/payments/\')) {', 'if ($method===\'POST\' && $path===\'/api/checkout\')');

    foreach ([
        'patient' => $patientValidator,
        'professional' => $professionalValidator,
        'service' => $serviceValidator,
        'appointment' => $appointmentValidator,
    ] as $entity => $validator) {
        p0Assert(str_contains($validator, 'array_diff(array_keys($body), $allowed)'), "$entity validator rejects unlisted request fields");
        foreach (['clinic_id', 'clinicId', 'role', 'token_version', 'paid_at'] as $forbiddenField) {
            p0Assert(!str_contains($validator, "'$forbiddenField'"), "$entity allowlist excludes $forbiddenField");
        }
    }

    p0Assert(str_contains($registration, "requireClinicAccess(['admin'])"), 'only clinic admins may register accounts');
    p0Assert(str_contains($registration, '\'clinic\'=>$user[\'clinic_id\']'), 'registration uses authenticated clinic, not client clinic_id');
    p0Assert(str_contains($registration, 'in_array($role,[\'admin\',\'reception\',\'professional\',\'patient\'],true)'), 'account role is restricted to known values');

    p0Assert(str_contains($payments, '$fields=[\'appointmentId\',\'amount\',\'currency\',\'paymentMode\',\'provider\',\'status\']'), 'payment creation has a finite request-field allowlist');
    p0Assert(str_contains($payments, 'array_diff(array_keys($body),$fields)'), 'payment creation rejects unlisted fields');
    p0Assert(str_contains($payments, 'array_diff(array_keys($body),[\'status\'])'), 'payment status route only accepts status');
    p0Assert(!str_contains($payments, '$body[\'paid_at\']'), 'payment timestamps cannot be set directly by request');
    p0Assert(!str_contains($payments, '$body[\'metadata\']'), 'payment metadata cannot be set directly by request');
    p0Assert(str_contains($payments, "requireClinicAccess(['admin','reception'])"), 'financial writes require authorized clinic roles');
    p0Assert(str_contains($payments, "'amount'") && str_contains($payments, "'status'"), 'payment creation intentionally accepts explicit amount and status fields');
    p0Assert(str_contains($payments, "CASE WHEN :paid_status='paid' THEN NOW()"), 'paid_at is derived from the accepted payment status, not client timestamp');
});

p0Test('settings, reports, audit, waitlist, and scheduling operations retain tenant scope', static function () use ($apiSource): void {
    $specialties = p0ExtractBlock($apiSource, "if (str_starts_with(\$path, '/api/specialties')) {", "if (str_starts_with(\$path, '/api/professionals')) {");
    p0Assert(str_contains($specialties, 'WHERE id = :id AND clinic_id = :clinic'), 'specialty reads and updates are tenant-scoped');
    p0Assert(str_contains($specialties, 'INSERT INTO specialties (clinic_id,'), 'specialty creation assigns the authenticated tenant');

    $services = p0ExtractBlock($apiSource, "if (str_starts_with(\$path, '/api/services')) {", "if (str_starts_with(\$path, '/api/schedules')) {");
    p0Assert(str_contains($services, 'WHERE id = :id AND clinic_id = :clinic'), 'service reads and updates are tenant-scoped');
    p0Assert(str_contains($services, 'INSERT INTO services (clinic_id,'), 'service creation assigns the authenticated tenant');
    p0Assert(str_contains($services, 'professional_services WHERE clinic_id = :clinic AND service_id = :service'), 'service assignments are tenant-scoped');

    $schedules = p0ExtractBlock($apiSource, "if (str_starts_with(\$path, '/api/schedules')) {", "if (str_starts_with(\$path, '/api/appointments')) {");
    p0Assert(str_contains($schedules, 'professional_id=:professional AND clinic_id=:clinic'), 'schedule reads and mutations bind the authenticated tenant');
    p0Assert(str_contains($schedules, 'INSERT INTO schedule_blocks (clinic_id,'), 'schedule block creation assigns the authenticated tenant');

    $reports = p0ExtractBlock($apiSource, "if (\$method === 'GET' && \$path === '/api/reports/summary') {", "if (in_array(\$path, ['/api/settings', '/api/settings/'], true)) {");
    p0Assert(str_contains($reports, 'requireClinicAccess([\'admin\', \'reception\'])'), 'reports require a permitted clinic role');
    p0Assert(str_contains($reports, 'WHERE clinic_id=:clinic'), 'report aggregates filter every data source by tenant');

    $settings = p0ExtractBlock($apiSource, "if (in_array(\$path, ['/api/settings', '/api/settings/'], true)) {", "if (\$method === 'GET' && \$path === '/api/audit') {");
    p0Assert(str_contains($settings, 'WHERE clinic_id=:clinic'), 'settings reads and updates use the authenticated tenant');
    p0Assert(str_contains($settings, 'INSERT INTO clinic_configurations (clinic_id,'), 'new settings rows use the authenticated tenant');

    $audit = p0ExtractBlock($apiSource, "if (\$method === 'GET' && \$path === '/api/audit') {", "if (\$method === 'GET' && \$path === '/api/subscriptions/current') {");
    p0Assert(str_contains($audit, 'WHERE a.clinic_id=:clinic'), 'audit reads filter by tenant');

    $waitlist = p0ExtractBlock($apiSource, "if (\$path==='/api/waitlist' || str_starts_with(\$path,'/api/waitlist/')) {", "if(\$method==='POST' && preg_match('#^/api/public/clinics/");
    p0Assert(str_contains($waitlist, 'WHERE w.clinic_id=:clinic'), 'waitlist reads filter by tenant');
    p0Assert(str_contains($waitlist, 'WHERE id=:id AND clinic_id=:clinic'), 'waitlist status writes filter by tenant');
    p0Assert(str_contains($waitlist, 'INSERT INTO appointment_waitlist (clinic_id,'), 'waitlist creation assigns the authenticated tenant');
});

fwrite(STDOUT, sprintf("PASS %d PHP P0 assertions (unit + static source guards; no DB/API integration).\n", $passed));
