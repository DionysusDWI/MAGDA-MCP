param(
    [string]$Executable = 'F:\MAGDA\MAGDA.exe',
    [ValidateSet('read', 'edit')][string]$Permissions = 'edit'
)
$ErrorActionPreference = 'Stop'
if (Get-Process MAGDA -ErrorAction SilentlyContinue) { throw 'MAGDA is already running. Use its existing endpoint or close it before launching an isolated acceptance instance.' }
$workspace = Split-Path $PSScriptRoot -Parent
$liveDirectory = Join-Path $workspace 'artifacts\live\runtime'
New-Item -ItemType Directory -Path $liveDirectory -Force | Out-Null
$scopes = @('read')
if ($Permissions -eq 'edit') { $scopes += @('edit', 'transport', 'session') }
$config = @{
    remoteApi = @{ enabled = $false; websocket = $false; mcp = $true; port = 0; mcpPort = 0; allowedOrigins = @(); clients = @(@{name = 'magda-mcp/live-acceptance'; scopes = $scopes}) }
    dataDir = $liveDirectory
    presetsDir = (Join-Path $liveDirectory 'presets')
    renderFolder = (Join-Path $liveDirectory 'renders')
    recentProjects = @()
    scanPluginsOnStartup = $false
    loadModelOnStartup = $false
    loadSampleTaggerOnStartup = $false
    autoCheckUpdates = $false
    autoSaveEnabled = $false
    showRightPanel = $false
}
$configPath = Join-Path $liveDirectory 'config.json'
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8
$environmentKeys = @('MAGDA_CONFIG_FILE', 'MAGDA_DATA_DIR', 'MAGDA_PRESETS_DIR', 'MAGDA_RENDER_DIR')
$previousEnvironment = @{}
foreach ($key in $environmentKeys) { $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    $env:MAGDA_CONFIG_FILE = $configPath
    $env:MAGDA_DATA_DIR = $liveDirectory
    $env:MAGDA_PRESETS_DIR = Join-Path $liveDirectory 'presets'
    $env:MAGDA_RENDER_DIR = Join-Path $liveDirectory 'renders'
    $process = Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
} finally {
    foreach ($key in $environmentKeys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
}
[pscustomobject]@{ pid = $process.Id; dataDir = $liveDirectory; permissions = $Permissions; configIsolated = $true } | ConvertTo-Json
