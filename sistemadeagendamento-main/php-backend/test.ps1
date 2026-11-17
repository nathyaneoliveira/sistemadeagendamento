$ErrorActionPreference = 'Stop'
$phpExe = (Get-Command php).Source
$phpCgi = (Get-Command php-cgi -ErrorAction SilentlyContinue).Source
$phpExtensionDirectory = Join-Path (Split-Path $phpExe) 'ext'
$pdoPgsqlExtension = Join-Path $phpExtensionDirectory 'php_pdo_pgsql.dll'
$script:phpCgiRequestCount = 0
$script:phpCgiRunSubnet = Get-Random -Minimum 1 -Maximum 255
$script:phpSmokeTempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('noa-php-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:phpSmokeTempDirectory | Out-Null
Set-Location $PSScriptRoot

try {
if (-not (Test-Path -LiteralPath $pdoPgsqlExtension)) {
    throw 'A extensão php_pdo_pgsql.dll não foi encontrada junto à instalação ativa do PHP.'
}

$phpModules = & $phpExe -m
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar os módulos do PHP CLI.' }
$phpExtensionArguments = @()
if ($phpModules -notcontains 'pdo_pgsql') {
    $phpExtensionArguments = @('-d', "extension_dir=$phpExtensionDirectory", '-d', 'extension=php_pdo_pgsql.dll')
}

$phpCgiExtensionArguments = @()
if ($phpCgi) {
    $phpCgiModules = & $phpCgi -m
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar os módulos do PHP CGI.' }
    if ($phpCgiModules -notcontains 'pdo_pgsql') {
        $phpCgiExtensionArguments = @('-d', "extension_dir=$phpExtensionDirectory", '-d', 'extension=php_pdo_pgsql.dll')
    }
}

$phpFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -Filter '*.php'
foreach ($file in $phpFiles) {
    & $phpExe -l $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "Falha de sintaxe em $($file.FullName)." }
}

& $phpExe (Join-Path $PSScriptRoot 'test/appointment-state.php')
if ($LASTEXITCODE -ne 0) { throw 'A máquina de estados PHP de agendamento falhou.' }

& $phpExe @phpExtensionArguments -r 'if (!in_array("pgsql", PDO::getAvailableDrivers(), true)) { exit(1); }'
if ($LASTEXITCODE -ne 0) { throw 'O driver PDO PostgreSQL não carregou.' }
Write-Output 'PASS PDO PostgreSQL carrega.'

$jsLengthCode = @'
require "src/bootstrap.php";
$emoji = json_decode('"\uD83D\uDE00"', false, 512, JSON_THROW_ON_ERROR);
if (Noa\jsStringLength($emoji) !== 2 || Noa\jsStringLength("a\n") !== 2) { exit(1); }
'@
& $phpExe -r $jsLengthCode
if ($LASTEXITCODE -ne 0) { throw 'JavaScript UTF-16 string length parity failed.' }
Write-Output 'PASS medição de texto corresponde às unidades UTF-16 do JavaScript.'

$healthCode = '$_SERVER["REQUEST_METHOD"]="GET"; $_SERVER["REQUEST_URI"]="/api/health"; include "public/index.php"; exit(http_response_code()===200?0:1);'
$healthOutput = & $phpExe -r $healthCode
if ($LASTEXITCODE -ne 0 -or ($healthOutput -join '') -notmatch '"ok":true') { throw 'O health check PHP falhou.' }
Write-Output 'PASS GET /api/health sem banco.'

$notFoundCode = '$_SERVER["REQUEST_METHOD"]="GET"; $_SERVER["REQUEST_URI"]="/api/not-a-route"; include "public/index.php"; exit(http_response_code()===404?0:1);'
$notFoundOutput = & $phpExe -r $notFoundCode
if ($LASTEXITCODE -ne 0 -or ($notFoundOutput -join '') -notmatch 'Rota não encontrada') { throw 'A rota desconhecida não retornou 404.' }
Write-Output 'PASS rota desconhecida retorna 404.'

if ($phpCgi) {
    function Invoke-PHP-CgiRequest([string]$Method, [string]$Uri, [string]$Body, [hashtable]$Headers = @{}) {
        $environmentNames = @('REDIRECT_STATUS','SCRIPT_FILENAME','REQUEST_METHOD','REQUEST_URI','CONTENT_TYPE','CONTENT_LENGTH','REMOTE_ADDR','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','DB_SSL','NODE_ENV','MERCADOPAGO_ACCESS_TOKEN','MERCADOPAGO_WEBHOOK_SECRET','MERCADOPAGO_WEBHOOK_URL','PUBLIC_APP_URL','HTTP_ORIGIN','HTTP_COOKIE','HTTP_X_CSRF_TOKEN')
        $previous = @{}
        foreach ($name in $environmentNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name) }
        try {
            $env:REDIRECT_STATUS = '200'
            $env:SCRIPT_FILENAME = Join-Path $PSScriptRoot 'public/index.php'
            $env:REQUEST_METHOD = $Method
            $env:REQUEST_URI = $Uri
            $env:CONTENT_TYPE = 'application/json'
            $env:CONTENT_LENGTH = [Text.Encoding]::UTF8.GetByteCount($Body).ToString()
            $script:phpCgiRequestCount++
            $env:REMOTE_ADDR = "198.18.$script:phpCgiRunSubnet.$script:phpCgiRequestCount"
            $env:DB_HOST = '127.0.0.1'
            $env:DB_PORT = '1'
            $env:DB_NAME = 'php_smoke_no_data'
            $env:DB_USER = 'php_smoke_no_user'
            $env:DB_PASSWORD = 'php_smoke_no_password'
            $env:DB_SSL = 'false'
            $env:NODE_ENV = 'test'
            $env:MERCADOPAGO_ACCESS_TOKEN = ''
            $env:MERCADOPAGO_WEBHOOK_SECRET = ''
            $env:MERCADOPAGO_WEBHOOK_URL = ''
            $env:PUBLIC_APP_URL = ''
            foreach ($headerName in $Headers.Keys) {
                $cgiName = 'HTTP_' + ($headerName -replace '-', '_').ToUpperInvariant()
                [Environment]::SetEnvironmentVariable($cgiName, [string]$Headers[$headerName], 'Process')
            }
            $phpCgiArguments = @('-d', "sys_temp_dir=$script:phpSmokeTempDirectory") + $phpCgiExtensionArguments
            $response = $Body | & $phpCgi @phpCgiArguments 2>&1
            if ($LASTEXITCODE -ne 0) { throw "php-cgi failed for $Method $Uri." }
            $responseText = $response -join "`n"
            if ($responseText -match '(?i)<b>(warning|notice|fatal error|deprecated)</b>|PHP (Warning|Notice|Fatal error|Deprecated)') { throw "PHP diagnostic leaked for $Method $Uri." }
            return $responseText
        }
        finally {
            foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name]) }
        }
    }

    $smokeCsrfToken = 'A' * 43
    $smokeHeaders = @{
        Origin = 'http://localhost:5173'
        Cookie = "clinic_csrf=$smokeCsrfToken"
        'X-CSRF-Token' = $smokeCsrfToken
    }
    $invalidLogin = Invoke-PHP-CgiRequest 'POST' '/api/auth/login' '{}' $smokeHeaders
    if ($invalidLogin -notmatch 'Status: 400' -or $invalidLogin -notmatch 'e-mail e uma senha') { throw 'Login validation did not reject an empty payload before database access.' }
    Write-Output 'PASS login inválido é rejeitado antes do banco.'

    $malformedJson = Invoke-PHP-CgiRequest 'POST' '/api/auth/login' '{'
    if ($malformedJson -notmatch 'Status: 400' -or $malformedJson -notmatch 'JSON inválido') { throw 'Malformed JSON did not return a safe 400 response.' }
    Write-Output 'PASS JSON malformado retorna erro seguro.'

    $liveHealth = Invoke-PHP-CgiRequest 'GET' '/api/health/live' ''
    if (($liveHealth -match 'Status:' -and $liveHealth -notmatch 'Status: 200') -or $liveHealth -notmatch '"ok":true') { throw 'Liveness endpoint failed.' }
    Write-Output 'PASS GET /api/health/live.'

    $preflight = Invoke-PHP-CgiRequest 'OPTIONS' '/api/health' ''
    if ($preflight -notmatch 'Status: 204' -or $preflight -notmatch 'Access-Control-Allow-Methods') { throw 'CORS preflight failed.' }
    Write-Output 'PASS preflight CORS responde 204.'

    $emoji = ConvertFrom-Json '"\uD83D\uDE00"'
    $oversizedPassword = $emoji * 513
    $unicodeLoginBody = @{ email='nathy@example.com'; password=$oversizedPassword } | ConvertTo-Json -Compress
    $unicodeLogin = Invoke-PHP-CgiRequest 'POST' '/api/auth/login' $unicodeLoginBody $smokeHeaders
    if ($unicodeLogin -notmatch 'Status: 400') { throw 'Login length did not match JavaScript UTF-16 code units.' }
    Write-Output 'PASS limite de senha de login conta pares substitutos como no JavaScript.'

    $invalidBooking = Invoke-PHP-CgiRequest 'POST' '/api/public/clinics/demo/appointments' '{}'
    if ($invalidBooking -notmatch 'Status: 400' -or $invalidBooking -notmatch 'agendamento inválidos') { throw 'Public booking validation did not reject an empty payload before database access.' }
    Write-Output 'PASS agendamento público inválido é rejeitado antes do banco.'

    $longUnicodeName = $emoji * 101
    $signupBody = @{ clinicName=$longUnicodeName; ownerName='Ana Silva'; email='ana@example.com'; password='SenhaSegura123'; plan='essential'; billingCycle='monthly' } | ConvertTo-Json -Compress
    $unicodeSignup = Invoke-PHP-CgiRequest 'POST' '/api/checkout' $signupBody
    if ($unicodeSignup -notmatch 'Status: 400') { throw 'Signup name length did not match JavaScript UTF-16 code units.' }
    Write-Output 'PASS limite do nome na contratação corresponde ao JavaScript.'

    $validSignupBody = @{ clinicName='Clínica de Teste'; ownerName='Ana Silva'; email='ana@example.com'; password='SenhaSegura123'; plan='essential'; billingCycle='monthly' } | ConvertTo-Json -Compress
    $validSignup = Invoke-PHP-CgiRequest 'POST' '/api/checkout' $validSignupBody
    if ($validSignup -notmatch 'Status: 503' -or $validSignup -notmatch 'aguardando a configuração') { throw 'A valid signup payload did not reach the expected disabled-gateway response.' }
    Write-Output 'PASS contratação válida exige configuração do gateway antes de criar dados.'

    $bookingBody = @{ idempotencyKey='11111111-1111-4111-8111-111111111111'; serviceId='22222222-2222-4222-8222-222222222222'; professionalId='33333333-3333-4333-8333-333333333333'; scheduledStart='2026-11-05T12:00:00Z'; name=$longUnicodeName; phone='+5511999999999'; reminderConsent=$false } | ConvertTo-Json -Compress
    $unicodeBooking = Invoke-PHP-CgiRequest 'POST' '/api/public/clinics/clinic-demo/appointments' $bookingBody
    if ($unicodeBooking -notmatch 'Status: 400') { throw 'Public booking name length did not match JavaScript UTF-16 code units.' }
    Write-Output 'PASS limite do nome no agendamento público corresponde ao JavaScript.'

    $validBookingBody = @{ idempotencyKey='11111111-1111-4111-8111-111111111112'; serviceId='22222222-2222-4222-8222-222222222222'; professionalId='33333333-3333-4333-8333-333333333333'; scheduledStart='2026-11-05T12:00:00+23:59'; name='Ana Silva'; phone='+5511999999999'; reminderConsent=$false } | ConvertTo-Json -Compress
    $validBooking = Invoke-PHP-CgiRequest 'POST' '/api/public/clinics/clinic-demo/appointments' $validBookingBody
    if ($validBooking -notmatch 'Status: 503') { throw 'A valid ISO offset accepted by JavaScript was rejected before database access.' }
    Write-Output 'PASS timestamp ISO com offset válido segue o comportamento esperado pelo JavaScript.'

    $invalidOffsetBody = @{ idempotencyKey='11111111-1111-4111-8111-111111111112'; serviceId='22222222-2222-4222-8222-222222222222'; professionalId='33333333-3333-4333-8333-333333333333'; scheduledStart='2026-11-05T12:00:00+24:00'; name='Ana Silva'; phone='+5511999999999'; reminderConsent=$false } | ConvertTo-Json -Compress
    $invalidOffset = Invoke-PHP-CgiRequest 'POST' '/api/public/clinics/clinic-demo/appointments' $invalidOffsetBody
    if ($invalidOffset -notmatch 'Status: 400') { throw 'An out-of-range ISO offset was not rejected.' }
    Write-Output 'PASS timestamp ISO com offset fora do intervalo é rejeitado.'

    $readyOffline = Invoke-PHP-CgiRequest 'GET' '/api/health/ready' ''
    if ($readyOffline -notmatch 'Status: 503' -or $readyOffline -notmatch 'temporariamente indisponível') { throw 'Readiness did not fail safely when the isolated test database was unavailable.' }
    Write-Output 'PASS readiness falha de forma genérica com banco isolado indisponível.'

    $phpApiSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'public/index.php'))
    $frontendSource = [IO.File]::ReadAllText((Join-Path (Split-Path $PSScriptRoot) 'frontend/src/App.jsx'))
    $availabilityResponsePattern = "'date'\s*=>\s*\`$date,\s*'schedule'\s*=>\s*\`$scheduleRows,\s*'blocks'\s*=>\s*\`$blockRows,\s*'availableSlots'\s*=>\s*generateClinicSlots\([^)]*\),\s*'timeZone'\s*=>\s*\`$tz"
    if ($phpApiSource -notmatch $availabilityResponsePattern -or $frontendSource -notmatch 'data\?\.availableSlots') {
        throw 'Authenticated PHP availability response does not match the React availableSlots contract.'
    }
    Write-Output 'PASS disponibilidade autenticada preserva o contrato consumido pelo React.'
}
else {
    Write-Output 'SKIP testes HTTP CGI: php-cgi não está instalado.'
}

