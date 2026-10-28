param([Parameter(Mandatory=$true)][ValidateRange(0,2)][int]$SeedOffset,[string]$ResumePath,[ValidateSet('preflight','formal')][string]$Action='preflight',[string]$AuthorizationPath)
$ErrorActionPreference='Stop'
$app=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $app
$node=(Get-Command node.exe -ErrorAction Stop).Source
function AssertNoReparseAncestors([string]$path) {
  $current=[IO.Path]::GetFullPath($path)
  while ($current) {
    if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Study path and ancestors cannot be reparse points' }
    $parent=[IO.Directory]::GetParent($current)
    $current=if ($parent) { $parent.FullName } else { $null }
  }
}
if ($Action -eq 'formal' -and (-not $ResumePath -or -not $AuthorizationPath -or $SeedOffset -ne 0)) { throw 'Formal execution requires an existing prepared study and separate authorization' }
if ($ResumePath) {
  $root=[IO.Path]::GetFullPath($ResumePath)
  $leaf=if ($Action -eq 'formal') { 'signallab-v14-study-formal' } else { 'signallab-v14-study-preflight' }
  $base=[IO.Path]::GetFullPath((Join-Path $app ('..\output\'+$leaf))) + [IO.Path]::DirectorySeparatorChar
  if (-not $root.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) { throw 'Resume path outside preflight directory' }
  $item=Get-Item -LiteralPath $root
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe preflight path' }
  AssertNoReparseAncestors $root
  $meta=[pscustomobject]@{root=$root;identity=(Join-Path $root 'identity.json');buildSeconds=0}
} else {
  $prepared=& $node (Join-Path $PSScriptRoot 'v14-study-prepare.mjs') $SeedOffset
  if ($LASTEXITCODE -ne 0) { throw 'Preflight preparation failed; retain its files' }
  $meta=$prepared | ConvertFrom-Json
}
AssertNoReparseAncestors $meta.root
Add-Type -Path (Join-Path $PSScriptRoot 'ofdm-study-guard.cs')
$guard=$null
$runLock=$null
function HashBytes([byte[]]$value) { $h=[Security.Cryptography.SHA256]::Create(); try { ([BitConverter]::ToString($h.ComputeHash($value))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() } }
$watch=[Diagnostics.Stopwatch]::StartNew()
try {
  $runLock=New-Object IO.FileStream((Join-Path $meta.root 'run.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $coord=Join-Path $meta.root 'coordination'; [IO.Directory]::CreateDirectory($coord) | Out-Null
  $marker=Join-Path $coord 'publication.lock'
  if (Test-Path -LiteralPath $marker) {
    $item=Get-Item -LiteralPath $marker
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 1024) { throw 'Unsafe stale marker' }
    $oldBytes=[IO.File]::ReadAllBytes($marker)
    $old=[Text.Encoding]::UTF8.GetString($oldBytes) | ConvertFrom-Json
    if ($old.pid -isnot [int] -or $old.pid -le 0 -or (Get-Process -Id $old.pid -ErrorAction SilentlyContinue)) { throw 'Cannot verify abandoned marker owner; preserve evidence' }
    $saved=Join-Path $coord ('abandoned-'+[Guid]::NewGuid().ToString('N')+'.json')
    $file=[IO.File]::Open($saved,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $file.Write($oldBytes,0,$oldBytes.Length); $file.Flush($true) } finally { $file.Dispose() }
    Remove-Item -LiteralPath $marker
  }
  $leases=Join-Path $meta.root 'leases'; [IO.Directory]::CreateDirectory($leases) | Out-Null
  $prior=@(Get-ChildItem -LiteralPath $leases -File -Filter '*.json' | Sort-Object Name)
  if ((Test-Path -LiteralPath (Join-Path $meta.root 'manifest.json')) -and $prior.Count -eq 0) { throw 'Missing resource lease; preserve evidence' }
  $previous=$null
  for ($i=0; $i -lt $prior.Count; $i++) {
    if ($prior[$i].Name -ne ('{0:d6}.json' -f $i)) { throw 'Missing or reordered resource lease' }
    $oldBytes=[IO.File]::ReadAllBytes($prior[$i].FullName)
    if ([Convert]::ToBase64String($oldBytes) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($prior[$i].FullName+'.backup'))) { throw 'Resource lease backup mismatch' }
    $entry=[Text.Encoding]::UTF8.GetString($oldBytes) | ConvertFrom-Json
    if ($entry.sequence -ne $i -or $entry.previous -ne $previous -or $entry.reservedSeconds -ne 60 -or $entry.limitSeconds -ne 3600) { throw 'Invalid resource lease' }
    $previous=HashBytes $oldBytes
  }
  if (@(Get-ChildItem -LiteralPath $leases -File).Count -ne $prior.Count*2) { throw 'Unexpected resource lease files' }
  if ($prior.Count -ge 60) { throw 'Cumulative time budget exhausted' }
  $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($meta.root))
  if ($drive.AvailableFreeSpace -lt 8589934592L) { throw 'At least 8 GiB free is required at every session start' }
  if ($drive.DriveFormat -ne 'NTFS') { throw 'Native study requires NTFS' }
  $session=[Guid]::NewGuid().ToString('N')
  $lease=[ordered]@{sequence=$prior.Count;previous=$previous;session=$session;reservedSeconds=60;limitSeconds=3600;freeBytes=$drive.AvailableFreeSpace;filesystem=$drive.DriveFormat}
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($lease | ConvertTo-Json -Compress))
  $leasePath=Join-Path $leases ('{0:d6}.json' -f $prior.Count)
  foreach ($path in @($leasePath,($leasePath+'.backup'))) {
    $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
  }
  $sessions=Join-Path $meta.root 'sessions'; [IO.Directory]::CreateDirectory($sessions) | Out-Null
  $argsList=@('--max-old-space-size=320',(Join-Path $PSScriptRoot 'v14-study-runner.mjs'),$Action,[string]$meta.root,[string]$SeedOffset,[string]$meta.identity)
  if ($Action -eq 'formal') { $argsList+=([IO.Path]::GetFullPath($AuthorizationPath)) }
  $log=Join-Path $sessions ($session+'.log')
  $env:SIGNALLAB_V14_GUARD_SESSION=$session
  $guard=[OfdmStudyGuard]::Start($node,$argsList,$app,$log)
  Remove-Item Env:SIGNALLAB_V14_GUARD_SESSION
  $remaining=58000-[int]$watch.ElapsedMilliseconds
  if ($remaining -le 0) { throw 'Session budget exhausted before numerical start' }
  $guard.SetDeadlineMilliseconds($remaining,$true)
  $guard.Resume()
  while (-not $guard.Exited) { Start-Sleep -Milliseconds 25 }
  $result=[ordered]@{ schema='signallab-v14-resource-session-1'; action=$Action; root=$meta.root; session=$session; seedOffset=$SeedOffset; exitCode=$guard.ExitCode; deadlineExpired=$guard.DeadlineExpired; hardWorkingSet=$guard.HardWorkingSet; peakWorkingSetBytes=$guard.PeakBytes; peakJobCommitBytes=$guard.PeakJobCommitBytes; elapsedSeconds=$watch.Elapsed.TotalSeconds; buildSeconds=$meta.buildSeconds; cumulativeReservedSeconds=60*($prior.Count+1) }
  $path=Join-Path $sessions ($session+'-report.json')
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($result | ConvertTo-Json -Compress))
  $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
  $result | ConvertTo-Json -Compress
  if ($guard.ExitCode -ne 0 -or $guard.DeadlineExpired -or -not $guard.HardWorkingSet) { throw 'Preflight failed; keep logs and evidence' }
} finally { if ($guard) { $guard.Dispose() }; if ($runLock) { $runLock.Dispose() } }
