# Treino do Dia — academia orientada pelo histórico do Strava

Aplicativo web independente (servidor próprio) que lê diariamente suas atividades no Strava e seus dados de sono e recuperação, e define o treino de academia do dia.

## 1. O que o aplicativo faz

| Função | Funcionamento |
|---|---|
| Leitura do Strava | Conexão OAuth somente leitura (`activity:read_all`). Carga inicial dos últimos 120 dias. |
| Atualização diária | Sincronização automática no horário configurado (padrão 05h, America/Sao_Paulo). Também sincroniza ao abrir a página quando os dados têm mais de 12 h e pelo botão "Sincronizar agora". |
| Sono e recuperação | Sono, FC de repouso e VFC recebidos do celular (Samsung Health, Fitbit/Pixel Watch e outros, via Health Connect) ou registrados manualmente. Ver seção 6. |
| Treino do dia | Foco, intensidade, exercícios, séries × repetições, descanso e RIR, com lista de verificação para uso na academia. |
| Fundamentação | Lista os motivos da recomendação e as opções descartadas. |
| Próximos dias | Projeção dos 3 dias seguintes. |
| Correção de foco | Cada treino de musculação pode ser marcado manualmente (Empurrar, Puxar, Pernas etc.). |

### Regras de decisão

| # | Regra | Efeito |
|---|---|---|
| 1 | Dias consecutivos de atividade ≥ limite configurado (padrão 6) | Descanso |
| 2 | Relação aguda:crônica (7 × 28 dias) > 1,50 | Recuperação ativa |
| 3 | Meta semanal de academia já cumprida nos últimos 7 dias | Recuperação ativa |
| 4 | Sono < 6 h com FC de repouso ou VFC alterada, ou FC e VFC alteradas ao mesmo tempo | Recuperação ativa |
| 5 | Grupo muscular principal treinado há menos de 48 h | Foco descartado |
| 6 | Fadiga alta de pernas (corrida, pedal, treino de pernas) | Foco de membros inferiores descartado |
| 7 | Fadiga moderada de pernas ou treino longo habitual no dia seguinte | Pernas em versão leve (substituições e menor volume) |
| 8 | Entre os focos elegíveis, escolhe o que está há mais tempo sem estímulo | Rotação da divisão |
| 9 | Relação 1,30–1,50, ≥ 4 dias consecutivos ou carga muito alta ontem | Intensidade reduzida |
| 10 | Sono da última noite < 6 h, qualidade informada ≤ 2/5 ou débito de sono ≥ 5 h em 7 dias | Intensidade −1 nível |
| 11 | FC de repouso ≥ 5 bpm acima da linha de base ou VFC ≥ 15% abaixo (base: 28 dias anteriores) | Intensidade −1 nível |
| 12 | Mais de 10 dias sem academia ou sem histórico | Intensidade moderada (readaptação) |

**Carga por atividade**: Relative Effort do Strava (quando disponível) → TRIMP pela frequência cardíaca (quando a FC máxima está configurada) → estimativa por duração × modalidade.

**Identificação do foco dos treinos de academia** (ordem de prioridade): marcação manual no aplicativo → nome da atividade no Strava (ex.: "Peito e tríceps", "Leg day", "Costas") → inferência pela rotação da divisão.

## 2. Pré-requisitos

1. Servidor com Node.js 20+ **ou** Docker.
2. Domínio ou subdomínio com HTTPS (ex.: `treino.seudominio.com.br`).
3. Aplicativo cadastrado no Strava:
   - Acesse <https://www.strava.com/settings/api>.
   - **Authorization Callback Domain**: apenas o domínio, sem `https://` (ex.: `treino.seudominio.com.br`).
   - Anote o **Client ID** e o **Client Secret**.

## 3. Configuração

