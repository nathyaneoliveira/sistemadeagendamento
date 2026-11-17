<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$arguments = array_slice($argv, 1);
if (in_array('--help', $arguments, true) || in_array('-h', $arguments, true)) {
    fwrite(STDOUT, "Usage: php bin/provision-platform-admin.php\n\nRequires explicit PLATFORM_ADMIN_PROVISIONING_CONFIRM, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME, and PLATFORM_ADMIN_PASSWORD process variables.\n");
    exit(0);
}
if ($arguments !== []) {
    fwrite(STDERR, "Unknown argument. Use --help.\n");
    exit(2);
}

require dirname(__DIR__) . '/src/bootstrap.php';

use Noa\Database;

if (getenv('PLATFORM_ADMIN_PROVISIONING_CONFIRM') !== 'CREATE_PLATFORM_ADMIN') {
    fwrite(STDERR, "Provisionamento bloqueado: defina PLATFORM_ADMIN_PROVISIONING_CONFIRM=CREATE_PLATFORM_ADMIN no ambiente do processo.\n");
    exit(1);
}

try {
    Noa\validateDatabaseConfiguration();
} catch (Throwable $error) {
    fwrite(STDERR, "Invalid provisioner configuration: {$error->getMessage()}\n");
    exit(1);
}

$email=getenv('PLATFORM_ADMIN_EMAIL') ?: '';
$name=getenv('PLATFORM_ADMIN_NAME') ?: '';
$password=getenv('PLATFORM_ADMIN_PASSWORD');
if (!is_string($password) || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/',trim($email)) || strlen($email)>255 || trim($name)==='' || textLength($name)>200 || textLength($password)<12 || strlen($password)>72) {
    fwrite(STDERR,"Dados de provisionamento inválidos; senha deve conter ao menos 12 caracteres e no máximo 72 bytes em UTF-8.\n");
    exit(1);
}

try {
    $hash=password_hash($password,PASSWORD_BCRYPT,['cost'=>12]);
    $db=Database::connection(); $db->beginTransaction();
    try {
        $insert=$db->prepare('INSERT INTO platform_admin_accounts (email,name,password_hash) VALUES (LOWER(:email),:name,:password) RETURNING id');
        $insert->execute(['email'=>trim($email),'name'=>trim($name),'password'=>$hash]); $id=$insert->fetchColumn();
        $audit=$db->prepare("INSERT INTO platform_audit_logs (platform_admin_id,action,entity_type,details) VALUES (:admin,'platform.admin.provisioned','platform_admin',CAST(:details AS jsonb))");
        $audit->execute(['admin'=>$id,'details'=>json_encode(['source'=>'operator_cli'],JSON_THROW_ON_ERROR)]);
        $db->commit();
    } catch (Throwable $error) { if($db->inTransaction()) $db->rollBack(); throw $error; }
    fwrite(STDOUT,"Conta administrativa global provisionada. Identificador: $id\n");
} catch (Throwable) {
    fwrite(STDERR,"Falha no provisionamento administrativo. Verifique a migration, a conexão e se o e-mail já foi cadastrado.\n");
    exit(1);
}
