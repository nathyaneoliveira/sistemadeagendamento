$ErrorActionPreference = 'Stop'

$backendRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$publicDirectory = Join-Path $backendRoot 'public'
$frontController = Join-Path $publicDirectory 'index.php'

if (-not (Test-Path -LiteralPath $publicDirectory -PathType Container)) {
    throw "Diretório público do backend PHP não encontrado: $publicDirectory"
}

if (-not (Test-Path -LiteralPath $frontController -PathType Leaf)) {
    throw "Front-controller do backend PHP não encontrado: $frontController"
}

$phpCommand = Get-Command php -CommandType Application -ErrorAction SilentlyContinue

if (-not $phpCommand -or -not $phpCommand.Source) {
    throw 'PHP CLI não encontrado. Instale o PHP 8.1 ou superior e adicione php.exe ao PATH.'
}

$phpExe = [System.IO.Path]::GetFullPath($phpCommand.Source)
if (-not (Test-Path -LiteralPath $phpExe -PathType Leaf)) {
    throw "Executável PHP não encontrado: $phpExe"
}

$versionOutput = & $phpExe -r 'echo PHP_VERSION;' 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'Não foi possível consultar a versão do PHP CLI.'
}

$versionText = ($versionOutput | Out-String).Trim()
if ($versionText -notmatch '^(?<version>\d+\.\d+\.\d+)') {
    throw 'Não foi possível identificar a versão do PHP CLI.'
}

$phpVersion = [version]$Matches['version']
if ($phpVersion -lt [version]'8.1.0') {
    throw "PHP 8.1 ou superior é necessário. Versão encontrada: $versionText"
}

& $phpExe -r "exit(extension_loaded('pdo_pgsql') && in_array('pgsql', PDO::getAvailableDrivers(), true) ? 0 : 1);" 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'A extensão pdo_pgsql não está carregada na configuração efetiva do PHP CLI.'
}

Write-Host "Iniciando API PHP com PHP $versionText em http://127.0.0.1:4000"
Write-Host "Document root: $publicDirectory"

Push-Location $backendRoot
try {
    & $phpExe -S '127.0.0.1:4000' -t $publicDirectory $frontController
    if ($LASTEXITCODE -ne 0) {
        throw "O servidor PHP encerrou com código de saída $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