```bash
cp .env.example .env
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `BASE_URL` | Sim | Endereço público, sem barra final. O retorno do OAuth será `BASE_URL/auth/strava/callback`. |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Sim | Credenciais do aplicativo no Strava. |
| `APP_PASSWORD` | Sim | Senha de acesso à página. Sem ela, o servidor não inicia. |
| `TRUST_PROXY` | Recomendada | `1` quando estiver atrás de Nginx, Caddy, Render ou Railway. |
| `DATA_DIR` | Recomendada | Diretório persistente para tokens, atividades, dados de saúde e configurações. |
| `HEALTH_WEBHOOK_TOKEN` | Opcional | Habilita o recebimento de dados de saúde do celular (seção 6). Mínimo de 24 caracteres aleatórios. |
| `SESSION_SECRET` | Opcional | Chave de assinatura da sessão (gerada automaticamente se ausente). |
| `CRON_SECRET` | Opcional | Habilita `/cron/sync` para agendadores externos. |
| `RESUMO_DIR` | Opcional | Pasta onde o resumo diário (`resumo-treino.txt` e `dados-treino.json`) é gravado, por exemplo dentro do Google Drive. |
| `WEBHOOK_URL` | Opcional | Endereço exibido para o app de envio de saúde (ex.: `http://nome-do-pc:3000/api/saude/webhook`). |

## 4. Publicação

### Opção A — VPS com Docker (recomendada)

```bash
git clone https://github.com/Luizam0rim23/Academia.git && cd Academia
cp .env.example .env    # preencher as variáveis
docker compose up -d --build
```

O contêiner escuta em `127.0.0.1:3000`. Publique com proxy reverso e HTTPS. Exemplo com Caddy (certificado automático):

```
treino.seudominio.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

Os dados ficam no volume `treino-dados` e são preservados em reinícios e atualizações.

### Opção B — VPS sem Docker (Node + systemd)

```bash
cd /opt/treino-strava && cp .env.example .env   # preencher as variáveis
node server.js                                  # teste
```

`/etc/systemd/system/treino-strava.service`:

```ini
[Unit]
Description=Treino do Dia (Strava)
After=network.target

[Service]
WorkingDirectory=/opt/treino-strava
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now treino-strava
```

### Opção C — Plataformas gerenciadas (Railway, Render, Fly.io)

- Criar o serviço a partir deste repositório (o Dockerfile é detectado automaticamente).
- **Anexar volume persistente** montado em `/data` e definir `DATA_DIR=/data`. Sem volume persistente, a conexão com o Strava e o histórico de sono são perdidos a cada implantação.
- Definir as variáveis da seção 3 no painel da plataforma.
- Em planos que hibernam o serviço, definir `CRON_SECRET` e agendar uma chamada diária (ex.: cron-job.org):
  `POST https://treino.seudominio.com.br/cron/sync` com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

### Opção D — No próprio celular Android (Termux), gratuita

| Aspecto | Situação |
|---|---|
| Custo | R$ 0, sem cartão de crédito |
| Privacidade | Dados de treino e saúde permanecem no celular; o servidor não fica exposto na internet (`HOST=127.0.0.1`) |
| Acesso | Somente pelo próprio celular (`http://localhost:3000`) |
| Limitações | Depende de o Android manter o Termux ativo; sem cópia de segurança automática (ver abaixo) |

Passo a passo (Galaxy S26) — tudo o que exige ação no celular:

1. Criar o aplicativo em `strava.com/settings/api`: **Site** `http://localhost`; **Domínio de autorização callback** `localhost`.
2. Instalar o **Termux** pelo GitHub (`github.com/termux/termux-app/releases`, arquivo `arm64-v8a`), desativando o **Bloqueador automático** só durante a instalação (Configurações → Segurança e privacidade).
3. Abrir o Termux, colar o comando abaixo e aguardar (não há perguntas; o navegador abre ao final):
   ```bash
   curl -fsSLo instalar.sh https://raw.githubusercontent.com/Luizam0rim23/Academia/main/scripts/termux-instalar.sh && bash instalar.sh
   ```
4. Na página aberta: colar **Client ID** e **Client Secret** do Strava → **Salvar e conectar com Strava** → **Autorizar**. No Chrome, menu ⋮ → **Adicionar à tela inicial**.
5. Bateria do Termux: **Sem restrições** (Configurações → Aplicativos → Termux → Bateria) e incluir em **Apps que nunca suspendem** (Configurações → Bateria → Limites de uso em segundo plano).
6. No card **Sono e recuperação**, usar **Copiar endereço** e **Copiar segredo** e colar no Life Dashboard Companion (destino e segredo de assinatura); agendar envio às 07:30.

O aplicativo inicia automaticamente sempre que o Termux é aberto. Após reiniciar o celular, basta abrir o Termux uma vez (ou instalar o app opcional **Termux:Boot**, da mesma origem do Termux, e abri-lo uma vez para início automático).

