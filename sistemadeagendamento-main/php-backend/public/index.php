<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';
Noa\validateApiConfiguration();
require_once dirname(__DIR__) . '/src/PlanCatalog.php';
require_once dirname(__DIR__) . '/src/PlatformAdmin.php';
require_once dirname(__DIR__) . '/src/SmtpMailer.php';
require_once dirname(__DIR__) . '/src/MercadoPagoWebhook.php';

use Noa\Http;
use Noa\Database;
use Noa\Jwt;
use Noa\PlatformAdmin;
use Noa\SmtpMailer;
use Noa\MercadoPagoWebhook;
use function Noa\jsStringLength;

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = rtrim($path, '/') ?: '/';
$requestIdBytes = random_bytes(16);
$requestIdBytes[6] = chr((ord($requestIdBytes[6]) & 0x0f) | 0x40);
$requestIdBytes[8] = chr((ord($requestIdBytes[8]) & 0x3f) | 0x80);
$requestIdHex = bin2hex($requestIdBytes);
$requestId = substr($requestIdHex,0,8).'-'.substr($requestIdHex,8,4).'-'.substr($requestIdHex,12,4).'-'.substr($requestIdHex,16,4).'-'.substr($requestIdHex,20,12);

header('X-Request-Id: ' . $requestId);
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header('Content-Security-Policy: default-src \'none\'; frame-ancestors \'none\'');
header('Cache-Control: no-store');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigin = getenv('CORS_ORIGIN') ?: 'http://localhost:5173';
if ($origin !== '' && hash_equals($allowedOrigin, $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token');
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $body = Http::jsonBody();

    if ($path === '/api/auth/csrf') enforceRequestRateLimit('auth-csrf',120,60);
    elseif ($path === '/api/auth' || str_starts_with($path, '/api/auth/')) enforceRequestRateLimit('auth-api',5,60);
    if ($path === '/api/appointments' || str_starts_with($path, '/api/appointments/')) enforceRequestRateLimit('appointment-api',10,60);
    if ($path === '/api/public' || str_starts_with($path, '/api/public/')) enforceRequestRateLimit('public-api',120,60);
    $standardLimitedPrefixes=['/api/clinics','/api/professionals','/api/patients','/api/schedules','/api/specialties','/api/settings','/api/audit','/api/payments','/api/subscriptions','/api/reports','/api/waitlist','/api/platform','/api/services'];
    foreach($standardLimitedPrefixes as $prefix) if($path===$prefix || str_starts_with($path,$prefix.'/')) { enforceRequestRateLimit('api',100,60); break; }
    if ($path==='/api/checkout' || str_starts_with($path,'/api/checkout/')) enforceRequestRateLimit('public-action',5,60);
    if (preg_match('#^/api/platform/auth/login$#',$path)) enforceRequestRateLimit('auth-api',5,60);
    if ($method==='POST' && preg_match('#^/api/public/clinics/[^/]+/(appointments|waitlist)$#',$path)) enforceRequestRateLimit('public-action',5,60);
    if ($method==='POST' && $path==='/api/public/appointment-management-link') enforceRequestRateLimit('public-action',5,60);
    if (($path === '/api/public/appointment-management/cancel' || preg_match('#^/api/public/appointment-management/[^/]+/cancel$#',$path)) && $method==='POST') enforceRequestRateLimit('public-action',5,60);

    if ($method === 'GET' && $path === '/api/auth/csrf') {
        Http::json(200, ['ok' => true, 'data' => ['csrfToken' => issueCsrfCookie()]]);
    }

    if ($method === 'GET' && in_array($path, ['/api/health', '/api/health/live'], true)) {
        Http::json(200, ['ok' => true, 'message' => 'Sistema de agendamento online', 'timestamp' => gmdate(DATE_ATOM)]);
    }

    if ($method === 'GET' && $path === '/api/health/ready') {
        Database::connection()->query('SELECT 1');
        Http::json(200, ['ok' => true, 'message' => 'Dependências disponíveis', 'timestamp' => gmdate(DATE_ATOM)]);
    }

    if ($method === 'POST' && $path === '/api/auth/password-reset/request') {
        enforceRequestRateLimit('password-reset-ip',5,900);
        $email=$body['email'] ?? null;
        if (!is_string($email) || trim($email)==='' || jsStringLength($email)>255 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/',trim($email))) Http::json(400,['ok'=>false,'message'=>'Informe um endereço de e-mail válido.']);
        $normalized=strtolower(trim($email)); enforceRequestRateLimit('password-reset-email',3,3600,hash('sha256',$normalized));
        $db=Database::connection();
        $accountsStmt=$db->prepare("SELECT u.id,u.clinic_id,c.trade_name,c.name AS clinic_name FROM users u JOIN clinics c ON c.id=u.clinic_id WHERE LOWER(u.email)=:email AND u.status='active' ORDER BY u.clinic_id,u.id");
        $accountsStmt->execute(['email'=>$normalized]); $accounts=$accountsStmt->fetchAll(); $issued=[]; $links=[];
        if ($accounts) {
            $db->beginTransaction();
            try {
                foreach ($accounts as $account) {
                    $userLock=$db->prepare("SELECT id FROM users WHERE id=:user AND clinic_id=:clinic AND status='active' FOR UPDATE"); $userLock->execute(['user'=>$account['id'],'clinic'=>$account['clinic_id']]);
                    if (!$userLock->fetchColumn()) continue;
                    $invalidate=$db->prepare('UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=:user AND clinic_id=:clinic AND used_at IS NULL'); $invalidate->execute(['user'=>$account['id'],'clinic'=>$account['clinic_id']]);
                    $token=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'='); $digest=hash('sha256',$token);
                    $insert=$db->prepare("INSERT INTO password_reset_tokens (clinic_id,user_id,token_hash,expires_at) VALUES (:clinic,:user,:hash,NOW()+INTERVAL '30 minutes')");
                    $insert->execute(['clinic'=>$account['clinic_id'],'user'=>$account['id'],'hash'=>$digest]);
                    writeAudit($db,$account['clinic_id'],$account['id'],'user',$account['id'],'auth.password_reset.requested',['requestId'=>$requestId]);
                    $issued[]=['clinicId'=>$account['clinic_id'],'userId'=>$account['id'],'hash'=>$digest];
                    $links[]=['token'=>$token,'clinicName'=>$account['trade_name'] ?: $account['clinic_name']];
                }
                commitClinicOperation($db);
            } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
        }
        try { sendPhpPasswordResetEmail($normalized,$links); }
        catch (Throwable) {
            if ($issued) {
                $db->beginTransaction();
                try { $revoke=$db->prepare('UPDATE password_reset_tokens SET used_at=NOW() WHERE clinic_id=:clinic AND user_id=:user AND token_hash=:hash AND used_at IS NULL'); foreach($issued as $item) $revoke->execute(['clinic'=>$item['clinicId'],'user'=>$item['userId'],'hash'=>$item['hash']]); commitClinicOperation($db); }
                catch(Throwable $e) { if($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
            error_log(sprintf('[%s] Password reset email delivery failed',$requestId));
            throw new Noa\ApiException(503,'A recuperação de senha está temporariamente indisponível.');
        }
        Http::json(202,['ok'=>true,'message'=>'Se o endereço estiver associado a uma conta ativa, as instruções serão enviadas.']);
    }

    if ($method === 'POST' && $path === '/api/auth/password-reset/confirm') {
        enforceRequestRateLimit('password-reset-ip',5,900);
        $token=$body['token'] ?? null; $password=$body['password'] ?? null; $confirmation=$body['confirmPassword'] ?? null;
        if (!is_string($token) || strlen($token)>128 || !is_string($password) || jsStringLength($password)>1024 || !is_string($confirmation) || jsStringLength($confirmation)>1024) Http::json(400,['ok'=>false,'message'=>'Dados de redefinição inválidos.']);
        if ($password!==$confirmation) Http::json(400,['ok'=>false,'message'=>'As senhas não coincidem.']);
        if (textLength($password)<12 || strlen($password)>72) Http::json(400,['ok'=>false,'message'=>'A senha deve conter ao menos 12 caracteres e no máximo 72 bytes em UTF-8.']);
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/',$token)) Http::json(400,['ok'=>false,'message'=>'O link de redefinição é inválido, expirou ou já foi utilizado.']);
        $hash=password_hash($password,PASSWORD_BCRYPT,['cost'=>12]); if (!is_string($hash)) throw new Noa\ApiException(503,'Serviço temporariamente indisponível.');
        $db=Database::connection(); $tokenHash=hash('sha256',$token); beginClinicOperation($db);
        try {
            $ownerStmt=$db->prepare('SELECT clinic_id,user_id FROM password_reset_tokens WHERE token_hash=:hash'); $ownerStmt->execute(['hash'=>$tokenHash]); $owner=$ownerStmt->fetch();
            if (!$owner) { rollBackClinicOperation($db); Http::json(400,['ok'=>false,'message'=>'O link de redefinição é inválido, expirou ou já foi utilizado.']); }
            $userLock=$db->prepare("SELECT id FROM users WHERE id=:user AND clinic_id=:clinic AND status='active' FOR UPDATE"); $userLock->execute(['user'=>$owner['user_id'],'clinic'=>$owner['clinic_id']]);
            if (!$userLock->fetchColumn()) {
                $used=$db->prepare('UPDATE password_reset_tokens SET used_at=NOW() WHERE token_hash=:hash AND used_at IS NULL'); $used->execute(['hash'=>$tokenHash]); commitClinicOperation($db);
                Http::json(400,['ok'=>false,'message'=>'O link de redefinição é inválido, expirou ou já foi utilizado.']);
            }
            $valid=$db->prepare('SELECT id FROM password_reset_tokens WHERE token_hash=:hash AND clinic_id=:clinic AND user_id=:user AND used_at IS NULL AND expires_at>NOW() FOR UPDATE'); $valid->execute(['hash'=>$tokenHash,'clinic'=>$owner['clinic_id'],'user'=>$owner['user_id']]);
            if (!$valid->fetchColumn()) { rollBackClinicOperation($db); Http::json(400,['ok'=>false,'message'=>'O link de redefinição é inválido, expirou ou já foi utilizado.']); }
            $update=$db->prepare("UPDATE users SET password_hash=:password,token_version=token_version+1,updated_at=NOW() WHERE id=:user AND clinic_id=:clinic AND status='active' RETURNING id"); $update->execute(['password'=>$hash,'user'=>$owner['user_id'],'clinic'=>$owner['clinic_id']]);
            if (!$update->fetchColumn()) { rollBackClinicOperation($db); Http::json(400,['ok'=>false,'message'=>'O link de redefinição é inválido, expirou ou já foi utilizado.']); }
            $consume=$db->prepare('UPDATE password_reset_tokens SET used_at=NOW() WHERE clinic_id=:clinic AND user_id=:user AND used_at IS NULL'); $consume->execute(['clinic'=>$owner['clinic_id'],'user'=>$owner['user_id']]);
            writeAudit($db,$owner['clinic_id'],$owner['user_id'],'user',$owner['user_id'],'auth.password_reset.completed',['requestId'=>$requestId]);
            commitClinicOperation($db);
        } catch(Throwable $e) { if($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
        Http::json(200,['ok'=>true,'message'=>'Senha redefinida. Entre com sua nova senha.']);
    }

    if ($method === 'POST' && $path === '/api/auth/register') {
        $user=requireClinicAccess(['admin']); requirePlanCapability($user,'userManagement');
        $name=$body['name'] ?? null; $email=$body['email'] ?? null; $password=$body['password'] ?? null; $role=$body['role'] ?? null; $phone=$body['phone'] ?? null;
        if (!is_string($name) || trim($name)==='' || textLength($name)>200 || !is_string($email) || trim($email)==='' || textLength($email)>255 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/',trim($email)) || !is_string($role)) Http::json(400,['ok'=>false,'message'=>'Dados de cadastro inválidos.']);
        if (!is_string($password) || textLength($password)<12 || strlen($password)>72) Http::json(400,['ok'=>false,'message'=>'A senha deve conter ao menos 12 caracteres e no máximo 72 bytes em UTF-8.']);
        if (!in_array($role,['admin','reception','professional','patient'],true)) Http::json(400,['ok'=>false,'message'=>'Role inválida.']);
        if ($phone!==null && !is_string($phone)) Http::json(400,['ok'=>false,'message'=>'Dados de cadastro inválidos.']);
        $db=Database::connection(); beginClinicOperation($db);
        try {
            $dupe=$db->prepare('SELECT id FROM users WHERE clinic_id=:clinic AND LOWER(email)=LOWER(:email)'); $dupe->execute(['clinic'=>$user['clinic_id'],'email'=>$email]);
            if ($dupe->fetchColumn()) throw new Noa\ApiException(409,'Usuário já cadastrado nesta clínica.');
            $hash=password_hash($password,PASSWORD_BCRYPT,['cost'=>12]);
            $insert=$db->prepare("INSERT INTO users (clinic_id,name,email,password_hash,phone,role,status) VALUES (:clinic,:name,:email,:password,:phone,:role,'active') RETURNING id,clinic_id,name,email,phone,role");
            $insert->execute(['clinic'=>$user['clinic_id'],'name'=>$name,'email'=>$email,'password'=>$hash,'phone'=>$phone,'role'=>$role]); $created=$insert->fetch();
            commitClinicOperation($db); Http::json(201,['ok'=>true,'data'=>$created]);
        } catch(Throwable $e) { if($db->inTransaction()) rollBackClinicOperation($db); if($e instanceof PDOException && $e->getCode()==='23505') throw new Noa\ApiException(409,'Usuário já cadastrado nesta clínica.'); throw $e; }
    }

    if ($method === 'POST' && $path === '/api/auth/login') {
        requireCsrfProtection();
        $email = $body['email'] ?? null;
        $password = $body['password'] ?? null;
        if (!is_string($email) || jsStringLength($email) > 255 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', trim($email)) ||
            !is_string($password) || $password === '' || jsStringLength($password) > 1024) {
            Http::json(400, ['ok' => false, 'message' => 'Informe um e-mail e uma senha válidos.']);
        }
        $query = Database::connection()->prepare(
            "SELECT u.id, u.clinic_id, u.name, u.email, u.password_hash, u.role, u.status, u.token_version,
                    c.name AS clinic_name, c.trade_name AS clinic_trade_name,
                    COALESCE((SELECT timezone FROM clinic_configurations WHERE clinic_id = u.clinic_id), 'UTC') AS clinic_timezone
             FROM users u JOIN clinics c ON c.id = u.clinic_id
             WHERE LOWER(u.email) = LOWER(:email) ORDER BY u.clinic_id, u.id"
        );
        $query->execute(['email' => trim($email)]);
        $matches = [];
        foreach ($query->fetchAll() as $user) {
            $passwordMatches = password_verify($password, $user['password_hash']);
            if ($user['status'] === 'active' && $passwordMatches && Noa\isKnownClinicRole($user['role'] ?? null)) {
                $matches[] = $user;
            }
        }
        if (!$matches || count(array_unique(array_column($matches, 'clinic_id'))) !== count($matches)) {
            Http::json(401, ['ok' => false, 'message' => 'Credenciais inválidas.']);
        }
        if (count($matches) > 1) {
            $selection = array_map(static fn(array $u): array => [
                'userId' => $u['id'],
                'clinicId' => $u['clinic_id'],
                'sessionVersion' => (int)$u['token_version'],
            ], $matches);
            Http::json(200, ['ok' => true, 'data' => [
                'requiresClinicSelection' => true,
                'selectionToken' => Jwt::sign(['accounts' => $selection], 300, 'sistema-de-agendamentos-clinic-selection'),
                'clinics' => array_map(static fn(array $u): array => ['clinicId' => $u['clinic_id'], 'name' => $u['clinic_trade_name'] ?: $u['clinic_name']], $matches),
            ]]);
        }
        respondWithClinicSession(createClinicSession($matches[0]));
    }

    if ($method === 'POST' && $path === '/api/auth/login/select-clinic') {
        requireCsrfProtection();
        $token = $body['selectionToken'] ?? null;
        $clinicId = $body['clinicId'] ?? null;
        if (!is_string($token) || !is_string($clinicId) || $clinicId === '') {
            Http::json(400, ['ok' => false, 'message' => 'Seleção de clínica inválida.']);
        }
        $claims = Jwt::verify($token, 'sistema-de-agendamentos-clinic-selection');
        $selected = Noa\selectClinicLoginAccount($claims, $clinicId);
        $db = Database::connection();
        beginClinicOperation($db);
        try {
            $stmt = $db->prepare(
                "SELECT u.id, u.clinic_id, u.name, u.email, u.role, u.status, u.token_version,
                        COALESCE((SELECT timezone FROM clinic_configurations WHERE clinic_id = u.clinic_id), 'UTC') AS clinic_timezone
                 FROM users u WHERE u.id = :user_id AND u.clinic_id = :clinic_id AND u.status = 'active'
                 FOR UPDATE"
            );
            $stmt->execute(['user_id' => $selected['userId'], 'clinic_id' => $clinicId]);
            $user = $stmt->fetch();
            if (!$user ||
                !hash_equals((string)$selected['userId'], (string)$user['id']) ||
                !hash_equals((string)$selected['clinicId'], (string)$user['clinic_id']) ||
                !Noa\isSessionVersionCurrent($selected['sessionVersion'], $user['token_version']) ||
                !Noa\isKnownClinicRole($user['role'] ?? null)) {
                throw new Noa\ApiException(401, 'Credenciais inválidas.');
            }
            $session = createClinicSession($user);
            commitClinicOperation($db);
            respondWithClinicSession($session);
        } catch (Throwable $error) {
            if ($db->inTransaction()) rollBackClinicOperation($db);
            throw $error;
        }
    }

    if (in_array($path, ['/api/auth/me', '/api/auth/logout'], true)) {
        $user = authenticatedUser();
        if ($method === 'GET' && $path === '/api/auth/me') {
            unset($user['password_hash'], $user['token_version']);
            Http::json(200, ['ok' => true, 'data' => $user]);
        }
        if ($method === 'POST' && $path === '/api/auth/logout') {
            $stmt = Database::connection()->prepare('UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = :id AND clinic_id = :clinic');
            $stmt->execute(['id' => $user['id'], 'clinic' => $user['clinic_id']]);
            clearClinicSessionCookie();
            Http::json(200, ['ok' => true, 'message' => 'Logout realizado com sucesso.']);
        }
    }

    if (str_starts_with($path, '/api/clinics')) {
        $user = requireClinicAccess(['admin', 'reception']);
        if ($method === 'GET' && $path === '/api/clinics') {
            $stmt = Database::connection()->prepare('SELECT * FROM clinics WHERE id = :clinic');
            $stmt->execute(['clinic' => $user['clinic_id']]);
            $clinic = $stmt->fetch();
            if (!$clinic) Http::json(404, ['ok' => false, 'message' => 'Clínica não encontrada.']);
            Http::json(200, ['ok' => true, 'data' => $clinic]);
        }
        if ($method === 'GET' && $path === '/api/clinics/users') {
            requirePlanCapability($user, 'userManagement');
            $stmt = Database::connection()->prepare('SELECT id, name, email, role, phone, status FROM users WHERE clinic_id = :clinic ORDER BY created_at DESC');
            $stmt->execute(['clinic' => $user['clinic_id']]);
            Http::json(200, ['ok' => true, 'data' => $stmt->fetchAll()]);
        }
    }

    if (str_starts_with($path, '/api/patients')) {
        $user = requireClinicAccess();
        $clinicId = $user['clinic_id'];
        if ($method === 'GET' && $path === '/api/patients') {
            $sql = 'SELECT p.* FROM patients p WHERE p.clinic_id = :clinic';
            $params = ['clinic' => $clinicId];
            if ($user['role'] === 'patient') {
                $sql .= ' AND p.user_id = :user'; $params['user'] = $user['id'];
            } elseif ($user['role'] === 'professional') {
                $sql .= ' AND EXISTS (SELECT 1 FROM appointments a JOIN professionals pr ON pr.id = a.professional_id AND pr.clinic_id = a.clinic_id WHERE a.patient_id = p.id AND a.clinic_id = p.clinic_id AND pr.user_id = :user)';
                $params['user'] = $user['id'];
            }
            $stmt = Database::connection()->prepare($sql . ' ORDER BY p.created_at DESC');
            $stmt->execute($params);
            Http::json(200, ['ok' => true, 'data' => $stmt->fetchAll()]);
        }
        if (preg_match('#^/api/patients/([0-9a-f-]{36})$#i', $path, $match) && $method === 'GET') {
            if (!isUuid($match[1])) Http::json(400, ['ok' => false, 'message' => 'Identificador inválido.']);
            $sql = 'SELECT p.* FROM patients p WHERE p.id = :id AND p.clinic_id = :clinic';
            $params = ['id' => $match[1], 'clinic' => $clinicId];
            if ($user['role'] === 'patient') { $sql .= ' AND p.user_id = :user'; $params['user'] = $user['id']; }
            elseif ($user['role'] === 'professional') {
                $sql .= ' AND EXISTS (SELECT 1 FROM appointments a JOIN professionals pr ON pr.id = a.professional_id AND pr.clinic_id = a.clinic_id WHERE a.patient_id = p.id AND a.clinic_id = p.clinic_id AND pr.user_id = :user)';
                $params['user'] = $user['id'];
            }
            $stmt = Database::connection()->prepare($sql);
            $stmt->execute($params);
            $patient = $stmt->fetch();
            if (!$patient) Http::json(404, ['ok' => false, 'message' => 'Paciente não encontrado.']);
            Http::json(200, ['ok' => true, 'data' => $patient]);
        }
        if ($method === 'POST' && $path === '/api/patients') {
            requireRole($user, ['admin', 'reception']);
            validatePatientBody($body, true);
            $db = Database::connection();
            $userId = $body['userId'] ?? null;
            if ($userId !== null && $userId !== '') {
                $check = $db->prepare("SELECT 1 FROM users WHERE id = :id AND clinic_id = :clinic AND role = 'patient' AND status = 'active'");
                $check->execute(['id' => $userId, 'clinic' => $clinicId]);
                if (!$check->fetchColumn()) Http::json(400, ['ok' => false, 'message' => 'Usuário paciente inválido para esta clínica.']);
            }
            $stmt = $db->prepare('INSERT INTO patients (clinic_id,user_id,name,cpf,birth_date,phone,email,status) VALUES (:clinic,:user_id,:name,:cpf,:birth_date,:phone,:email,:status) RETURNING *');
            $stmt->execute(['clinic' => $clinicId, 'user_id' => $userId ?: null, 'name' => trim($body['name']), 'cpf' => $body['cpf'] ?? null, 'birth_date' => empty($body['birthDate']) ? null : $body['birthDate'], 'phone' => $body['phone'] ?? null, 'email' => $body['email'] ?? null, 'status' => $body['status'] ?? 'active']);
            Http::json(201, ['ok' => true, 'data' => $stmt->fetch()]);
        }
        if (preg_match('#^/api/patients/([0-9a-f-]{36})$#i', $path, $match) && $method === 'PUT') {
            requireRole($user, ['admin', 'reception']);
            if (!isUuid($match[1])) Http::json(400, ['ok' => false, 'message' => 'Identificador inválido.']);
            validatePatientBody($body, false);
            $map = ['name' => 'name', 'cpf' => 'cpf', 'birthDate' => 'birth_date', 'phone' => 'phone', 'email' => 'email', 'status' => 'status'];
            $sets = []; $params = ['id' => $match[1], 'clinic' => $clinicId];
            foreach ($map as $key => $column) {
                if (!array_key_exists($key, $body)) continue;
                $bind = 'v_' . $key; $sets[] = "$column = COALESCE(:$bind, $column)";
                $params[$bind] = $body[$key] === null || ($key === 'birthDate' && $body[$key] === '') ? null : ($key === 'name' ? trim($body[$key]) : $body[$key]);
            }
            $sets[] = 'updated_at = NOW()';
            $stmt = Database::connection()->prepare('UPDATE patients SET ' . implode(', ', $sets) . ' WHERE id = :id AND clinic_id = :clinic RETURNING *');
            $stmt->execute($params); $patient = $stmt->fetch();
            if (!$patient) Http::json(404, ['ok' => false, 'message' => 'Paciente não encontrado.']);
            Http::json(200, ['ok' => true, 'data' => $patient]);
        }
    }

    if (str_starts_with($path, '/api/specialties')) {
        $user = requireClinicAccess();
        if ($method === 'GET' && $path === '/api/specialties') {
            $stmt = Database::connection()->prepare('SELECT * FROM specialties WHERE clinic_id = :clinic ORDER BY name ASC');
            $stmt->execute(['clinic' => $user['clinic_id']]);
            Http::json(200, ['ok' => true, 'data' => $stmt->fetchAll()]);
        }
        if ($method === 'POST' && $path === '/api/specialties') {
            requireRole($user, ['admin', 'reception']);
            validateEntityBody($body, ['name', 'description', 'status'], ['name'], ['name' => 200, 'description' => 2000, 'status' => 20]);
            $stmt = Database::connection()->prepare('INSERT INTO specialties (clinic_id,name,description,status) VALUES (:clinic,:name,:description,:status) RETURNING *');
            $stmt->execute(['clinic' => $user['clinic_id'], 'name' => trim($body['name']), 'description' => $body['description'] ?? null, 'status' => $body['status'] ?? 'active']);
            Http::json(201, ['ok' => true, 'data' => $stmt->fetch()]);
        }
        if (preg_match('#^/api/specialties/([^/]+)$#', $path, $match)) {
            if (!isUuid($match[1])) Http::json(400, ['ok' => false, 'message' => 'Identificador de especialidade inválido.']);
            if ($method === 'GET') {
                $stmt = Database::connection()->prepare('SELECT * FROM specialties WHERE id = :id AND clinic_id = :clinic');
                $stmt->execute(['id' => $match[1], 'clinic' => $user['clinic_id']]);
                $row = $stmt->fetch();
                if (!$row) Http::json(404, ['ok' => false, 'message' => 'Especialidade não encontrada.']);
                Http::json(200, ['ok' => true, 'data' => $row]);
            }
            if ($method === 'PUT') {
                requireRole($user, ['admin', 'reception']);
                validateEntityBody($body, ['name', 'description', 'status'], [], ['name' => 200, 'description' => 2000, 'status' => 20], true);
                $sets = []; $params = ['id' => $match[1], 'clinic' => $user['clinic_id']];
                foreach (['name', 'description', 'status'] as $field) if (array_key_exists($field, $body)) {
                    $sets[] = "$field = COALESCE(:$field, $field)";
                    $params[$field] = $body[$field] === '' || $body[$field] === null ? null : ($field === 'name' ? trim($body[$field]) : $body[$field]);
                }
                if (!$sets) Http::json(400, ['ok' => false, 'message' => 'Dados de especialidade inválidos ou campos não permitidos.']);
                $stmt = Database::connection()->prepare('UPDATE specialties SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE id = :id AND clinic_id = :clinic RETURNING *');
                $stmt->execute($params); $row = $stmt->fetch();
                if (!$row) Http::json(404, ['ok' => false, 'message' => 'Especialidade não encontrada.']);
                Http::json(200, ['ok' => true, 'data' => $row]);
            }
        }
    }

    if (str_starts_with($path, '/api/professionals')) {
        $user = requireClinicAccess();
        $clinic = $user['clinic_id'];
        if ($method === 'GET' && $path === '/api/professionals') {
            $sql = 'SELECT p.*, s.name AS specialty_name FROM professionals p LEFT JOIN specialties s ON s.id = p.specialty_id AND s.clinic_id = p.clinic_id WHERE p.clinic_id = :clinic';
            $params = ['clinic' => $clinic];
            if ($user['role'] === 'professional') { $sql .= ' AND p.user_id = :user'; $params['user'] = $user['id']; }
            $stmt = Database::connection()->prepare($sql . ' ORDER BY p.name ASC'); $stmt->execute($params);
            Http::json(200, ['ok' => true, 'data' => $stmt->fetchAll()]);
        }
        if ($method === 'POST' && $path === '/api/professionals') {
            requireRole($user, ['admin', 'reception']);
            validateProfessionalBody($body, true);
            $status = $body['status'] ?? 'active';
            $db = Database::connection(); beginClinicOperation($db);
            try {
                if ($status === 'active') assertProfessionalLimit($db, $clinic);
                assertClinicReference($db, 'specialties', $body['specialtyId'], $clinic, 'Especialidade inválida para esta clínica.');
                if (!empty($body['userId'])) assertClinicUser($db, $body['userId'], $clinic, 'professional', 'Usuário profissional inválido para esta clínica.');
                $stmt = $db->prepare('INSERT INTO professionals (clinic_id,user_id,specialty_id,name,crm,phone,status) VALUES (:clinic,:user_id,:specialty,:name,:crm,:phone,:status) RETURNING *');
                $stmt->execute(['clinic' => $clinic, 'user_id' => $body['userId'] ?? null, 'specialty' => $body['specialtyId'], 'name' => $body['name'], 'crm' => $body['crm'] ?? null, 'phone' => $body['phone'] ?? null, 'status' => $status]);
                $professional = $stmt->fetch();
                writeAudit($db, $clinic, $user['id'], 'professionals', $professional['id'], 'professional.created', ['status' => $status]);
                commitClinicOperation($db);
                Http::json(201, ['ok' => true, 'data' => $professional]);
            } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
        }
        if (preg_match('#^/api/professionals/([^/]+)(?:/(status))?$#', $path, $match)) {
            if (!isUuid($match[1])) Http::json(400, ['ok' => false, 'message' => 'Identificador inválido.']);
            if ($method === 'GET' && empty($match[2])) {
                $sql = 'SELECT p.*, s.name AS specialty_name FROM professionals p LEFT JOIN specialties s ON s.id = p.specialty_id AND s.clinic_id = p.clinic_id WHERE p.id = :id AND p.clinic_id = :clinic';
                $params = ['id' => $match[1], 'clinic' => $clinic];
                if ($user['role'] === 'professional') { $sql .= ' AND p.user_id = :user'; $params['user'] = $user['id']; }
                $stmt = Database::connection()->prepare($sql); $stmt->execute($params); $row = $stmt->fetch();
                if (!$row) Http::json(404, ['ok' => false, 'message' => 'Profissional não encontrado.']);
                Http::json(200, ['ok' => true, 'data' => $row]);
            }
            if (($method === 'PUT' && empty($match[2])) || ($method === 'PATCH' && ($match[2] ?? '') === 'status')) {
                requireRole($user, ['admin', 'reception']);
                $isStatusOnly = ($match[2] ?? '') === 'status';
                if ($isStatusOnly) {
                    if (!in_array($body['status'] ?? null, ['active', 'inactive'], true) || array_diff(array_keys($body), ['status'])) Http::json(400, ['ok' => false, 'message' => 'Status de profissional inválido.']);
                } else validateProfessionalBody($body, false);
                $db = Database::connection(); beginClinicOperation($db);
                try {
                    $lookup = $db->prepare('SELECT id,status FROM professionals WHERE id = :id AND clinic_id = :clinic FOR UPDATE');
                    $lookup->execute(['id' => $match[1], 'clinic' => $clinic]); $current = $lookup->fetch();
                    if (!$current) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Profissional não encontrado.']); }
                    $status = $isStatusOnly ? $body['status'] : ($body['status'] ?? null);
                    if ($status === 'active' && $current['status'] !== 'active') assertProfessionalLimit($db, $clinic);
                    if (!$isStatusOnly && !empty($body['specialtyId'])) assertClinicReference($db, 'specialties', $body['specialtyId'], $clinic, 'Especialidade inválida para esta clínica.');
                    $map = ['name' => 'name', 'specialtyId' => 'specialty_id', 'crm' => 'crm', 'phone' => 'phone', 'status' => 'status'];
                    $sets = []; $params = ['id' => $match[1], 'clinic' => $clinic];
                    foreach ($map as $field => $column) if (array_key_exists($field, $body)) {
                        $bind = 'v_' . $field; $sets[] = "$column = COALESCE(:$bind, $column)";
                        $params[$bind] = $body[$field] === null || $body[$field] === '' ? null : $body[$field];
                    }
                    if (!$sets) Http::json(400, ['ok' => false, 'message' => 'Dados de profissional inválidos.']);
                    $sets[] = 'updated_at = NOW()';
                    $stmt = $db->prepare('UPDATE professionals SET ' . implode(', ', $sets) . ' WHERE id = :id AND clinic_id = :clinic RETURNING *');
                    $stmt->execute($params); $updated = $stmt->fetch();
                    $changedStatus = $status !== null && $status !== $current['status'];
                    writeAudit($db, $clinic, $user['id'], 'professionals', $updated['id'], $changedStatus ? 'professional.' . ($status === 'active' ? 'activated' : 'deactivated') : 'professional.updated', ['changedFields' => array_keys($body), 'previousStatus' => $current['status'], 'status' => $updated['status']]);
                    commitClinicOperation($db);
                    Http::json(200, ['ok' => true, 'data' => $updated]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
        }
    }

    if (str_starts_with($path, '/api/services')) {
        $user = requireClinicAccess(); $clinic = $user['clinic_id'];
        if ($method === 'GET' && $path === '/api/services') {
            $sql = serviceListingSql(false, $user['role']);
            $params = ['clinic' => $clinic]; if ($user['role'] === 'professional') $params['user'] = $user['id'];
            $stmt = Database::connection()->prepare($sql); $stmt->execute($params);
            $rows = $stmt->fetchAll();
            foreach ($rows as &$row) $row['professional_ids'] = json_decode((string)$row['professional_ids'], true) ?: [];
            unset($row);
            Http::json(200, ['ok' => true, 'data' => $rows]);
        }
        if ($method === 'POST' && $path === '/api/services') {
            requireRole($user, ['admin', 'reception']); validateServiceBody($body, true);
            $db = Database::connection(); beginClinicOperation($db);
            try {
                assertProfessionalIds($db, $clinic, $body['professionalIds'] ?? []);
                $stmt = $db->prepare('INSERT INTO services (clinic_id,name,description,duration_minutes,price) VALUES (:clinic,:name,:description,:duration,:price) RETURNING *');
                $stmt->execute(['clinic' => $clinic, 'name' => trim($body['name']), 'description' => isset($body['description']) ? (trim($body['description']) ?: null) : null, 'duration' => $body['durationMinutes'], 'price' => $body['price']]);
                $service = $stmt->fetch();
                foreach ($body['professionalIds'] ?? [] as $professionalId) {
                    $assign = $db->prepare('INSERT INTO professional_services (clinic_id,professional_id,service_id) VALUES (:clinic,:professional,:service)');
                    $assign->execute(['clinic' => $clinic, 'professional' => $professionalId, 'service' => $service['id']]);
                    writeAudit($db, $clinic, $user['id'], 'services', $service['id'], 'professional_assigned', ['professionalId' => $professionalId]);
                }
                writeAudit($db, $clinic, $user['id'], 'services', $service['id'], 'created', ['name' => $service['name']]);
                commitClinicOperation($db); Http::json(201, ['ok' => true, 'data' => $service]);
            } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
        }
        if (preg_match('#^/api/services/([^/]+)(?:/(status|professionals))?$#', $path, $match)) {
            if (!isUuid($match[1])) Http::json(400, ['ok' => false, 'message' => 'Identificador de serviço inválido.']);
            $subroute = $match[2] ?? '';
            if ($method === 'GET' && $subroute === '') {
                $params = ['clinic' => $clinic, 'id' => $match[1]]; if ($user['role'] === 'professional') $params['user'] = $user['id'];
                $stmt = Database::connection()->prepare(serviceListingSql(true, $user['role']));
                $stmt->execute($params);
                $row = $stmt->fetch(); if (!$row) Http::json(404, ['ok' => false, 'message' => 'Serviço não encontrado.']);
                $row['professional_ids'] = json_decode((string)$row['professional_ids'], true) ?: [];
                Http::json(200, ['ok' => true, 'data' => $row]);
            }
            if ($method === 'PATCH' && $subroute === 'status') {
                requireRole($user, ['admin', 'reception']);
                if (array_diff(array_keys($body), ['isActive']) || !is_bool($body['isActive'] ?? null)) Http::json(400, ['ok' => false, 'message' => 'Status de serviço inválido.']);
                $db = Database::connection(); beginClinicOperation($db);
                try {
                    $stmt = $db->prepare('UPDATE services SET is_active = :active, updated_at = NOW() WHERE id = :id AND clinic_id = :clinic RETURNING *');
                    $stmt->execute(['active' => $body['isActive'] ? 'true' : 'false', 'id' => $match[1], 'clinic' => $clinic]); $row = $stmt->fetch();
                    if (!$row) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Serviço não encontrado.']); }
                    writeAudit($db, $clinic, $user['id'], 'services', $row['id'], $body['isActive'] ? 'activated' : 'deactivated', []);
                    commitClinicOperation($db); Http::json(200, ['ok' => true, 'data' => $row]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
            if (($method === 'PUT' && $subroute === '') || ($method === 'PUT' && $subroute === 'professionals')) {
                requireRole($user, ['admin', 'reception']); validateServiceBody($body, false, $subroute === 'professionals');
                $db = Database::connection(); beginClinicOperation($db);
                try {
                    $currentStmt = $db->prepare('SELECT is_active FROM services WHERE id = :id AND clinic_id = :clinic FOR UPDATE');
                    $currentStmt->execute(['id' => $match[1], 'clinic' => $clinic]); $current = $currentStmt->fetch();
                    if (!$current) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Serviço não encontrado.']); }
                    if (array_key_exists('professionalIds', $body)) {
                        $requested = $body['professionalIds']; assertProfessionalIds($db, $clinic, $requested);
                        if (!$current['is_active'] && $requested) {
                            $existingStmt = $db->prepare('SELECT professional_id FROM professional_services WHERE clinic_id = :clinic AND service_id = :service');
                            $existingStmt->execute(['clinic' => $clinic, 'service' => $match[1]]); $existing = array_column($existingStmt->fetchAll(), 'professional_id');
                            if (array_diff($requested, $existing)) { rollBackClinicOperation($db); Http::json(409, ['ok' => false, 'message' => 'Não é possível associar profissionais a um serviço inativo.']); }
                        }
                    }
                    $sets = []; $params = ['id' => $match[1], 'clinic' => $clinic];
                    foreach (['name' => 'name', 'description' => 'description', 'durationMinutes' => 'duration_minutes', 'price' => 'price'] as $field => $column) {
                        if (!array_key_exists($field, $body)) continue;
                        $bind = 'v_' . $field; $sets[] = "$column = :$bind";
                        $params[$bind] = $field === 'name' ? trim($body[$field]) : ($field === 'description' ? (trim((string)$body[$field]) ?: null) : $body[$field]);
                    }
                    $sets[] = 'updated_at = NOW()';
                    $stmt = $db->prepare('UPDATE services SET ' . implode(', ', $sets) . ' WHERE id = :id AND clinic_id = :clinic RETURNING *');
                    $stmt->execute($params); $service = $stmt->fetch();
                    if (!$service) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Serviço não encontrado.']); }
                    if (array_key_exists('professionalIds', $body)) syncServiceProfessionals($db, $clinic, $user['id'], $match[1], $body['professionalIds']);
                    writeAudit($db, $clinic, $user['id'], 'services', $service['id'], 'updated', ['fields' => array_keys($body)]);
                    commitClinicOperation($db); Http::json(200, ['ok' => true, 'data' => $service]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
        }
    }

    if (str_starts_with($path, '/api/schedules')) {
        $user = requireClinicAccess(); $clinic = $user['clinic_id'];
        if (preg_match('#^/api/schedules/professionals/([^/]+)(?:/(blocks|availability))?$#', $path, $match)) {
            $professionalId = $match[1]; $suffix = $match[2] ?? '';
            if (!isUuid($professionalId)) Http::json(400, ['ok' => false, 'message' => 'Identificador de profissional inválido.']);
            if ($method === 'GET' && $suffix === '') {
                if ($user['role'] === 'professional') {
                    $owner = Database::connection()->prepare('SELECT user_id FROM professionals WHERE id=:id AND clinic_id=:clinic');
                    $owner->execute(['id' => $professionalId, 'clinic' => $clinic]); $professionalUserId = $owner->fetchColumn();
                    if ($professionalUserId === false || $professionalUserId !== $user['id']) Http::json(403, ['ok' => false, 'message' => 'Você não pode visualizar a agenda de outro profissional.']);
                }
                $stmt = Database::connection()->prepare('SELECT * FROM professional_schedules WHERE professional_id=:professional AND clinic_id=:clinic ORDER BY weekday,start_time');
                $stmt->execute(['professional' => $professionalId, 'clinic' => $clinic]);
                Http::json(200, ['ok' => true, 'data' => $stmt->fetchAll()]);
            }
            if ($method === 'POST' && $suffix === '') {
                requireRole($user, ['admin', 'reception']);
                validateScheduleBody($body);
                assertProfessionalExists($clinic, $professionalId);
                $stmt = Database::connection()->prepare('INSERT INTO professional_schedules (clinic_id,professional_id,weekday,start_time,end_time,duration_minutes,break_duration_minutes) VALUES (:clinic,:professional,:weekday,:start,:end,:duration,:break) RETURNING *');
                $stmt->execute(['clinic' => $clinic, 'professional' => $professionalId, 'weekday' => (int)$body['weekday'], 'start' => $body['startTime'], 'end' => $body['endTime'], 'duration' => (int)$body['durationMinutes'], 'break' => (int)($body['breakDurationMinutes'] ?? 0)]);
                Http::json(201, ['ok' => true, 'data' => $stmt->fetch()]);
            }
            if ($method === 'POST' && $suffix === 'blocks') {
                requireRole($user, ['admin', 'reception']);
                validateScheduleBlockBody($body);
                $tz = $user['clinic_timezone'] ?? 'UTC';
                if (!uniqueClinicInstant($body['startDatetime'], $tz) || !uniqueClinicInstant($body['endDatetime'], $tz)) Http::json(400, ['ok' => false, 'message' => 'O horário local é inexistente ou ambíguo no fuso da clínica.']);
                assertProfessionalExists($clinic, $professionalId);
                $db = Database::connection(); beginClinicOperation($db);
                try {
                    $db->prepare('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))')->execute(['key' => $professionalId]);
                    $conflict = $db->prepare("SELECT 1 FROM appointments WHERE clinic_id=:clinic AND professional_id=:professional AND status NOT IN ('cancelled','rescheduled') AND scheduled_start < :ends AND scheduled_end > :starts LIMIT 1");
                    $conflict->execute(['clinic' => $clinic, 'professional' => $professionalId, 'starts' => $body['startDatetime'], 'ends' => $body['endDatetime']]);
                    if ($conflict->fetchColumn()) throw new Noa\ApiException(409, 'O bloqueio conflita com um agendamento existente.');
                    $stmt = $db->prepare('INSERT INTO schedule_blocks (clinic_id,professional_id,block_type,start_datetime,end_datetime,reason) VALUES (:clinic,:professional,:type,:starts,:ends,:reason) RETURNING *');
                    $stmt->execute(['clinic' => $clinic, 'professional' => $professionalId, 'type' => $body['blockType'], 'starts' => $body['startDatetime'], 'ends' => $body['endDatetime'], 'reason' => $body['reason'] ?? null]);
                    $block = $stmt->fetch(); commitClinicOperation($db); Http::json(201, ['ok' => true, 'data' => $block]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
            if ($method === 'GET' && $suffix === 'availability') {
                $date = $_GET['date'] ?? null; $serviceId = $_GET['serviceId'] ?? null; $appointmentId = $_GET['appointmentId'] ?? null;
                $tz = $user['clinic_timezone'] ?? 'UTC'; $day = clinicDayBounds(is_string($date) ? $date : '', $tz);
                if (!$day) Http::json(400, ['ok' => false, 'message' => 'Data inválida ou fuso horário da clínica inválido.']);
                if ($serviceId !== null && !isUuid((string)$serviceId)) Http::json(400, ['ok' => false, 'message' => 'Identificador de serviço inválido.']);
                if ($appointmentId !== null && (!isUuid((string)$appointmentId) || !$serviceId)) Http::json(400, ['ok' => false, 'message' => 'Identificador de reagendamento inválido.']);
                $db = Database::connection();
                $pro = $db->prepare('SELECT id,status,user_id FROM professionals WHERE id=:id AND clinic_id=:clinic');
                $pro->execute(['id' => $professionalId, 'clinic' => $clinic]); $professional = $pro->fetch();
                if (!$professional || $professional['status'] !== 'active') Http::json(404, ['ok' => false, 'message' => 'Profissional não encontrado nesta clínica.']);
                if ($user['role'] === 'professional' && $professional['user_id'] !== $user['id']) Http::json(403, ['ok' => false, 'message' => 'Você não pode visualizar a agenda de outro profissional.']);
                $duration = null; $snapshot = null;
                if ($serviceId) {
                    if ($appointmentId) {
                        $snapshotStmt = $db->prepare("SELECT a.service_duration_snapshot FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id WHERE a.id=:appointment AND a.clinic_id=:clinic AND a.service_id=:service AND (:role <> 'patient' OR p.user_id=:user)");
                        $snapshotStmt->execute(['appointment' => $appointmentId, 'clinic' => $clinic, 'service' => $serviceId, 'role' => $user['role'], 'user' => $user['id']]);
                        $snapshot = $snapshotStmt->fetchColumn();
                        if ($snapshot === false) $snapshot = null;
                    }
                    $serviceStmt = $db->prepare('SELECT s.duration_minutes FROM services s JOIN professional_services ps ON ps.service_id=s.id AND ps.clinic_id=s.clinic_id WHERE s.id=:service AND s.clinic_id=:clinic AND ps.professional_id=:professional AND (s.is_active=TRUE OR :allow_inactive=TRUE)');
                    $serviceStmt->execute(['service' => $serviceId, 'clinic' => $clinic, 'professional' => $professionalId, 'allow_inactive' => $snapshot !== null]);
                    $service = $serviceStmt->fetchColumn();
                    if ($service === false) Http::json(404, ['ok' => false, 'message' => 'Serviço não encontrado ou indisponível para este profissional.']);
                    $duration = (int)($snapshot ?? $service);
                }
                $schedules = $db->prepare('SELECT * FROM professional_schedules WHERE professional_id=:professional AND clinic_id=:clinic ORDER BY weekday,start_time');
                $schedules->execute(['professional' => $professionalId, 'clinic' => $clinic]);
                $blocks = $db->prepare("SELECT * FROM schedule_blocks WHERE professional_id=:professional AND clinic_id=:clinic AND status='active' AND start_datetime < :ends AND end_datetime > :starts");
                $blocks->execute(['professional' => $professionalId, 'clinic' => $clinic, 'starts' => $day['startUtc'], 'ends' => $day['endUtc']]);
                $appointments = $db->prepare("SELECT id,scheduled_start,scheduled_end,status FROM appointments WHERE professional_id=:professional AND clinic_id=:clinic AND status NOT IN ('cancelled','rescheduled') AND scheduled_start < :ends AND scheduled_end > :starts");
                $appointments->execute(['professional' => $professionalId, 'clinic' => $clinic, 'starts' => $day['startUtc'], 'ends' => $day['endUtc']]);
                $scheduleRows = $schedules->fetchAll();
                $blockRows = $blocks->fetchAll();
                $appointmentRows = $appointments->fetchAll();
                Http::json(200, ['ok' => true, 'data' => [
                    'date' => $date,
                    'schedule' => $scheduleRows,
                    'blocks' => $blockRows,
                    'availableSlots' => generateClinicSlots($date, $scheduleRows, $blockRows, $appointmentRows, $tz, $duration),
                    'timeZone' => $tz,
                ]]);
            }
        }
    }

    if (str_starts_with($path, '/api/appointments')) {
        $user = requireClinicAccess(); $clinic = $user['clinic_id'];
        if ($method === 'GET' && $path === '/api/appointments') {
            $sql = appointmentSelectSql() . ' WHERE a.clinic_id=:clinic'; $params = ['clinic' => $clinic];
            if ($user['role'] === 'patient') { $sql .= ' AND a.patient_id IN (SELECT id FROM patients WHERE user_id=:user AND clinic_id=:clinic)'; $params['user'] = $user['id']; }
            if ($user['role'] === 'professional') { $sql .= ' AND a.professional_id IN (SELECT id FROM professionals WHERE user_id=:user AND clinic_id=:clinic)'; $params['user'] = $user['id']; }
            $stmt = Database::connection()->prepare($sql . ' ORDER BY a.scheduled_start ASC'); $stmt->execute($params);
            Http::json(200, ['ok' => true, 'data' => $stmt->fetchAll()]);
        }
        if ($method === 'POST' && $path === '/api/appointments') {
            requireRole($user, ['admin', 'reception', 'patient']);
            validateCreateAppointment($body);
            if (!validIsoInterval($body['scheduledStart'], $body['scheduledEnd'])) Http::json(400, ['ok' => false, 'message' => 'Intervalo de agendamento inválido.']);
            $db = Database::connection();
            $patientStmt = $db->prepare('SELECT id,clinic_id,user_id,status FROM patients WHERE id=:id AND clinic_id=:clinic');
            $patientStmt->execute(['id' => $body['patientId'], 'clinic' => $clinic]); $patient = $patientStmt->fetch();
            if (!$patient || $patient['status'] !== 'active' || ($user['role'] === 'patient' && $patient['user_id'] !== $user['id'])) Http::json(404, ['ok' => false, 'message' => 'Paciente não encontrado nesta clínica.']);
            $proStmt = $db->prepare('SELECT id,clinic_id,specialty_id,status FROM professionals WHERE id=:id AND clinic_id=:clinic');
            $proStmt->execute(['id' => $body['professionalId'], 'clinic' => $clinic]); $professional = $proStmt->fetch();
            if (!$professional || $professional['status'] !== 'active') Http::json(404, ['ok' => false, 'message' => 'Profissional não encontrado nesta clínica.']);
            $specialty = $body['specialtyId'] ?? $professional['specialty_id'];
            if (!empty($body['specialtyId']) && $body['specialtyId'] !== $professional['specialty_id']) Http::json(400, ['ok' => false, 'message' => 'Especialidade incompatível com o profissional.']);
            if ($specialty !== null) {
                $spec = $db->prepare("SELECT id FROM specialties WHERE id=:id AND clinic_id=:clinic AND status='active'"); $spec->execute(['id' => $specialty, 'clinic' => $clinic]);
                if (!$spec->fetchColumn() || $professional['specialty_id'] !== $specialty) Http::json(400, ['ok' => false, 'message' => 'Especialidade inválida ou incompatível com o profissional.']);
            }
            $code = 'CONS-' . (int)floor(microtime(true) * 1000); beginClinicOperation($db);
            try {
                lockProfessional($db, $body['professionalId']);
                $service = loadBookableService($db, $clinic, $body['professionalId'], $body['serviceId'], false);
                if (!$service) throw new Noa\ApiException(404, 'Serviço não encontrado ou indisponível para este profissional nesta clínica.');
                if (!hasExpectedDuration($body['scheduledStart'], $body['scheduledEnd'], (int)$service['duration_minutes'])) throw new Noa\ApiException(400, 'A duração do horário não corresponde à duração cadastrada do serviço.');
                assertAppointmentAvailable($db, $clinic, $body['professionalId'], $body['scheduledStart'], $body['scheduledEnd'], $user['clinic_timezone'] ?? 'UTC', (int)$service['duration_minutes']);
                $stmt = $db->prepare("INSERT INTO appointments (clinic_id,patient_id,professional_id,specialty_id,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,scheduled_start,scheduled_end,status,code,notes) VALUES (:clinic,:patient,:professional,:specialty,:service,:service_name,:service_price,:service_duration,:starts,:ends,'scheduled',:code,:notes) RETURNING *");
                $stmt->execute(['clinic' => $clinic, 'patient' => $body['patientId'], 'professional' => $body['professionalId'], 'specialty' => $specialty, 'service' => $service['id'], 'service_name' => $service['name'], 'service_price' => $service['price'], 'service_duration' => $service['duration_minutes'], 'starts' => $body['scheduledStart'], 'ends' => $body['scheduledEnd'], 'code' => $code, 'notes' => $body['notes'] ?? null]);
                $row = $stmt->fetch(); writeAudit($db, $clinic, $user['id'], 'appointments', $row['id'], 'created', ['code' => $code, 'patientId' => $body['patientId'], 'professionalId' => $body['professionalId'], 'serviceId' => $service['id'], 'scheduledStart' => $body['scheduledStart'], 'scheduledEnd' => $body['scheduledEnd']]);
                commitClinicOperation($db); Http::json(201, ['ok' => true, 'data' => $row]);
            } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
        }
        if (preg_match('#^/api/appointments/([^/]+)(?:/(status|cancel|reschedule))?$#', $path, $match)) {
            $id = $match[1]; $action = $match[2] ?? '';
            if (!isUuid($id)) Http::json(400, ['ok' => false, 'message' => 'Identificador de agendamento inválido.']);
            if ($method === 'GET' && $action === '') {
                $sql = appointmentSelectSql() . ' WHERE a.id=:id AND a.clinic_id=:clinic'; $params = ['id' => $id, 'clinic' => $clinic];
                if ($user['role'] === 'patient') { $sql .= ' AND EXISTS (SELECT 1 FROM patients owner WHERE owner.id=a.patient_id AND owner.clinic_id=a.clinic_id AND owner.user_id=:user)'; $params['user'] = $user['id']; }
                if ($user['role'] === 'professional') { $sql .= ' AND EXISTS (SELECT 1 FROM professionals owner WHERE owner.id=a.professional_id AND owner.clinic_id=a.clinic_id AND owner.user_id=:user)'; $params['user'] = $user['id']; }
                $stmt = Database::connection()->prepare($sql); $stmt->execute($params); $row = $stmt->fetch();
                if (!$row) Http::json(404, ['ok' => false, 'message' => 'Agendamento não encontrado.']);
                Http::json(200, ['ok' => true, 'data' => $row]);
            }
            if ($method === 'PATCH' && $action === '') {
                if ($method === 'PATCH') {
                    requireRole($user, ['admin', 'reception']);
                    if (array_diff(array_keys($body), ['notes']) || !array_key_exists('notes', $body) || (!is_string($body['notes']) && $body['notes'] !== null)) Http::json(400, ['ok' => false, 'message' => 'Somente o campo notes pode ser atualizado.']);
                    $db = Database::connection(); beginClinicOperation($db);
                    try {
                        $stmt = $db->prepare('UPDATE appointments SET notes=:notes,updated_at=NOW() WHERE id=:id AND clinic_id=:clinic RETURNING *');
                        $stmt->execute(['notes' => $body['notes'], 'id' => $id, 'clinic' => $clinic]); $row = $stmt->fetch();
                        if (!$row) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Agendamento não encontrado.']); }
                        writeAudit($db, $clinic, $user['id'], 'appointments', $row['id'], 'updated', ['fields' => ['notes']]);
                        commitClinicOperation($db); Http::json(200, ['ok' => true, 'data' => $row]);
                    } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
                }
                requireRole($user, ['admin', 'reception', 'patient']);
                validateCreateAppointment($body);
                if (!validIsoInterval($body['scheduledStart'], $body['scheduledEnd'])) Http::json(400, ['ok' => false, 'message' => 'Intervalo de agendamento inválido.']);
                $db = Database::connection();
                $patientStmt = $db->prepare('SELECT id,clinic_id,user_id,status FROM patients WHERE id=:id AND clinic_id=:clinic');
                $patientStmt->execute(['id' => $body['patientId'], 'clinic' => $clinic]); $patient = $patientStmt->fetch();
                if (!$patient || $patient['status'] !== 'active' || ($user['role'] === 'patient' && $patient['user_id'] !== $user['id'])) Http::json(404, ['ok' => false, 'message' => 'Paciente não encontrado nesta clínica.']);
                $proStmt = $db->prepare('SELECT id,clinic_id,specialty_id,status FROM professionals WHERE id=:id AND clinic_id=:clinic');
                $proStmt->execute(['id' => $body['professionalId'], 'clinic' => $clinic]); $professional = $proStmt->fetch();
                if (!$professional || $professional['status'] !== 'active') Http::json(404, ['ok' => false, 'message' => 'Profissional não encontrado nesta clínica.']);
                $specialty = $body['specialtyId'] ?? $professional['specialty_id'];
                if (!empty($body['specialtyId']) && $body['specialtyId'] !== $professional['specialty_id']) Http::json(400, ['ok' => false, 'message' => 'Especialidade incompatível com o profissional.']);
                if ($specialty !== null) {
                    $spec = $db->prepare("SELECT id FROM specialties WHERE id=:id AND clinic_id=:clinic AND status='active'"); $spec->execute(['id' => $specialty, 'clinic' => $clinic]);
                    if (!$spec->fetchColumn() || $professional['specialty_id'] !== $specialty) Http::json(400, ['ok' => false, 'message' => 'Especialidade inválida ou incompatível com o profissional.']);
                }
                $code = 'CONS-' . (int)floor(microtime(true) * 1000); beginClinicOperation($db);
                try {
                    lockProfessional($db, $body['professionalId']);
                    $service = loadBookableService($db, $clinic, $body['professionalId'], $body['serviceId'], false);
                    if (!$service) throw new Noa\ApiException(404, 'Serviço não encontrado ou indisponível para este profissional nesta clínica.');
                    if (!hasExpectedDuration($body['scheduledStart'], $body['scheduledEnd'], (int)$service['duration_minutes'])) throw new Noa\ApiException(400, 'A duração do horário não corresponde à duração cadastrada do serviço.');
                    assertAppointmentAvailable($db, $clinic, $body['professionalId'], $body['scheduledStart'], $body['scheduledEnd'], $user['clinic_timezone'] ?? 'UTC', (int)$service['duration_minutes']);
                    $stmt = $db->prepare("INSERT INTO appointments (clinic_id,patient_id,professional_id,specialty_id,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,scheduled_start,scheduled_end,status,code,notes) VALUES (:clinic,:patient,:professional,:specialty,:service,:service_name,:service_price,:service_duration,:starts,:ends,'scheduled',:code,:notes) RETURNING *");
                    $stmt->execute(['clinic' => $clinic, 'patient' => $body['patientId'], 'professional' => $body['professionalId'], 'specialty' => $specialty, 'service' => $service['id'], 'service_name' => $service['name'], 'service_price' => $service['price'], 'service_duration' => $service['duration_minutes'], 'starts' => $body['scheduledStart'], 'ends' => $body['scheduledEnd'], 'code' => $code, 'notes' => $body['notes'] ?? null]);
                    $row = $stmt->fetch(); writeAudit($db, $clinic, $user['id'], 'appointments', $row['id'], 'created', ['code' => $code, 'patientId' => $body['patientId'], 'professionalId' => $body['professionalId'], 'serviceId' => $service['id'], 'scheduledStart' => $body['scheduledStart'], 'scheduledEnd' => $body['scheduledEnd']]);
                    commitClinicOperation($db); Http::json(201, ['ok' => true, 'data' => $row]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
            if ($method === 'PATCH' && $action === 'status') {
                requireRole($user, ['admin', 'reception']);
                if (array_diff(array_keys($body), ['status']) || !Noa\AppointmentState::isKnownStatus($body['status'] ?? null)) Http::json(400, ['ok' => false, 'message' => 'Status inválido.']);
                $db = Database::connection(); beginClinicOperation($db);
                try {
                    $currentStmt = $db->prepare('SELECT status FROM appointments WHERE id=:id AND clinic_id=:clinic FOR UPDATE');
                    $currentStmt->execute(['id' => $id, 'clinic' => $clinic]); $current = $currentStmt->fetch();
                    if (!$current) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Agendamento não encontrado.']); }
                    if (!Noa\AppointmentState::allowsStatusTransition($current['status'], $body['status'])) throw new Noa\ApiException(409, 'Transição de status não permitida.');
                    $stmt = $db->prepare('UPDATE appointments SET status=:status,updated_at=NOW() WHERE id=:id AND clinic_id=:clinic AND status=:current_status RETURNING *');
                    $stmt->execute(['status' => $body['status'], 'id' => $id, 'clinic' => $clinic, 'current_status' => $current['status']]); $row = $stmt->fetch();
                    if (!$row) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Agendamento não encontrado.']); }
                    writeAudit($db, $clinic, $user['id'], 'appointments', $row['id'], 'status_updated', ['status' => $body['status']]); commitClinicOperation($db); Http::json(200, ['ok' => true, 'data' => $row]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
            if ($method === 'PATCH' && $action === 'cancel') {
                requireRole($user, ['admin', 'reception', 'patient']);
                if (array_diff(array_keys($body), ['reason']) || (array_key_exists('reason', $body) && $body['reason'] !== null && !is_string($body['reason']))) Http::json(400, ['ok' => false, 'message' => 'Dados de cancelamento inválidos ou campos não permitidos.']);
                $db = Database::connection(); beginClinicOperation($db);
                try {
                    $currentStmt = $db->prepare('SELECT a.status,p.user_id AS patient_user_id FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id WHERE a.id=:id AND a.clinic_id=:clinic FOR UPDATE OF a');
                    $currentStmt->execute(['id' => $id, 'clinic' => $clinic]); $current = $currentStmt->fetch();
                    if (!$current || ($user['role'] === 'patient' && $current['patient_user_id'] !== $user['id'])) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Agendamento não encontrado.']); }
                    if (!Noa\AppointmentState::allowsStatusTransition($current['status'], 'cancelled')) throw new Noa\ApiException(409, 'Transição de status não permitida.');
                    $sql = "UPDATE appointments SET status='cancelled',updated_at=NOW() WHERE id=:id AND clinic_id=:clinic AND status=:current_status RETURNING *";
                    $stmt = $db->prepare($sql); $stmt->execute(['id' => $id, 'clinic' => $clinic, 'current_status' => $current['status']]); $row = $stmt->fetch();
                    if (!$row) { rollBackClinicOperation($db); Http::json(404, ['ok' => false, 'message' => 'Agendamento não encontrado.']); }
                    writeAudit($db, $clinic, $user['id'], 'appointments', $row['id'], 'cancelled', ['reason' => ($body['reason'] ?? '') ?: 'cancelled_by_user']); commitClinicOperation($db); Http::json(200, ['ok' => true, 'data' => $row]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
            if ($method === 'PATCH' && $action === 'reschedule') {
                requireRole($user, ['admin', 'reception', 'patient']); validateRescheduleAppointment($body);
                if (!validIsoInterval($body['scheduledStart'], $body['scheduledEnd'])) Http::json(400, ['ok' => false, 'message' => 'Intervalo de agendamento inválido.']);
                $db = Database::connection(); beginClinicOperation($db);
                try {
                    $stmt = $db->prepare('SELECT a.id,a.patient_id,p.user_id AS patient_user_id,a.status,a.notes,a.service_id,a.service_name_snapshot,a.service_price_snapshot,a.service_duration_snapshot FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id WHERE a.id=:id AND a.clinic_id=:clinic FOR UPDATE OF a');
                    $stmt->execute(['id' => $id, 'clinic' => $clinic]); $appointment = $stmt->fetch();
                    if (!$appointment || ($user['role'] === 'patient' && $appointment['patient_user_id'] !== $user['id'])) throw new Noa\ApiException(404, 'Agendamento não encontrado.');
                    if (!Noa\AppointmentState::canReschedule($appointment['status'])) throw new Noa\ApiException(409, 'Somente agendamentos agendados ou confirmados podem ser reagendados.');
                    $serviceId = $body['serviceId'] ?? null;
                    if (($appointment['service_id'] && $appointment['service_id'] !== $serviceId) || (!$appointment['service_id'] && $serviceId)) throw new Noa\ApiException(400, 'O serviço deste agendamento não pode ser alterado durante o reagendamento.');
                    if ($appointment['service_id'] && !$serviceId) throw new Noa\ApiException(400, 'Informe o serviço deste agendamento para reagendá-lo.');
                    lockProfessional($db, $body['professionalId']);
                    $pro = $db->prepare('SELECT id,clinic_id,specialty_id,status FROM professionals WHERE id=:id AND clinic_id=:clinic'); $pro->execute(['id' => $body['professionalId'], 'clinic' => $clinic]); $professional = $pro->fetch();
                    if (!$professional || $professional['status'] !== 'active') throw new Noa\ApiException(404, 'Profissional não encontrado nesta clínica.');
                    $specialty = $body['specialtyId'] ?? $professional['specialty_id'];
                    if (!empty($body['specialtyId']) && $body['specialtyId'] !== $professional['specialty_id']) throw new Noa\ApiException(400, 'Especialidade incompatível com o profissional.');
                    if ($specialty !== null) { $spec = $db->prepare("SELECT 1 FROM specialties WHERE id=:id AND clinic_id=:clinic AND status='active'"); $spec->execute(['id' => $specialty, 'clinic' => $clinic]); if (!$spec->fetchColumn() || $specialty !== $professional['specialty_id']) throw new Noa\ApiException(400, 'Especialidade inválida ou incompatível com o profissional.'); }
                    $service = null;
                    if ($serviceId) {
                        $service = loadBookableService($db, $clinic, $body['professionalId'], $serviceId, true);
                        if (!$service) throw new Noa\ApiException(404, 'Serviço não encontrado ou não associado a este profissional nesta clínica.');
                        $service['name'] = $appointment['service_name_snapshot']; $service['price'] = $appointment['service_price_snapshot']; $service['duration_minutes'] = $appointment['service_duration_snapshot'];
                        if (!hasExpectedDuration($body['scheduledStart'], $body['scheduledEnd'], (int)$service['duration_minutes'])) throw new Noa\ApiException(400, 'A duração do horário não corresponde ao histórico deste serviço.');
                    }
                    assertAppointmentAvailable($db, $clinic, $body['professionalId'], $body['scheduledStart'], $body['scheduledEnd'], $user['clinic_timezone'] ?? 'UTC', $service ? (int)$service['duration_minutes'] : null, $id);
                    $update = $db->prepare("UPDATE appointments SET status='rescheduled',updated_at=NOW() WHERE id=:id AND clinic_id=:clinic AND status=:current_status RETURNING id");
                    $update->execute(['id' => $id, 'clinic' => $clinic, 'current_status' => $appointment['status']]);
                    if (!$update->fetch()) throw new Noa\ApiException(409, 'O agendamento já foi alterado.');
                    $code = 'CONS-' . strtoupper(substr(bin2hex(random_bytes(12)), 0, 20));
                    $insert = $db->prepare("INSERT INTO appointments (clinic_id,patient_id,professional_id,specialty_id,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,scheduled_start,scheduled_end,status,code,notes,rescheduled_from_appointment_id) VALUES (:clinic,:patient,:professional,:specialty,:service,:service_name,:service_price,:service_duration,:starts,:ends,'scheduled',:code,:notes,:original) RETURNING *");
                    $insert->execute([
                        'clinic' => $clinic,
                        'patient' => $appointment['patient_id'],
                        'professional' => $body['professionalId'],
                        'specialty' => $specialty,
                        'service' => $appointment['service_id'],
                        'service_name' => $appointment['service_name_snapshot'],
                        'service_price' => $appointment['service_price_snapshot'],
                        'service_duration' => $appointment['service_duration_snapshot'],
                        'starts' => $body['scheduledStart'],
                        'ends' => $body['scheduledEnd'],
                        'code' => $code,
                        'notes' => $appointment['notes'],
                        'original' => $appointment['id'],
                    ]);
                    $row = $insert->fetch();
                    writeAudit($db, $clinic, $user['id'], 'appointments', $appointment['id'], 'rescheduled', ['newAppointmentId' => $row['id'], 'professionalId' => $body['professionalId'], 'specialtyId' => $row['specialty_id'], 'scheduledStart' => $body['scheduledStart'], 'scheduledEnd' => $body['scheduledEnd']]);
                    commitClinicOperation($db); Http::json(200, ['ok' => true, 'data' => $row]);
                } catch (Throwable $e) { if ($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
            }
        }
    }

    if ($method === 'GET' && $path === '/api/reports/summary') {
        $user = requireClinicAccess(['admin', 'reception']); requirePlanCapability($user, 'reports');
        $today = gmdate('Y-m-d'); $defaultFrom = gmdate('Y-m-d', time() - 29 * 86400);
        $from = $_GET['from'] ?? $defaultFrom; $to = $_GET['to'] ?? $today;
        $validDate = static fn($d): bool => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) === 1 && checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4));
        if (!$validDate($from) || !$validDate($to) || $from > $to || (strtotime($to) - strtotime($from)) > 365 * 86400) Http::json(400, ['ok' => false, 'message' => 'Informe um período válido de até 366 dias.']);
        $db = Database::connection(); $params = ['clinic' => $user['clinic_id'], 'from_date' => $from, 'to_date' => $to];
        $summaryStmt = $db->prepare("SELECT COUNT(*)::int AS appointments,COUNT(*) FILTER (WHERE status='completed')::int AS completed,COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,COUNT(*) FILTER (WHERE status='no_show')::int AS no_shows,COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed'))::int AS upcoming,COALESCE(SUM(service_price_snapshot) FILTER (WHERE status='completed'),0)::numeric(12,2) AS completed_service_value FROM appointments WHERE clinic_id=:clinic AND scheduled_start >= CAST(:from_date AS date) AND scheduled_start < CAST(:to_date AS date)+INTERVAL '1 day'");
        $summaryStmt->execute($params); $summary = $summaryStmt->fetch();
        $dailyStmt = $db->prepare("SELECT (a.scheduled_start AT TIME ZONE :timezone)::date::text AS date,COUNT(*)::int AS appointments,COUNT(*) FILTER (WHERE a.status='completed')::int AS completed,COUNT(*) FILTER (WHERE a.status='cancelled')::int AS cancelled,COUNT(*) FILTER (WHERE a.status='no_show')::int AS no_shows FROM appointments a WHERE a.clinic_id=:clinic AND a.scheduled_start >= CAST(:from_date AS date) AND a.scheduled_start < CAST(:to_date AS date)+INTERVAL '1 day' GROUP BY 1 ORDER BY 1");
        $dailyStmt->execute($params + ['timezone' => $user['clinic_timezone'] ?? 'UTC']);
        $servicesStmt = $db->prepare("SELECT COALESCE(a.service_name_snapshot,'Sem serviço') AS name,COUNT(*)::int AS appointments,COUNT(*) FILTER (WHERE a.status='completed')::int AS completed,COUNT(*) FILTER (WHERE a.status='cancelled')::int AS cancelled,COUNT(*) FILTER (WHERE a.status='no_show')::int AS no_shows,COALESCE(SUM(a.service_price_snapshot) FILTER (WHERE a.status='completed'),0)::numeric(12,2) AS completed_service_value FROM appointments a WHERE a.clinic_id=:clinic AND a.scheduled_start >= CAST(:from_date AS date) AND a.scheduled_start < CAST(:to_date AS date)+INTERVAL '1 day' GROUP BY 1 ORDER BY appointments DESC,name LIMIT 20");
        $servicesStmt->execute($params);
        $professionalsStmt = $db->prepare("SELECT p.name,COUNT(*)::int AS appointments,COUNT(*) FILTER (WHERE a.status='completed')::int AS completed,COUNT(*) FILTER (WHERE a.status='cancelled')::int AS cancelled,COUNT(*) FILTER (WHERE a.status='no_show')::int AS no_shows FROM appointments a JOIN professionals p ON p.id=a.professional_id AND p.clinic_id=a.clinic_id WHERE a.clinic_id=:clinic AND a.scheduled_start >= CAST(:from_date AS date) AND a.scheduled_start < CAST(:to_date AS date)+INTERVAL '1 day' GROUP BY p.id,p.name ORDER BY appointments DESC,p.name LIMIT 20");
        $professionalsStmt->execute($params);
        $paymentsStmt = $db->prepare("SELECT COALESCE(SUM(amount),0)::numeric(12,2) AS received FROM payments WHERE clinic_id=:clinic AND status='paid' AND currency='BRL' AND paid_at >= CAST(:from_date AS date) AND paid_at < CAST(:to_date AS date)+INTERVAL '1 day'");
        $paymentsStmt->execute($params); $summary['received'] = $paymentsStmt->fetchColumn();
        Http::json(200, ['ok' => true, 'data' => ['from' => $from, 'to' => $to, 'summary' => $summary, 'daily' => $dailyStmt->fetchAll(), 'services' => $servicesStmt->fetchAll(), 'professionals' => $professionalsStmt->fetchAll()]]);
    }

    if ($path === '/api/settings/privacy-profile') {
        $user = requireClinicAccess(['admin']);
        $profileFields = ['legalName', 'cnpj', 'privacyEmail', 'privacyPolicyUrl'];
        if ($method === 'GET') {
            $stmt = Database::connection()->prepare("SELECT value FROM settings WHERE clinic_id=:clinic AND key='privacy_profile'");
            $stmt->execute(['clinic' => $user['clinic_id']]);
            $stored = $stmt->fetchColumn();
            $decoded = is_string($stored) ? json_decode($stored, true) : null;
            $profile = [];
            foreach ($profileFields as $field) {
                $profile[$field] = is_array($decoded) && is_string($decoded[$field] ?? null)
                    ? $decoded[$field]
                    : '';
            }
            Http::json(200, ['ok' => true, 'data' => $profile]);
        }
        if ($method === 'POST') {
            if (array_diff(array_keys($body), $profileFields) ||
                array_diff($profileFields, array_keys($body))) {
                Http::json(400, ['ok' => false, 'message' => 'Dados de privacidade inválidos.']);
            }
            $profile = [];
            foreach ($profileFields as $field) {
                $value = $body[$field];
                $limit = match ($field) {
                    'legalName' => 200,
                    'cnpj' => 18,
                    'privacyEmail' => 255,
                    'privacyPolicyUrl' => 2048,
                };
                if (!is_string($value) || textLength($value) > $limit || str_contains($value, "\0")) {
                    Http::json(400, ['ok' => false, 'message' => 'Dados de privacidade inválidos.']);
                }
                $profile[$field] = trim($value);
            }
            if ($profile['privacyEmail'] !== '' &&
                !filter_var($profile['privacyEmail'], FILTER_VALIDATE_EMAIL)) {
                Http::json(400, ['ok' => false, 'message' => 'Informe um e-mail de privacidade válido.']);
            }
            if ($profile['privacyPolicyUrl'] !== '' &&
                !isValidPrivacyPolicyUrl($profile['privacyPolicyUrl'])) {
                Http::json(400, ['ok' => false, 'message' => 'O aviso de privacidade deve usar uma URL HTTPS válida.']);
            }
            $stmt = Database::connection()->prepare(
                "INSERT INTO settings (clinic_id, key, value)
                 VALUES (:clinic, 'privacy_profile', CAST(:value AS jsonb))
                 ON CONFLICT (clinic_id, key)
                 DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
            );
            $stmt->execute([
                'clinic' => $user['clinic_id'],
                'value' => json_encode($profile, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
            Http::json(200, ['ok' => true, 'data' => $profile]);
        }
    }

    if (in_array($path, ['/api/settings', '/api/settings/'], true)) {
        $user = requireClinicAccess(['admin', 'reception']);
        if ($method === 'GET') {
            $stmt = Database::connection()->prepare('SELECT * FROM clinic_configurations WHERE clinic_id=:clinic');
            $stmt->execute(['clinic' => $user['clinic_id']]); Http::json(200, ['ok' => true, 'data' => $stmt->fetch() ?: null]);
        }
        if ($method === 'POST') {
            requireRole($user, ['admin']);
            $allowed = ['name','logoUrl','phone','whatsapp','addressLine1','addressLine2','email','openingHours','serviceInfo','timezone','publicSlug','appointmentRemindersEnabled'];
            $limits = ['name'=>200,'phone'=>20,'whatsapp'=>20,'addressLine1'=>255,'addressLine2'=>255,'email'=>255,'timezone'=>64];
            if (array_diff(array_keys($body), $allowed)) Http::json(400, ['ok' => false, 'message' => 'Dados de configuração inválidos.']);
            foreach ($limits as $field => $max) if (isset($body[$field]) && (!is_string($body[$field]) || textLength($body[$field]) > $max || str_contains($body[$field], "\0"))) Http::json(400, ['ok' => false, 'message' => 'Dados de configuração inválidos.']);
            foreach (['logoUrl','serviceInfo'] as $field) if (isset($body[$field]) && (!is_string($body[$field]) || str_contains($body[$field], "\0"))) Http::json(400, ['ok' => false, 'message' => 'Dados de configuração inválidos.']);
            if (isset($body['email']) && $body['email'] !== '' && !filter_var(trim($body['email']), FILTER_VALIDATE_EMAIL)) Http::json(400, ['ok' => false, 'message' => 'Dados de configuração inválidos.']);
            if (isset($body['openingHours']) && $body['openingHours'] !== null && !is_array($body['openingHours'])) Http::json(400, ['ok' => false, 'message' => 'Dados de configuração inválidos.']);
            if (isset($body['appointmentRemindersEnabled']) && !is_bool($body['appointmentRemindersEnabled'])) Http::json(400, ['ok' => false, 'message' => 'Dados de configuração inválidos.']);
            if (isset($body['timezone'])) {
                try { if (!is_string($body['timezone']) || textLength($body['timezone']) > 64) throw new RuntimeException(); new DateTimeZone($body['timezone']); }
                catch (Throwable) { Http::json(400, ['ok' => false, 'message' => 'Informe um fuso horário IANA válido, por exemplo America/Sao_Paulo.']); }
            }
            $slug = $body['publicSlug'] ?? null;
            if ($slug !== null && $slug !== '' && (!is_string($slug) || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', trim($slug)))) Http::json(400, ['ok' => false, 'message' => 'Identificador público inválido. Use letras minúsculas, números e hífens.']);
            $reminders = $body['appointmentRemindersEnabled'] ?? null;
            $params = ['clinic'=>$user['clinic_id'],'name'=>$body['name'] ?? null,'logo'=>$body['logoUrl'] ?? null,'phone'=>$body['phone'] ?? null,'whatsapp'=>$body['whatsapp'] ?? null,'line1'=>$body['addressLine1'] ?? null,'line2'=>$body['addressLine2'] ?? null,'email'=>$body['email'] ?? null,'hours'=>isset($body['openingHours']) ? json_encode($body['openingHours'], JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR) : null,'info'=>$body['serviceInfo'] ?? null,'timezone'=>$body['timezone'] ?? null,'set_slug'=>array_key_exists('publicSlug',$body) ? 'true' : 'false','slug'=>is_string($slug) ? (trim($slug) ?: null) : null,'reminders'=>is_bool($reminders) ? ($reminders ? 'true' : 'false') : null];
            $db = Database::connection(); $exists = $db->prepare('SELECT 1 FROM clinic_configurations WHERE clinic_id=:clinic'); $exists->execute(['clinic'=>$user['clinic_id']]);
            if ($exists->fetchColumn()) {
                $sql = 'UPDATE clinic_configurations SET name=COALESCE(:name,name),logo_url=COALESCE(:logo,logo_url),phone=COALESCE(:phone,phone),whatsapp=COALESCE(:whatsapp,whatsapp),address_line1=COALESCE(:line1,address_line1),address_line2=COALESCE(:line2,address_line2),email=COALESCE(:email,email),opening_hours=COALESCE(CAST(:hours AS jsonb),opening_hours),service_info=COALESCE(:info,service_info),timezone=COALESCE(:timezone,timezone),public_slug=CASE WHEN :set_slug THEN :slug ELSE public_slug END,appointment_reminders_enabled=COALESCE(:reminders,appointment_reminders_enabled),updated_at=NOW() WHERE clinic_id=:clinic RETURNING *';
                $stmt = $db->prepare($sql); $stmt->execute($params); Http::json(200, ['ok'=>true,'data'=>$stmt->fetch()]);
            }
            $sql = 'INSERT INTO clinic_configurations (clinic_id,name,logo_url,phone,whatsapp,address_line1,address_line2,email,opening_hours,service_info,timezone,public_slug,appointment_reminders_enabled) VALUES (:clinic,:name,:logo,:phone,:whatsapp,:line1,:line2,:email,CAST(:hours AS jsonb),:info,COALESCE(:timezone,\'UTC\'),:slug,COALESCE(:reminders,FALSE)) RETURNING *';
            $stmt = $db->prepare($sql); $stmt->execute($params); Http::json(201, ['ok'=>true,'data'=>$stmt->fetch()]);
        }
    }

    if ($method === 'GET' && $path === '/api/audit') {
        $user = requireClinicAccess(['admin', 'reception']); requirePlanCapability($user, 'audit');
        $stmt = Database::connection()->prepare('SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id AND u.clinic_id=a.clinic_id WHERE a.clinic_id=:clinic ORDER BY a.created_at DESC LIMIT 200');
        $stmt->execute(['clinic' => $user['clinic_id']]); Http::json(200, ['ok' => true, 'data' => $stmt->fetchAll()]);
    }

    if ($method === 'GET' && $path === '/api/subscriptions/current') {
        $user = requireClinicAccess(['admin']);
        $stmt = Database::connection()->prepare('SELECT plan,billing_cycle,status,started_at,current_period_start,current_period_end,trial_ends_at,cancelled_at FROM subscriptions WHERE clinic_id=:clinic ORDER BY created_at DESC LIMIT 1');
        $stmt->execute(['clinic' => $user['clinic_id']]); $subscription = $stmt->fetch();
        if (!$subscription) Http::json(200, ['ok' => true, 'data' => null]);
        $plan = Noa\PlanCatalog::plan($subscription['plan']);
        $cycle = $subscription['billing_cycle'];
        $capabilities = $plan['capabilities'] ?? [];
        $roadmap = $plan['roadmapCapabilities'] ?? [];
        Http::json(200, ['ok' => true, 'data' => [
            'planName' => $plan['name'] ?? $subscription['plan'], 'plan' => $subscription['plan'], 'billingCycle' => $cycle,
            'priceInCents' => Noa\PlanCatalog::priceInCents($subscription['plan'], $cycle),
            'billingCycleLabel' => Noa\PlanCatalog::billingCycles()[$cycle]['label'] ?? $cycle,
            'status' => $subscription['status'], 'limits' => $plan['limits'] ?? null,
            'capabilities' => $capabilities, 'roadmapCapabilities' => $roadmap,
            'startedAt' => $subscription['started_at'], 'currentPeriodStart' => $subscription['current_period_start'], 'currentPeriodEnd' => $subscription['current_period_end'], 'trialEndsAt' => $subscription['trial_ends_at'], 'cancelledAt' => $subscription['cancelled_at'],
        ]]);
    }

    if ($method === 'POST' && preg_match('#^/api/public/clinics/([^/]+)/appointments$#', $path, $bookingMatch)) {
        $slug = rawurldecode($bookingMatch[1]);
        $allowed = ['idempotencyKey','serviceId','professionalId','scheduledStart','name','phone','email','reminderConsent'];
        $phone = is_string($body['phone'] ?? null) ? preg_replace('/\D+/', '', $body['phone']) : '';
        $email = is_string($body['email'] ?? null) ? strtolower(trim($body['email'])) : '';
        $timestampPattern = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i';
        $name = is_string($body['name'] ?? null) ? trim($body['name']) : '';
        $phoneRaw = $body['phone'] ?? null;
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug) || strlen($slug) < 3 || strlen($slug) > 63 || array_diff(array_keys($body), $allowed) || !isUuidValue($body['idempotencyKey'] ?? null) || !isUuidValue($body['serviceId'] ?? null) || !isUuidValue($body['professionalId'] ?? null) || !is_string($body['scheduledStart'] ?? null) || !preg_match($timestampPattern, $body['scheduledStart']) || !validIsoTimestamp($body['scheduledStart']) || jsStringLength($name) < 2 || jsStringLength($name) > 200 || preg_match('/[\x00-\x1F\x7F]/', $name) || !is_string($phoneRaw) || strlen($phoneRaw) > 20 || !preg_match('/^[+()\d.\s-]+$/', $phoneRaw) || strlen($phone) < 8 || strlen($phone) > 15 || (isset($body['email']) && $body['email'] !== null && $body['email'] !== '' && (!is_string($body['email']) || jsStringLength($body['email']) > 254 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', trim($body['email'])))) || (isset($body['reminderConsent']) && !is_bool($body['reminderConsent']))) Http::json(400, ['ok'=>false,'message'=>'Dados de agendamento inválidos.']);

        $db = Database::connection(); beginClinicOperation($db);
        try {
            $lock = $db->prepare('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))');
            $lock->execute(['key'=>'public-booking:' . $slug . ':' . $body['idempotencyKey']]);
            $clinicStmt = $db->prepare("SELECT c.id,cc.timezone,COALESCE(NULLIF(trim(cc.name),''),NULLIF(trim(c.trade_name),''),c.name) AS name FROM clinics c JOIN clinic_configurations cc ON cc.clinic_id=c.id JOIN LATERAL (SELECT plan,status,current_period_start,current_period_end,trial_ends_at FROM subscriptions WHERE clinic_id=c.id ORDER BY created_at DESC LIMIT 1) sub ON sub.status IN ('active','trialing') AND sub.current_period_start<=NOW() AND sub.current_period_end>NOW() AND (sub.status<>'trialing' OR sub.trial_ends_at>NOW()) WHERE c.status='active' AND cc.public_slug=:slug FOR SHARE OF c,cc");
            $clinicStmt->execute(['slug'=>$slug]); $clinic=$clinicStmt->fetch();
            if (!$clinic) throw new Noa\ApiException(404,'Página de agendamento não encontrada.');

            $priorStmt=$db->prepare('SELECT a.code,a.patient_id,a.professional_id,a.service_id,a.scheduled_start,p.name AS patient_name,p.phone AS patient_phone,p.email AS patient_email FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id WHERE a.clinic_id=:clinic AND a.public_idempotency_key=:key');
            $priorStmt->execute(['clinic'=>$clinic['id'],'key'=>$body['idempotencyKey']]); $prior=$priorStmt->fetch();
            if ($prior) {
                $same = $prior['service_id']===$body['serviceId'] && $prior['professional_id']===$body['professionalId'] && isoMilliseconds($prior['scheduled_start'])===isoMilliseconds($body['scheduledStart']) && strtolower(trim($prior['patient_name']))===strtolower($name) && preg_replace('/\D+/', '', (string)$prior['patient_phone'])===$phone && strtolower(trim((string)$prior['patient_email']))===$email;
                if (!$same) throw new Noa\ApiException(409,'Chave de solicitação já utilizada.');
                $confirmation=loadPhpPublicConfirmation($db,$clinic['id'],$prior['code']);
                commitClinicOperation($db); Http::json(200,['ok'=>true,'data'=>$confirmation]);
            }

            $planLock=$db->prepare('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))'); $planLock->execute(['key'=>'plan-limits:' . $clinic['id']]);
            $planStmt=$db->prepare("SELECT plan,status,current_period_start,current_period_end,trial_ends_at FROM subscriptions WHERE clinic_id=:clinic ORDER BY created_at DESC LIMIT 1 FOR SHARE"); $planStmt->execute(['clinic'=>$clinic['id']]); $plan=$planStmt->fetch();
            $now=time(); if (!$plan || !in_array($plan['status'],['active','trialing'],true) || strtotime($plan['current_period_start'])>$now || strtotime($plan['current_period_end'])<=$now || ($plan['status']==='trialing' && (!$plan['trial_ends_at'] || strtotime($plan['trial_ends_at'])<=$now))) throw new Noa\ApiException(403,'A assinatura desta clínica não está ativa para uso dos recursos.');

            lockProfessional($db,$body['professionalId']);
            $service=loadBookableService($db,$clinic['id'],$body['professionalId'],$body['serviceId'],false);
            if (!$service) throw new Noa\ApiException(404,'Serviço ou profissional indisponível.');
            $start=(new DateTimeImmutable($body['scheduledStart']))->setTimezone(new DateTimeZone('UTC')); $end=$start->modify('+' . (int)$service['duration_minutes'] . ' minutes'); $scheduledEnd=$end->format('Y-m-d\TH:i:s.v\Z');
            if (!validIsoInterval($body['scheduledStart'],$scheduledEnd)) throw new Noa\ApiException(400,'Horário inválido.');
            assertAppointmentAvailable($db,$clinic['id'],$body['professionalId'],$body['scheduledStart'],$scheduledEnd,$clinic['timezone'] ?: 'UTC',(int)$service['duration_minutes']);

            $contactKeys=['public-contact:' . $clinic['id'] . ':phone:' . $phone]; if ($email!=='') $contactKeys[]='public-contact:' . $clinic['id'] . ':email:' . $email; sort($contactKeys,SORT_STRING);
            foreach ($contactKeys as $key) { $contactLock=$db->prepare('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))'); $contactLock->execute(['key'=>$key]); }
            $contact=$db->prepare("SELECT id FROM patients WHERE clinic_id=:clinic AND (regexp_replace(COALESCE(phone,''),'[^0-9]','','g')=:phone OR (:email_filter <> '' AND lower(trim(COALESCE(email,'')))=:email_compare)) FOR UPDATE");
            $contact->execute(['clinic'=>$clinic['id'],'phone'=>$phone,'email_filter'=>$email,'email_compare'=>$email]);
            if ($contact->fetchColumn()) throw new Noa\ApiException(409,'Não foi possível confirmar os dados de contato. Verifique-os ou entre em contato com a clínica.');

            $patientStmt=$db->prepare("INSERT INTO patients (clinic_id,name,phone,email,status,reminder_consent_at) VALUES (:clinic,:name,:phone,:email,'active',CASE WHEN :consent THEN NOW() ELSE NULL END) RETURNING id");
            $patientStmt->execute(['clinic'=>$clinic['id'],'name'=>$name,'phone'=>trim($phoneRaw),'email'=>$email ?: null,'consent'=>($body['reminderConsent'] ?? false) ? 'true' : 'false']); $patientId=$patientStmt->fetchColumn();
            $code='PUB-' . strtoupper(substr(bin2hex(random_bytes(12)),0,20));
            $insert=$db->prepare("INSERT INTO appointments (clinic_id,patient_id,professional_id,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,scheduled_start,scheduled_end,status,code,public_idempotency_key) VALUES (:clinic,:patient,:professional,:service,:service_name,:price,:duration,:starts,:ends,'scheduled',:code,:idempotency) RETURNING id,code");
            $insert->execute(['clinic'=>$clinic['id'],'patient'=>$patientId,'professional'=>$body['professionalId'],'service'=>$service['id'],'service_name'=>$service['name'],'price'=>$service['price'],'duration'=>$service['duration_minutes'],'starts'=>$body['scheduledStart'],'ends'=>$scheduledEnd,'code'=>$code,'idempotency'=>$body['idempotencyKey']]); $appointment=$insert->fetch();
            writeAudit($db,$clinic['id'],null,'appointments',$appointment['id'],'public_created',['code'=>$appointment['code'],'serviceId'=>$service['id'],'professionalId'=>$body['professionalId'],'scheduledStart'=>$body['scheduledStart']]);
            $confirmation=loadPhpPublicConfirmation($db,$clinic['id'],$appointment['code']); commitClinicOperation($db); Http::json(201,['ok'=>true,'data'=>$confirmation]);
        } catch (Throwable $e) {
            if ($db->inTransaction()) rollBackClinicOperation($db);
            if ($e instanceof PDOException && str_contains((string)($e->errorInfo[2] ?? ''),'ex_appointments_no_overlapping_professional')) throw new Noa\ApiException(409,'Esse horário acabou de ser ocupado. Escolha outro horário.');
            if ($e instanceof PDOException && str_contains((string)($e->errorInfo[2] ?? ''),'uq_appointments_clinic_id_idempotency_key')) throw new Noa\ApiException(409,'A solicitação já foi processada.');
            throw $e;
        }
    }

    if ($path==='/api/platform/auth/login' && $method==='POST') Http::json(200,['ok'=>true,'data'=>PlatformAdmin::login($body,$requestId)]);
    if ($path==='/api/platform/auth/me' && $method==='GET') {
        $platformAdmin=PlatformAdmin::authenticate($requestId); Http::json(200,['ok'=>true,'data'=>PlatformAdmin::me($platformAdmin,$requestId)]);
    }
    if ($path==='/api/platform/auth/logout' && $method==='POST') {
        $platformAdmin=PlatformAdmin::authenticate($requestId); PlatformAdmin::logout($platformAdmin,$requestId); Http::json(200,['ok'=>true,'message'=>'Sessão administrativa encerrada.']);
    }
    if ($path==='/api/platform' || str_starts_with($path,'/api/platform/')) {
        $platformAdmin=PlatformAdmin::authenticate($requestId);
        if($method==='GET' && $path==='/api/platform/dashboard') Http::json(200,['ok'=>true,'data'=>PlatformAdmin::dashboard($_GET,$platformAdmin,$requestId)]);
        if($method==='GET' && $path==='/api/platform/clinics') Http::json(200,['ok'=>true]+PlatformAdmin::listClinics($_GET,$platformAdmin,$requestId));
        if($method==='GET' && preg_match('#^/api/platform/clinics/([^/]+)$#',$path,$platformClinicMatch)) Http::json(200,['ok'=>true,'data'=>PlatformAdmin::clinicDetails(rawurldecode($platformClinicMatch[1]),$platformAdmin,$requestId)]);
        if($method==='GET' && $path==='/api/platform/subscriptions') Http::json(200,['ok'=>true]+PlatformAdmin::subscriptions($_GET,$platformAdmin,$requestId));
        if($method==='GET' && $path==='/api/platform/events') Http::json(200,['ok'=>true]+PlatformAdmin::events($_GET,$platformAdmin,$requestId));
    }

    if ($path==='/api/payments' || str_starts_with($path,'/api/payments/')) {
        $user=requireClinicAccess(['admin','reception']); requirePlanCapability($user,'payments'); $clinic=$user['clinic_id']; $db=Database::connection();
        if ($method==='GET' && $path==='/api/payments') {
            $stmt=$db->prepare('SELECT p.*,a.code AS appointment_code FROM payments p LEFT JOIN appointments a ON a.id=p.appointment_id AND a.clinic_id=p.clinic_id WHERE p.clinic_id=:clinic ORDER BY p.created_at DESC'); $stmt->execute(['clinic'=>$clinic]); Http::json(200,['ok'=>true,'data'=>$stmt->fetchAll()]);
        }
        if ($method==='POST' && $path==='/api/payments') {
            $fields=['appointmentId','amount','currency','paymentMode','provider','status'];
            $amount=$body['amount'] ?? null; $fractionDigits=is_int($amount)?0:(is_float($amount)?strlen(explode('.',strtolower((string)$amount))[1] ?? ''):99);
            $optionalValid=static function(string $key,int $max,?array $values=null) use($body): bool { if(!array_key_exists($key,$body) || $body[$key]===null || $body[$key]==='') return true; return is_string($body[$key]) && textLength($body[$key])<=$max && !str_contains($body[$key],"\0") && ($values===null || in_array($body[$key],$values,true)); };
            if (array_diff(array_keys($body),$fields) || !isUuidValue($body['appointmentId'] ?? null) || (!is_int($amount) && !is_float($amount)) || !is_finite((float)$amount) || $amount<0 || $amount>99999999.99 || $fractionDigits>2 || !$optionalValid('currency',3) || !$optionalValid('provider',50) || !$optionalValid('paymentMode',30,['before','after']) || !$optionalValid('status',30,['pending','paid','cancelled','refunded'])) Http::json(400,['ok'=>false,'message'=>'Dados de pagamento inválidos.']);
            $appointment=$db->prepare('SELECT id FROM appointments WHERE id=:appointment AND clinic_id=:clinic'); $appointment->execute(['appointment'=>$body['appointmentId'],'clinic'=>$clinic]);
            if (!$appointment->fetchColumn()) Http::json(404,['ok'=>false,'message'=>'Agendamento não encontrado para esta clínica.']);
            $stmt=$db->prepare("INSERT INTO payments (clinic_id,appointment_id,provider,amount,currency,payment_mode,status,paid_at) VALUES (:clinic,:appointment,:provider,:amount,:currency,:mode,:status,CASE WHEN :paid_status='paid' THEN NOW() ELSE NULL END) RETURNING *");
            $status=($body['status'] ?? null) ?: 'pending'; $stmt->execute(['clinic'=>$clinic,'appointment'=>$body['appointmentId'],'provider'=>($body['provider'] ?? null) ?: 'internal','amount'=>$amount,'currency'=>($body['currency'] ?? null) ?: 'BRL','mode'=>($body['paymentMode'] ?? null) ?: 'before','status'=>$status,'paid_status'=>$status]);
            Http::json(201,['ok'=>true,'data'=>$stmt->fetch()]);
        }
        if (preg_match('#^/api/payments/([^/]+)/checkout$#',$path,$paymentMatch) && $method==='POST') {
            $access=getenv('MERCADOPAGO_ACCESS_TOKEN') ?: ''; $webhook=getenv('MERCADOPAGO_WEBHOOK_URL') ?: '';
            if ($access==='' || $webhook==='' || !isUuid($paymentMatch[1])) Http::json(503,['ok'=>false,'message'=>'Checkout Mercado Pago indisponível ou pagamento inválido.']);
            $lookup=$db->prepare('SELECT p.id,p.amount,p.currency,p.status,a.code FROM payments p LEFT JOIN appointments a ON a.id=p.appointment_id AND a.clinic_id=p.clinic_id WHERE p.id=:id AND p.clinic_id=:clinic'); $lookup->execute(['id'=>$paymentMatch[1],'clinic'=>$clinic]); $payment=$lookup->fetch();
            if (!$payment || $payment['status']!=='pending') Http::json(409,['ok'=>false,'message'=>'Este pagamento não está pendente.']);
            $appUrl=getenv('PUBLIC_APP_URL') ?: ''; if ($appUrl==='') Http::json(503,['ok'=>false,'message'=>'URL pública não configurada.']);
            $origin=validPublicOrigin($appUrl,(getenv('NODE_ENV') ?: '')==='production'); if ($origin===null) Http::json(503,['ok'=>false,'message'=>'URL pública não configurada.']);
            releaseClinicAccessLock($db);
            $result=mercadoPagoRequest('POST',mercadoPagoApiUrl('/checkout/preferences'),$access,[
                'items'=>[['id'=>$payment['id'],'title'=>trim('Atendimento '.($payment['code'] ?? '')),'quantity'=>1,'currency_id'=>$payment['currency'] ?: 'BRL','unit_price'=>(float)$payment['amount']]],
                'external_reference'=>'patient_payment:'.$payment['id'],'notification_url'=>$webhook,
                'back_urls'=>['success'=>$origin.'/clinic/payments?payment=success','pending'=>$origin.'/clinic/payments?payment=pending','failure'=>$origin.'/clinic/payments?payment=failure'],'auto_return'=>'approved',
            ]);
            if ($result['status']<200 || $result['status']>=300 || empty($result['data']['init_point'])) Http::json(502,['ok'=>false,'message'=>'Não foi possível iniciar o pagamento.']);
            reacquireClinicAccessLock($db,$clinic);
            $meta=json_encode(['preference_id'=>$result['data']['id'] ?? null,'clinic_id'=>$clinic],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
            $update=$db->prepare("UPDATE payments SET provider='mercadopago',external_reference=:reference,metadata=COALESCE(metadata,'{}'::jsonb)||CAST(:metadata AS jsonb),updated_at=NOW() WHERE id=:id AND clinic_id=:clinic");
            $update->execute(['reference'=>'patient_payment:'.$payment['id'],'metadata'=>$meta,'id'=>$payment['id'],'clinic'=>$clinic]);
            Http::json(200,['ok'=>true,'data'=>['checkoutUrl'=>$result['data']['init_point']]]);
        }
        if (preg_match('#^/api/payments/([^/]+)/status$#',$path,$paymentMatch) && $method==='PATCH') {
            if (!isUuid($paymentMatch[1]) || array_diff(array_keys($body),['status']) || !in_array($body['status'] ?? null,['pending','paid','cancelled','refunded'],true)) Http::json(400,['ok'=>false,'message'=>'Status de pagamento inválido.']);
            $stmt=$db->prepare("UPDATE payments SET status=:status,paid_at=CASE WHEN :status_paid='paid' THEN COALESCE(paid_at,NOW()) WHEN :status_refunded='refunded' THEN NULL ELSE paid_at END,updated_at=NOW() WHERE id=:id AND clinic_id=:clinic RETURNING *");
            $stmt->execute(['status'=>$body['status'],'status_paid'=>$body['status'],'status_refunded'=>$body['status'],'id'=>$paymentMatch[1],'clinic'=>$clinic]); $row=$stmt->fetch();
            if (!$row) Http::json(404,['ok'=>false,'message'=>'Pagamento não encontrado.']); Http::json(200,['ok'=>true,'data'=>$row]);
        }
    }

    if ($method==='POST' && $path==='/api/checkout') {
        $allowed=['clinicName','ownerName','email','phone','password','plan','billingCycle']; $name=$body['clinicName'] ?? null; $ownerName=$body['ownerName'] ?? null; $email=$body['email'] ?? null; $password=$body['password'] ?? null; $phone=$body['phone'] ?? null; $planName=$body['plan'] ?? null; $cycle=$body['billingCycle'] ?? null;
        $plan = is_string($planName) ? Noa\PlanCatalog::plan($planName) : null;
        $cycleDefinition = is_string($cycle) ? (Noa\PlanCatalog::billingCycles()[$cycle] ?? null) : null;
        $priceInCents = is_string($planName) && is_string($cycle) ? Noa\PlanCatalog::priceInCents($planName, $cycle) : null;
        if (array_diff(array_keys($body),$allowed) || !is_string($name) || jsStringLength(trim($name))<2 || jsStringLength($name)>200 || !is_string($ownerName) || jsStringLength(trim($ownerName))<2 || jsStringLength($ownerName)>200 || !is_string($email) || jsStringLength($email)>254 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/',trim($email)) || !is_string($password) || textLength($password)<12 || strlen($password)>72 || !is_string($planName) || !in_array($planName, Noa\PlanCatalog::commercialPlanIds(), true) || $plan === null || $priceInCents === null || $cycleDefinition === null || ($phone!==null && (!is_string($phone) || jsStringLength($phone)>20))) Http::json(400,['ok'=>false,'message'=>'Confira os dados da clínica, do responsável, do plano e da senha (mínimo de 12 caracteres).']);
        $origin=validPublicOrigin(getenv('PUBLIC_APP_URL') ?: '',(getenv('NODE_ENV') ?: '')==='production'); $webhook=getenv('MERCADOPAGO_WEBHOOK_URL') ?: ''; $webhookUrl=parse_url($webhook); $access=getenv('MERCADOPAGO_ACCESS_TOKEN') ?: ''; $webhookSecret=getenv('MERCADOPAGO_WEBHOOK_SECRET') ?: '';
        if ($access==='' || $webhookSecret==='' || $origin===null || !is_array($webhookUrl) || !in_array($webhookUrl['scheme'] ?? '',['http','https'],true) || ((getenv('NODE_ENV') ?: '')==='production' && ($webhookUrl['scheme'] ?? '')!=='https')) Http::json(503,['ok'=>false,'message'=>'A contratação está aguardando a configuração do Mercado Pago e do webhook.']);
        $db=Database::connection(); $passwordHash=password_hash($password,PASSWORD_BCRYPT,['cost'=>12]); $clinicName=trim($name); $ownerName=trim($ownerName); $normalizedEmail=strtolower(trim($email)); $phoneValue=is_string($phone)?(trim($phone) ?: null):null; $checkout=beginClinicOperation($db);
        try {
            $dupe=$db->prepare('SELECT 1 FROM users WHERE LOWER(email)=LOWER(:email) LIMIT 1'); $dupe->execute(['email'=>$normalizedEmail]); if ($dupe->fetchColumn()) throw new Noa\ApiException(409,'Este e-mail já possui acesso. Entre ou use outro endereço.');
            $clinicStmt=$db->prepare("INSERT INTO clinics (name,trade_name,email,phone,status,suspension_reason) VALUES (:name,:name_trade,:email,:phone,'suspended','onboarding') RETURNING id"); $clinicStmt->execute(['name'=>$clinicName,'name_trade'=>$clinicName,'email'=>$normalizedEmail,'phone'=>$phoneValue]); $clinicId=$clinicStmt->fetchColumn();
            $config=$db->prepare('INSERT INTO clinic_configurations (clinic_id,name,email,phone,timezone) VALUES (:clinic,:name,:email,:phone,\'America/Sao_Paulo\')'); $config->execute(['clinic'=>$clinicId,'name'=>$clinicName,'email'=>$normalizedEmail,'phone'=>$phoneValue]);
            $owner=$db->prepare("INSERT INTO users (clinic_id,name,email,password_hash,phone,role) VALUES (:clinic,:name,:email,:password,:phone,'admin')"); $owner->execute(['clinic'=>$clinicId,'name'=>$ownerName,'email'=>$normalizedEmail,'password'=>$passwordHash,'phone'=>$phoneValue]);
            $subscription=$db->prepare("INSERT INTO subscriptions (clinic_id,plan,billing_cycle,status,started_at,current_period_start,current_period_end,gateway) VALUES (:clinic,:plan,:cycle,'past_due',NOW(),NOW(),NOW()+(CAST(:months AS int)*INTERVAL '1 month'),'mercadopago') RETURNING id"); $subscription->execute(['clinic'=>$clinicId,'plan'=>$planName,'cycle'=>$cycle,'months'=>$cycleDefinition['months']]); $subscriptionId=$subscription->fetchColumn();
            $session=$db->prepare("INSERT INTO checkout_sessions (clinic_id,subscription_id,gateway,amount_cents) VALUES (:clinic,:subscription,'mercadopago',:amount) RETURNING id"); $session->execute(['clinic'=>$clinicId,'subscription'=>$subscriptionId,'amount'=>$priceInCents]); $checkoutId=$session->fetchColumn();
            commitClinicOperation($db);
        } catch(Throwable $e) { if($db->inTransaction()) rollBackClinicOperation($db); throw $e; }
        $amount=$priceInCents/100;
        $preference=mercadoPagoRequest('POST',mercadoPagoApiUrl('/checkout/preferences'),$access,[
            'items'=>[['id'=>$planName.'-'.$cycle,'title'=>'NOA CONNECT — '.$plan['name'],'description'=>'Assinatura '.$cycleDefinition['label'],'quantity'=>1,'currency_id'=>'BRL','unit_price'=>$amount]],
            'payer'=>['email'=>$normalizedEmail,'name'=>$ownerName],'external_reference'=>$checkoutId,'notification_url'=>$webhook,
            'back_urls'=>['success'=>$origin.'/contratacao?checkout=success','pending'=>$origin.'/contratacao?checkout=pending','failure'=>$origin.'/contratacao?checkout=failure'],'auto_return'=>'approved','metadata'=>['checkout_id'=>$checkoutId,'clinic_id'=>$clinicId],
        ]);
        if($preference['status']<200 || $preference['status']>=300 || empty($preference['data']['id']) || empty($preference['data']['init_point'])) throw new Noa\ApiException(502,'Não foi possível criar o checkout no Mercado Pago.');
        $save=$db->prepare('UPDATE checkout_sessions SET gateway_preference_id=:preference WHERE id=:id'); $save->execute(['preference'=>$preference['data']['id'],'id'=>$checkoutId]);
        Http::json(201,['ok'=>true,'data'=>['checkoutUrl'=>$preference['data']['init_point'],'checkoutId'=>$checkoutId]]);
    }

    if ($method==='POST' && $path==='/api/checkout/mercadopago/webhook') {
        $secret=getenv('MERCADOPAGO_WEBHOOK_SECRET') ?: ''; $signature=$_SERVER['HTTP_X_SIGNATURE'] ?? ''; $requestHeader=$_SERVER['HTTP_X_REQUEST_ID'] ?? '';
        parse_str($_SERVER['QUERY_STRING'] ?? '',$queryData); $paymentId=(string)($body['data']['id'] ?? $queryData['data_id'] ?? '');
        if ($secret==='' || !MercadoPagoWebhook::isValidSignature($signature,$requestHeader,$paymentId,$secret)) Http::json(401,['ok'=>false]);
        if (!preg_match('/^\d+$/',$paymentId)) Http::json(200,['ok'=>true]);
        $access=getenv('MERCADOPAGO_ACCESS_TOKEN') ?: ''; if($access==='') Http::json(200,['ok'=>true]);
        $provider=mercadoPagoRequest('GET',mercadoPagoApiUrl('/v1/payments/'.rawurlencode($paymentId)),$access);
        $payment=$provider['data']; if($provider['status']<200 || $provider['status']>=300 || !MercadoPagoWebhook::isValidPayment($payment,$paymentId)) Http::json(200,['ok'=>true]);
        $external=$payment['external_reference'] ?? ''; $db=Database::connection();
        if(is_string($external) && str_starts_with($external,'patient_payment:')) {
            $paymentUuid=substr($external,strlen('patient_payment:')); if($payment['status']!=='approved' || !isUuid($paymentUuid)) Http::json(200,['ok'=>true]);
            $amountCents=(int)round((float)($payment['transaction_amount'] ?? 0)*100);
            try {
                $update=$db->prepare("UPDATE payments SET status='paid',gateway_payment_id=:mp_id,paid_at=COALESCE(paid_at,NOW()),updated_at=NOW(),metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('mercadopago_payment_id',:metadata_mp_id) WHERE id=:id AND provider='mercadopago' AND currency='BRL' AND external_reference=:reference AND status='pending' AND round(amount*100)::integer=:amount AND (gateway_payment_id IS NULL OR gateway_payment_id=:existing_mp_id)");
                $update->execute(['mp_id'=>$paymentId,'metadata_mp_id'=>$paymentId,'id'=>$paymentUuid,'reference'=>$external,'amount'=>$amountCents,'existing_mp_id'=>$paymentId]);
            } catch(PDOException $error) {
                if($error->getCode()==='23505') Http::json(200,['ok'=>true]);
                throw $error;
            }
            Http::json(200,['ok'=>true]);
        }
        if(!isUuid($external)) Http::json(200,['ok'=>true]);
        $amountCents=(int)round((float)($payment['transaction_amount'] ?? 0)*100); beginClinicOperation($db);
        try {
            $session=$db->prepare("SELECT cs.*,s.billing_cycle,c.status AS clinic_status,c.suspension_reason FROM checkout_sessions cs JOIN subscriptions s ON s.id=cs.subscription_id JOIN clinics c ON c.id=cs.clinic_id WHERE cs.id=:id AND cs.gateway='mercadopago' FOR UPDATE OF cs,s,c"); $session->execute(['id'=>$external]); $row=$session->fetch();
            if($row && (int)$row['amount_cents']===$amountCents && !in_array($row['status'],['paid','paid_late'],true)) {
                if($payment['status']==='approved') {
                    $nextStatus=MercadoPagoWebhook::nextSessionStatus($row['status'],$payment['status']);
                    if($nextStatus!==null) {
                        $mark=$db->prepare("UPDATE checkout_sessions SET status=:status,gateway_payment_id=:payment,paid_at=COALESCE(paid_at,NOW()),updated_at=NOW() WHERE id=:id"); $mark->execute(['status'=>$nextStatus,'payment'=>$paymentId,'id'=>$row['id']]);
                        if($nextStatus==='paid') {
                            $activate=$db->prepare("UPDATE subscriptions SET status='active',current_period_start=NOW(),current_period_end=NOW()+(CASE billing_cycle WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 ELSE 12 END*INTERVAL '1 month') WHERE id=:id"); $activate->execute(['id'=>$row['subscription_id']]);
                            if(MercadoPagoWebhook::canActivateClinic($row['clinic_status'],$row['suspension_reason'])) {
                                $clinicUpdate=$db->prepare("UPDATE clinics SET status='active',suspension_reason=NULL,updated_at=NOW() WHERE id=:id AND status='suspended' AND suspension_reason IN ('onboarding','billing')"); $clinicUpdate->execute(['id'=>$row['clinic_id']]);
                            }
                        }
                    }
                } elseif(MercadoPagoWebhook::nextSessionStatus($row['status'],$payment['status'])==='failed') {
                    $fail=$db->prepare("UPDATE checkout_sessions SET status='failed',updated_at=NOW() WHERE id=:id AND status='pending'"); $fail->execute(['id'=>$row['id']]);
                }
            }
            commitClinicOperation($db);
        } catch(Throwable $e) {
            if($db->inTransaction()) rollBackClinicOperation($db);
            if($e instanceof PDOException && $e->getCode()==='23505') Http::json(200,['ok'=>true]);
            throw $e;
        }
        Http::json(200,['ok'=>true]);
    }

    if ($path==='/api/waitlist' || str_starts_with($path,'/api/waitlist/')) {
        $user=requireClinicAccess(['admin','reception']); requirePlanCapability($user,'waitlist'); $clinic=$user['clinic_id']; $db=Database::connection();
        if($method==='GET' && $path==='/api/waitlist') {
            $stmt=$db->prepare("SELECT w.id,w.patient_name,w.patient_phone,w.patient_email,w.preferred_from,w.preferred_to,w.preferred_period,w.status,w.created_at,s.name AS service_name,pr.name AS professional_name FROM appointment_waitlist w JOIN services s ON s.id=w.service_id AND s.clinic_id=w.clinic_id LEFT JOIN professionals pr ON pr.id=w.professional_id AND pr.clinic_id=w.clinic_id WHERE w.clinic_id=:clinic AND w.status IN ('waiting','offered') ORDER BY w.preferred_from,w.created_at"); $stmt->execute(['clinic'=>$clinic]); Http::json(200,['ok'=>true,'data'=>$stmt->fetchAll()]);
        }
        if($method==='GET' && $path==='/api/waitlist/matches') {
            $appointmentId=$_GET['appointmentId'] ?? null; if(!isUuidValue($appointmentId)) Http::json(400,['ok'=>false,'message'=>'Agendamento inválido.']);
            $sql="SELECT w.id,w.patient_name,w.patient_phone,w.patient_email,w.preferred_from,w.preferred_to,w.preferred_period,s.name AS service_name,pr.name AS professional_name FROM appointments a JOIN clinic_configurations cc ON cc.clinic_id=a.clinic_id JOIN appointment_waitlist w ON w.clinic_id=a.clinic_id AND w.service_id=a.service_id AND w.status='waiting' AND w.preferred_from<=(a.scheduled_start AT TIME ZONE cc.timezone)::date AND w.preferred_to>=(a.scheduled_start AT TIME ZONE cc.timezone)::date AND (w.professional_id IS NULL OR w.professional_id=a.professional_id) AND (w.preferred_period='any' OR (w.preferred_period='morning' AND EXTRACT(HOUR FROM a.scheduled_start AT TIME ZONE cc.timezone)<12) OR (w.preferred_period='afternoon' AND EXTRACT(HOUR FROM a.scheduled_start AT TIME ZONE cc.timezone) BETWEEN 12 AND 16) OR (w.preferred_period='evening' AND EXTRACT(HOUR FROM a.scheduled_start AT TIME ZONE cc.timezone)>=17)) JOIN services s ON s.id=a.service_id AND s.clinic_id=a.clinic_id LEFT JOIN professionals pr ON pr.id=a.professional_id AND pr.clinic_id=a.clinic_id WHERE a.id=:appointment AND a.clinic_id=:clinic AND a.status='cancelled' ORDER BY w.created_at ASC LIMIT 25";
            $stmt=$db->prepare($sql); $stmt->execute(['appointment'=>$appointmentId,'clinic'=>$clinic]); Http::json(200,['ok'=>true,'data'=>$stmt->fetchAll()]);
        }
        if($method==='POST' && $path==='/api/waitlist') {
            if(!validWaitlistEntry($body)) Http::json(400,['ok'=>false,'message'=>'Dados da lista de espera inválidos.']);
            $stmt=$db->prepare("INSERT INTO appointment_waitlist (clinic_id,service_id,professional_id,patient_name,patient_phone,patient_email,preferred_from,preferred_to,preferred_period,consent_at) SELECT :clinic,s.id,:professional,:name,:phone,NULLIF(LOWER(TRIM(:email)),''),CAST(:from_date AS date),CAST(:to_date AS date),:period,NOW() FROM services s WHERE s.id=:service AND s.clinic_id=:clinic_check AND s.is_active AND (CAST(:professional_check AS uuid) IS NULL OR EXISTS(SELECT 1 FROM professional_services ps JOIN professionals p ON p.id=ps.professional_id AND p.clinic_id=ps.clinic_id WHERE ps.clinic_id=:clinic_prof AND ps.service_id=s.id AND ps.professional_id=:professional_ref AND p.status='active')) RETURNING id,status,created_at");
            $professional=($body['professionalId'] ?? null) ?: null; $stmt->execute(['clinic'=>$clinic,'professional'=>$professional,'name'=>trim($body['name']),'phone'=>trim($body['phone']),'email'=>$body['email'] ?? '', 'from_date'=>$body['preferredFrom'],'to_date'=>$body['preferredTo'],'period'=>$body['preferredPeriod'] ?? 'any','service'=>$body['serviceId'],'clinic_check'=>$clinic,'professional_check'=>$professional,'clinic_prof'=>$clinic,'professional_ref'=>$professional]); $row=$stmt->fetch();
            if(!$row) Http::json(400,['ok'=>false,'message'=>'Serviço ou profissional indisponível.']); Http::json(201,['ok'=>true,'data'=>$row]);
        }
        if(preg_match('#^/api/waitlist/([^/]+)/status$#',$path,$waitMatch) && $method==='PATCH') {
            if(!isUuid($waitMatch[1]) || !isWaitlistStatus($body)) Http::json(400,['ok'=>false,'message'=>'Atualização da lista de espera inválida.']);
            $stmt=$db->prepare("UPDATE appointment_waitlist SET status=:status,offered_at=CASE WHEN :status_offered='offered' THEN NOW() ELSE offered_at END,updated_at=NOW() WHERE id=:id AND clinic_id=:clinic AND status IN ('waiting','offered') RETURNING id,status,offered_at"); $stmt->execute(['status'=>$body['status'],'status_offered'=>$body['status'],'id'=>$waitMatch[1],'clinic'=>$clinic]); $row=$stmt->fetch();
            if(!$row) Http::json(404,['ok'=>false,'message'=>'Entrada da lista não encontrada.']); Http::json(200,['ok'=>true,'data'=>$row]);
        }
    }

    if($method==='POST' && preg_match('#^/api/public/clinics/([^/]+)/waitlist$#',$path,$publicWaitMatch)) {
        $slug=rawurldecode($publicWaitMatch[1]);
        if(!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/',$slug) || !validWaitlistEntry($body)) Http::json(400,['ok'=>false,'message'=>'Dados da lista de espera inválidos.']);
        $professional=($body['professionalId'] ?? null) ?: null; $db=Database::connection(); beginClinicOperation($db);
        try {
            $lock=$db->prepare("SELECT c.id FROM clinics c JOIN clinic_configurations cc ON cc.clinic_id=c.id WHERE cc.public_slug=:slug AND c.status='active' FOR SHARE OF c"); $lock->execute(['slug'=>$slug]); $clinicId=$lock->fetchColumn();
            if($clinicId===false) $row=false;
            else {
                $stmt=$db->prepare("INSERT INTO appointment_waitlist (clinic_id,service_id,professional_id,patient_name,patient_phone,patient_email,preferred_from,preferred_to,preferred_period,consent_at) SELECT cc.clinic_id,s.id,:professional,:name,:phone,NULLIF(LOWER(TRIM(:email)),''),CAST(:from_date AS date),CAST(:to_date AS date),:period,NOW() FROM clinic_configurations cc JOIN clinics c ON c.id=cc.clinic_id AND c.status='active' JOIN services s ON s.clinic_id=cc.clinic_id AND s.id=:service AND s.is_active WHERE cc.public_slug=:slug AND (CAST(:professional_check AS uuid) IS NULL OR EXISTS(SELECT 1 FROM professional_services ps JOIN professionals p ON p.id=ps.professional_id AND p.clinic_id=ps.clinic_id WHERE ps.clinic_id=cc.clinic_id AND ps.service_id=s.id AND ps.professional_id=:professional_ref AND p.status='active')) AND EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.clinic_id=cc.clinic_id AND sub.status IN ('active','trialing') AND sub.current_period_start<=NOW() AND sub.current_period_end>NOW() AND (sub.status<>'trialing' OR sub.trial_ends_at>NOW())) RETURNING id,status,created_at");
                $stmt->execute(['professional'=>$professional,'name'=>trim($body['name']),'phone'=>trim($body['phone']),'email'=>$body['email'] ?? '','from_date'=>$body['preferredFrom'],'to_date'=>$body['preferredTo'],'period'=>$body['preferredPeriod'] ?? 'any','service'=>$body['serviceId'],'slug'=>$slug,'professional_check'=>$professional,'professional_ref'=>$professional]); $row=$stmt->fetch();
            }
            commitClinicOperation($db);
        } catch(Throwable $error) { if($db->inTransaction()) rollBackClinicOperation($db); throw $error; }
        if(!$row) Http::json(404,['ok'=>false,'message'=>'Serviço ou clínica indisponível.']); Http::json(201,['ok'=>true,'data'=>$row]);
    }

    if($method==='POST' && $path==='/api/public/appointment-management-link') {
        $code=is_string($body['code'] ?? null)?strtoupper(trim($body['code'])):''; $email=is_string($body['email'] ?? null)?strtolower(trim($body['email'])):'';
        $generic=['ok'=>true,'message'=>'Se os dados corresponderem a um agendamento, enviaremos as instruções por e-mail.'];
        if(!preg_match('/^PUB-[A-F0-9]{20}$/',$code) || jsStringLength($email)>254 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/',$email)) Http::json(202,$generic);
        $db=Database::connection();
        $smtpNames=['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','PUBLIC_APP_URL']; $smtpConfigured=true; foreach($smtpNames as $smtpName) if(!is_string(getenv($smtpName)) || trim((string)getenv($smtpName))==='') $smtpConfigured=false;
        $origin=null;
        if($smtpConfigured) {
            $appParts=parse_url(getenv('PUBLIC_APP_URL')); if(!is_array($appParts) || !in_array(strtolower($appParts['scheme'] ?? ''),['http','https'],true) || empty($appParts['host']) || isset($appParts['user']) || isset($appParts['pass']) || isset($appParts['query']) || isset($appParts['fragment']) || ((getenv('NODE_ENV') ?: '')==='production' && strtolower($appParts['scheme'])!=='https')) throw new Noa\ApiException(503,'Serviço temporariamente indisponível.');
            $origin=strtolower($appParts['scheme']).'://'.$appParts['host'].(isset($appParts['port'])?':'.$appParts['port']:'');
        }
        beginClinicOperation($db);
        try {
            $stmt=$db->prepare("SELECT a.id,a.clinic_id,p.email,COALESCE(NULLIF(trim(cc.name),''),c.trade_name,c.name) AS clinic_name FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id JOIN clinics c ON c.id=a.clinic_id JOIN clinic_configurations cc ON cc.clinic_id=c.id WHERE a.code=:code AND lower(trim(COALESCE(p.email,'')))=:email AND a.status IN ('scheduled','confirmed') AND c.status='active' FOR SHARE OF c"); $stmt->execute(['code'=>$code,'email'=>$email]); $appointment=$stmt->fetch();
            if($appointment && $smtpConfigured) {
                $rawToken=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'='); $tokenHash=hash('sha256',$rawToken);
                $insert=$db->prepare("INSERT INTO appointment_access_tokens (clinic_id,appointment_id,token_hash,expires_at) VALUES (:clinic,:appointment,:hash,NOW()+INTERVAL '24 hours')"); $insert->execute(['clinic'=>$appointment['clinic_id'],'appointment'=>$appointment['id'],'hash'=>$tokenHash]);
            }
            commitClinicOperation($db);
        } catch(Throwable $error) { if($db->inTransaction()) rollBackClinicOperation($db); throw $error; }
        if($appointment && $smtpConfigured) {
            $url=$origin.'/manage-appointment#token='.rawurlencode($rawToken); $text='Use este link nas próximas 24 horas para consultar ou cancelar seu agendamento: '.$url."\nSe você não solicitou o acesso, ignore esta mensagem.";
            sendPhpSmtpMessage($email,'Gerenciar agendamento — '.$appointment['clinic_name'],$text,'<p>'.htmlspecialchars($text,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'</p>');
        }
        Http::json(202,$generic);
    }

    $legacyPortalLookup = $method === 'GET' && preg_match('#^/api/public/appointment-management/([^/]+)$#',$path,$portalMatch);
    $portalLookup = $method === 'POST' && $path === '/api/public/appointment-management/lookup';
    if ($legacyPortalLookup || $portalLookup) {
        $portalToken = $portalLookup ? ($body['token'] ?? null) : $portalMatch[1];
        if (!is_string($portalToken) || !preg_match('/^[A-Za-z0-9_-]{40,60}$/',$portalToken)) Http::json(404,['ok'=>false,'message'=>'Link inválido ou expirado.']);
        $hash=hash('sha256',$portalToken); $stmt=Database::connection()->prepare("SELECT a.code,a.status,a.scheduled_start,COALESCE(NULLIF(trim(cc.name),''),c.trade_name,c.name) AS clinic_name,cc.timezone FROM appointment_access_tokens t JOIN appointments a ON a.id=t.appointment_id AND a.clinic_id=t.clinic_id JOIN clinics c ON c.id=a.clinic_id JOIN clinic_configurations cc ON cc.clinic_id=c.id WHERE t.token_hash=:hash AND t.revoked_at IS NULL AND t.expires_at>NOW() AND a.status IN ('scheduled','confirmed') AND c.status IN ('active','pending_payment','suspended','inactive')"); $stmt->execute(['hash'=>$hash]); $row=$stmt->fetch();
        if(!$row) Http::json(404,['ok'=>false,'message'=>'Link inválido ou expirado.']); Http::json(200,['ok'=>true,'data'=>$row]);
    }

    $legacyPortalCancel = $method === 'POST' && preg_match('#^/api/public/appointment-management/([^/]+)/cancel$#',$path,$portalMatch);
    $portalCancel = $method === 'POST' && $path === '/api/public/appointment-management/cancel';
    if ($legacyPortalCancel || $portalCancel) {
        $portalToken = $portalCancel ? ($body['token'] ?? null) : $portalMatch[1];
        if (!is_string($portalToken) || !preg_match('/^[A-Za-z0-9_-]{40,60}$/',$portalToken)) Http::json(404,['ok'=>false,'message'=>'Link inválido ou expirado.']);
        $hash=hash('sha256',$portalToken); $db=Database::connection();
        $stmt=$db->prepare("UPDATE appointments a SET status='cancelled',updated_at=NOW() FROM appointment_access_tokens t JOIN clinics c ON c.id=t.clinic_id WHERE t.token_hash=:hash AND t.clinic_id=a.clinic_id AND t.appointment_id=a.id AND c.id=a.clinic_id AND c.status IN ('active','pending_payment','suspended','inactive') AND t.revoked_at IS NULL AND t.expires_at>NOW() AND a.status IN ('scheduled','confirmed') AND a.scheduled_start>NOW() RETURNING a.code,a.status"); $stmt->execute(['hash'=>$hash]); $row=$stmt->fetch();
        if(!$row) Http::json(409,['ok'=>false,'message'=>'Não foi possível cancelar. Verifique se o horário já passou ou se o agendamento foi alterado.']);
        $revoke=$db->prepare('UPDATE appointment_access_tokens SET revoked_at=NOW() WHERE token_hash=:hash'); $revoke->execute(['hash'=>$hash]); Http::json(200,['ok'=>true,'data'=>$row]);
    }

    if ($method === 'GET' && preg_match('#^/api/public/clinics/([^/]+)(?:/services(?:/([^/]+)/professionals(?:/([^/]+)/availability)?)?)?$#', $path, $publicMatch)) {
        $slug = rawurldecode($publicMatch[1]);
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug) || strlen($slug) < 3 || strlen($slug) > 63) Http::json(404, ['ok'=>false,'message'=>'Página de agendamento não encontrada.']);
        $db = Database::connection();
        $clinicStmt = $db->prepare("SELECT c.id,COALESCE(NULLIF(trim(cc.name),''),NULLIF(trim(c.trade_name),''),c.name) AS name,cc.phone,cc.whatsapp,cc.address_line1 AS address,cc.email,cc.timezone,(SELECT value->>'privacyPolicyUrl' FROM settings WHERE clinic_id=c.id AND key='privacy_profile') AS privacy_policy_url FROM clinic_configurations cc JOIN clinics c ON c.id=cc.clinic_id JOIN LATERAL (SELECT status,current_period_start,current_period_end,trial_ends_at FROM subscriptions WHERE clinic_id=c.id ORDER BY created_at DESC LIMIT 1) sub ON sub.status IN ('active','trialing') AND sub.current_period_start <= NOW() AND sub.current_period_end > NOW() AND (sub.status <> 'trialing' OR sub.trial_ends_at > NOW()) WHERE cc.public_slug=:slug AND c.status='active'");
        $clinicStmt->execute(['slug'=>$slug]); $clinic = $clinicStmt->fetch();
        if (!$clinic || trim((string)$clinic['name']) === '') Http::json(404, ['ok'=>false,'message'=>'Página de agendamento não encontrada.']);
        if ($path === '/api/public/clinics/' . $publicMatch[1]) {
            $privacyPolicyUrl = is_string($clinic['privacy_policy_url'] ?? null) &&
                isValidPrivacyPolicyUrl($clinic['privacy_policy_url'])
                ? $clinic['privacy_policy_url']
                : null;
            Http::json(200, ['ok'=>true,'data'=>['name'=>$clinic['name'],'phone'=>$clinic['phone'],'whatsapp'=>$clinic['whatsapp'],'address'=>$clinic['address'],'email'=>$clinic['email'],'timezone'=>$clinic['timezone'],'privacyPolicyUrl'=>$privacyPolicyUrl]]);
        }
        $serviceId = $publicMatch[2] ?? null;
        if (str_ends_with($path, '/services')) {
            $stmt = $db->prepare("SELECT s.id,s.name,s.duration_minutes,s.price FROM services s WHERE s.clinic_id=:clinic AND s.is_active=TRUE AND EXISTS (SELECT 1 FROM professional_services ps JOIN professionals p ON p.id=ps.professional_id AND p.clinic_id=ps.clinic_id WHERE ps.clinic_id=s.clinic_id AND ps.service_id=s.id AND p.status='active') ORDER BY s.name");
            $stmt->execute(['clinic'=>$clinic['id']]); Http::json(200,['ok'=>true,'data'=>$stmt->fetchAll()]);
        }
        if (!is_string($serviceId) || !isUuid($serviceId)) Http::json(400,['ok'=>false,'message'=>'Serviço inválido.']);
        if (empty($publicMatch[3])) {
            $stmt=$db->prepare("SELECT p.id,p.name FROM services s JOIN professional_services ps ON ps.service_id=s.id AND ps.clinic_id=s.clinic_id JOIN professionals p ON p.id=ps.professional_id AND p.clinic_id=ps.clinic_id WHERE s.id=:service AND s.clinic_id=:clinic AND s.is_active=TRUE AND p.status='active' ORDER BY p.name");
            $stmt->execute(['service'=>$serviceId,'clinic'=>$clinic['id']]); Http::json(200,['ok'=>true,'data'=>$stmt->fetchAll()]);
        }
        $professionalId = $publicMatch[3];
        if (!isUuid($professionalId)) Http::json(400,['ok'=>false,'message'=>'Serviço ou profissional inválido.']);
        $date = $_GET['date'] ?? null; $day = is_string($date) ? clinicDayBounds($date, $clinic['timezone'] ?: 'UTC') : null;
        if (!$day) Http::json(400,['ok'=>false,'message'=>'Data inválida.']);
        $eligible=$db->prepare("SELECT s.duration_minutes FROM services s JOIN professional_services ps ON ps.service_id=s.id AND ps.clinic_id=s.clinic_id JOIN professionals p ON p.id=ps.professional_id AND p.clinic_id=ps.clinic_id WHERE s.id=:service AND s.clinic_id=:clinic AND p.id=:professional AND p.status='active' AND s.is_active=TRUE");
        $eligible->execute(['service'=>$serviceId,'clinic'=>$clinic['id'],'professional'=>$professionalId]); $duration=$eligible->fetchColumn();
        if ($duration === false) Http::json(404,['ok'=>false,'message'=>'Serviço ou profissional indisponível.']);
        $schedules=$db->prepare("SELECT weekday,start_time,end_time,duration_minutes,break_duration_minutes,status FROM professional_schedules WHERE clinic_id=:clinic AND professional_id=:professional AND status='active' ORDER BY weekday,start_time"); $schedules->execute(['clinic'=>$clinic['id'],'professional'=>$professionalId]);
        $blocks=$db->prepare("SELECT start_datetime,end_datetime,status FROM schedule_blocks WHERE clinic_id=:clinic AND professional_id=:professional AND status='active' AND start_datetime < :ends AND end_datetime > :starts"); $blocks->execute(['clinic'=>$clinic['id'],'professional'=>$professionalId,'starts'=>$day['startUtc'],'ends'=>$day['endUtc']]);
        $appointments=$db->prepare("SELECT id,scheduled_start,scheduled_end,status FROM appointments WHERE clinic_id=:clinic AND professional_id=:professional AND status NOT IN ('cancelled','rescheduled') AND scheduled_start < :ends AND scheduled_end > :starts"); $appointments->execute(['clinic'=>$clinic['id'],'professional'=>$professionalId,'starts'=>$day['startUtc'],'ends'=>$day['endUtc']]);
        Http::json(200,['ok'=>true,'data'=>generateClinicSlots($date,$schedules->fetchAll(),$blocks->fetchAll(),$appointments->fetchAll(),$clinic['timezone'] ?: 'UTC',(int)$duration)]);
    }

    Http::json(404, ['ok' => false, 'message' => 'Rota não encontrada.']);
} catch (Noa\ApiException $error) {
    Http::json($error->status, ['ok' => false, 'message' => $error->getMessage()]);
} catch (PDOException $error) {
    if ($error->getCode() === '23505') Http::json(409, ['ok' => false, 'message' => 'Já existe um registro com esses dados nesta clínica.']);
    error_log(sprintf('[%s] PHP database failure: %s', $requestId, $error->getCode()));
    Http::json(503, ['ok' => false, 'message' => 'Serviço temporariamente indisponível.']);
} catch (Throwable $error) {
    error_log(sprintf('[%s] PHP API failure: %s', $requestId, get_class($error)));
    Http::json(503, ['ok' => false, 'message' => 'Serviço temporariamente indisponível.']);
}

function loadPhpPublicConfirmation(PDO $db, string $clinicId, string $code): array
{
    $stmt=$db->prepare("SELECT a.code,a.service_name_snapshot,a.service_price_snapshot,a.service_duration_snapshot,a.scheduled_start,a.scheduled_end,p.name AS patient_name,p.phone AS patient_phone,p.email AS patient_email,pr.name AS professional_name,COALESCE(NULLIF(trim(cc.name),''),NULLIF(trim(c.trade_name),''),c.name) AS public_name,cc.phone AS public_phone,cc.whatsapp AS public_whatsapp,cc.address_line1 AS public_address FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id JOIN professionals pr ON pr.id=a.professional_id AND pr.clinic_id=a.clinic_id JOIN clinics c ON c.id=a.clinic_id JOIN clinic_configurations cc ON cc.clinic_id=c.id WHERE a.clinic_id=:clinic AND a.code=:code");
    $stmt->execute(['clinic'=>$clinicId,'code'=>$code]); $row=$stmt->fetch();
    if (!$row) throw new Noa\ApiException(500,'Não foi possível carregar a confirmação.');
    return [
        'code'=>$row['code'],
        'clinic'=>['name'=>$row['public_name'],'phone'=>$row['public_phone'],'whatsapp'=>$row['public_whatsapp'],'address'=>$row['public_address']],
        'service'=>['name'=>$row['service_name_snapshot'],'durationMinutes'=>(int)$row['service_duration_snapshot'],'price'=>(float)$row['service_price_snapshot']],
        'professional'=>['name'=>$row['professional_name']],
        'scheduledStart'=>(new DateTimeImmutable($row['scheduled_start']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),
        'scheduledEnd'=>(new DateTimeImmutable($row['scheduled_end']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),
        'customer'=>['name'=>$row['patient_name'],'phone'=>$row['patient_phone'],'email'=>$row['patient_email']],
    ];
}

function isoMilliseconds(string $value): ?int
{
    try { $date=new DateTimeImmutable($value); return ((int)$date->format('U')*1000)+(int)floor((int)$date->format('u')/1000); } catch (Throwable) { return null; }
}

function createClinicSession(array $user): array
{
    $db = Database::connection();
    $stmt = $db->prepare("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = :id AND clinic_id = :clinic AND status = 'active' RETURNING token_version");
    $stmt->execute(['id' => $user['id'], 'clinic' => $user['clinic_id']]);
    $version = $stmt->fetchColumn();
    if ($version === false) throw new Noa\ApiException(401, 'Credenciais inválidas.');
    $secret = getenv('JWT_SECRET') ?: '';
    $token = Jwt::sign([
        'sub' => $user['id'], 'clinicId' => $user['clinic_id'], 'sessionVersion' => (int)$version,
    ], Jwt::ttl(), Jwt::audience());
    return ['token' => $token, 'user' => [
        'id' => $user['id'], 'clinicId' => $user['clinic_id'], 'name' => $user['name'],
        'email' => $user['email'], 'role' => $user['role'], 'clinic_timezone' => $user['clinic_timezone'] ?? 'UTC',
    ]];
}

function clinicCookieOptions(int $expires): array
{
    $sameSite = strtolower(trim(getenv('SESSION_COOKIE_SAME_SITE') ?: 'lax'));
    if (!in_array($sameSite, ['lax', 'strict', 'none'], true)) {
        throw new RuntimeException('SESSION_COOKIE_SAME_SITE must be lax, strict, or none.');
    }
    $secure = Noa\runtimeEnvironment() === 'production' || (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off');
    if ($sameSite === 'none' && !$secure) {
        throw new RuntimeException('SameSite=None requires HTTPS.');
    }
    return [
        'expires' => $expires,
        'path' => '/api',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => ucfirst($sameSite),
    ];
}

function isValidPrivacyPolicyUrl(string $url): bool
{
    $parts = parse_url($url);
    return filter_var($url, FILTER_VALIDATE_URL) !== false &&
        is_array($parts) &&
        strtolower($parts['scheme'] ?? '') === 'https' &&
        !empty($parts['host']) &&
        !isset($parts['user']) &&
        !isset($parts['pass']);
}

function issueCsrfCookie(): string
{
    $current = $_COOKIE['clinic_csrf'] ?? '';
    $token = is_string($current) && preg_match('/^[A-Za-z0-9_-]{43}$/', $current)
        ? $current
        : rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $options = clinicCookieOptions(0);
    unset($options['expires']);
    $options['httponly'] = false;
    setcookie('clinic_csrf', $token, $options);
    return $token;
}

function requireCsrfProtection(): void
{
    $expectedOrigin = getenv('CORS_ORIGIN') ?: 'http://localhost:5173';
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $cookieToken = $_COOKIE['clinic_csrf'] ?? '';
    $headerToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($origin) || !hash_equals($expectedOrigin, $origin) ||
        !is_string($cookieToken) || !is_string($headerToken) ||
        !preg_match('/^[A-Za-z0-9_-]{43}$/', $cookieToken) ||
        !hash_equals($cookieToken, $headerToken)) {
        throw new Noa\ApiException(403, 'Solicitação não autorizada.');
    }
}

function respondWithClinicSession(array $session): never
{
    $token = $session['token'] ?? null;
    if (!is_string($token) || $token === '' || !is_array($session['user'] ?? null)) {
        throw new RuntimeException('Clinic session could not be issued.');
    }
    setcookie('clinic_session', $token, clinicCookieOptions(time() + Jwt::ttl()));
    Http::json(200, ['ok' => true, 'data' => ['user' => $session['user']]]);
}

function clearClinicSessionCookie(): void
{
    setcookie('clinic_session', '', clinicCookieOptions(time() - 3600));
}

function authenticatedUser(): array
{
    $cookieToken = $_COOKIE['clinic_session'] ?? '';
    $cookieSession = is_string($cookieToken) && $cookieToken !== '';
    if ($cookieSession) {
        $token = $cookieToken;
    } else {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) throw new Noa\ApiException(401, 'Token ausente.');
        $token = trim($matches[1]);
    }
    $claims = Jwt::verify($token, Jwt::audience());
    if ($cookieSession && !in_array(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), ['GET', 'HEAD', 'OPTIONS'], true)) {
        requireCsrfProtection();
    }
    if (!is_string($claims['sub'] ?? null) || $claims['sub'] === '' ||
        !is_string($claims['clinicId'] ?? null) || $claims['clinicId'] === '' ||
        !Noa\isValidSessionVersion($claims['sessionVersion'] ?? null)) {
        throw new Noa\ApiException(401, 'Token inválido ou expirado.');
    }
    $stmt = Database::connection()->prepare(
        "SELECT u.id, u.clinic_id, u.name, u.email, u.role, u.phone, u.status, u.last_login_at, u.token_version,
                COALESCE((SELECT timezone FROM clinic_configurations WHERE clinic_id = u.clinic_id), 'UTC') AS clinic_timezone
         FROM users u WHERE u.id = :id AND u.clinic_id = :clinic"
    );
    $stmt->execute(['id' => $claims['sub'], 'clinic' => $claims['clinicId']]);
    $user = $stmt->fetch();
    return Noa\validateAuthenticatedClinicUser($claims, $user ?: null);
}

function requireClinicAccess(array $roles = []): array
{
    $user = authenticatedUser();
    if ($roles !== []) requireRole($user, $roles);
    $db = Database::connection();
    if (!beginClinicAccessLock($db, $user['clinic_id'])) {
        throw new Noa\ApiException(403, 'Esta clínica não possui uma assinatura ativa para usar os recursos.');
    }
    return $user;
}

function beginClinicAccessLock(PDO $db, string $clinicId): bool
{
    $db->beginTransaction();
    try {
        $stmt = $db->prepare(
        'SELECT c.status AS clinic_status, s.status AS subscription_status,
                s.current_period_start, s.current_period_end, s.trial_ends_at
         FROM clinics c
         LEFT JOIN LATERAL (
             SELECT status, current_period_start, current_period_end, trial_ends_at
             FROM subscriptions
             WHERE clinic_id = c.id
             ORDER BY created_at DESC
             LIMIT 1
         ) s ON TRUE
         WHERE c.id = :clinic
         FOR SHARE OF c'
        );
        $stmt->execute(['clinic' => $clinicId]);
        $subscription = $stmt->fetch();
        $now = time();
        $active = $subscription && $subscription['clinic_status'] === 'active' &&
            in_array($subscription['subscription_status'], ['active', 'trialing'], true) &&
            strtotime((string)$subscription['current_period_start']) <= $now && strtotime((string)$subscription['current_period_end']) > $now &&
            ($subscription['subscription_status'] !== 'trialing' || ($subscription['trial_ends_at'] !== null && strtotime($subscription['trial_ends_at']) > $now));
        if (!$active) {
            $db->rollBack();
            return false;
        }
        $GLOBALS['clinicAccessFinalize'] = static function (bool $commit) use ($db): void {
            if (!$db->inTransaction()) return;
            try {
                if ($commit) $db->commit();
                else $db->rollBack();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        };
        return true;
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function releaseClinicAccessLock(PDO $db): void
{
    if (!$db->inTransaction()) throw new RuntimeException('Clinic access transaction is not active.');
    $db->commit();
    unset($GLOBALS['clinicAccessFinalize']);
}

function reacquireClinicAccessLock(PDO $db, string $clinicId): void
{
    if (!beginClinicAccessLock($db, $clinicId)) {
        throw new Noa\ApiException(403, 'Esta clínica não possui uma assinatura ativa para usar os recursos.');
    }
}

function beginClinicOperation(PDO $db): void
{
    $stack = $GLOBALS['clinicOperationSavepoints'] ?? [];
    if (!$db->inTransaction()) {
        $db->beginTransaction();
        $stack[] = null;
    } else {
        $name = 'clinic_operation_' . count($stack);
        $db->exec('SAVEPOINT ' . $name);
        $stack[] = $name;
    }
    $GLOBALS['clinicOperationSavepoints'] = $stack;
}

function commitClinicOperation(PDO $db): bool
{
    $stack = $GLOBALS['clinicOperationSavepoints'] ?? [];
    if ($stack === []) return $db->commit();
    $savepoint = array_pop($stack);
    $GLOBALS['clinicOperationSavepoints'] = $stack;
    if ($savepoint === null) return $db->commit();
    $db->exec('RELEASE SAVEPOINT ' . $savepoint);
    return true;
}

function rollBackClinicOperation(PDO $db): bool
{
    $stack = $GLOBALS['clinicOperationSavepoints'] ?? [];
    if ($stack === []) return $db->rollBack();
    $savepoint = array_pop($stack);
    $GLOBALS['clinicOperationSavepoints'] = $stack;
    if ($savepoint === null) return $db->rollBack();
    $db->exec('ROLLBACK TO SAVEPOINT ' . $savepoint);
    $db->exec('RELEASE SAVEPOINT ' . $savepoint);
    return true;
}

function requireRole(array $user, array $roles): void
{
    if (!in_array($user['role'] ?? '', $roles, true)) throw new Noa\ApiException(403, 'Você não tem permissão para esta ação.');
}

function requirePlanCapability(array $user, string $capability): void
{
    $stmt = Database::connection()->prepare('SELECT plan FROM subscriptions WHERE clinic_id = :clinic ORDER BY created_at DESC LIMIT 1');
    $stmt->execute(['clinic' => $user['clinic_id']]);
    $plan = $stmt->fetchColumn();
    if (!is_string($plan) || !Noa\PlanCatalog::capabilityIsAvailable($plan, $capability)) {
        throw new Noa\ApiException(403, 'Este recurso está disponível a partir do plano Profissional.');
    }
}

function isUuid(string $value): bool
{
    return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1;
}

function validateEntityBody(array $body, array $allowed, array $required, array $limits, bool $requireTruthy = false): void
{
    if (array_diff(array_keys($body), $allowed) || array_diff($required, array_keys($body)) || ($requireTruthy && !array_filter($body))) Http::json(400, ['ok' => false, 'message' => 'Dados inválidos ou campos não permitidos.']);
    foreach ($required as $field) if (!is_string($body[$field]) || trim($body[$field]) === '') Http::json(400, ['ok' => false, 'message' => 'Dados inválidos ou campos não permitidos.']);
    foreach ($limits as $field => $max) if (array_key_exists($field, $body) && $body[$field] !== null && (!is_string($body[$field]) || textLength($body[$field]) > $max || str_contains($body[$field], "\0"))) Http::json(400, ['ok' => false, 'message' => 'Dados inválidos ou campos não permitidos.']);
    if (isset($body['name']) && (!is_string($body['name']) || trim($body['name']) === '')) Http::json(400, ['ok' => false, 'message' => 'Dados inválidos ou campos não permitidos.']);
}

function validateProfessionalBody(array $body, bool $creating): void
{
    $allowed = ['name', 'specialtyId', 'userId', 'crm', 'phone', 'status'];
    if (array_diff(array_keys($body), $allowed) || ($creating && (!is_string($body['name'] ?? null) || $body['name'] === '' || textLength($body['name']) > 200 || !is_string($body['specialtyId'] ?? null) || !isUuid($body['specialtyId'])))) Http::json(400, ['ok' => false, 'message' => 'Dados de profissional inválidos.']);
    foreach (['name' => 200, 'crm' => 50, 'phone' => 20] as $field => $max) if (array_key_exists($field, $body) && $body[$field] !== null && (!is_string($body[$field]) || textLength($body[$field]) > $max || str_contains($body[$field], "\0"))) Http::json(400, ['ok' => false, 'message' => 'Dados de profissional inválidos.']);
    if (isset($body['specialtyId']) && $body['specialtyId'] !== '' && !isUuid((string)$body['specialtyId'])) Http::json(400, ['ok' => false, 'message' => 'Dados de profissional inválidos.']);
    if (isset($body['userId']) && $body['userId'] !== '' && !isUuid((string)$body['userId'])) Http::json(400, ['ok' => false, 'message' => 'Dados de profissional inválidos.']);
    if (array_key_exists('status', $body) && !in_array($body['status'], ['active', 'inactive'], true)) Http::json(400, ['ok' => false, 'message' => 'Dados de profissional inválidos.']);
    if (!$creating && !array_filter($body)) Http::json(400, ['ok' => false, 'message' => 'Dados de profissional inválidos.']);
}

function validateServiceBody(array $body, bool $creating, bool $assignmentOnly = false): void
{
    $allowed = $assignmentOnly ? ['professionalIds'] : ['name', 'description', 'durationMinutes', 'price', 'professionalIds'];
    if ($assignmentOnly && !array_key_exists('professionalIds', $body)) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    if (array_diff(array_keys($body), $allowed) || ($creating && (!isset($body['name']) || !is_string($body['name']) || trim($body['name']) === '' || jsStringLength(trim($body['name'])) > 200 || !array_key_exists('durationMinutes', $body) || !is_int($body['durationMinutes']) || $body['durationMinutes'] < 1 || $body['durationMinutes'] > 1440 || !array_key_exists('price', $body) || !is_numeric($body['price']) || is_string($body['price']) || !is_finite((float)$body['price']) || (float)$body['price'] < 0 || (float)$body['price'] > 99999999.99 || round((float)$body['price'], 2) !== (float)$body['price']))) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    if (!$creating && $body === []) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    if (array_key_exists('name', $body) && (!is_string($body['name']) || trim($body['name']) === '' || jsStringLength(trim($body['name'])) > 200)) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    if (array_key_exists('description', $body) && $body['description'] !== null && (!is_string($body['description']) || jsStringLength($body['description']) > 2000)) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    if (array_key_exists('durationMinutes', $body) && (!is_int($body['durationMinutes']) || $body['durationMinutes'] < 1 || $body['durationMinutes'] > 1440)) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    if (array_key_exists('price', $body) && (!is_numeric($body['price']) || is_string($body['price']) || !is_finite((float)$body['price']) || (float)$body['price'] < 0 || (float)$body['price'] > 99999999.99 || round((float)$body['price'], 2) !== (float)$body['price'])) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    if (array_key_exists('professionalIds', $body)) {
        $ids = $body['professionalIds'];
        if (!is_array($ids) || !array_is_list($ids) || count(array_unique($ids)) !== count($ids)) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
        foreach ($ids as $id) if (!is_string($id) || !isUuid($id)) Http::json(400, ['ok' => false, 'message' => 'Dados de serviço inválidos ou campos não permitidos.']);
    }
}

function serviceListingSql(bool $single, string $role): string
{
    $scope = $role === 'patient' ? 'AND s.is_active AND EXISTS (SELECT 1 FROM professional_services x JOIN professionals p ON p.id=x.professional_id AND p.clinic_id=x.clinic_id WHERE x.clinic_id=s.clinic_id AND x.service_id=s.id AND p.status=\'active\')' : ($role === 'professional' ? 'AND EXISTS (SELECT 1 FROM professional_services x JOIN professionals p ON p.id=x.professional_id AND p.clinic_id=x.clinic_id WHERE x.clinic_id=s.clinic_id AND x.service_id=s.id AND p.user_id=:user AND p.status=\'active\')' : '');
    return 'SELECT s.*, COALESCE(json_agg(p.id) FILTER (WHERE p.id IS NOT NULL), \'[]\'::json) AS professional_ids FROM services s LEFT JOIN professional_services ps ON ps.clinic_id=s.clinic_id AND ps.service_id=s.id LEFT JOIN professionals p ON p.clinic_id=ps.clinic_id AND p.id=ps.professional_id AND p.status=\'active\' WHERE s.clinic_id=:clinic ' . ($single ? 'AND s.id=:id ' : '') . $scope . ' GROUP BY s.id ' . ($single ? '' : 'ORDER BY s.name ASC');
}

function assertProfessionalIds(PDO $db, string $clinicId, array $ids): void
{
    foreach (array_unique($ids) as $id) {
        $stmt = $db->prepare("SELECT 1 FROM professionals WHERE id=:id AND clinic_id=:clinic AND status='active'");
        $stmt->execute(['id' => $id, 'clinic' => $clinicId]);
        if (!$stmt->fetchColumn()) throw new Noa\ApiException(400, 'Um ou mais profissionais não pertencem a esta clínica ou estão inativos.');
    }
}

function syncServiceProfessionals(PDO $db, string $clinicId, string $userId, string $serviceId, array $requested): void
{
    $stmt = $db->prepare('SELECT professional_id FROM professional_services WHERE clinic_id=:clinic AND service_id=:service FOR UPDATE');
    $stmt->execute(['clinic' => $clinicId, 'service' => $serviceId]); $existing = array_column($stmt->fetchAll(), 'professional_id');
    $delete = $db->prepare('DELETE FROM professional_services WHERE clinic_id=:clinic AND service_id=:service');
    $delete->execute(['clinic' => $clinicId, 'service' => $serviceId]);
    $insert = $db->prepare('INSERT INTO professional_services (clinic_id,professional_id,service_id) VALUES (:clinic,:professional,:service)');
    foreach ($requested as $id) {
        $insert->execute(['clinic' => $clinicId, 'professional' => $id, 'service' => $serviceId]);
        if (!in_array($id, $existing, true)) writeAudit($db, $clinicId, $userId, 'services', $serviceId, 'professional_assigned', ['professionalId' => $id]);
    }
    foreach ($existing as $id) if (!in_array($id, $requested, true)) writeAudit($db, $clinicId, $userId, 'services', $serviceId, 'professional_unassigned', ['professionalId' => $id]);
}

function validateScheduleBody(array $body): void
{
    $allowed = ['weekday', 'startTime', 'endTime', 'durationMinutes', 'breakDurationMinutes'];
    if (array_diff(array_keys($body), $allowed) || !array_key_exists('weekday', $body) || !array_key_exists('startTime', $body) || !array_key_exists('endTime', $body) || !array_key_exists('durationMinutes', $body)) Http::json(400, ['ok' => false, 'message' => 'Informe dia, horários válidos e duração positiva; o término deve ser posterior ao início.']);
    $weekday = filter_var($body['weekday'], FILTER_VALIDATE_INT); $duration = filter_var($body['durationMinutes'], FILTER_VALIDATE_INT); $break = filter_var($body['breakDurationMinutes'] ?? 0, FILTER_VALIDATE_INT);
    $start = is_string($body['startTime']) ? timeSeconds($body['startTime']) : null; $end = is_string($body['endTime']) ? timeSeconds($body['endTime']) : null;
    if ($weekday === false || $weekday < 1 || $weekday > 7 || $duration === false || $duration <= 0 || $break === false || $break < 0 || $start === null || $end === null || $end <= $start) Http::json(400, ['ok' => false, 'message' => 'Informe dia, horários válidos e duração positiva; o término deve ser posterior ao início.']);
}

function validateScheduleBlockBody(array $body): void
{
    $allowed = ['blockType', 'startDatetime', 'endDatetime', 'reason'];
    if (array_diff(array_keys($body), $allowed) || !in_array($body['blockType'] ?? null, ['vacation', 'holiday', 'meeting', 'absence', 'custom'], true) || !is_string($body['startDatetime'] ?? null) || !is_string($body['endDatetime'] ?? null) || !validIsoInterval($body['startDatetime'], $body['endDatetime']) || (isset($body['reason']) && !is_string($body['reason']))) Http::json(400, ['ok' => false, 'message' => 'blockType, startDatetime e endDatetime são obrigatórios.']);
}

function assertProfessionalExists(string $clinicId, string $professionalId): void
{
    $stmt = Database::connection()->prepare('SELECT 1 FROM professionals WHERE id=:id AND clinic_id=:clinic'); $stmt->execute(['id' => $professionalId, 'clinic' => $clinicId]);
    if (!$stmt->fetchColumn()) Http::json(404, ['ok' => false, 'message' => 'Profissional não encontrado nesta clínica.']);
}

function timeSeconds(string $value): ?int
{
    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/', $value)) return null;
    [$hours, $minutes, $rest] = array_pad(explode(':', $value, 3), 3, '0');
    $seconds = (float)$rest;
    return ((int)$hours * 3600) + ((int)$minutes * 60) + (int)$seconds;
}

function timeMilliseconds(string $value): ?int
{
    if (!preg_match('/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/', $value, $m) || (int)$m[1] > 23 || (int)$m[2] > 59 || (int)($m[3] ?? 0) > 59) return null;
    $fraction = (int)str_pad(substr($m[4] ?? '', 0, 3), 3, '0');
    return ((int)$m[1] * 3600000) + ((int)$m[2] * 60000) + ((int)($m[3] ?? 0) * 1000) + $fraction;
}

function validIsoInterval(string $start, string $end): bool
{
    try {
        if (!validIsoTimestamp($start) || !validIsoTimestamp($end)) return false;
        $a = new DateTimeImmutable($start); $b = new DateTimeImmutable($end);
        return isoMilliseconds($end) > isoMilliseconds($start);
    } catch (Throwable) { return false; }
}

function validIsoTimestamp(string $value): bool
{
    $pattern = '/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/i';
    if (!preg_match($pattern, $value, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1]) || (int)$m[4] > 23 || (int)$m[5] > 59 || (int)$m[6] > 59) return false;
    if (strtoupper($m[7] ?? '') === 'Z') return true;
    $offsetHours = (int)($m[9] ?? -1);
    $offsetMinutes = (int)($m[10] ?? -1);
    return $offsetHours >= 0 && $offsetHours <= 23 && $offsetMinutes >= 0 && $offsetMinutes <= 59;
}

function clinicDayBounds(string $date, string $timezone): ?array
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return null;
    try {
        $zone = new DateTimeZone($timezone); $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, $zone);
        if (!$parsed || $parsed->format('Y-m-d') !== $date) return null;
        $start = $parsed->setTime(0, 0); $end = $start->modify('+1 day');
        return ['date' => $date, 'weekday' => (int)$start->format('N'), 'startUtc' => $start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:sP'), 'endUtc' => $end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:sP')];
    } catch (Throwable) { return null; }
}

function uniqueClinicInstant(string $value, string $timezone): bool
{
    try {
        if (!validIsoTimestamp($value)) return false;
        $zone = new DateTimeZone($timezone); $instant = new DateTimeImmutable($value); $local = $instant->setTimezone($zone)->format('Y-m-d H:i:s');
        $wall = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $local, new DateTimeZone('UTC'))->getTimestamp();
        $transitions = $zone->getTransitions($instant->getTimestamp() - 86400, $instant->getTimestamp() + 86400);
        $offsets = array_unique(array_map(static fn(array $t): int => (int)$t['offset'], $transitions ?: [['offset' => $instant->getOffset()]]));
        $candidates = [];
        foreach ($offsets as $offset) {
            $candidate = $wall - $offset;
            if ((new DateTimeImmutable('@' . $candidate))->setTimezone($zone)->format('Y-m-d H:i:s') === $local) $candidates[$candidate] = true;
        }
        return count($candidates) === 1 && isset($candidates[$instant->getTimestamp()]);
    } catch (Throwable) { return false; }
}

function generateClinicSlots(string $date, array $schedules, array $blocks, array $appointments, string $timezone, ?int $requestedDuration): array
{
    $day = clinicDayBounds($date, $timezone); if (!$day) return [];
    $slots = [];
    foreach ($schedules as $schedule) {
        if ($schedule['status'] !== 'active' || (int)$schedule['weekday'] !== $day['weekday']) continue;
        $start = timeSeconds((string)$schedule['start_time']); $end = timeSeconds((string)$schedule['end_time']);
        $duration = $requestedDuration ?? (int)$schedule['duration_minutes']; $break = (int)($schedule['break_duration_minutes'] ?? 0);
        if ($start === null || $end === null || $duration <= 0 || $break < 0) continue;
        $step = ($duration + $break) * 60;
        for ($localStart = $start; $localStart + $duration * 60 <= $end; $localStart += $step) {
            $localDateTime = (new DateTimeImmutable($date . ' 00:00:00', new DateTimeZone('UTC')))->modify('+' . $localStart . ' seconds')->format('Y-m-d H:i:s');
            $localEndDateTime = (new DateTimeImmutable($localDateTime, new DateTimeZone('UTC')))->modify('+' . ($duration * 60) . ' seconds')->format('Y-m-d H:i:s');
            $candidateStart = localDateTimeInstant($localDateTime, $timezone); $candidateEnd = localDateTimeInstant($localEndDateTime, $timezone);
            if ($candidateStart === null || $candidateEnd === null || $candidateEnd - $candidateStart !== $duration * 60 || !uniqueClinicInstant((new DateTimeImmutable('@' . $candidateStart))->format(DATE_ATOM), $timezone) || !uniqueClinicInstant((new DateTimeImmutable('@' . $candidateEnd))->format(DATE_ATOM), $timezone)) continue;
            $blocked = false;
            foreach (array_merge($blocks, $appointments) as $item) {
                $itemStart = (new DateTimeImmutable($item['start_datetime'] ?? $item['scheduled_start']))->getTimestamp();
                $itemEnd = (new DateTimeImmutable($item['end_datetime'] ?? $item['scheduled_end']))->getTimestamp();
                if ($candidateStart < $itemEnd && $candidateEnd > $itemStart) { $blocked = true; break; }
            }
            if ($blocked) continue;
            $startIso = gmdate('Y-m-d\TH:i:s\Z', $candidateStart); $endIso = gmdate('Y-m-d\TH:i:s\Z', $candidateEnd);
            $slots[$startIso] = ['scheduledStart' => $startIso, 'scheduledEnd' => $endIso, 'durationMinutes' => $duration];
        }
    }
    ksort($slots); return array_values($slots);
}

function localDateTimeInstant(string $localDateTime, string $timezone): ?int
{
    try {
        $zone = new DateTimeZone($timezone); $wall = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $localDateTime, new DateTimeZone('UTC'));
        if (!$wall) return null;
        $wallTs = $wall->getTimestamp();
        $transitions = $zone->getTransitions($wallTs - 172800, $wallTs + 172800);
        $offsets = array_unique(array_map(static fn(array $t): int => (int)$t['offset'], $transitions ?: [['offset' => $zone->getOffset($wall)]]));
        $candidates = [];
        foreach ($offsets as $offset) {
            $candidate = $wallTs - $offset;
            if ((new DateTimeImmutable('@' . $candidate))->setTimezone($zone)->format('Y-m-d H:i:s') === $localDateTime) $candidates[] = $candidate;
        }
        return count(array_unique($candidates)) === 1 ? $candidates[0] : null;
    } catch (Throwable) { return null; }
}

function appointmentSelectSql(): string
{
    return 'SELECT a.*,p.name AS patient_name,pr.name AS professional_name,s.name AS specialty_name FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id AND p.clinic_id=a.clinic_id LEFT JOIN professionals pr ON pr.id=a.professional_id AND pr.clinic_id=a.clinic_id LEFT JOIN specialties s ON s.id=a.specialty_id AND s.clinic_id=a.clinic_id';
}

function validateCreateAppointment(array $body): void
{
    $allowed = ['patientId','professionalId','specialtyId','serviceId','scheduledStart','scheduledEnd','notes'];
    if (array_diff(array_keys($body), $allowed) || !isUuidValue($body['patientId'] ?? null) || !isUuidValue($body['professionalId'] ?? null) || !isUuidValue($body['serviceId'] ?? null) || !is_string($body['scheduledStart'] ?? null) || !is_string($body['scheduledEnd'] ?? null) || (isset($body['specialtyId']) && !isUuidValue($body['specialtyId'])) || (array_key_exists('notes', $body) && $body['notes'] !== null && !is_string($body['notes']))) Http::json(400, ['ok' => false, 'message' => 'Dados de agendamento inválidos ou campos não permitidos.']);
}

function validateRescheduleAppointment(array $body): void
{
    $allowed = ['professionalId','specialtyId','serviceId','scheduledStart','scheduledEnd'];
    if (array_diff(array_keys($body), $allowed) || !isUuidValue($body['professionalId'] ?? null) || !is_string($body['scheduledStart'] ?? null) || !is_string($body['scheduledEnd'] ?? null) || (isset($body['specialtyId']) && !isUuidValue($body['specialtyId'])) || (array_key_exists('serviceId', $body) && !isUuidValue($body['serviceId']))) Http::json(400, ['ok' => false, 'message' => 'Dados de reagendamento inválidos ou campos não permitidos.']);
}

function isUuidValue(mixed $value): bool { return is_string($value) && isUuid($value); }

function validWaitlistEntry(array $body): bool
{
    $allowed=['serviceId','professionalId','name','phone','email','preferredFrom','preferredTo','preferredPeriod','consent'];
    $name=$body['name'] ?? null; $phone=$body['phone'] ?? null; $email=$body['email'] ?? null; $from=$body['preferredFrom'] ?? null; $to=$body['preferredTo'] ?? null;
    $validDate=static fn($date): bool => is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/',$date)===1 && checkdate((int)substr($date,5,2),(int)substr($date,8,2),(int)substr($date,0,4));
    return !array_diff(array_keys($body),$allowed) && isUuidValue($body['serviceId'] ?? null) && (($body['professionalId'] ?? null)===null || ($body['professionalId'] ?? '')==='' || isUuidValue($body['professionalId'])) && is_string($name) && trim($name)!=='' && textLength($name)<=200 && is_string($phone) && trim($phone)!=='' && textLength($phone)<=20 && ($email===null || $email==='' || (is_string($email) && strlen($email)<=255 && preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/',trim($email)))) && $validDate($from) && $validDate($to) && $to >= $from && (!array_key_exists('preferredPeriod',$body) || in_array($body['preferredPeriod'],['morning','afternoon','evening','any'],true)) && ($body['consent'] ?? null)===true;
}

function isWaitlistStatus(array $body): bool
{
    return count($body)===1 && in_array($body['status'] ?? null,['offered','booked','cancelled'],true);
}

function loadBookableService(PDO $db, string $clinic, string $professional, string $serviceId, bool $allowInactive): ?array
{
    $stmt = $db->prepare("SELECT s.id,s.name,s.price,s.duration_minutes,s.is_active FROM services s JOIN professional_services ps ON ps.service_id=s.id AND ps.clinic_id=s.clinic_id JOIN professionals pr ON pr.id=ps.professional_id AND pr.clinic_id=ps.clinic_id WHERE s.id=:service AND s.clinic_id=:clinic AND ps.professional_id=:professional AND pr.status='active' AND (s.is_active=TRUE OR :allow=TRUE) FOR SHARE OF s,ps,pr");
    $stmt->execute(['service' => $serviceId, 'clinic' => $clinic, 'professional' => $professional, 'allow' => $allowInactive ? 'true' : 'false']);
    $row = $stmt->fetch(); return $row ?: null;
}

function lockProfessional(PDO $db, string $professionalId): void
{
    $stmt = $db->prepare('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))'); $stmt->execute(['key' => $professionalId]);
}

function hasExpectedDuration(string $start, string $end, int $duration): bool
{
    return isoMilliseconds($end) !== null && isoMilliseconds($start) !== null && isoMilliseconds($end) - isoMilliseconds($start) === $duration * 60000;
}

function assertAppointmentAvailable(PDO $db, string $clinic, string $professional, string $start, string $end, string $timezone, ?int $duration, ?string $excludeId = null): void
{
    if (!validIsoInterval($start, $end)) throw new Noa\ApiException(400, 'Intervalo de agendamento inválido.');
    if (!uniqueClinicInstant($start, $timezone) || !uniqueClinicInstant($end, $timezone)) throw new Noa\ApiException(400, 'Horário local inexistente ou ambíguo no fuso da clínica.');
    $startDt = new DateTimeImmutable($start); $endDt = new DateTimeImmutable($end); $zone = new DateTimeZone($timezone);
    $localStart = $startDt->setTimezone($zone); $localEnd = $endDt->setTimezone($zone);
    if ($localStart->format('Y-m-d') !== $localEnd->format('Y-m-d')) throw new Noa\ApiException(409, 'Horário fora da agenda de trabalho ou incompatível com a duração configurada.');
    $weekday = (int)$localStart->format('N'); $startMs = ((int)$localStart->format('G') * 3600000) + ((int)$localStart->format('i') * 60000) + ((int)$localStart->format('s') * 1000) + (int)floor((int)$localStart->format('u') / 1000); $endMs = ((int)$localEnd->format('G') * 3600000) + ((int)$localEnd->format('i') * 60000) + ((int)$localEnd->format('s') * 1000) + (int)floor((int)$localEnd->format('u') / 1000);
    $sql = "SELECT start_time,end_time,duration_minutes,break_duration_minutes FROM professional_schedules WHERE clinic_id=:clinic AND professional_id=:professional AND weekday=:weekday AND status='active'";
    $stmt = $db->prepare($sql); $stmt->execute(['clinic' => $clinic, 'professional' => $professional, 'weekday' => $weekday]); $schedules = $stmt->fetchAll();
    $matches = false;
    foreach ($schedules as $schedule) {
        $scheduleStart = timeMilliseconds((string)$schedule['start_time']); $scheduleEnd = timeMilliseconds((string)$schedule['end_time']); $slotDuration = $duration ?? (int)$schedule['duration_minutes']; $break = (int)$schedule['break_duration_minutes'];
        if ($scheduleStart !== null && $scheduleEnd !== null && $startMs >= $scheduleStart && $endMs <= $scheduleEnd && (isoMilliseconds($end) - isoMilliseconds($start)) === $slotDuration * 60000 && ($startMs - $scheduleStart) % (($slotDuration + $break) * 60000) === 0) { $matches = true; break; }
    }
    if (!$matches) throw new Noa\ApiException(409, 'Horário fora da agenda de trabalho ou incompatível com a duração configurada.');
    $conflictSql = "SELECT 1 FROM appointments WHERE clinic_id=:clinic AND professional_id=:professional AND status NOT IN ('cancelled','rescheduled') AND scheduled_start < :ends AND scheduled_end > :starts";
    $conflictParameters = ['clinic' => $clinic, 'professional' => $professional, 'starts' => $start, 'ends' => $end];
    if ($excludeId !== null) {
        $conflictSql .= ' AND id <> :exclude_id';
        $conflictParameters['exclude_id'] = $excludeId;
    }
    $conflict = $db->prepare($conflictSql . ' LIMIT 1');
    $conflict->execute($conflictParameters);
    if ($conflict->fetchColumn()) throw new Noa\ApiException(409, 'Esse horário já está ocupado.');
    $block = $db->prepare("SELECT 1 FROM schedule_blocks WHERE clinic_id=:clinic AND professional_id=:professional AND status='active' AND start_datetime < :ends AND end_datetime > :starts LIMIT 1");
    $block->execute(['clinic' => $clinic, 'professional' => $professional, 'starts' => $start, 'ends' => $end]);
    if ($block->fetchColumn()) throw new Noa\ApiException(409, 'Este horário está bloqueado para o profissional.');
}

function assertClinicReference(PDO $db, string $table, string $id, string $clinicId, string $message): void
{
    if (!in_array($table, ['specialties'], true)) throw new LogicException('Unsafe clinic reference table.');
    $stmt = $db->prepare("SELECT 1 FROM $table WHERE id = :id AND clinic_id = :clinic");
    $stmt->execute(['id' => $id, 'clinic' => $clinicId]);
    if (!$stmt->fetchColumn()) throw new Noa\ApiException(400, $message);
}

function assertClinicUser(PDO $db, string $id, string $clinicId, string $role, string $message): void
{
    $stmt = $db->prepare('SELECT 1 FROM users WHERE id = :id AND clinic_id = :clinic AND role = :role AND status = \'active\'');
    $stmt->execute(['id' => $id, 'clinic' => $clinicId, 'role' => $role]);
    if (!$stmt->fetchColumn()) throw new Noa\ApiException(400, $message);
}

function assertProfessionalLimit(PDO $db, string $clinicId): void
{
    $db->query("SELECT pg_advisory_xact_lock(hashtextextended('plan-limits:' || " . $db->quote($clinicId) . ", 0))");
    $sub = $db->prepare('SELECT plan,status,current_period_start,current_period_end,trial_ends_at FROM subscriptions WHERE clinic_id = :clinic ORDER BY created_at DESC LIMIT 1 FOR SHARE');
    $sub->execute(['clinic' => $clinicId]); $plan = $sub->fetch(); $now = time();
    if (!$plan || !in_array($plan['status'], ['active', 'trialing'], true) || strtotime($plan['current_period_start']) > $now || strtotime($plan['current_period_end']) <= $now || ($plan['status'] === 'trialing' && (!$plan['trial_ends_at'] || strtotime($plan['trial_ends_at']) <= $now))) throw new Noa\ApiException(403, 'Esta clínica não possui uma assinatura ativa para usar os recursos.');
    try {
        $limit = Noa\PlanCatalog::resourceLimit((string)$plan['plan'], 'professionals');
    } catch (InvalidArgumentException $error) {
        throw new Noa\ApiException(403, 'O plano desta clínica não está disponível para este recurso.');
    }
    if ($limit === null) return;
    $count = $db->prepare("SELECT COUNT(*) FROM professionals WHERE clinic_id = :clinic AND status = 'active'");
    $count->execute(['clinic' => $clinicId]);
    $current = (int)$count->fetchColumn();
    if ($current >= $limit) throw new Noa\ApiException(403, 'Você atingiu o limite de funcionários ativos do seu plano.');
}

function writeAudit(PDO $db, string $clinicId, ?string $userId, string $entity, string $entityId, string $action, array $details): void
{
    $stmt = $db->prepare('INSERT INTO audit_logs (clinic_id,user_id,entity_type,entity_id,action,details) VALUES (:clinic,:user,:entity,:entity_id,:action,CAST(:details AS jsonb))');
    $stmt->execute(['clinic' => $clinicId, 'user' => $userId, 'entity' => $entity, 'entity_id' => $entityId, 'action' => $action, 'details' => json_encode($details, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
}

function textLength(string $value): int
{
    $count = preg_match_all('/./us', $value, $matches);
    return $count === false ? PHP_INT_MAX : $count;
}

function validatePatientBody(array $body, bool $creating): void
{
    $allowed = $creating ? ['name', 'cpf', 'birthDate', 'phone', 'email', 'userId', 'status'] : ['name', 'cpf', 'birthDate', 'phone', 'email', 'status'];
    if (array_diff(array_keys($body), $allowed) || (!$creating && $body === [])) Http::json(400, ['ok' => false, 'message' => 'Dados do paciente inválidos.']);
    if ($creating && (!is_string($body['name'] ?? null) || trim($body['name']) === '' || textLength($body['name']) > 200)) Http::json(400, ['ok' => false, 'message' => 'Dados do paciente inválidos.']);
    if (!$creating && isset($body['name']) && (!is_string($body['name']) || textLength($body['name']) > 200)) Http::json(400, ['ok' => false, 'message' => 'Dados do paciente inválidos.']);
    foreach (['cpf' => 14, 'phone' => 20, 'email' => 255, 'status' => 20] as $field => $limit) {
        if (array_key_exists($field, $body) && $body[$field] !== null && (!is_string($body[$field]) || textLength($body[$field]) > $limit)) Http::json(400, ['ok' => false, 'message' => 'Dados do paciente inválidos.']);
    }
    if (array_key_exists('birthDate', $body) && $body['birthDate'] !== null && $body['birthDate'] !== '') {
        $date = is_string($body['birthDate']) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $body['birthDate']) : false;
        if (!$date || $date->format('Y-m-d') !== $body['birthDate']) Http::json(400, ['ok' => false, 'message' => 'Dados do paciente inválidos.']);
    }
    if (isset($body['userId']) && $body['userId'] !== '' && $body['userId'] !== null && (!is_string($body['userId']) || !isUuid($body['userId']))) Http::json(400, ['ok' => false, 'message' => 'Dados do paciente inválidos.']);
}

function enforceRequestRateLimit(string $namespace, int $points, int $durationSeconds, ?string $subject = null): void
{
    $identity = $namespace . '|' . ($subject ?? ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    $key = hash('sha256', $identity);
    $file = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'noa-api-' . $namespace . '-' . $key . '.json';
    $handle = fopen($file, 'c+');
    if ($handle === false) throw new Noa\ApiException(503, 'Serviço temporariamente indisponível.');
    try {
        if (!flock($handle, LOCK_EX)) throw new Noa\ApiException(503, 'Serviço temporariamente indisponível.');
        $raw = stream_get_contents($handle); $state = is_string($raw) ? json_decode($raw, true) : null; $now = time();
        $window = is_array($state) && ($now - (int)($state['start'] ?? 0)) < $durationSeconds ? $state : ['start' => $now, 'count' => 0];
        if ((int)$window['count'] >= $points) throw new Noa\ApiException(429, 'Muitas tentativas. Tente novamente mais tarde.');
        $window['count']++; ftruncate($handle, 0); rewind($handle); fwrite($handle, json_encode($window, JSON_THROW_ON_ERROR));
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}

function sendPhpPasswordResetEmail(string $to, array $resetLinks): void
{
    $names=['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','PUBLIC_APP_URL']; $config=[];
    foreach($names as $name) { $value=getenv($name); if(is_string($value) && trim($value)!=='') $config[$name]=$value; }
    if (!$config) throw new Noa\ApiException(503,'A recuperação de senha está temporariamente indisponível.');
    if (count($config)!==count($names) || preg_match('/[\r\n]/', $config['SMTP_HOST'] ?? '') || preg_match('/[\r\n]/', $config['SMTP_FROM'] ?? '') || !ctype_digit(trim($config['SMTP_PORT'] ?? ''))) throw new Noa\ApiException(503,'A recuperação de senha está temporariamente indisponível.');
    $port=(int)$config['SMTP_PORT']; $secure=strtolower(trim($config['SMTP_SECURE'])); $url=parse_url(trim($config['PUBLIC_APP_URL']));
    if ($port<1 || $port>65535 || !in_array($secure,['true','false'],true) || !is_array($url) || !in_array($url['scheme'] ?? '',['http','https'],true) || empty($url['host']) || !in_array($url['path'] ?? '',['','/'],true) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) || ((getenv('NODE_ENV') ?: '')==='production' && $url['scheme']!=='https')) throw new Noa\ApiException(503,'A recuperação de senha está temporariamente indisponível.');
    $origin=$url['scheme'].'://'.$url['host'].(isset($url['port'])?':'.$url['port']:'');
    $links=[];
    foreach($resetLinks as $link) {
        $name=(string)$link['clinicName']; $href=$origin.'/reset-password#token='.rawurlencode((string)$link['token']);
        $links[]=['name'=>$name,'url'=>$href];
    }
    if ($links) {
        $text="Recebemos uma solicitação para redefinir uma senha no Sistema de Agendamento.\n\n";
        foreach($links as $link) $text.='Acesso à clínica '.$link['name'].': '.$link['url']."\n\n";
        $text.='Cada link é válido por 30 minutos e pode ser usado uma única vez. Se você não solicitou a redefinição, ignore esta mensagem.';
        $html='<p>Recebemos uma solicitação para redefinir uma senha no Sistema de Agendamento.</p>';
        foreach($links as $link) $html.='<p><a href="'.htmlspecialchars($link['url'],ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'">Redefinir senha — '.htmlspecialchars($link['name'],ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'</a></p>';
        $html.='<p>Cada link é válido por 30 minutos e pode ser usado uma única vez. Se você não solicitou a redefinição, ignore esta mensagem.</p>';
    } else {
        $text='Recebemos uma solicitação para redefinir uma senha no Sistema de Agendamento. Se o endereço estiver associado a uma conta ativa, esta mensagem incluirá os links de redefinição correspondentes. Se não houver links ou você não solicitou a redefinição, ignore esta mensagem.';
        $html='<p>Recebemos uma solicitação para redefinir uma senha no Sistema de Agendamento. Se o endereço estiver associado a uma conta ativa, esta mensagem incluirá os links de redefinição correspondentes.</p><p>Se não houver links ou você não solicitou a redefinição, ignore esta mensagem.</p>';
    }
    sendPhpSmtpMessage($to,'Solicitação de recuperação de senha',$text,$html);
}

function sendPhpSmtpMessage(string $to,string $subjectText,string $text,string $html): void
{
    SmtpMailer::send($to,$subjectText,$text,$html);
}

function validPublicOrigin(string $value, bool $production): ?string
{
    try {
        $parts=parse_url($value);
        if(!is_array($parts) || !in_array(strtolower($parts['scheme'] ?? ''),['https','http'],true) || empty($parts['host']) || !in_array($parts['path'] ?? '',['','/'],true) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment']) || ($production && strtolower($parts['scheme'])!=='https')) return null;
        $scheme=strtolower($parts['scheme']); return $scheme.'://'.$parts['host'].(isset($parts['port'])?':'.$parts['port']:'');
    } catch(Throwable) { return null; }
}

function mercadoPagoRequest(string $method,string $url,string $accessToken,?array $payload=null): array
{
    $headers="Authorization: Bearer $accessToken\r\nAccept: application/json\r\nContent-Type: application/json\r\n";
    $options=['http'=>['method'=>$method,'header'=>$headers,'ignore_errors'=>true,'timeout'=>20,'follow_location'=>0,'protocol_version'=>1.1,'max_redirects'=>0]];
    if($payload!==null) $options['http']['content']=json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    $context=stream_context_create($options); $responseHeaders=[]; $response=@file_get_contents($url,false,$context);
    foreach(($http_response_header ?? []) as $header) $responseHeaders[]=$header;
    $status=0; if(isset($responseHeaders[0]) && preg_match('/\s(\d{3})\s/',$responseHeaders[0],$match)) $status=(int)$match[1];
    $data=is_string($response)?json_decode($response,true):null;
    return ['status'=>$status,'data'=>is_array($data)?$data:[]];
}

function mercadoPagoApiUrl(string $path): string
{
    if (!preg_match('#^/[A-Za-z0-9/_-]+$#', $path)) throw new LogicException('Invalid Mercado Pago API path.');
    $base = getenv('MERCADOPAGO_API_BASE_URL');
    if ($base === false || $base === '') return 'https://api.mercadopago.com' . $path;
    if ((getenv('NODE_ENV') ?: '') !== 'test') throw new RuntimeException('MERCADOPAGO_API_BASE_URL is test-only.');
    $parts = parse_url($base);
    if (!is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'http' ||
        !in_array(strtolower($parts['host'] ?? ''), ['localhost', '127.0.0.1', '::1'], true) ||
        isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) ||
        isset($parts['fragment']) || !in_array($parts['path'] ?? '', ['', '/'], true) ||
        (isset($parts['port']) && ((int)$parts['port'] < 1 || (int)$parts['port'] > 65535))) {
        throw new RuntimeException('Test Mercado Pago API URL must use loopback HTTP.');
    }
    return rtrim($base, '/') . $path;
}
