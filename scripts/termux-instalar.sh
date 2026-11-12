#!/data/data/com.termux/files/usr/bin/bash
# Instalador do Treino do Dia no celular Android (Termux).
# Uso:  curl -fsSLo instalar.sh https://raw.githubusercontent.com/Luizam0rim23/Academia/main/scripts/termux-instalar.sh && bash instalar.sh
# Pode ser executado novamente a qualquer momento: atualiza o aplicativo e preserva configurações e dados.
set -euo pipefail

REPO="${ACADEMIA_REPO:-https://github.com/Luizam0rim23/Academia.git}"
DIR="${ACADEMIA_DIR:-$HOME/academia}"
PORTA="${ACADEMIA_PORTA:-3000}"
BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin"

etapa() { printf '\n== %s\n' "$1"; }

etapa "1/5 Instalando Node.js e Git (alguns minutos na primeira vez)"
yes | pkg upgrade -y || true
pkg install -y nodejs-lts git

etapa "2/5 Baixando ou atualizando o aplicativo"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi

etapa "3/5 Configuração (.env)"
cd "$DIR"
if [ -f .env ]; then
  echo "Configuração existente preservada ($DIR/.env)."
else
  TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  umask 077
  cat > .env <<CFG
HOST=127.0.0.1
PORT=$PORTA
BASE_URL=http://localhost:$PORTA
HEALTH_WEBHOOK_TOKEN=$TOKEN
APP_PASSWORD=
DATA_DIR=$DIR/data
CFG
  echo "Configuração criada. Os dados do Strava serão informados na própria página."
fi

etapa "4/5 Criando o comando 'treino'"
mkdir -p "$BIN"
cat > "$BIN/treino" <<CMD
#!/data/data/com.termux/files/usr/bin/bash
DIR="$DIR"
PID="\$DIR/data/servidor.pid"
LOG="\$DIR/data/servidor.log"
mkdir -p "\$DIR/data"
rodando() { [ -f "\$PID" ] && kill -0 "\$(cat "\$PID")" 2>/dev/null; }
case "\${1:-status}" in
  iniciar)
    if rodando; then echo "Já está em execução (http://localhost:$PORTA)."; exit 0; fi
    command -v termux-wake-lock >/dev/null && termux-wake-lock
    cd "\$DIR" || exit 1
    nohup node server.js >> "\$LOG" 2>&1 < /dev/null &
    echo \$! > "\$PID"; sleep 2
    if rodando; then echo "Em execução: http://localhost:$PORTA"; else echo "Falha ao iniciar. Veja: treino log"; exit 1; fi ;;
  parar)
    if rodando; then kill "\$(cat "\$PID")"; rm -f "\$PID"; echo "Parado."; else echo "Não está em execução."; fi
    command -v termux-wake-unlock >/dev/null && termux-wake-unlock || true ;;
  reiniciar) "\$0" parar; "\$0" iniciar ;;
  status) if rodando; then echo "Em execução: http://localhost:$PORTA"; else echo "Parado. Use: treino iniciar"; fi ;;
  abrir) "\$0" iniciar >/dev/null; termux-open-url "http://localhost:$PORTA" ;;
  log) tail -n 40 "\$LOG" ;;
  token) grep '^HEALTH_WEBHOOK_TOKEN=' "\$DIR/.env" | cut -d= -f2 ;;
  atualizar) git -C "\$DIR" pull --ff-only && "\$0" reiniciar ;;
  *) echo "Uso: treino {iniciar|parar|reiniciar|status|abrir|log|token|atualizar}" ;;
esac
CMD
chmod 700 "$BIN/treino"

etapa "5/5 Início automático"
# Ao abrir o Termux, o aplicativo é iniciado (se ainda não estiver em execução).
MARCA="# treino-do-dia: inicio automatico"
touch "$HOME/.bashrc"
grep -qF "$MARCA" "$HOME/.bashrc" || printf '\n%s\n%s\n' "$MARCA" "$BIN/treino iniciar >/dev/null 2>&1" >> "$HOME/.bashrc"
# Opcional: com o app Termux:Boot, inicia também após reiniciar o celular.
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/academia" <<BOOT
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
$BIN/treino iniciar
BOOT
chmod 700 "$HOME/.termux/boot/academia"

"$BIN/treino" reiniciar
cat <<FIM

Instalação concluída. O aplicativo será aberto no navegador.
Próximos passos na página: informar Client ID e Client Secret do Strava e conectar.
Endereço do aplicativo: http://localhost:$PORTA  (comandos: treino abrir | status | log | atualizar)
FIM
command -v termux-open-url >/dev/null && termux-open-url "http://localhost:$PORTA" || true
