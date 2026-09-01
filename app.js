// ==========================================
// CRÔNICAS DE CAMELOT - APP.JS COMPLETO
// ==========================================

let supabaseClient = null;
let canalMesa = null;
let gridAtivo = false;

document.addEventListener('DOMContentLoaded', () => {
  // Inicializa o cliente do Supabase se estiver disponível na página
  if (window.supabase && !supabaseClient && typeof SUPABASE_URL !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else if (window.supabaseClient) {
    supabaseClient = window.supabaseClient;
  }

  // Configuração do Canal em Tempo Real (Broadcast)
  if (supabaseClient) {
    canalMesa = supabaseClient.channel('sala-rpg-geral');
    
    canalMesa
      .on('broadcast', { event: 'novo_mapa' }, (payload) => {
        exibirMapaNaTela(payload.payload.url);
        mostrarPopup('🗺️ O Mestre atualizou o Mapa de Batalha!');
      })
      .on('broadcast', { event: 'nova_rolagem' }, (payload) => {
        registrarRolagemHistorico(payload.payload.descricao, payload.payload.resultado, true);
      })
      .on('broadcast', { event: 'vtt_ping' }, (payload) => {
        criarEfeitoPing(payload.payload.x, payload.payload.y);
      })
      .on('broadcast', { event: 'vtt_mover_token' }, (payload) => {
        criarElementoToken(payload.payload.id, payload.payload.nome, payload.payload.x, payload.payload.y, false);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Conectado à Távola Redonda em Tempo Real!');
        }
      });
  }
});

// --- SISTEMA DE MENSAGENS / TOASTS (HERALDO) ---
function mostrarPopup(mensagem) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>⚔️</span> <span>${mensagem}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- SISTEMA DE ROLAGEM DE DADOS ÉPICA ---
function rolarDado(lados) {
  const resultado = Math.floor(Math.random() * lados) + 1;
  const userNick = document.getElementById('user-nick-display')?.innerText || document.getElementById('input-nick')?.value || 'Cavaleiro';
  const descricao = `${userNick} rolou d${lados}`;

  let mensagemExtra = '';
  if (lados === 20) {
    if (resultado === 20) {
      mensagemExtra = ' ✨ BENÇÃO DA DAMA DO LAGO! Crítico Lendário!';
    } else if (resultado === 1) {
      mensagemExtra = ' ⚠️ DESASTRE EM CAMELOT! Falha Crítica!';
    }
  }

  const textoResultado = `${descricao}: ${resultado}${mensagemExtra}`;
  
  registrarRolagemHistorico(descricao, resultado, false);
  mostrarPopup(textoResultado);

  // Transmite a rolagem para a mesa inteira
  if (canalMesa) {
    canalMesa.send({
      type: 'broadcast',
      event: 'nova_rolagem',
      payload: { descricao, resultado: textoResultado }
    });
  }
}

function registrarRolagemHistorico(descricao, resultado, externo = false) {
  const historicoDiv = document.getElementById('historico-rolagens');
  if (!historicoDiv) return;

  const item = document.createElement('div');
  item.style.padding = '8px 12px';
  item.style.marginBottom = '6px';
  item.style.background = externo ? 'rgba(27, 42, 74, 0.4)' : 'rgba(16, 20, 31, 0.6)';
  item.style.borderLeft = '3px solid var(--cam-gold)';
  item.style.borderRadius = '4px';
  item.style.fontSize = '0.95rem';
  
  const texto = typeof resultado === 'string' ? resultado : `${descricao} = ${resultado}`;
  item.innerText = texto;
  
  historicoDiv.prepend(item);
}

