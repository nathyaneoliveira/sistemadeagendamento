param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$databaseName = 'agendamento_php_security_test'
$databaseHost = '127.0.0.1'
$databasePort = '5432'
$backendRoot = Split-Path -Parent $PSScriptRoot
$publicRoot = Join-Path $backendRoot 'public'
$frontController = Join-Path $publicRoot 'index.php'
$integrationPhp = Join-Path $PSScriptRoot 'security-integration.php'
$php = (Get-Command php -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw 'The local integration configuration file was not found.'
}
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.host -cne $databaseHost -or [string]$config.port -cne $databasePort -or $config.database -cne $databaseName) {
    throw 'Integration configuration rejected: only 127.0.0.1:5432/agendamento_php_security_test is allowed.'
}
if ([string]::IsNullOrWhiteSpace([string]$config.user) -or [string]::IsNullOrEmpty([string]$config.password)) {
    throw 'The local integration configuration is missing database credentials.'
}

$environmentNames = @(
    'NOA_ENV_FILE', 'NODE_ENV', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER',
    'DB_PASSWORD', 'DB_SSL', 'JWT_SECRET', 'JWT_AUDIENCE', 'JWT_EXPIRES_IN',
    'CORS_ORIGIN', 'PGOPTIONS'
)
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$tempRoot = Join-Path $env:USERPROFILE ('.copilot\session-state\security-integration-' + [guid]::NewGuid().ToString('N'))
$server = $null
$concurrentServer = $null
$prepared = $false
$tempFiles = @()
$cleanupExitCode = 0
$integrationFailed = $false
try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    $env:NOA_ENV_FILE = 'php://memory'
    $env:NODE_ENV = 'test'
    $env:DB_HOST = $databaseHost
    $env:DB_PORT = $databasePort
    $env:DB_NAME = $databaseName
    $env:DB_USER = [string]$config.user
    $env:DB_PASSWORD = [string]$config.password
    $env:DB_SSL = 'false'
    $env:JWT_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $env:JWT_AUDIENCE = 'sistema-de-agendamentos-client'
    $env:JWT_EXPIRES_IN = '8h'
    $env:CORS_ORIGIN = 'http://localhost:5173'
    $env:PGOPTIONS = '-c search_path=public'

    & $php $integrationPhp '--prepare'
    if ($LASTEXITCODE -ne 0) {
        throw "Integration fixture preparation failed with exit code $LASTEXITCODE."
    }
    $prepared = $true

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $concurrentPort = $listener.LocalEndpoint.Port
    $listener.Stop()

    $stdoutPath = Join-Path $tempRoot 'php-server.stdout.log'
    $stderrPath = Join-Path $tempRoot 'php-server.stderr.log'
    $concurrentStdoutPath = Join-Path $tempRoot 'php-concurrent-server.stdout.log'
    $concurrentStderrPath = Join-Path $tempRoot 'php-concurrent-server.stderr.log'
    $tempFiles += $stdoutPath, $stderrPath, $concurrentStdoutPath, $concurrentStderrPath
    $server = Start-Process -FilePath $php `
        -ArgumentList @('-d', "sys_temp_dir=$tempRoot", '-S', "127.0.0.1:$port", '-t', $publicRoot, $frontController) `
        -WorkingDirectory $backendRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru `
        -WindowStyle Hidden
    $concurrentServer = Start-Process -FilePath $php `
        -ArgumentList @('-d', "sys_temp_dir=$tempRoot", '-S', "127.0.0.1:$concurrentPort", '-t', $publicRoot, $frontController) `
        -WorkingDirectory $backendRoot `
        -RedirectStandardOutput $concurrentStdoutPath `
        -RedirectStandardError $concurrentStderrPath `
        -PassThru `
        -WindowStyle Hidden

    $baseUrl = "http://127.0.0.1:$port"
    $concurrentBaseUrl = "http://127.0.0.1:$concurrentPort"
    $ready = $false
    $concurrentReady = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($server.HasExited) {
            throw "Local PHP API exited before readiness (exit code $($server.ExitCode))."
        }
        if ($concurrentServer.HasExited) {
            throw "Concurrent local PHP API exited before readiness (exit code $($concurrentServer.ExitCode))."
        }
        if (-not $ready) {
            try {
                $response = Invoke-WebRequest -Uri "$baseUrl/api/health/live" -TimeoutSec 2 -UseBasicParsing
                if ($response.StatusCode -eq 200) {
                    $ready = $true
                }
            }
            catch {
                Start-Sleep -Milliseconds 200
            }
        }
        if (-not $concurrentReady) {
            try {
                $response = Invoke-WebRequest -Uri "$concurrentBaseUrl/api/health/live" -TimeoutSec 2 -UseBasicParsing
                if ($response.StatusCode -eq 200) {
                    $concurrentReady = $true
                }
            }
            catch {
                Start-Sleep -Milliseconds 200
            }
        }
        if ($ready -and $concurrentReady) {
            break
        }
    }
    if (-not $ready -or -not $concurrentReady) {
        throw 'Both local PHP APIs did not become ready on loopback.'
    }

    & $php '-d' "sys_temp_dir=$tempRoot" $integrationPhp '--test' "--base-url=$baseUrl" "--concurrent-base-url=$concurrentBaseUrl"
    if ($LASTEXITCODE -ne 0) {
        $integrationFailed = $true
        throw "HTTP/PostgreSQL integration tests failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
        $server.WaitForExit()
    }
    if ($concurrentServer -and -not $concurrentServer.HasExited) {
        Stop-Process -Id $concurrentServer.Id -ErrorAction SilentlyContinue
        $concurrentServer.WaitForExit()
    }

    if ($prepared) {
        & $php $integrationPhp '--cleanup'
        $cleanupExitCode = $LASTEXITCODE
    }

    if ($integrationFailed -and (Test-Path -LiteralPath $stderrPath -PathType Leaf)) {
        Get-Content -LiteralPath $stderrPath |
            Select-String -Pattern 'PHP database failure:|PHP API failure:' |
            ForEach-Object { Write-Output ("API diagnostic: " + $_.Line) }
    }
    if ($integrationFailed) {
        foreach ($logPath in @($stdoutPath, $stderrPath, $concurrentStdoutPath, $concurrentStderrPath)) {
            if (Test-Path -LiteralPath $logPath -PathType Leaf) {
                Get-Content -LiteralPath $logPath -Tail 20 |
                    ForEach-Object { Write-Output ("Test server log: " + $_) }
            }
        }
    }

    foreach ($file in $tempFiles) {
        if (Test-Path -LiteralPath $file -PathType Leaf) {
            Remove-Item -LiteralPath $file -Force
        }
    }
    if (Test-Path -LiteralPath $tempRoot -PathType Container) {
        Get-ChildItem -LiteralPath $tempRoot -File | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
        }
        Remove-Item -LiteralPath $tempRoot -Force
    }

    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
}

if ($cleanupExitCode -ne 0) {
    throw "Synthetic fixture cleanup failed with exit code $cleanupExitCode."
}
