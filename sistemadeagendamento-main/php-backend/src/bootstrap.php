<?php
declare(strict_types=1);

namespace Noa;

require_once __DIR__ . '/AppointmentState.php';

function loadEnvironmentFile(string $path): void
{
    if (!is_file($path) || !is_readable($path)) return;
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) return;
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) continue;
        if (!preg_match('/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/', $line, $match)) continue;
        if (getenv($match[1]) !== false) continue;
        $value = trim($match[2]);
        if (strlen($value) >= 2 && (($value[0] === '"' && $value[-1] === '"') || ($value[0] === "'" && $value[-1] === "'"))) {
            $value = substr($value, 1, -1);
        } elseif (($hash = strpos($value, ' #')) !== false) {
            $value = rtrim(substr($value, 0, $hash));
        }
        putenv($match[1] . '=' . $value);
        $_ENV[$match[1]] = $value;
    }
}

loadEnvironmentFile(getenv('NOA_ENV_FILE') ?: dirname(__DIR__, 2) . '/backend/.env');

function requiredEnvironmentValue(string $name, bool $preserveWhitespace = false): string
{
    $value = getenv($name);
    if (!is_string($value) || trim($value) === '') {
        throw new \RuntimeException("$name must be configured.");
    }
    return $preserveWhitespace ? $value : trim($value);
}

function runtimeEnvironment(): string
{
    $environment = getenv('NODE_ENV');
    if (!is_string($environment) || trim($environment) === '') {
        throw new \RuntimeException('NODE_ENV must be explicitly set to development, test, or production.');
    }
    $environment = strtolower(trim($environment));
    if (!in_array($environment, ['development', 'test', 'production'], true)) {
        throw new \RuntimeException('NODE_ENV must be explicitly set to development, test, or production.');
    }
    if (getenv('NODE_ENV') !== $environment) {
        putenv('NODE_ENV=' . $environment);
        $_ENV['NODE_ENV'] = $environment;
    }
    return $environment;
}

function isLoopbackHost(string $host): bool
{
    $host = strtolower(trim($host, " \t\n\r\0\x0B[]"));
    if ($host === 'localhost') return true;
    $packed = @inet_pton($host);
    if ($packed === false) return false;
    if (strlen($packed) === 4) return ord($packed[0]) === 127;
    if ($packed === str_repeat("\0", 15) . "\x01") return true;
    return substr($packed, 0, 10) === str_repeat("\0", 10) &&
        substr($packed, 10, 2) === "\xff\xff" &&
        ord($packed[12]) === 127;
}

function canonicalOriginHost(string $host): ?string
{
    if ($host === '' || $host !== strtolower($host)) return null;
    if (rtrim($host, '.') === 'localhost') return null;

    if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
        $address = substr($host, 1, -1);
        $packed = inet_pton($address);
        if ($packed === false || strlen($packed) !== 16) return null;
        $canonical = '[' . strtolower((string)inet_ntop($packed)) . ']';
        return $canonical === $host && !isLoopbackHost($address) ? $canonical : null;
    }

    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        return isLoopbackHost($host) ? null : $host;
    }

    if (preg_match('/^(?:0[xX][0-9a-fA-F]+|[0-9]+)(?:\.(?:0[xX][0-9a-fA-F]+|[0-9]+))*\.?$/', $host)) {
        return null;
    }

    if (strlen($host) > 254 || !preg_match('/^(?=.{1,253}\.?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\.?$/', $host)) {
        return null;
    }
    return $host;
}

