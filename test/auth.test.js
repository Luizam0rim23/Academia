'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'treino-auth-'));
process.env.HEALTH_WEBHOOK_TOKEN = 'segredo-de-teste-com-mais-de-24-caracteres';

const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/auth');

const corpo = '{"sleep":[]}';
const req = (headers) => ({ headers });
const assinar = (texto, chave) => `sha256=${crypto.createHmac('sha256', chave).update(texto).digest('hex')}`;

test('webhook de saúde aceita token Bearer correto', () => {
  assert.equal(auth.tokenSaudeValido(req({ authorization: `Bearer ${process.env.HEALTH_WEBHOOK_TOKEN}` }), corpo), true);
  assert.equal(auth.tokenSaudeValido(req({ authorization: 'Bearer errado' }), corpo), false);
  assert.equal(auth.tokenSaudeValido(req({}), corpo), false);
});

test('webhook de saúde aceita assinatura HMAC-SHA256 (Life Dashboard Companion)', () => {
  const ok = assinar(corpo, process.env.HEALTH_WEBHOOK_TOKEN);
  assert.equal(auth.tokenSaudeValido(req({ 'x-signature': ok }), corpo), true);
  assert.equal(auth.tokenSaudeValido(req({ 'x-signature': ok.toUpperCase().replace('SHA256', 'sha256') }), corpo), true);
  assert.equal(auth.tokenSaudeValido(req({ 'x-signature': ok }), `${corpo} `), false, 'corpo alterado');
  assert.equal(auth.tokenSaudeValido(req({ 'x-signature': assinar(corpo, 'outra-chave') }), corpo), false);
});

test('webhook de saúde: assinatura sobre corpo compactado ou descompactado e motivo da recusa', () => {
  const zlib = require('zlib');
  const compactado = zlib.gzipSync(Buffer.from(corpo));
  const sobreDescompactado = assinar(corpo, process.env.HEALTH_WEBHOOK_TOKEN);
  const sobreCompactado = `sha256=${crypto.createHmac('sha256', process.env.HEALTH_WEBHOOK_TOKEN).update(compactado).digest('hex')}`;
  assert.equal(auth.verificarSaude(req({ 'x-signature': sobreDescompactado }), [compactado, Buffer.from(corpo)]).ok, true);
  assert.equal(auth.verificarSaude(req({ 'x-signature': sobreCompactado }), [compactado, Buffer.from(corpo)]).ok, true);
  const r = auth.verificarSaude(req({ 'x-signature': assinar(corpo, 'outra') }), [Buffer.from(corpo)]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /segredo/);
  assert.doesNotMatch(r.motivo, new RegExp(process.env.HEALTH_WEBHOOK_TOKEN));
  assert.match(auth.verificarSaude(req({}), [Buffer.from(corpo)]).motivo, /sem X-Signature/);
});
