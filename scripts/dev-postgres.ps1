[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Init', 'Start', 'Status', 'Stop')]
    [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$clusterPath = Join-Path $projectPath '.local/postgres'
$dataPath = Join-Path $clusterPath 'data'
$binaryPath = 'C:/Program Files/PostgreSQL/16/bin'
$port = 55442
$markerPath = Join-Path $clusterPath 'ownership.json'
$credentialsPath = Join-Path $clusterPath 'credentials.json'
$utf8 = New-Object Text.UTF8Encoding($false)

function Assert-SafePath([string]$Path) {
    $absolute = [IO.Path]::GetFullPath($Path)
    if ($absolute -match '(?i)(^|[\\/])OneDrive[^\\/]*([\\/]|$)') {
        throw 'OneDrive paths are not permitted.'
    }
    foreach ($name in @('OneDrive', 'OneDriveCommercial', 'OneDriveConsumer')) {
        $syncRoot = [Environment]::GetEnvironmentVariable($name)
        if ($syncRoot) {
            $syncRoot = [IO.Path]::GetFullPath($syncRoot).TrimEnd('\', '/')
            if ($absolute.Equals($syncRoot, [StringComparison]::OrdinalIgnoreCase) -or
                $absolute.StartsWith($syncRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
                throw 'A configured OneDrive tree is not permitted.'
            }
        }
    }
    $cursor = $absolute
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Reparse point is not permitted: $cursor"
            }
        }
        $parent = [IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor = $parent.FullName
    }
}

function Assert-SafeTree {
    Assert-SafePath $clusterPath
    if (-not (Test-Path -LiteralPath $clusterPath)) { return }
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($clusterPath)
    while ($pending.Count -gt 0) {
        foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Cluster contains a reparse point: $($item.FullName)"
            }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
        }
    }
}

function Write-LocalText([string]$Path, [string]$Value) {
    Assert-SafePath $Path
    [IO.File]::WriteAllText($Path, $Value, $utf8)
}