function validateProductionCorsOrigin(string $origin): void
{
    try {
        $parts = parse_url($origin);
    } catch (\ValueError) {
        $parts = false;
    }
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' ||
        empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) ||
        isset($parts['query']) || isset($parts['fragment']) ||
        (isset($parts['path']) && $parts['path'] !== '')) {
        throw new \RuntimeException('CORS_ORIGIN must be a valid HTTPS origin in production.');
    }
    $host = canonicalOriginHost($parts['host']);
    if ($host === null) {
        throw new \RuntimeException('CORS_ORIGIN must be a valid HTTPS origin in production.');
    }
    if (isset($parts['port']) && ($parts['port'] < 1 || $parts['port'] > 65535 || $parts['port'] === 443)) {
        throw new \RuntimeException('CORS_ORIGIN must be a valid HTTPS origin in production.');
    }
    $canonicalOrigin = 'https://' . $host . (isset($parts['port']) ? ':' . $parts['port'] : '');
    if (!hash_equals($canonicalOrigin, $origin)) {
        throw new \RuntimeException('CORS_ORIGIN must be a valid HTTPS origin in production.');
    }
}

function validateDatabaseConfiguration(): void
{
    $environment = runtimeEnvironment();
    $sslValue = strtolower(trim(getenv('DB_SSL') ?: 'false'));
    if (!in_array($sslValue, ['true', '1', 'false', '0'], true)) {
        throw new \RuntimeException('DB_SSL must be set to true, 1, false, or 0.');
    }

    if ($environment !== 'production') return;

    $host = requiredEnvironmentValue('DB_HOST');
    $port = requiredEnvironmentValue('DB_PORT');
    $name = requiredEnvironmentValue('DB_NAME');
    $user = requiredEnvironmentValue('DB_USER');
    $password = requiredEnvironmentValue('DB_PASSWORD', true);
    if (!ctype_digit($port) || (int)$port < 1 || (int)$port > 65535) {
        throw new \RuntimeException('DB_PORT must be an integer between 1 and 65535.');
    }
    if (isLoopbackHost($host)) {
        throw new \RuntimeException('DB_HOST must not point to a loopback address in production.');
    }
    if ($name === 'clinic_db' || $user === 'clinic_user' || $password === 'clinic_password') {
        throw new \RuntimeException('Development database defaults are not allowed in production.');
    }
    if (!in_array($sslValue, ['true', '1'], true)) {
        throw new \RuntimeException('DB_SSL must be enabled in production.');
    }
    $caPath = getenv('DB_SSL_CA_PATH');
    if (is_string($caPath) && trim($caPath) !== '' &&
        (!is_file($caPath) || !is_readable($caPath))) {
        throw new \RuntimeException('DB_SSL_CA_PATH must point to a readable CA certificate file.');
    }
}

function validateApiConfiguration(): void
{
    validateDatabaseConfiguration();
    Jwt::validateConfiguration();
    if (runtimeEnvironment() === 'production') {
        validateProductionCorsOrigin(requiredEnvironmentValue('CORS_ORIGIN'));
    }
}

function isValidSessionVersion(mixed $value): bool
{
    return (is_int($value) || is_float($value)) &&
        is_finite((float)$value) &&
        $value >= 0 &&
        $value <= 9007199254740991 &&
        floor((float)$value) === (float)$value;
}

function isKnownClinicRole(mixed $role): bool
{
    return is_string($role) && in_array($role, ['admin', 'reception', 'professional', 'patient'], true);
}

function validateAuthenticatedClinicUser(array $claims, ?array $user): array
{
    if (!$user ||
        !is_string($claims['sub'] ?? null) ||
        !is_string($claims['clinicId'] ?? null) ||
        !hash_equals($claims['sub'], (string)($user['id'] ?? '')) ||
        !hash_equals($claims['clinicId'], (string)($user['clinic_id'] ?? '')) ||
        ($user['status'] ?? null) !== 'active' ||
        !isSessionVersionCurrent($claims['sessionVersion'] ?? null, $user['token_version'] ?? null)) {
        throw new ApiException(401, 'Token inválido ou expirado.');
    }
    if (!isKnownClinicRole($user['role'] ?? null)) {
        throw new ApiException(403, 'Você não tem permissão para esta ação.');
    }
    return $user;
}

