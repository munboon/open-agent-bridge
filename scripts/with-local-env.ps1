[CmdletBinding()]
param([switch]$TestDatabase,[Parameter(Mandatory=$true)][string]$Program,[Parameter(ValueFromRemainingArguments=$true)][string[]]$ProgramArguments)
$ErrorActionPreference='Stop'
$projectPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath=Join-Path $projectPath '.local/postgres/development.env'
if(-not (Test-Path -LiteralPath $envPath)){throw 'Initialize the isolated development database first.'}
$priorDatabase=[Environment]::GetEnvironmentVariable('DATABASE_URL')
$priorTest=[Environment]::GetEnvironmentVariable('TEST_DATABASE_URL')
try {
  foreach($line in Get-Content -LiteralPath $envPath){
    if($line -match '^(DATABASE_URL|TEST_DATABASE_URL)=(.+)$'){[Environment]::SetEnvironmentVariable($Matches[1],$Matches[2])}
  }
  if($TestDatabase){$env:DATABASE_URL=$env:TEST_DATABASE_URL}
  & $Program @ProgramArguments
  exit $LASTEXITCODE
} finally {
  [Environment]::SetEnvironmentVariable('DATABASE_URL',$priorDatabase)
  [Environment]::SetEnvironmentVariable('TEST_DATABASE_URL',$priorTest)
}