Comandos disponíveis no Termux:

| Comando | Função |
|---|---|
| `treino abrir` | Inicia (se necessário) e abre o aplicativo no navegador |
| `treino status` / `treino log` | Situação e últimas linhas do registro |
| `treino parar` / `treino reiniciar` | Controle do servidor |
| `treino token` | Exibe o token do app de envio |
| `treino atualizar` | Baixa a versão mais recente e reinicia |

Cópia de segurança: os dados ficam em `~/academia/data`. Para guardar uma cópia na memória do celular, executar uma vez `termux-setup-storage` e depois `cp -r ~/academia/data ~/storage/downloads/academia-backup`. Mesmo sem cópia, o histórico do Strava é recuperável (nova sincronização de 120 dias); perdem-se apenas configurações, marcações de foco e histórico de sono.

### Opção E — Computador Windows como servidor; celular apenas com o app de envio (gratuita)

| Componente | Função |
|---|---|
| Computador Windows (ligado) | Executa o aplicativo, sincroniza o Strava e recebe os dados de saúde |
| Tailscale Funnel (somente no computador) | Publica o site com HTTPS em `https://NOME.SUA-REDE.ts.net`, sem abrir portas no roteador; acesso protegido pela senha do aplicativo |
| Celular | Nenhuma instalação adicional: navegador para ver o site e o app de envio de saúde (Life Dashboard Companion) |
| Google Drive para computador | Pasta `Treino do Dia` com `resumo-treino.txt` e `dados-treino.json`, que o Claude lê pelo conector do Google Drive |

Passo a passo:

1. Instalar o **Google Drive para computador** e fazer login (para o resumo lido pelo Claude).
2. No PowerShell do computador (sem administrador), executar:
   ```powershell
   irm https://raw.githubusercontent.com/Luizam0rim23/Academia/main/scripts/windows-instalar.ps1 | iex
   ```
   O instalador instala Node.js e Tailscale (via winget), baixa o aplicativo, pede uma senha de acesso, configura o início automático e abre o aplicativo.
3. Entrar no **Tailscale** no computador (ícone ao lado do relógio) e executar o comando do passo 2 novamente. Se o Tailscale abrir uma página pedindo para habilitar **HTTPS/Funnel**, aprovar e executar o comando mais uma vez. Ao final, o endereço público é exibido.
4. No computador, abrir `http://localhost:3000`, informar Client ID e Client Secret do aplicativo Strava e conectar. (Alternativa: importar o backup exportado do celular.)
5. No celular: abrir o endereço `https://….ts.net` no navegador, entrar com a senha e adicionar à tela inicial. No card **Sono e recuperação**, usar **Copiar endereço** e **Copiar segredo** e colar no destino do Life Dashboard Companion (endereço HTTPS: a opção de HTTP sem criptografia pode ser desativada).
6. Se o Termux foi usado anteriormente, desinstalá-lo.
7. Windows: Configurações → Sistema → Energia → não suspender quando ligado na tomada.

Atualização: executar novamente o comando do passo 2 (configuração e dados preservados).

## 5. Primeiro uso

1. Acessar `BASE_URL` e informar a senha.
2. Clicar em **Conectar com Strava** e autorizar o acesso às atividades.
3. Em **Configurações**, ajustar: treinos por semana, divisão, objetivo, duração-alvo, horário habitual do treino, meta de sono e FC máxima.
4. Prática recomendada: nomear os treinos de academia no Strava com o foco ("Empurrar", "Puxar", "Pernas", "Superiores", "Inferiores"). Na impossibilidade, corrigir o foco na tabela de atividades.
5. Configurar a integração de sono (seção 6) ou usar o registro manual.

## 6. Sono e recuperação (Samsung Health / Google)

### Por que via Health Connect

| Fonte | Situação | Uso neste aplicativo |
|---|---|---|
| Samsung Health | Não possui API web; compartilha dados com o Health Connect no celular | Via Health Connect |
| Google Fit | API descontinuada pelo Google (fim do suporte em 2026; novos cadastros bloqueados desde 05/2024) | Não utilizada |
| Fitbit / Pixel Watch | Grava sono no Health Connect | Via Health Connect |
| Health Connect (Android) | Repositório de saúde do celular, sem acesso em nuvem | Lido por um app de envio, que remete os dados a este servidor |