function selectClinicLoginAccount(array $claims, string $clinicId): array
{
    $accounts = $claims['accounts'] ?? null;
    if (!is_array($accounts) || !array_is_list($accounts) || count($accounts) < 2) {
        throw new ApiException(401, 'Credenciais inválidas.');
    }

    $selected = null;
    foreach ($accounts as $account) {
        if (!is_array($account) ||
            !is_string($account['userId'] ?? null) ||
            !is_string($account['clinicId'] ?? null) ||
            !isValidSessionVersion($account['sessionVersion'] ?? null)) {
            throw new ApiException(401, 'Credenciais inválidas.');
        }
        if (hash_equals($account['clinicId'], $clinicId)) $selected = $account;
    }

    if ($selected === null) throw new ApiException(401, 'Credenciais inválidas.');
    return $selected;
}

function isSessionVersionCurrent(mixed $claim, mixed $stored): bool
{
    if (!isValidSessionVersion($claim)) return false;
    if (is_string($stored)) {
        $stored = filter_var($stored, FILTER_VALIDATE_INT);
        if ($stored === false) return false;
    }
    if (!isValidSessionVersion($stored)) return false;
    return (float)$claim === (float)$stored;
}

function jsStringLength(string $value): int
{
    $codePoints = preg_match_all('/./us', $value);
    $surrogatePairs = preg_match_all('/[\x{10000}-\x{10FFFF}]/u', $value);
    if ($codePoints === false || $surrogatePairs === false) return PHP_INT_MAX;
    return $codePoints + $surrogatePairs;
}

final class ApiException extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Http
{
    public static function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || strlen($raw) > 1_048_576) throw new ApiException(413, 'Conteúdo da solicitação inválido.');
        if ($raw === '') return [];
        try {
            $decoded = json_decode($raw, false, 32, JSON_THROW_ON_ERROR);
            if (!$decoded instanceof \stdClass) throw new \JsonException();
            $data = (array)$decoded;
        }
        catch (\JsonException) { throw new ApiException(400, 'JSON inválido.'); }
        return $data;
    }

    public static function json(int $status, array $data): never
    {
        if (isset($GLOBALS['clinicAccessFinalize']) && is_callable($GLOBALS['clinicAccessFinalize'])) {
            $finalize = $GLOBALS['clinicAccessFinalize'];
            unset($GLOBALS['clinicAccessFinalize']);
            try {
                $finalize($status < 400);
            } catch (\Throwable $error) {
                error_log('Clinic access transaction finalization failed: ' . get_class($error));
                $status = 503;
                $data = ['ok' => false, 'message' => 'Serviço temporariamente indisponível.'];
            }
        }
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }
}

final class Database
{
    private static ?\PDO $pdo = null;

    public static function connection(): \PDO
    {
        if (self::$pdo instanceof \PDO) return self::$pdo;
        validateDatabaseConfiguration();
        if (!in_array('pgsql', \PDO::getAvailableDrivers(), true)) throw new \RuntimeException('PostgreSQL PDO driver unavailable');
        $production = runtimeEnvironment() === 'production';
        $host = $production ? requiredEnvironmentValue('DB_HOST') : (getenv('DB_HOST') ?: 'localhost');
        $port = $production ? requiredEnvironmentValue('DB_PORT') : (getenv('DB_PORT') ?: '5432');
        $name = $production ? requiredEnvironmentValue('DB_NAME') : (getenv('DB_NAME') ?: 'clinic_db');
        $user = $production ? requiredEnvironmentValue('DB_USER') : (getenv('DB_USER') ?: 'clinic_user');
        $password = $production ? requiredEnvironmentValue('DB_PASSWORD', true) : (getenv('DB_PASSWORD') ?: 'clinic_password');
        $sslValue = strtolower(trim(getenv('DB_SSL') ?: 'false'));
        $sslEnabled = in_array($sslValue, ['true', '1'], true);
        $sslMode = $sslEnabled ? 'verify-full' : 'prefer';
        $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=%s', $host, $port, $name, $sslMode);
        $caPath = getenv('DB_SSL_CA_PATH');
        if ($sslEnabled && is_string($caPath) && $caPath !== '') $dsn .= ';sslrootcert=' . $caPath;
        self::$pdo = new \PDO($dsn, $user, $password, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return self::$pdo;
    }
}

final class Jwt
{
    private const ISSUER = 'sistema-de-agendamentos-api';
    private const DEFAULT_AUDIENCE = 'sistema-de-agendamentos-client';

