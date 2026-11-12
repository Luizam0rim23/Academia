# Instalador do Treino do Dia no Windows: o computador é o servidor; o site é publicado com HTTPS pelo
# Tailscale Funnel (somente no computador). No celular, nada além do app de envio de saúde.
# Uso (PowerShell, sem privilégios de administrador):
#   irm https://raw.githubusercontent.com/Luizam0rim23/Academia/main/scripts/windows-instalar.ps1 | iex
# Pode ser executado novamente para atualizar: preserva configuração (.env) e dados.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'Luizam0rim23/Academia'
$Base = Join-Path $env:USERPROFILE 'TreinoDoDia'
$App = Join-Path $Base 'app'
$Porta = 3000
$Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'

function Etapa([string]$texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }
function Atualizar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Definir-Variavel([string]$arquivo, [string]$chave, [string]$valor) {
  $linhas = @(Get-Content -LiteralPath $arquivo -Encoding UTF8)
  $achou = $false
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    if ($linhas[$i] -match "^\s*$chave\s*=") { $linhas[$i] = "$chave=$valor"; $achou = $true }
  }
  if (-not $achou) { $linhas += "$chave=$valor" }
  [IO.File]::WriteAllLines($arquivo, [string[]]$linhas)
}
function Pasta-GoogleDrive {
  $candidatos = @()
  foreach ($d in (Get-PSDrive -PSProvider FileSystem)) {
    foreach ($n in @('Meu Drive', 'My Drive')) { $candidatos += (Join-Path $d.Root $n) }
  }
  $candidatos += @((Join-Path $env:USERPROFILE 'Google Drive'), (Join-Path $env:USERPROFILE 'Meu Drive'), (Join-Path $env:USERPROFILE 'My Drive'))
  foreach ($c in $candidatos) { if (Test-Path -LiteralPath $c) { return $c } }
  return $null
}

Etapa '1/6 Node.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
    Atualizar-Path
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Start-Process 'https://nodejs.org/pt'
    throw 'Instale o Node.js (versão LTS) pelo site que foi aberto e execute este comando novamente.'
  }
}
$Node = (Get-Command node).Source
Write-Host "Node.js: $(& $Node --version)"

Etapa '2/6 Encerrando versão em execução (se houver)'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$App*server.js*" } |
  ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null; Write-Host "Processo $($_.ProcessId) encerrado." }

Etapa '3/6 Baixando o aplicativo'
$tmp = Join-Path $env:TEMP ('treino-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp 'app.zip'
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$origem = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $App | Out-Null
Copy-Item -Path (Join-Path $origem.FullName '*') -Destination $App -Recurse -Force
Remove-Item -LiteralPath $tmp -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $App 'data') | Out-Null
Write-Host "Aplicativo em $App"

Etapa '4/6 Configuração'
$EnvFile = Join-Path $App '.env'
if (Test-Path -LiteralPath $EnvFile) {
  Write-Host 'Configuração existente preservada.'
} else {
  $seg = Read-Host 'Crie uma senha de acesso ao aplicativo (mínimo 8 caracteres)' -AsSecureString
  $senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
  if ($senha.Length -lt 8) { throw 'A senha deve ter ao menos 8 caracteres. Execute o comando novamente.' }
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  [IO.File]::WriteAllLines($EnvFile, [string[]]@(
    'HOST=127.0.0.1',
    "PORT=$Porta",
    "BASE_URL=http://localhost:$Porta",
    "APP_PASSWORD=$senha",
    "HEALTH_WEBHOOK_TOKEN=$token",
    'RESUMO_DIR='
  ))
  Write-Host 'Configuração criada.'
}
# Pasta do Google Drive para o resumo (lido pelo Claude via conector do Google Drive).
$drive = Pasta-GoogleDrive
if ($drive) {
  $destino = Join-Path $drive 'Treino do Dia'
  Definir-Variavel $EnvFile 'RESUMO_DIR' $destino
  Write-Host "Resumo diário será gravado em: $destino"
} else {
  Write-Warning 'Google Drive para computador não encontrado. Instale-o (google.com/drive/download), faça login e execute este comando novamente para ativar o resumo para o Claude.'
}

Etapa '5/6 Início automático e Tailscale'
$Log = Join-Path $App 'data\servidor.log'
$alvo = 'cmd /c ""' + $Node + '" "' + (Join-Path $App 'server.js') + '" >> "' + $Log + '" 2>&1"'
$Vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'TreinoDoDia.vbs'
Set-Content -LiteralPath $Vbs -Encoding Unicode -Value ('CreateObject("WScript.Shell").Run "' + $alvo.Replace('"', '""') + '", 0, False')
Write-Host 'Início automático configurado (ao entrar no Windows).'

if (-not (Test-Path -LiteralPath $Tailscale)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Instalando o Tailscale (publica o site com HTTPS, sem abrir portas no roteador)...'
    winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements --silent
  } else {
    Start-Process 'https://tailscale.com/download/windows'
  }
}

Etapa '6/6 Iniciando e publicando'
Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $Vbs + '"')
Start-Sleep -Seconds 3
$ok = $false
try { $ok = (Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Porta/healthz" -TimeoutSec 5).StatusCode -eq 200 } catch { }
if ($ok) { Write-Host 'Aplicativo em execução.' -ForegroundColor Green } else { Write-Warning "O aplicativo não respondeu. Veja o registro: $Log" }

# Publicação com HTTPS pelo Tailscale Funnel (requer login no Tailscale neste computador).
$Publico = $null
$logado = $false
if (Test-Path -LiteralPath $Tailscale) {
  try { $estado = (& $Tailscale status --json 2>$null | Out-String | ConvertFrom-Json); $logado = $estado.BackendState -eq 'Running' } catch { }
  if ($logado) {
    $saida = (& $Tailscale funnel --bg $Porta 2>&1 | Out-String)
    $link = [regex]::Match($saida, 'https://login\.tailscale\.com/\S+').Value
    if ($link) {
      Start-Process $link
      Write-Warning 'Autorize o Funnel/HTTPS na página aberta do Tailscale e execute este comando de instalação novamente.'
    } else {
      $Publico = 'https://' + $estado.Self.DNSName.TrimEnd('.')
      Definir-Variavel $EnvFile 'WEBHOOK_URL' "$Publico/api/saude/webhook"
      # Reinicia para aplicar o endereço público exibido na página
      Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$App*server.js*" } | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
      Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $Vbs + '"')
      Write-Host "Site publicado: $Publico" -ForegroundColor Green
    }
  } else {
    Start-Process $Tailscale -ErrorAction SilentlyContinue
    Write-Warning 'Entre no Tailscale (ícone ao lado do relógio do Windows) e execute este comando de instalação novamente para publicar o site.'
  }
}
Start-Process "http://localhost:$Porta"

$enderecoSite = if ($Publico) { $Publico } else { '(pendente: login no Tailscale e nova execução do instalador)' }
Write-Host @"

Resumo
- Neste computador:      http://localhost:$Porta
- Celular e qualquer lugar (navegador): $enderecoSite
- App de sono (destino): $enderecoSite/api/saude/webhook   (segredo: botão Copiar segredo na página)
- Atualizar:             execute novamente o mesmo comando de instalação
- Registro (log):        $Log

Mantenha o computador ligado e sem suspensão na tomada (Configurações > Sistema > Energia).
"@
