'use strict';
(function () {
  const erro = new URLSearchParams(location.search).get('erro');
  const mensagens = {
    senha: 'Senha incorreta.',
    bloqueado: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.',
  };
  if (erro && mensagens[erro]) {
    const el = document.getElementById('erro');
    el.textContent = mensagens[erro];
    el.hidden = false;
  }
})();
