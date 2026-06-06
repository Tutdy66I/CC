# Claude Code TaskCompleted notification with orange Claude icon
# Usage: echo '{"hook_event_name":"TaskCompleted",...}' | powershell -File task-complete-notify.ps1

$iconPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\claude-color.png"))

$inputJson = $input | Out-String

if (-not [string]::IsNullOrWhiteSpace($inputJson)) {
  try {
    $data = $inputJson | ConvertFrom-Json
  } catch {
    $data = $null
  }
}

$title = "Claude Code"
$body = "后台任务已完成"

if ($data.task_type) {
  $body = "任务完成: $($data.task_type)"
}
if ($data.tool_input -and $data.tool_input.description) {
  $body = $body + " - " + $data.tool_input.description
}

Import-Module BurntToast -ErrorAction SilentlyContinue

New-BurntToastNotification `
  -Text $title, $body `
  -AppLogo $iconPath `
  -Silent

Write-Output "Notification sent: $body"
