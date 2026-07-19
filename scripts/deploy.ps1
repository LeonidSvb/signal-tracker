param([switch]$SkipBuild)

$KEY = "$env:USERPROFILE\.ssh\id_ed25519_hostinger"
$SSH_HOST = "leonid@152.53.194.162"
$APP_DIR = "/opt/apps/signal-tracker"
$NEXTJS_DIR = "$PSScriptRoot\..\nextjs"
$PIPELINE_CONFIG_DIR = "$PSScriptRoot\..\pipeline\config"

# Step 1: Build (unless skipped)
if (-not $SkipBuild) {
    Write-Host "=== Building Next.js ===" -ForegroundColor Cyan
    Set-Location $NEXTJS_DIR
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host "BUILD FAILED" -ForegroundColor Red; exit 1 }
}

# Step 2: Package
Write-Host "=== Packaging ===" -ForegroundColor Cyan
Set-Location $NEXTJS_DIR
tar --exclude=".next/standalone/.next/cache" --exclude=".next/standalone/node_modules" -czf "$env:TEMP\st-app.tar.gz" -C .next/standalone .
tar -czf "$env:TEMP\st-static.tar.gz" -C .next static
tar -czf "$env:TEMP\st-pipeline-config.tar.gz" -C $PIPELINE_CONFIG_DIR copy_templates.json icp_filter.json
Write-Host "Packages ready"

# Step 3: Upload
Write-Host "=== Uploading to server ===" -ForegroundColor Cyan
scp -i $KEY "$env:TEMP\st-app.tar.gz" "$env:TEMP\st-static.tar.gz" "$env:TEMP\st-pipeline-config.tar.gz" "${SSH_HOST}:/tmp/"

# Step 4: Deploy on server
Write-Host "=== Deploying on server ===" -ForegroundColor Cyan
ssh -i $KEY $SSH_HOST @"
set -e
cd $APP_DIR
tar -xzf /tmp/st-app.tar.gz --overwrite
mkdir -p .next && tar -xzf /tmp/st-static.tar.gz -C .next --overwrite
mkdir -p /opt/apps/pipeline/config && tar -xzf /tmp/st-pipeline-config.tar.gz -C /opt/apps/pipeline/config --overwrite
printf 'PORT=3099\nNODE_ENV=production\nHOSTNAME=0.0.0.0\nNEXT_PUBLIC_SUPABASE_URL=https://supabase.pamelacoreypc.com\nNEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc3NDQ1MDc0LCJleHAiOjk5OTk5OTk5OTl9.7_gz6Kr2QyIfYNO9v1bvvYSHJUuusqgwxbsnqTfMDrQ\nSUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3Nzc0NDUwNzQsImV4cCI6OTk5OTk5OTk5OX0.bP8P8ivFjcvcf0bD_Nk4Zpq3lAd_OCb_tc8opZ91u8M\nNEXT_PUBLIC_CLIENT_SLUG=philippe-bosquillon\n' > .env
echo '31ib*lH0WJKDC#qilDptlM0e' | sudo -S systemctl restart signal-tracker
sleep 3 && systemctl is-active signal-tracker && echo 'SERVICE ACTIVE'
curl -s http://localhost:3099 | head -c 60
"@

Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Live at: https://philippe.pamelacoreypc.com" -ForegroundColor Green
