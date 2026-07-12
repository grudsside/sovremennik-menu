$ErrorActionPreference = 'Stop'

Write-Host "Исправление Push-уведомлений v20" -ForegroundColor Cyan
Write-Host "Этот скрипт вставит VAPID_PUBLIC_KEY в сайт и создаст чистую папку для GitHub." -ForegroundColor Cyan
Write-Host "Вставляйте только публичный ключ. VAPID_PRIVATE_KEY сюда не вставлять." -ForegroundColor Yellow
Write-Host ""

$Source = Get-Location
$Config = Join-Path $Source "assets\js\supabase-config.js"
if (!(Test-Path $Config)) {
    throw "Не найден файл assets\js\supabase-config.js. Запустите скрипт из распакованной папки сайта v20."
}

$Vapid = Read-Host "Вставьте VAPID_PUBLIC_KEY"
$Vapid = $Vapid.Trim()
$Vapid = $Vapid -replace '^VAPID_PUBLIC_KEY\s*=\s*', ''
$Vapid = $Vapid.Trim().Trim("'").Trim('"')

if ([string]::IsNullOrWhiteSpace($Vapid)) {
    throw "VAPID_PUBLIC_KEY пустой."
}
if ($Vapid -match 'PRIVATE|SUPABASE|SERVICE_ROLE|CRON_SECRET') {
    throw "Похоже, вы вставили не публичный VAPID-ключ. Остановлено для безопасности."
}
if ($Vapid -match '\s') {
    throw "В ключе есть пробелы или переносы строк. Скопируйте значение VAPID_PUBLIC_KEY одной строкой."
}

$content = Get-Content $Config -Raw -Encoding UTF8
$content = [regex]::Replace($content, "vapidPublicKey:\s*'[^']*'", "vapidPublicKey: '$Vapid'")
Set-Content -Path $Config -Value $content -Encoding UTF8
Write-Host "VAPID_PUBLIC_KEY вставлен в assets/js/supabase-config.js" -ForegroundColor Green

$Out = Join-Path $Source "GITHUB_UPLOAD_READY"
if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Path $Out | Out-Null

$RootFiles = @(
    "index.html",
    ".nojekyll",
    "manifest.webmanifest",
    "service-worker.js",
    "photos_mapping_template.csv"
)
foreach ($file in $RootFiles) {
    $src = Join-Path $Source $file
    if (Test-Path $src) {
        Copy-Item $src -Destination (Join-Path $Out $file) -Force
    }
}

$RootDirs = @("assets", "data")
foreach ($dir in $RootDirs) {
    $src = Join-Path $Source $dir
    if (Test-Path $src) {
        Copy-Item $src -Destination (Join-Path $Out $dir) -Recurse -Force
    }
}

# Защита: удаляем то, что точно нельзя случайно загрузить.
$BlockedInsideOut = @(
    "node_modules", "supabase", "tools", "vapid.env", "package.json", "package-lock.json",
    "PUSH_SETUP_V19.md", "PUSH_SETUP_V20_FIX.md", "README.md", "README_UPLOAD_FIRST.md",
    "README_V19_PUSH_SHORT.md", "SUPABASE_NEXT_STEPS.md", "SUPABASE_V18_PATCH_STEPS.md"
)
foreach ($item in $BlockedInsideOut) {
    $target = Join-Path $Out $item
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
}

$checkConfig = Get-Content (Join-Path $Out "assets\js\supabase-config.js") -Raw -Encoding UTF8
if ($checkConfig -match "PASTE_VAPID_PUBLIC_KEY_HERE") {
    throw "Публичный ключ не вставился. Не загружайте папку на GitHub, напишите мне."
}

$count = (Get-ChildItem $Out -Recurse -File | Measure-Object).Count
Write-Host ""
Write-Host "Готово. Создана папка:" -ForegroundColor Green
Write-Host $Out -ForegroundColor Green
Write-Host "Файлов для загрузки: $count" -ForegroundColor Green
Write-Host ""
Write-Host "На GitHub загружайте содержимое папки GITHUB_UPLOAD_READY, не саму папку." -ForegroundColor Yellow
Write-Host "Не загружайте vapid.env, node_modules, supabase и tools." -ForegroundColor Yellow
