[CmdletBinding()]
param([ValidateSet('Start','Stop','Status')][string]$Action='Status',
  [ValidateSet('Development','Production')][string]$Mode='Development')
$ErrorActionPreference='Stop'
$projectPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath=Join-Path $projectPath '.local/postgres'
$statePath=Join-Path $runtimePath 'app-process.json'
$appEnvPath=Join-Path $runtimePath 'app.env'
if(-not (Test-Path -LiteralPath (Join-Path $runtimePath 'ownership.json'))){throw 'Initialize the isolated local database first.'}
$ownedProcess=$null
if(Test-Path -LiteralPath $statePath){
  $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -DateKind String
  $candidate=Get-Process -Id $state.processId -ErrorAction SilentlyContinue
  if($candidate){
    if($candidate.Path -ne $state.executable -or [Math]::Abs(($candidate.StartTime.ToUniversalTime()-[DateTime]::Parse($state.startedAt).ToUniversalTime()).TotalSeconds) -gt 2){throw 'Recorded process identity changed. No process was controlled.'}
    $ownedProcess=$candidate
  }
}
if($Action -eq 'Status'){[pscustomobject]@{running=($null -ne $ownedProcess);url='http://127.0.0.1:3220'};return}
if($Action -eq 'Stop'){
  if($ownedProcess){
    # Next's dev process starts one server child. Verify each child command is
    # from this project's Next installation before stopping that exact child.
    $children=Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ownedProcess.Id)"
    foreach($child in $children){
      if($child.Name -eq 'conhost.exe' -and $child.ExecutablePath -eq (Join-Path $env:SystemRoot 'System32/conhost.exe')){continue}
      if($child.Name -ne 'node.exe' -or $child.CommandLine -notlike "*$projectPath*next*"){throw 'Unexpected child process; inspect before stopping.'}
      Stop-Process -Id $child.ProcessId
    }
    Stop-Process -Id $ownedProcess.Id -ErrorAction SilentlyContinue
  }
  Write-Output 'Local app stopped; data and protected configuration remain.';return
}
if($ownedProcess){Write-Output 'Local app is already running at http://127.0.0.1:3220';return}
if(Get-NetTCPConnection -LocalPort 3220 -State Listen -ErrorAction SilentlyContinue){throw 'Port 3220 is occupied. No existing listener was stopped.'}
if(-not (Test-Path -LiteralPath $appEnvPath)){
  $authSecret=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
  $envelopeKey=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  [IO.File]::WriteAllText($appEnvPath,"BETTER_AUTH_URL=http://127.0.0.1:3220`nBETTER_AUTH_SECRET=$authSecret`nBRIDGE_ENVELOPE_KEY=$envelopeKey`n",[Text.UTF8Encoding]::new($false))
}
$prior=@{}
try{
  foreach($file in @((Join-Path $runtimePath 'development.env'),$appEnvPath)){
    foreach($line in Get-Content -LiteralPath $file){
      if($line -match '^(DATABASE_URL|BETTER_AUTH_URL|BETTER_AUTH_SECRET|BRIDGE_ENVELOPE_KEY)=(.+)$'){
        $name=$Matches[1];if(-not $prior.ContainsKey($name)){$prior[$name]=[Environment]::GetEnvironmentVariable($name)}
        [Environment]::SetEnvironmentVariable($name,$Matches[2])
      }
    }
  }
  $nodePath=(Get-Command node.exe -ErrorAction Stop).Source
  if($Mode -eq 'Production' -and ([Uri]$env:BETTER_AUTH_URL).Scheme -ne 'https'){
    throw 'Production owner authentication requires an HTTPS origin. Use Development for the local HTTP pilot, or configure an approved HTTPS ingress first.'
  }
  $nextPath=Join-Path $projectPath 'node_modules/next/dist/bin/next'
  $nextCommand=if($Mode -eq 'Production'){'start'}else{'dev'}
  $process=Start-Process -FilePath $nodePath -ArgumentList @(('"'+$nextPath+'"'),$nextCommand,'--hostname','127.0.0.1','--port','3220') -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'app-stdout.log') -RedirectStandardError (Join-Path $runtimePath 'app-stderr.log')
  [IO.File]::WriteAllText($statePath,(@{processId=$process.Id;executable=$process.Path;startedAt=$process.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  Write-Output 'Local app starting at http://127.0.0.1:3220. Secrets were stored only in the protected runtime directory.'
}finally{foreach($name in $prior.Keys){[Environment]::SetEnvironmentVariable($name,$prior[$name])}}
