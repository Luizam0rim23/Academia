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

## 4. Publicação

### Opção A — VPS com Docker (recomendada)

```bash
cd treino-strava
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

- Criar o serviço a partir do diretório `treino-strava` (o Dockerfile é detectado automaticamente).
- **Anexar volume persistente** montado em `/data` e definir `DATA_DIR=/data`. Sem volume persistente, a conexão com o Strava e o histórico de sono são perdidos a cada implantação.
- Definir as variáveis da seção 3 no painel da plataforma.
- Em planos que hibernam o serviço, definir `CRON_SECRET` e agendar uma chamada diária (ex.: cron-job.org):
  `POST https://treino.seudominio.com.br/cron/sync` com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

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
| Health Connect (Android) | Repositório de saúde do celular, sem acesso em nuvem | Lido pelo app **HC Webhook**, que envia os dados a este servidor |

Fluxo: `Samsung Health / Fitbit → Health Connect → app HC Webhook → POST /api/saude/webhook → recomendação do dia`.

### Configuração

1. **Servidor**: gerar o token (`openssl rand -hex 32`), informar em `HEALTH_WEBHOOK_TOKEN` e reiniciar.
2. **Samsung Health** (ou app Fitbit): em Configurações → Health Connect, permitir o compartilhamento de **Sono**, **Frequência cardíaca em repouso** e, se disponível, **Variabilidade da frequência cardíaca**. Os nomes dos menus variam por versão.
3. **App HC Webhook** (Google Play, `com.hcwebhook.app`, código aberto):
   - conceder leitura apenas de Sono, FC em repouso e VFC (não habilitar FC contínua, que gera grande volume e não é utilizada);
   - URL do webhook: `https://SEU_DOMINIO/api/saude/webhook`;
   - cabeçalho personalizado: `Authorization` = `Bearer <HEALTH_WEBHOOK_TOKEN>`;
   - agendamento: modo programado com um envio após acordar (ex.: 07:30) e outro à noite, ou intervalo de 60 min;
   - executar "Sync Now" e confirmar, no card **Sono e recuperação**, o horário do "último recebimento".
4. **Sem celular Android ou sem o app**: usar o registro manual no próprio card (horas dormidas e qualidade de 1 a 5).

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
| Webhook de saúde | Token obrigatório (Bearer), comparação em tempo constante, limite de 8 MB por envio, valores fora de faixa descartados. |
| Retenção | Atividades dos últimos 180 dias; dados de saúde dos últimos 90 dias. "Desconectar Strava" revoga o acesso e apaga as atividades do servidor. |
| Cabeçalhos | CSP restritiva, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`. |
| Dependências | Nenhuma (apenas Node.js padrão). |

## 9. Limites e manutenção

- API do Strava: 100 requisições / 15 min e 1.000 / dia. Uma sincronização diária usa de 1 a 2 requisições.
- A recomendação é apoio ao treino e não substitui orientação de profissional de educação física ou avaliação médica.
- Atualização: `git pull && docker compose up -d --build` (dados preservados no volume).
