$ErrorActionPreference = 'Stop'
$phpExe = (Get-Command php).Source
$phpExtensionDirectory = Join-Path (Split-Path $phpExe) 'ext'
$pdoPgsqlExtension = Join-Path $phpExtensionDirectory 'php_pdo_pgsql.dll'

if (-not (Test-Path -LiteralPath $pdoPgsqlExtension)) {
    throw 'A extensão php_pdo_pgsql.dll não foi encontrada junto à instalação ativa do PHP.'
}

Set-Location $PSScriptRoot
& $phpExe -d "extension_dir=$phpExtensionDirectory" -d 'extension=php_pdo_pgsql.dll' bin/reminder-worker.php @args
