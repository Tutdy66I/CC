param(
  [Parameter(Mandatory=$true)][ValidateSet('prepare','preflight','resume','formal','request-stop')][string]$Action,
  [Parameter(Mandatory=$true)][string]$Directory,
  [ValidateSet(0,1)][int]$StopAfterGroups=0,
  [string]$AuthorizationPath=''
)
$ErrorActionPreference='Stop'
if ($MyInvocation.InvocationName -eq '.' -or [Environment]::CommandLine -notmatch '(?i)-NonInteractive' -or [Environment]::CommandLine -notmatch '(?i)-File') { throw 'Use a separate powershell.exe -NonInteractive -File host, never an interactive or dot-sourced shell' }
$watch=[Diagnostics.Stopwatch]::StartNew()
$studyRoot=[IO.Path]::GetFullPath($Directory)
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function AssertNoReparseAncestors([string]$path) {
  $current=[IO.Path]::GetFullPath($path)
  while ($current) {
    if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Study path and ancestors cannot be reparse points or volume mount points' }
    $parent=[IO.Directory]::GetParent($current)
    $current=if ($parent) { $parent.FullName } else { $null }
  }
}
AssertNoReparseAncestors $studyRoot
function Digest([byte[]]$bytes) { $h=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() } }
function WriteNew([string]$path,[string]$text) {
  $data=[Text.Encoding]::UTF8.GetBytes($text)
  $f=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try { $f.Write($data,0,$data.Length); $f.Flush($true) } finally { $f.Dispose() }
}
function FinalizeCandidate([object]$candidate,[string]$nativeSession) {
  if ($candidate.independentTrialVectors -ne 36000 -or $candidate.familySize -ne 32 -or $candidate.primaryComparisons.Count -ne 32 -or $candidate.mode -ne 'formal') { throw 'Fixed-horizon analysis incomplete' }
  foreach ($row in $candidate.primaryComparisons) {
    if ($row.frameObservations -ne 36000 -or $null -eq $row.candidateSimultaneous95Interval) { throw 'Missing independent analysis' }
    $row.simultaneous95Interval=$row.candidateSimultaneous95Interval; $row.precisionAchieved=$row.candidatePrecisionAchieved; $row.directionSupported=$row.candidateDirectionSupported; $row.statisticalRadius=[Math]::Sqrt(2*[Math]::Log(2*32/0.05)/36000)
  }
  $candidate.formalFixedHorizonComplete=$true; $candidate.analysisProvisional=$false
  $candidate | Add-Member -NotePropertyName publicationCondition -NotePropertyValue ('Valid only with a matching successful native settlement for session '+$nativeSession)
  return $candidate
}
if ($Action -eq 'request-stop') {
  if ((Get-Item -LiteralPath $studyRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Study root cannot be a reparse point' }
  $stopLeases=Join-Path $studyRoot 'leases'
  if ((Get-Item -LiteralPath $stopLeases).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Ledger cannot be a reparse point' }
  $stopPrevious=$null; $stopIndex=0; $current=$null
  foreach ($f in @(Get-ChildItem -LiteralPath $stopLeases -File -Filter '*.json' | Sort-Object Name)) {
    if ($f.Name -ne ('{0:d6}.json' -f $stopIndex)) { throw 'Resource journal sequence mismatch' }
    $b=[IO.File]::ReadAllBytes($f.FullName); $e=[Text.Encoding]::UTF8.GetString($b) | ConvertFrom-Json
    if ($e.previous -ne $stopPrevious -or $e.seq -ne $stopIndex -or $e.session -isnot [string] -or $e.session -notmatch '^[a-f0-9]{32}$' -or [Convert]::ToBase64String($b) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName+'.backup'))) { throw 'Invalid stop-request resource journal' }
    $stopPrevious=Digest $b; $stopIndex++; $current=$e
  }
  if (-not $current -or $current.kind -ne 'grant') { throw 'No active study session' }
  $stopDir=Join-Path $studyRoot 'stop-requests'; [IO.Directory]::CreateDirectory($stopDir) | Out-Null
  if ((Get-Item -LiteralPath $stopDir).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Stop directory cannot be a reparse point' }
  $stopFile=Join-Path $stopDir ($current.session+'.json')
  if (-not (Test-Path -LiteralPath $stopFile)) { WriteNew $stopFile ('{"session":"'+$current.session+'"}') }
  Write-Output 'Stop requested; the verified prefix and pending attempts are preserved.'; exit 0
}
if (-not (Test-Path -LiteralPath $studyRoot)) {
  if ($Action -notin @('prepare','preflight')) { throw 'Study directory missing' }
  [IO.Directory]::CreateDirectory($studyRoot) | Out-Null
}
if ((Get-Item -LiteralPath $studyRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Study root cannot be a reparse point' }
foreach ($name in @('leases','sessions','host-tmp','groups','pending','receipts','reports','source','authorizations','stop-requests')) { $p=Join-Path $studyRoot $name; if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Study subdirectory cannot be a reparse point' } }
$lock=New-Object IO.FileStream((Join-Path $studyRoot 'run.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$guard=$null
try {
  $manifestFile=Join-Path $studyRoot 'manifest.json'
  $mode=if ($Action -eq 'prepare') { 'formal' } else { 'engineering' }
  if (Test-Path -LiteralPath $manifestFile) {
    $bytes=[IO.File]::ReadAllBytes($manifestFile)
    if ((Digest $bytes) -ne [IO.File]::ReadAllText((Join-Path $studyRoot 'manifest.sha256'))) { throw 'Manifest integrity failure' }
    if ([Convert]::ToBase64String($bytes) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($manifestFile+'.backup'))) { throw 'Manifest backup mismatch' }
    $manifest=[Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    $mode=$manifest.mode
    if ($mode -notin @('formal','engineering')) { throw 'Invalid mode' }
  } elseif (@(Get-ChildItem -LiteralPath $studyRoot -Force | Where-Object Name -ne 'run.lock').Count -gt 0) { throw 'Existing incomplete directory: never create a new budget over old data' }
  if ($Action -eq 'formal' -and ($mode -ne 'formal' -or -not $AuthorizationPath)) { throw 'Separate exact-manifest authorization required' }
  if ($Action -in @('preflight','resume') -and $mode -ne 'engineering') { throw 'Engineering commands cannot execute a formal study' }
  $timeLimit=if ($mode -eq 'formal') { 7200000L } else { 120000L }
  $diskLimit=if ($mode -eq 'formal') { 17179869184L } else { 134217728L }
  if ($manifest -and ($manifest.limits.activeMs -ne $timeLimit -or $manifest.limits.diskBytes -ne $diskLimit -or $manifest.limits.memoryBytes -ne 536870912)) { throw 'Frozen resource limits mismatch' }
  $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($studyRoot)); if ($drive.AvailableFreeSpace -lt 21474836480L) { throw 'At least 20 GiB free required' }
  if ($drive.DriveFormat -ne 'NTFS') { throw 'Execution requires a local NTFS volume; unsupported durability semantics refused' }
  $leaseDir=Join-Path $studyRoot 'leases'; [IO.Directory]::CreateDirectory($leaseDir) | Out-Null
  $leaseFiles=@(Get-ChildItem -LiteralPath $leaseDir -File -Filter '*.json' | Sort-Object Name)
  if ($manifest -and $leaseFiles.Count -eq 0) { throw 'Missing cumulative ledger: never restart a budget over an existing manifest' }
  $previous=$null; $charged=0L; $seq=0; $oldSession=''; $oldReserved=0L; $settled=$false
  foreach ($f in $leaseFiles) {
    if ($f.Name -ne ('{0:d6}.json' -f $seq)) { throw 'Missing or reordered resource ledger event' }
    $b=[IO.File]::ReadAllBytes($f.FullName)
    if ([Convert]::ToBase64String($b) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName+'.backup'))) { throw 'Resource ledger backup mismatch' }
    $e=[Text.Encoding]::UTF8.GetString($b) | ConvertFrom-Json
    if ($e.seq -ne $seq -or $e.previous -ne $previous -or $e.timeLimitMs -ne $timeLimit -or $e.diskLimitBytes -ne $diskLimit -or $e.memoryBytes -ne 536870912 -or $e.session -isnot [string] -or $e.session -notmatch '^[a-f0-9]{32}$') { throw 'Resource ledger identity mismatch' }
    if ($e.session -ne $oldSession) { $oldSession=$e.session; $oldReserved=0L; $settled=$false }
    if ($e.kind -eq 'grant' -and -not $settled -and $e.reservedMs -gt 0 -and $e.reservedMs -le 30000) { $charged+=$e.reservedMs; $oldReserved+=$e.reservedMs }
    elseif ($e.kind -eq 'settle' -and -not $settled -and $e.usedMs -eq $oldReserved) { $settled=$true }
    else { throw 'Invalid resource settlement' }
    if ($charged -ne $e.chargedMs -or $charged -gt $timeLimit) { throw 'Resource time budget changed or exceeded' }
    $previous=Digest $b; $seq++
  }
  if (@(Get-ChildItem -LiteralPath $leaseDir -File).Count -ne $seq*2) { throw 'Unexpected ledger files' }
  if ($timeLimit-$charged -lt 5000 -or $seq -gt 8000) { throw 'Cumulative resource budget exhausted' }
  $hostTemp=Join-Path $studyRoot ('host-tmp/'+[Guid]::NewGuid().ToString('N')); [IO.Directory]::CreateDirectory($hostTemp) | Out-Null
  $env:TEMP=$hostTemp; $env:TMP=$hostTemp
  Add-Type -Path (Join-Path $PSScriptRoot 'ofdm-study-guard.cs')
  $session=[Guid]::NewGuid().ToString('N'); $reserved=0L; $peak=0L
  [IO.Directory]::CreateDirectory((Join-Path $studyRoot 'sessions')) | Out-Null
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $argsList=@('--max-old-space-size=320',(Join-Path $PSScriptRoot 'ofdm-study-runner.mjs'),$Action,$studyRoot,$session,[string]$StopAfterGroups,$AuthorizationPath)
  $guard=[OfdmStudyGuard]::Start($node,$argsList,$appRoot,(Join-Path $studyRoot ('sessions/'+$session+'.log')))
  function Event([string]$kind,[long]$amount,[long]$used) {
    $usedDisk=0L; Get-ChildItem -LiteralPath $studyRoot -Recurse -File | ForEach-Object { $usedDisk += [long]([Math]::Ceiling($_.Length/4096.0)*4096) }
    if ($usedDisk+65536 -gt $diskLimit) { throw 'Disk budget exhausted before resource journal write' }
    $event=[ordered]@{ schema=1; seq=$script:seq; previous=$script:previous; session=$session; action=$Action; kind=$kind; reservedMs=$amount; usedMs=$used; chargedMs=$script:charged; timeLimitMs=$timeLimit; diskLimitBytes=$diskLimit; memoryBytes=536870912L; childPid=$guard.Pid; hardWorkingSet=$guard.HardWorkingSet; hardWorkingSetCeilingBytes=$guard.WorkingSetCeilingBytes; hostRuntime=($PSVersionTable.PSVersion.ToString()+'/'+[Environment]::Version.ToString()); peakWorkingSetBytes=$script:peak }
    $receiptFile=Join-Path $studyRoot ('receipts/'+$session+'.json')
    if ($kind -eq 'settle') { $event.result=$reason; $event.childExit=$guard.ExitCode }
    if ($kind -eq 'settle' -and (Test-Path -LiteralPath $receiptFile)) { $r=Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json; $event.head=$r.head; $event.groups=$r.groups; $event.receiptSha256=Digest ([IO.File]::ReadAllBytes($receiptFile)); if ($script:finalReportPath) { $event.finalReport=$script:finalReportPath; $event.finalReportSha256=$script:finalReportHash } }
    $text=$event | ConvertTo-Json -Compress
    $path=Join-Path $leaseDir ('{0:d6}.json' -f $script:seq)
    WriteNew $path $text; WriteNew ($path+'.backup') $text
    $script:previous=Digest ([Text.Encoding]::UTF8.GetBytes($text)); $script:seq++
  }
  while ($reserved -lt $watch.ElapsedMilliseconds+5000) {
    if ($timeLimit-$charged -le 0) { throw 'No prepaid execution time remains after validation' }
    $grant=[Math]::Min(30000L,$timeLimit-$charged); $charged+=$grant; $reserved+=$grant; Event 'grant' $grant 0
  }
  $guard.SetDeadlineMilliseconds([int]($reserved-$watch.ElapsedMilliseconds-1000),$true)
  $guard.Resume(); $reason='exited'
  while (-not $guard.Exited) {
    $peak=[Math]::Max($peak,[long]$guard.PeakBytes)
    if ($peak -gt 536870912L) { $reason='memory-limit'; $guard.Kill(); break }
    if ($watch.ElapsedMilliseconds -ge $reserved-5000 -and $timeLimit-$charged -ge 5000) {
      $grant=[Math]::Min(30000L,$timeLimit-$charged); $charged+=$grant; $reserved+=$grant; Event 'grant' $grant 0
      $guard.SetDeadlineMilliseconds([int]($reserved-$watch.ElapsedMilliseconds-1000),$true)
    }
    if ($watch.ElapsedMilliseconds -ge $reserved-1000) { $reason='time-limit'; $guard.Kill(); break }
    Start-Sleep -Milliseconds 50
  }
  $peak=[Math]::Max($peak,[long]$guard.PeakBytes)
  if ($guard.DeadlineExpired) { $reason='time-limit' }
  if ($peak -gt 536870912L) { $reason='memory-limit' }
  $finalReportPath=$null
  $receiptFile=Join-Path $studyRoot ('receipts/'+$session+'.json')
  if ($Action -eq 'formal' -and $reason -eq 'exited' -and $guard.ExitCode -eq 0 -and (Test-Path -LiteralPath $receiptFile)) {
    $r=Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json
    if ($r.groups -eq 450) {
      if ($watch.ElapsedMilliseconds+2500 -gt $reserved) { throw 'Finalization has insufficient prepaid time; keep prefix and reservation' }
      if ($r.candidateReport -ne ('reports/'+$session+'.json')) { throw 'Candidate report identity mismatch' }
      $candidateFile=Join-Path $studyRoot $r.candidateReport
      $candidateBytes=[IO.File]::ReadAllBytes($candidateFile)
      if ($candidateBytes.Length -gt 2097152 -or (Digest $candidateBytes) -ne $r.candidateReportSha256) { throw 'Candidate report integrity mismatch' }
      $candidate=[Text.Encoding]::UTF8.GetString($candidateBytes) | ConvertFrom-Json
      $candidate=FinalizeCandidate $candidate $session
      $finalReportPath='reports/'+$session+'-final.json'
      $text=$candidate | ConvertTo-Json -Compress -Depth 32
      $usedDisk=0L; Get-ChildItem -LiteralPath $studyRoot -Recurse -File | ForEach-Object { $usedDisk += [long]([Math]::Ceiling($_.Length/4096.0)*4096) }
      if ($usedDisk+2*[Text.Encoding]::UTF8.GetByteCount($text)+65536 -gt $diskLimit) { throw 'Disk budget before final report' }
      WriteNew (Join-Path $studyRoot $finalReportPath) $text; WriteNew (Join-Path $studyRoot ($finalReportPath+'.backup')) $text
      $finalReportHash=Digest ([Text.Encoding]::UTF8.GetBytes($text))
    }
  }
  # Never refund a prepaid lease. This covers settlement I/O even if it blocks or the host dies.
  $used=$reserved
  if ($watch.ElapsedMilliseconds -ge $reserved-1000) { throw 'Native deadline exhausted before settlement' }
  Event 'settle' 0 $used
  $result=[ordered]@{ session=$session; reason=$reason; exitCode=$guard.ExitCode; nativeHardGate=$guard.HardWorkingSet; peakWorkingSetMiB=$peak/1048576; peakJobCommitMiB=$guard.PeakJobCommitBytes/1048576; cumulativeChargedSeconds=$charged/1000; usedSeconds=$used/1000; observedSeconds=$watch.Elapsed.TotalSeconds }
  $result | ConvertTo-Json -Compress
  if ($guard.ExitCode -ne 0 -or $reason -ne 'exited') { exit 1 }
} finally { if ($guard) { $guard.Dispose() }; $lock.Dispose() }