    public static function audience(): string
    {
        $audience = getenv('JWT_AUDIENCE');
        return is_string($audience) && trim($audience) !== '' ? trim($audience) : self::DEFAULT_AUDIENCE;
    }

    public static function validateConfiguration(): void
    {
        $secret = self::secret();
        if (strlen($secret) < 32 || trim($secret) !== $secret) {
            throw new \RuntimeException('JWT_SECRET must contain at least 32 bytes and have no surrounding whitespace.');
        }
        self::audience();
        self::ttl();
    }

    public static function ttl(): int
    {
        $value = strtolower(trim(getenv('JWT_EXPIRES_IN') ?: '8h'));
        if (!preg_match('/^([1-9]\d*)(s|m|h|d)$/', $value, $match)) {
            throw new \RuntimeException('JWT_EXPIRES_IN must be a positive integer followed by s, m, h, or d.');
        }
        $amount = (float)$match[1];
        $seconds = $amount * ['s' => 1, 'm' => 60, 'h' => 3600, 'd' => 86400][$match[2]];
        if (!is_finite($seconds) || $seconds > 9007199254740991) {
            throw new \RuntimeException('JWT_EXPIRES_IN exceeds the supported range.');
        }
        return (int)$seconds;
    }

    public static function sign(array $claims, int $ttl, ?string $audience = null): string
    {
        $secret = self::secret();
        $now = time();
        $header = self::encode(['alg' => 'HS256', 'typ' => 'JWT']);
        $payload = self::encode($claims + ['iss' => self::ISSUER, 'aud' => $audience ?? self::audience(), 'iat' => $now, 'exp' => $now + $ttl]);
        $input = $header . '.' . $payload;
        return $input . '.' . self::base64url(hash_hmac('sha256', $input, $secret, true));
    }

    public static function verify(string $token, string $audience): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) throw new ApiException(401, 'Token inválido ou expirado.');
        [$head, $body, $signature] = $parts;
        $secret = self::secret();
        $expected = self::base64url(hash_hmac('sha256', $head . '.' . $body, $secret, true));
        $header = json_decode(self::decode($head), true);
        $claims = json_decode(self::decode($body), true);
        $audiences = is_array($claims) ? ($claims['aud'] ?? null) : null;
        $audienceMatches = is_string($audiences)
            ? $audiences === $audience
            : (is_array($audiences) && in_array($audience, $audiences, true));
        $expiration = is_array($claims) ? ($claims['exp'] ?? null) : null;
        $notBefore = is_array($claims) ? ($claims['nbf'] ?? null) : null;
        if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256' || !is_array($claims) ||
            !hash_equals($expected, $signature) || ($claims['iss'] ?? '') !== self::ISSUER ||
            !$audienceMatches || !self::isNumericDate($expiration) || $expiration <= time() ||
            (array_key_exists('nbf', $claims) && (!self::isNumericDate($notBefore) || $notBefore > time()))) {
            throw new ApiException(401, 'Token inválido ou expirado.');
        }
        return $claims;
    }

    private static function isNumericDate(mixed $value): bool
    {
        return (is_int($value) || is_float($value)) && is_finite((float)$value);
    }

    private static function secret(): string
    {
        $secret = getenv('JWT_SECRET') ?: '';
        if (strlen($secret) < 32 || trim($secret) !== $secret) throw new ApiException(503, 'Serviço temporariamente indisponível.');
        return $secret;
    }

    private static function encode(array $value): string { return self::base64url(json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)); }
    private static function decode(string $value): string
    {
        $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
        if ($decoded === false) throw new ApiException(401, 'Token inválido ou expirado.');
        return $decoded;
    }
    private static function base64url(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
}
