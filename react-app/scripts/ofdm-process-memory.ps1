param([Parameter(Mandatory=$true)][string]$ProbeIds)
$ErrorActionPreference = 'Stop'
$rows = foreach ($value in $ProbeIds.Split(',')) {
  $probePid = [int]$value
  if ($probePid -le 0) { throw 'Invalid probe process ID' }
  try {
    $process = [System.Diagnostics.Process]::GetProcessById($probePid)
    $process.Refresh()
    [pscustomobject]@{ id=$probePid; name=$process.ProcessName; workingSetBytes=$process.WorkingSet64; peakWorkingSetBytes=$process.PeakWorkingSet64; privateBytes=$process.PrivateMemorySize64; exited=$false }
    $process.Dispose()
  } catch {
    [pscustomobject]@{ id=$probePid; exited=$true; error=$_.Exception.Message }
  }
}
ConvertTo-Json -InputObject @($rows) -Compress
