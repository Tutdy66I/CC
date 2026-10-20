param(
  [switch]$Production,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$taskPrevious = @{}
foreach ($taskName in @('AI_BASE_URL', 'AI_MODEL', 'AI_THINKING', 'AI_API_KEY')) {
  $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process')
}

try {
  $env:AI_BASE_URL = 'https://api.deepseek.com'
  $env:AI_MODEL = 'deepseek-flash'
  $env:AI_THINKING = 'disabled'
  if (-not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
    $env:AI_API_KEY = $env:DEEPSEEK_API_KEY
  } elseif ($taskPrevious['AI_BASE_URL'] -notin @('https://api.deepseek.com', 'https://api.deepseek.com/v1')) {
    $env:AI_API_KEY = ''
  }
  if ($CheckOnly) {
    [PSCustomObject]@{
      BaseUrl = $env:AI_BASE_URL
      Model = $env:AI_MODEL
      Thinking = $env:AI_THINKING
      KeyConfigured = -not [string]::IsNullOrWhiteSpace($env:AI_API_KEY)
    } | Format-List | Out-Host
    exit 0
  }
  if ([string]::IsNullOrWhiteSpace($env:AI_API_KEY)) {
    $taskSecureKey = Read-Host 'DeepSeek API Key (hidden input)' -AsSecureString
    $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecureKey)
    try {
      $env:AI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
      $taskSecureKey.Dispose()
    }
  }
  if ([string]::IsNullOrWhiteSpace($env:AI_API_KEY)) { throw 'API key is required.' }
  Push-Location (Split-Path -Parent $PSScriptRoot)
  try {
    if ($Production) {
      & npm.cmd run build
      if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
      & npm.cmd start
    } else {
      & npm.cmd run dev -- --host 127.0.0.1
    }
    if ($LASTEXITCODE -ne 0) { throw 'Server exited with an error.' }
  } finally { Pop-Location }
} finally {
  foreach ($taskName in $taskPrevious.Keys) {
    [Environment]::SetEnvironmentVariable($taskName, $taskPrevious[$taskName], 'Process')
  }
}
