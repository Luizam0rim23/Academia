'use strict';

// Persistência em arquivos JSON no diretório DATA_DIR (gravação atômica).
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./env');

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const arquivo = (nome) => path.join(DATA_DIR, `${nome}.json`);

function ler(nome, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo(nome), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return padrao;
    throw new Error(`Arquivo de dados corrompido: ${arquivo(nome)} (${e.message})`);
  }
}

function gravar(nome, dados) {
  const destino = arquivo(nome);
  const tmp = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, destino);
}

function remover(nome) {
  fs.rmSync(arquivo(nome), { force: true });
}

module.exports = { ler, gravar, remover, DATA_DIR };