Fluxo: `Samsung Health / Fitbit → Health Connect → app de envio → POST /api/saude/webhook → recomendação do dia`.

### App de envio: opções

| App | Custo | Instalação | Autenticação aceita pelo servidor |
|---|---|---|---|
| **Life Dashboard Companion** (recomendado) | Gratuito pelo GitHub, F-Droid ou Obtainium (na Google Play é pago) | APK `app-release.apk` em github.com/owen282000/life-dashboard-companion-app/releases, F-Droid ou Obtainium | Assinatura HMAC-SHA256 (`X-Signature`) com o segredo = `HEALTH_WEBHOOK_TOKEN` |
| HC Webhook | Pago na Google Play (`com.hcwebhook.app`); versão beta pelo Obtainium (github.com/mcnaveen/health-connect-webhook) | Google Play ou Obtainium | Cabeçalho `Authorization: Bearer <HEALTH_WEBHOOK_TOKEN>` |
| Registro manual | Gratuito | Card **Sono e recuperação** da página | Sessão do aplicativo |

O servidor aceita os dois formatos automaticamente (sono com estágios, FC de repouso e VFC).

### Configuração

1. **Servidor**: gerar o token (`openssl rand -hex 32`), informar em `HEALTH_WEBHOOK_TOKEN` e reiniciar.
2. **Samsung Health** (ou app Fitbit): permitir a gravação de **Sono**, **Frequência cardíaca em repouso** e, se disponível, **Variabilidade da frequência cardíaca** na Conexão Saúde (Health Connect).
3. **App de envio** (Life Dashboard Companion):
   - instalar o APK gratuito (GitHub Releases, F-Droid ou Obtainium); o Android pedirá autorização para instalar apps de fonte externa;
   - conceder leitura apenas de Sono, FC em repouso e VFC (não habilitar FC contínua, que gera grande volume e não é utilizada);
   - cadastrar o destino `https://SEU_DOMINIO/api/saude/webhook` e informar como segredo de assinatura (signing secret) o mesmo valor de `HEALTH_WEBHOOK_TOKEN`;
   - agendamento: horários fixos com um envio após acordar (ex.: 07:30) e outro à noite, ou intervalo de 60 min;
   - fazer um envio manual e confirmar, no card **Sono e recuperação**, o horário do "último recebimento".
4. **Alternativa HC Webhook**: mesmo procedimento, usando o cabeçalho `Authorization` = `Bearer <HEALTH_WEBHOOK_TOKEN>` em vez da assinatura.
5. **Sem app de envio**: usar o registro manual no próprio card (horas dormidas e qualidade de 1 a 5).

### Roteiro para Galaxy S26 + Galaxy Watch7

| # | Etapa | Onde (nomes de menu podem variar conforme a versão da One UI) |
|---|---|---|
| 1 | Usar o relógio durante a noite; o sono é registrado pelo Watch7 e sincronizado com o Samsung Health do celular | App Galaxy Wearable / Samsung Health |
| 2 | Conferir no Samsung Health se a noite aparece (duração e estágios) | Samsung Health → Sono |
| 3 | Autorizar o Samsung Health a gravar na Conexão Saúde (nome do Health Connect em português): Sono, Frequência cardíaca em repouso e, se oferecido, Variabilidade da FC | Configurações do celular → Conexão Saúde → Permissões de apps → Samsung Health |
| 3a | Conferir se a noite chegou à Conexão Saúde | Conexão Saúde → Dados e acesso → Sono |
| 4 | Instalar o Life Dashboard Companion (APK gratuito) e conceder leitura de Sono, FC em repouso e VFC | GitHub Releases / F-Droid / Obtainium |
| 5 | Cadastrar o destino (URL + segredo de assinatura) e o agendamento (ex.: 07:30 e 21:00). No modo celular (Opção D), o destino é `http://127.0.0.1:3000/api/saude/webhook` | Life Dashboard Companion → destinos / agendamento |
| 6 | Retirar a restrição de bateria do app de envio, para que o envio programado não seja interrompido | Configurações → Aplicativos → Life Dashboard Companion → Bateria → Sem restrições |
| 7 | Fazer um envio manual e confirmar o "último recebimento" no card Sono e recuperação | App de envio / página do aplicativo |

Pontos de atenção:

- A disponibilidade da VFC no Health Connect depende da versão do Samsung Health. Sem ela, o aplicativo usa sono e FC de repouso, sem prejuízo das demais regras.
- O Samsung Health pode levar alguns minutos para repassar à Conexão Saúde a noite sincronizada do relógio. Programe o envio do app ao menos 30 minutos após o horário habitual de acordar.
- Se a noite não aparecer no card, verificar nesta ordem: Samsung Health (noite registrada) → Conexão Saúde (dados de sono presentes) → app de envio (último envio com sucesso) → card (último recebimento).

### Dados utilizados e análise do técnico

| Dado (Health Connect) | Uso |
|---|---|
| Sono (com estágios), FC de repouso, VFC | Ajuste diário de intensidade e recuperação ativa |
| Frequência respiratória, temperatura da pele, SpO2 (no sono) | Sinais de recuperação incompleta ou início de doença |
| Sessões de exercício do relógio | Treinos registrados só no Samsung Health entram no plano (sem duplicar o Strava) |
| Peso, gordura corporal, massa magra (bioimpedância do Watch) | Tendência semanal comparada ao objetivo (ganho, manutenção, recomposição) |
| Passos (totais diários) | Atividade diária fora do treino |
| VO2 máx. | Indicador de capacidade aeróbica |

O card **Análise do técnico** prioriza achados em Ação, Atenção, Positivo e Informação, e o botão **Copiar resumo para análise** gera um texto com plano, atividades de 14 dias, sono de 7 noites, indicadores e achados.

No app de envio, em **O que enviar**, manter ativos: Sono, Frequência cardíaca em repouso, Variabilidade da FC, Exercício, Peso, Gordura corporal, Massa magra, Passos, Saturação de oxigênio, Frequência respiratória, Temperatura da pele e VO2 máx. Os demais tipos não são utilizados.

### Regras de tratamento

| Item | Tratamento |
|---|---|
| Atribuição da noite | Ao dia em que o sono termina (fuso configurado) |
| Sessões sobrepostas (duas fontes ou reenvio) | Consolidadas: prevalece a sessão com estágios e maior duração; cochilos sem sobreposição são somados |
| Registro manual | Substitui o dado automático da mesma data |
| Linha de base (FC e VFC) | 28 dias anteriores, mínimo de 5 dias com dado |
| Recomendação de amanhã | Não usa dados de sono (ainda inexistentes) |
| Retenção | 90 dias |

### Proteção de dados

Sono, frequência cardíaca e VFC são dados pessoais sensíveis (LGPD, art. 5º, II). Tratamento adotado: armazenamento exclusivo no seu servidor (`DATA_DIR`, permissão 600), transmissão somente por HTTPS com token, nenhum compartilhamento com terceiros e retenção limitada a 90 dias.

## 7. Avaliação local (sem conta no Strava)

```bash
npm run demo          # http://localhost:3000, histórico fictício (atividades e sono), sem senha
npm test              # testes automatizados do motor de recomendação e do módulo de saúde
```

## 8. Segurança e dados

| Item | Tratamento |
|---|---|
| Acesso à página | Senha obrigatória, sessão em cookie assinado (HttpOnly, SameSite, Secure em HTTPS), limite de 5 tentativas a cada 15 min. |
| Strava | Somente leitura. Tokens renovados automaticamente e armazenados em `DATA_DIR` com permissão restrita (600). |
| OAuth | Parâmetro `state` validado contra CSRF; escopo insuficiente é recusado. |
| Webhook de saúde | Token obrigatório (Bearer) ou assinatura HMAC-SHA256 do corpo, comparação em tempo constante, limite de 8 MB por envio, valores fora de faixa descartados. |
| Retenção | Atividades dos últimos 180 dias; dados de saúde dos últimos 90 dias. "Desconectar Strava" revoga o acesso e apaga as atividades do servidor. |
| Cabeçalhos | CSP restritiva, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`. |
| Dependências | Nenhuma (apenas Node.js padrão). |

## 9. Limites e manutenção

- API do Strava: 100 requisições / 15 min e 1.000 / dia. Uma sincronização diária usa de 1 a 2 requisições.
- A recomendação é apoio ao treino e não substitui orientação de profissional de educação física ou avaliação médica.
- Atualização: `git pull && docker compose up -d --build` (dados preservados no volume).