$workerHelp = & $phpExe @phpExtensionArguments 'bin/reminder-worker.php' '--help'
if ($LASTEXITCODE -ne 0 -or ($workerHelp -join '') -notmatch '--once') { throw 'A ajuda do worker de lembretes falhou.' }
Write-Output 'PASS worker aceita --help sem banco.'

try {
    $previousProvisioningConfirmation = [Environment]::GetEnvironmentVariable('PLATFORM_ADMIN_PROVISIONING_CONFIRM')
    $env:PLATFORM_ADMIN_PROVISIONING_CONFIRM = 'NO'
    & $phpExe 'bin/provision-platform-admin.php' *> $null
    if ($LASTEXITCODE -eq 0) { throw 'O provisionamento não bloqueou sem confirmação.' }
    Write-Output 'PASS provisionamento exige confirmação explícita.'
}
finally {
    [Environment]::SetEnvironmentVariable('PLATFORM_ADMIN_PROVISIONING_CONFIRM', $previousProvisioningConfirmation)
}

Write-Output 'As verificações de integração com PostgreSQL não estão incluídas: execute em um ambiente de teste com banco isolado.'
}
finally {
    $systemTempPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $smokeTempPath = [IO.Path]::GetFullPath($script:phpSmokeTempDirectory)
    if ($smokeTempPath.StartsWith($systemTempPath, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($smokeTempPath).StartsWith('noa-php-smoke-', [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $smokeTempPath -Recurse -Force
    }
}
