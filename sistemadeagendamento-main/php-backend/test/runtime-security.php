<?php
declare(strict_types=1);

$emptyEnvFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'noa-empty-runtime-env-' . getmypid();
putenv('NOA_ENV_FILE=' . $emptyEnvFile);
putenv('NODE_ENV=test');
putenv('DB_SSL=false');
putenv('JWT_SECRET=synthetic-runtime-security-test-secret');
require dirname(__DIR__) . '/src/bootstrap.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL $message\n");
        exit(1);
    }
}

function expectRejected(callable $operation, string $message): void
{
    try {
        $operation();
    } catch (Throwable) {
        return;
    }
    expect(false, $message);
}

function makeToken(array $claims): string
{
    $encode = static fn(array $value): string => rtrim(strtr(base64_encode(json_encode($value, JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
    $input = $encode(['alg' => 'HS256', 'typ' => 'JWT']) . '.' . $encode($claims);
    $signature = hash_hmac('sha256', $input, getenv('JWT_SECRET'), true);
    return $input . '.' . rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
}

Noa\validateDatabaseConfiguration();
Noa\validateApiConfiguration();

foreach ([
    'https://agenda.example.invalid',
    'https://agenda.example.invalid:8443',
] as $origin) {
    Noa\validateProductionCorsOrigin($origin);
}
foreach ([
    'https://AGENDA.example.invalid',
    'https://agenda.example.invalid:443',
    'https://agenda.example.invalid:0',
    'https://127.1',
    'https://0x7f000001',
    'https://localhost.',
    'https://[::ffff:7f00:1]',
] as $origin) {
    expectRejected(
        static fn() => Noa\validateProductionCorsOrigin($origin),
        "non-canonical or loopback origin rejected: $origin"
    );
}

putenv('JWT_EXPIRES_IN=15m');
expect(Noa\Jwt::ttl() === 900, 'JWT_EXPIRES_IN duration parsed in seconds');
foreach (['0s', '-1h', '1.5h', '3600', '1w', '9007199254740992d'] as $duration) {
    putenv('JWT_EXPIRES_IN=' . $duration);
    expectRejected(static fn() => Noa\Jwt::ttl(), "invalid JWT_EXPIRES_IN rejected: $duration");
}
putenv('JWT_EXPIRES_IN= 1H ');
expect(Noa\Jwt::ttl() === 3600, 'JWT_EXPIRES_IN is normalized consistently');
putenv('JWT_EXPIRES_IN=8h');

$baseClaims = [
    'sub' => 'synthetic-user',
    'clinicId' => 'synthetic-clinic',
    'sessionVersion' => 3,
    'iss' => 'sistema-de-agendamentos-api',
    'aud' => ['sistema-de-agendamentos-client'],
    'exp' => time() + 300,
];
putenv('JWT_AUDIENCE=custom-client');
$configuredAudienceToken = Noa\Jwt::sign(['sub' => 'synthetic-user'], 60);
expect(Noa\Jwt::verify($configuredAudienceToken, 'custom-client')['sub'] === 'synthetic-user', 'configured clinic audience used');
expectRejected(
    static fn() => Noa\Jwt::verify($configuredAudienceToken, 'sistema-de-agendamentos-client'),
    'configured clinic audience replaces only the default clinic audience'
);
foreach (['noa-connect-platform-admin', 'sistema-de-agendamentos-clinic-selection'] as $dedicatedAudience) {
    $dedicatedToken = Noa\Jwt::sign([], 60, $dedicatedAudience);
    expect(Noa\Jwt::verify($dedicatedToken, $dedicatedAudience)['aud'] === $dedicatedAudience, 'dedicated token audience remains supported');
}
putenv('JWT_AUDIENCE');

$claims = Noa\Jwt::verify(makeToken($baseClaims), 'sistema-de-agendamentos-client');
expect($claims['sub'] === 'synthetic-user', 'valid JWT with audience array accepted');
expect(Noa\isValidSessionVersion(0), 'zero sessionVersion accepted');
expect(Noa\isValidSessionVersion(3.0), 'integral JSON number sessionVersion accepted');
expect(Noa\isValidSessionVersion(9007199254740991), 'maximum safe sessionVersion accepted');
foreach ([-1, 1.5, '3', 9007199254740992, null] as $version) {
    expect(!Noa\isValidSessionVersion($version), 'invalid sessionVersion rejected');
}
expectRejected(
    static fn() => Noa\Jwt::verify(makeToken($baseClaims + ['nbf' => time() + 60]), 'sistema-de-agendamentos-client'),
    'future nbf rejected'
);
expectRejected(
    static fn() => Noa\Jwt::verify(makeToken(array_replace($baseClaims, ['exp' => 'tomorrow'])), 'sistema-de-agendamentos-client'),
    'non-numeric exp rejected'
);
expectRejected(
    static fn() => Noa\Jwt::verify(makeToken(array_replace($baseClaims, ['aud' => 'wrong-client'])), 'sistema-de-agendamentos-client'),
    'incompatible audience rejected'
);
expectRejected(
    static fn() => Noa\Jwt::verify(makeToken(array_diff_key($baseClaims, ['exp' => true])), 'sistema-de-agendamentos-client'),
    'missing exp rejected'
);

fwrite(STDOUT, "PASS PHP runtime security checks.\n");