// --- SISTEMA VTT (MAPA TÁTICO, GRELHA E TOKENS) ---
function exibirMapaNaTela(url) {
  const container = document.getElementById('container-mapa');
  if (!container) return;

  container.innerHTML = `
    <div style="margin-bottom: 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <button onclick="alternarGridVTT()">🗺️ Alternar Grelha</button>
      <button onclick="adicionarTokenMesa()">🛡️ Meu Token</button>
      <span style="font-size: 0.9rem; color: var(--cam-gold-light);">* Clique no mapa para dar Ping / Arraste seu token</span>
    </div>
    <div id="vtt-canvas" class="vtt-wrapper" onclick="darPingNoMapa(event)">
      <img src="${url}" class="vtt-mapa-img" alt="Mapa Tático de Camelot">
      <div id="vtt-grid-camada" class="vtt-grid ${gridAtivo ? 'ativo' : ''}"></div>
      <div id="vtt-tokens-camada" style="position: absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;"></div>
    </div>
  `;
}

function alternarGridVTT() {
  gridAtivo = !gridAtivo;
  const gridDiv = document.getElementById('vtt-grid-camada');
  if (gridDiv) {
    gridDiv.classList.toggle('ativo', gridAtivo);
  }
}

// Sistema de Ping (O Olhar de Merlin)
function darPingNoMapa(event) {
  if (event.target.classList.contains('vtt-token')) return;

  const canvas = document.getElementById('vtt-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  if (canalMesa) {
    canalMesa.send({
      type: 'broadcast',
      event: 'vtt_ping',
      payload: { x, y }
    });
  }
  criarEfeitoPing(x, y);
}

function criarEfeitoPing(x, y) {
  const canvas = document.getElementById('vtt-canvas');
  if (!canvas) return;

  const ping = document.createElement('div');
  ping.className = 'vtt-ping';
  ping.style.left = `${x}%`;
  ping.style.top = `${y}%`;
  canvas.appendChild(ping);

  setTimeout(() => ping.remove(), 1000);
}

// Gestão de Tokens dos Jogadores
function adicionarTokenMesa() {
  const userNick = document.getElementById('user-nick-display')?.innerText || document.getElementById('input-nick')?.value || 'Cavaleiro';
  const tokenID = 'token_' + (userNick.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  
  if (document.getElementById(tokenID)) {
    mostrarPopup('Seu token já está na mesa, cavaleiro!');
    return;
  }

  criarElementoToken(tokenID, userNick, 10, 10, true);
  
  if (canalMesa) {
    canalMesa.send({
      type: 'broadcast',
      event: 'vtt_mover_token',
      payload: { id: tokenID, nome: userNick, x: 10, y: 10 }
    });
  }
  mostrarPopup('🛡️ Token posicionado na Távola!');
}

function criarElementoToken(id, nome, x, y, ehMeu = false) {
  let camada = document.getElementById('vtt-tokens-camada');
  if (!camada) return;

  let token = document.getElementById(id);
  if (!token) {
    token = document.createElement('div');
    token.id = id;
    token.className = 'vtt-token';
    token.innerText = nome.substring(0, 3).toUpperCase();
    token.title = nome;
    camada.appendChild(token);
  }

  token.style.left = `${x}%`;
  token.style.top = `${y}%`;
  token.style.pointerEvents = 'auto';

  if (ehMeu) {
    ativarArrastoToken(token, id, nome);
  }
}

function ativarArrastoToken(token, id, nome) {
  let arrastando = false;

  const iniciarArrasto = (e) => {
    arrastando = true;
    e.stopPropagation();
  };

  const mover = (e) => {
    if (!arrastando) return;
    const canvas = document.getElementById('vtt-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    let x = ((clientX - rect.left) / rect.width) * 100;
    let y = ((clientY - rect.top) / rect.height) * 100;

    x = Math.max(0, Math.min(95, x));
    y = Math.max(0, Math.min(95, y));

    token.style.left = `${x}%`;
    token.style.top = `${y}%`;

    if (canalMesa) {
      canalMesa.send({
        type: 'broadcast',
        event: 'vtt_mover_token',
        payload: { id, nome, x, y }
      });
    }
  };

  const pararArrasto = () => {
    arrastando = false;
  };

  token.addEventListener('mousedown', iniciarArrasto);
  window.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', pararArrasto);

  token.addEventListener('touchstart', iniciarArrasto);
  window.addEventListener('touchmove', mover);
  window.addEventListener('touchend', pararArrasto);
}