function Protect-Directory {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($currentSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $clusterPath -AclObject $acl
}

function New-Password {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Quote-NativeArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting, including trailing backslashes.
    return '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-PostgresTool([string]$Name, [string[]]$ToolArguments, [string]$InputText = '') {
    $executable = Join-Path $binaryPath $Name
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Missing PostgreSQL tool: $Name" }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $executable
    $info.Arguments = ($ToolArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
    $info.WorkingDirectory = $projectPath
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    foreach ($key in @($info.EnvironmentVariables.Keys)) {
        if ($key -like 'PG*') { $info.EnvironmentVariables.Remove($key) }
    }
    $info.EnvironmentVariables['PGCONNECT_TIMEOUT'] = '5'
    $info.EnvironmentVariables['PGPASSFILE'] = Join-Path $clusterPath 'pgpass.conf'
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    $outputReaderStarted = $false
    $errorReaderStarted = $false
    try {
        [void]$process.Start()
        # Discard output without retaining secrets or waiting for stream EOF.
        # A detached postgres process can inherit pg_ctl's redirected handles.
        # Waiting for ReadToEndAsync after pg_ctl exits then waits on the server.
        $process.BeginOutputReadLine()
        $outputReaderStarted = $true
        $process.BeginErrorReadLine()
        $errorReaderStarted = $true
        if ($InputText) {
            $writeTask = $process.StandardInput.WriteAsync($InputText)
            if (-not $writeTask.Wait(10000)) {
                throw "$Name input write exceeded 10 seconds. Inspect tool PID $($process.Id); no process was stopped."
            }
        }
        $process.StandardInput.Close()
        # The finite overload waits for the tool, not inherited pipe closure.
        # Do not add parameterless WaitForExit or an output-drain wait here.
        if (-not $process.WaitForExit(60000)) {
            throw "$Name exceeded 60 seconds. Inspect tool PID $($process.Id) and owned cluster status; no process was stopped."
        }
        if ($process.ExitCode -ne 0) {
            throw "$Name failed with exit code $($process.ExitCode). Local logs may help; do not publish their contents without review."
        }
    } finally {
        # Cancel readers before disposing their pipes; never wait for server EOF.
        if ($outputReaderStarted) {
            try { $process.CancelOutputRead() } catch [InvalidOperationException] { }
        }
        if ($errorReaderStarted) {
            try { $process.CancelErrorRead() } catch [InvalidOperationException] { }
        }
        $process.Dispose()
    }
}

function Assert-Ownership {
    Assert-SafeTree
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw 'No owned cluster marker. Run Init only for a new empty location.' }
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($marker.kind -ne 'open-agent-bridge-local-postgres-v1' -or
        $marker.projectPath -ne $projectPath -or $marker.dataPath -ne $dataPath -or
        $marker.port -ne $port -or $marker.windowsUserSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
        throw 'Cluster ownership does not match this project, user, or port.'
    }
    $versionPath = Join-Path $dataPath 'PG_VERSION'
    if (-not (Test-Path -LiteralPath $versionPath) -or (Get-Content -LiteralPath $versionPath -Raw).Trim() -ne '16') {
        throw 'Initialization is incomplete or the cluster is not PostgreSQL 16. Preserve it for manual inspection.'
    }
    if (-not (Test-Path -LiteralPath $credentialsPath -PathType Leaf)) { throw 'Local credentials are missing; no automatic password replacement is allowed.' }
}

function Get-ClusterProcess {
    $pidPath = Join-Path $dataPath 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
    $pidLines = @(Get-Content -LiteralPath $pidPath)
    if ($pidLines.Count -lt 4 -or [IO.Path]::GetFullPath($pidLines[1]) -ne $dataPath -or [int]$pidLines[3] -ne $port) {
        throw 'Postmaster identity differs from the owned cluster; no process will be controlled.'
    }
    $clusterProcess = Get-Process -Id ([int]$pidLines[0]) -ErrorAction SilentlyContinue
    if ($null -eq $clusterProcess) { throw 'Stale postmaster.pid found. Preserve it and inspect manually; the helper will not delete it.' }
    $expectedExe = [IO.Path]::GetFullPath((Join-Path $binaryPath 'postgres.exe'))
    $startedAt = [DateTimeOffset]::FromUnixTimeSeconds([long]$pidLines[2]).UtcDateTime
    if ($clusterProcess.Path -ne $expectedExe -or [Math]::Abs(($clusterProcess.StartTime.ToUniversalTime() - $startedAt).TotalSeconds) -gt 10) {
        throw 'PID executable or start time does not match this cluster; refusing process control.'
    }
    return $clusterProcess
}

function Assert-PortAvailable {
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if (@($listeners | Where-Object { $_.Port -eq $port }).Count -gt 0) {
        throw "Port $port is already in use. No existing listener will be stopped and no fallback port will be chosen."
    }
}

Assert-SafePath $projectPath
Assert-SafePath $binaryPath
Assert-SafeTree
if ($Action -eq 'Status' -and -not (Test-Path -LiteralPath $clusterPath)) {
    [pscustomobject]@{ State = 'Not initialized'; Host = '127.0.0.1'; Port = $port; DataPath = $dataPath }
    return
}

if ($Action -eq 'Init') {
    $ignorePath = Join-Path $projectPath '.gitignore'
    if (-not (Test-Path -LiteralPath $ignorePath) -or
        -not (@(Get-Content -LiteralPath $ignorePath) -match '^/?\.local/?$')) {
        throw 'Add .local/ to the project .gitignore before initialization.'
    }
    if (Test-Path -LiteralPath $clusterPath) { throw 'The cluster directory already exists. Init never replaces or deletes existing files.' }
    Assert-PortAvailable
    [void][IO.Directory]::CreateDirectory($clusterPath)
    Protect-Directory
    $credentials = [ordered]@{
        adminUser = 'oab_local_admin'; adminPassword = New-Password
        developmentUser = 'oab_dev'; developmentPassword = New-Password
        testUser = 'oab_test'; testPassword = New-Password
    }
    Write-LocalText $credentialsPath ($credentials | ConvertTo-Json)
    Write-LocalText (Join-Path $clusterPath 'init-password.txt') ($credentials.adminPassword + "`n")
    Write-LocalText (Join-Path $clusterPath 'pgpass.conf') ("127.0.0.1:${port}:*:oab_local_admin:" + $credentials.adminPassword + "`n")
    Write-LocalText $markerPath ([ordered]@{
        kind = 'open-agent-bridge-local-postgres-v1'; projectPath = $projectPath
        dataPath = $dataPath; port = $port; windowsUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    } | ConvertTo-Json)
    Invoke-PostgresTool 'initdb.exe' @('-D', $dataPath, '-U', $credentials.adminUser,
        '--pwfile', (Join-Path $clusterPath 'init-password.txt'), '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C', '--no-instructions', '--no-clean')
    # Scrub the one-time initdb input without deleting any file.
    Write-LocalText (Join-Path $clusterPath 'init-password.txt') ''
    Write-LocalText (Join-Path $clusterPath 'pg_hba.conf') "host all all 127.0.0.1/32 scram-sha-256`nhost all all 0.0.0.0/0 reject`nhost all all ::0/0 reject`n"
    $dataConfig = $dataPath.Replace('\', '/').Replace("'", "''")
    $hbaConfig = (Join-Path $clusterPath 'pg_hba.conf').Replace('\', '/').Replace("'", "''")
    Write-LocalText (Join-Path $clusterPath 'postgresql.conf') @"
data_directory = '$dataConfig'
hba_file = '$hbaConfig'
listen_addresses = '127.0.0.1'
port = $port
password_encryption = 'scram-sha-256'
max_connections = 30
shared_buffers = '64MB'
log_statement = 'none'
log_min_error_statement = 'panic'
logging_collector = off
"@
    Write-LocalText (Join-Path $clusterPath 'development.env') (
        "DATABASE_URL=postgresql://oab_dev:" + $credentials.developmentPassword + "@127.0.0.1:${port}/oab_dev`n" +
        "TEST_DATABASE_URL=postgresql://oab_test:" + $credentials.testPassword + "@127.0.0.1:${port}/oab_test`n")
    Write-Output 'Initialized the owned PostgreSQL 16 cluster. Server remains stopped. Credentials were written only to the protected local directory.'
    return
}

Assert-Ownership
$runningProcess = Get-ClusterProcess
if ($Action -eq 'Status') {
    [pscustomobject]@{
        State = $(if ($null -eq $runningProcess) { 'Stopped' } else { 'Running' })
        Host = '127.0.0.1'; Port = $port; DataPath = $dataPath
        ProcessId = $(if ($null -eq $runningProcess) { $null } else { $runningProcess.Id })
        DevelopmentDatabase = 'oab_dev'; TestDatabase = 'oab_test'
    }
    return
}
if ($Action -eq 'Stop') {
    if ($null -eq $runningProcess) { Write-Output 'Owned cluster is already stopped.'; return }
    Invoke-PostgresTool 'pg_ctl.exe' @('stop', '-D', $dataPath, '-m', 'fast', '-w', '-t', '30')
    Write-Output 'Stopped the owned cluster. Data and credentials remain in place.'
    return
}

if ($null -eq $runningProcess) {
    Assert-PortAvailable
    $configPath = (Join-Path $clusterPath 'postgresql.conf').Replace('\', '/')
    Invoke-PostgresTool 'pg_ctl.exe' @('start', '-D', $dataPath, '-l', (Join-Path $clusterPath 'server.log'),
        '-o', "-c config_file=`"$configPath`" -h 127.0.0.1 -p $port", '-w', '-t', '30')
}
# Passwords go through stdin, never process arguments or terminal output.
$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
foreach ($name in @('developmentPassword', 'testPassword')) {
    if ($credentials.$name -notmatch '^[0-9a-f]{64}$') { throw 'Unexpected local password format; refusing SQL generation.' }
}
$sql = @"
SET statement_timeout = '15s';
SET lock_timeout = '5s';
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', 'oab_dev', '$($credentials.developmentPassword)') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oab_dev')
\gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', 'oab_test', '$($credentials.testPassword)') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oab_test')
\gexec
SELECT 'CREATE DATABASE oab_dev OWNER oab_dev' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'oab_dev')
\gexec
SELECT 'CREATE DATABASE oab_test OWNER oab_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'oab_test')
\gexec
REVOKE ALL ON DATABASE oab_dev FROM PUBLIC;
REVOKE ALL ON DATABASE oab_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE oab_dev TO oab_dev;
GRANT CONNECT, TEMPORARY ON DATABASE oab_test TO oab_test;
"@
Invoke-PostgresTool 'psql.exe' @('-X', '-w', '-h', '127.0.0.1', '-p', "$port", '-U', 'oab_local_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q') $sql
Write-Output 'Owned cluster is running on 127.0.0.1:55442. Separate development and test databases are ready; credentials were not printed.'
