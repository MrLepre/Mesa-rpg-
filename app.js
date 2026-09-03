// ==========================================
// CRÔNICAS DE CAMELOT - APP.JS
// ==========================================

const SUPABASE_URL = 'https://rolrbrtpqbchyxmjmvzr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mJmJfELKk4O1HCTzoKxDdw_EWaiv4j1';

let supabaseClient = null;
let dadosFichaAtual = null;
let fichaEditandoUserId = null;
let canalMesa = null;
let gridAtivo = false;
let vttZoom = 100;
let vttGridTamanho = 40;
let ehMestreGlobal = false;

// Variáveis de controle de Posição (Pan) e Cadeado do Mapa
let vttPanX = 0;
let vttPanY = 0;
let vttMovimentoLivre = false;
let mapaModoImersivo = false;
let audioContext = null;

// --- FEEDBACK SONORO E TÁTIL (sem arquivos externos) ---
function tocarSom(tipo = 'click') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') audioContext.resume();

    const config = {
      click: { freq: 520, duration: 0.045, volume: 0.025, wave: 'sine' },
      success: { freq: 740, duration: 0.11, volume: 0.035, wave: 'triangle' },
      dice: { freq: 180, duration: 0.12, volume: 0.04, wave: 'square' },
      critical: { freq: 980, duration: 0.18, volume: 0.045, wave: 'triangle' },
      ping: { freq: 620, duration: 0.08, volume: 0.03, wave: 'sine' }
    }[tipo] || { freq: 520, duration: 0.05, volume: 0.025, wave: 'sine' };

    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = config.wave;
    osc.frequency.setValueAtTime(config.freq, now);
    if (tipo === 'dice') osc.frequency.exponentialRampToValueAtTime(90, now + config.duration);
    if (tipo === 'critical') osc.frequency.exponentialRampToValueAtTime(1250, now + config.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(config.volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + config.duration + 0.01);
  } catch (err) {
    // Áudio é apenas um aprimoramento; nunca deve quebrar a mesa.
  }
}

function vibrarPadrao(padrao = [18]) {
  try {
    if (navigator.vibrate) navigator.vibrate(padrao);
  } catch (err) {}
}

function atualizarStatusConexao(estado, texto) {
  const status = document.getElementById('status-conexao');
  const label = document.getElementById('status-conexao-texto');
  if (!status) return;
  status.classList.remove('online', 'offline');
  if (estado === 'online') status.classList.add('online');
  if (estado === 'offline') status.classList.add('offline');
  if (label) label.textContent = texto;
}

// Inicialização segura
try {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (err) {
  console.error('Erro ao inicializar Supabase:', err);
}

document.addEventListener('DOMContentLoaded', async () => {
  document.body.style.overflowX = 'hidden';
  document.body.style.touchAction = 'pan-y';

  if (!supabaseClient && window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  atualizarStatusConexao(supabaseClient ? 'online' : 'offline', supabaseClient ? 'Conectando à Távola...' : 'Modo local — Supabase indisponível.');

  if (supabaseClient) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      atualizarInterfaceAuth(session?.user || null);

      if (session?.user) {
        carregarFichaDoUsuario(session.user.id);
      }

      canalMesa = supabaseClient.channel('sala-rpg-geral');
      canalMesa
        .on('broadcast', { event: 'novo_mapa' }, (payload) => {
          exibirMapaNaTela(payload.payload.url);
          mostrarPopup('🗺️ O Mestre atualizou o Mapa de Batalha!');
        })
        .on('broadcast', { event: 'vtt_zoom' }, (payload) => {
          vttZoom = payload.payload.zoom;
          vttPanX = payload.payload.panX || 0;
          vttPanY = payload.payload.panY || 0;
          atualizarTransformMapaVTT();
        })
        .on('broadcast', { event: 'nova_rolagem' }, (payload) => {
          registrarRolagemHistorico(payload.payload.descricao, payload.payload.resultado, true);
        })
        .on('broadcast', { event: 'vtt_ping' }, (payload) => {
          criarEfeitoPing(payload.payload.x, payload.payload.y);
        })
        .on('broadcast', { event: 'vtt_mover_token' }, (payload) => {
          criarElementoToken(
            payload.payload.id, 
            payload.payload.nome, 
            payload.payload.x, 
            payload.payload.y, 
            payload.payload.tamanho || 45, 
            payload.payload.imagem || '', 
            payload.payload.hpAtual ?? 50, 
            payload.payload.hpMax ?? 50, 
            false
          );
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') atualizarStatusConexao('online', 'Távola sincronizada');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') atualizarStatusConexao('offline', 'Sincronização indisponível');
        });

      carregarMapaAtual();
      carregarGaleria();
    } catch (err) {
      atualizarStatusConexao('offline', 'Erro de conexão');
      console.error('Erro na sessão/conexão:', err);
    }
  }
});

document.addEventListener('click', (event) => {
  const alvo = event.target.closest('button');
  if (alvo && !alvo.disabled) {
    tocarSom('click');
    vibrarPadrao([10]);
  }
});

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  const digit = event.key;
  if (digit === 'Escape') {
    fecharCriadorFicha();
    if (typeof fecharModalFichaGrupo === 'function') fecharModalFichaGrupo();
    const visualizador = document.getElementById('modal-visualizador-img');
    if (visualizador) visualizador.style.display = 'none';
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  const abas = ['ficha', 'grupo', 'mapa', 'rolagens', 'galeria'];
  const index = Number(digit) - 1;
  if (index >= 0 && index < abas.length) mudarAba(abas[index]);
});

window.addEventListener('message', async (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== 'cronicas-camelot-ficha-pronta') return;
  if (!event.data.dados) return;

  const foiEdicao = event.data.modo === 'edicao';
  dadosFichaAtual = event.data.dados;
  if (foiEdicao && event.data.userId) {
    fichaEditandoUserId = event.data.userId;
  }
  renderizarFichaNaTela(dadosFichaAtual);
  fecharCriadorFicha();

  const nome = dadosFichaAtual.nome || dadosFichaAtual.personagem_nome || 'Personagem';
  mostrarPopup(foiEdicao ? `💾 Ficha de ${nome} atualizada!` : `⚔️ Ficha de ${nome} criada na mesa!`);

  if (supabaseClient) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await salvarFichaNoSupabase(fichaEditandoUserId);
  }
});

function nickParaEmail(nick) {
  const nickTratado = nick.trim().toLowerCase().replace(/\s+/g, '');
  return `${nickTratado}@rpg.local`;
}

// --- AUTENTICAÇÃO ---
async function fazerCadastro() {
  if (!supabaseClient) return alert('Supabase não inicializado.');
  const nick = document.getElementById('auth-nick')?.value;
  const password = document.getElementById('auth-senha')?.value;

  if (!nick || !password) return alert('Informe Nick e senha!');

  const emailFake = nickParaEmail(nick);
  const { error } = await supabaseClient.auth.signUp({
    email: emailFake,
    password: password,
    options: { data: { display_name: nick } }
  });

  if (error) {
    mostrarPopup('❌ Erro no cadastro: ' + error.message);
  } else {
    mostrarPopup('✅ Conta criada com sucesso! Clique em Entrar.');
  }
}

async function fazerLogin() {
  if (!supabaseClient) return alert('Supabase não inicializado.');
  const nick = document.getElementById('auth-nick')?.value;
  const password = document.getElementById('auth-senha')?.value;

  if (!nick || !password) return alert('Informe Nick e senha!');

  const emailFake = nickParaEmail(nick);
  let authResult = await supabaseClient.auth.signInWithPassword({
    email: emailFake,
    password: password
  });

  if (authResult.error) {
    mostrarPopup('❌ Nick ou senha incorretos.');
  } else {
    mostrarPopup('✅ Login realizado!');
    atualizarInterfaceAuth(authResult.data.user);
    carregarFichaDoUsuario(authResult.data.user.id);
  }
}

async function fazerLogout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  atualizarInterfaceAuth(null);
  dadosFichaAtual = null;
  const containerFicha = document.getElementById('container-ficha-carregada');
  if (containerFicha) {
    containerFicha.innerHTML = '<p style="color: #a8a8b3;">Faça login para visualizar sua ficha.</p>';
  }
  mostrarPopup('Desconectado.');
}

function atualizarInterfaceAuth(user) {
  const formLogin = document.getElementById('form-login');
  const statusUsuario = document.getElementById('status-usuario');
  const painelMapaMestre = document.getElementById('painel-mapa-mestre');
  const painelUploadMestre = document.getElementById('painel-upload-mestre');
  const badgeMestre = document.getElementById('badge-mestre');

  if (user) {
    if (formLogin) formLogin.style.display = 'none';
    if (statusUsuario) statusUsuario.style.display = 'flex';
    
    const nickExibicao = user.user_metadata?.display_name || user.email.split('@')[0];
    const nickDisplay = document.getElementById('user-nick-display');
    if (nickDisplay) nickDisplay.innerText = nickExibicao;

    ehMestreGlobal = (user.email || '').toLowerCase() === 'mestre@rpg.local';
    if (ehMestreGlobal) {
      if (badgeMestre) badgeMestre.style.display = 'inline-block';
      if (painelMapaMestre) painelMapaMestre.style.display = 'block';
      if (painelUploadMestre) painelUploadMestre.style.display = 'block';
    } else {
      if (badgeMestre) badgeMestre.style.display = 'none';
      if (painelMapaMestre) painelMapaMestre.style.display = 'none';
      if (painelUploadMestre) painelUploadMestre.style.display = 'none';
    }
  } else {
    ehMestreGlobal = false;
    if (formLogin) formLogin.style.display = 'flex';
    if (statusUsuario) statusUsuario.style.display = 'none';
    if (painelMapaMestre) painelMapaMestre.style.display = 'none';
    if (painelUploadMestre) painelUploadMestre.style.display = 'none';
  }
}

// --- NAVEGAÇÃO DE ABAS ---
function mudarAba(nomeAba, evento) {
  const paineis = document.querySelectorAll('.painel');
  paineis.forEach(p => p.classList.remove('ativo'));
  const botoes = document.querySelectorAll('.abas-navegacao button');
  botoes.forEach(b => b.classList.remove('ativo'));

  const abaAlvo = document.getElementById(`aba-${nomeAba}`) || document.getElementById(nomeAba);
  if (abaAlvo) abaAlvo.classList.add('ativo');

  if (evento && evento.currentTarget) {
    evento.currentTarget.classList.add('ativo');
  }
}

// --- FICHA DO PERSONAGEM ---
function importarArquivoJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      dadosFichaAtual = JSON.parse(e.target.result);
      renderizarFichaNaTela(dadosFichaAtual);
      mostrarPopup('📄 Ficha JSON lida com sucesso! Clique em "Salvar na Nuvem".');
    } catch (err) {
      alert('Arquivo JSON inválido.');
    }
  };
  reader.readAsText(file);
}

async function salvarFichaNoSupabase(userIdDestino = null) {
  if (!supabaseClient) return alert('Supabase não conectado.');
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return alert('Você precisa estar logado para salvar sua ficha!');
  if (!dadosFichaAtual) return alert('Importe um arquivo JSON de ficha primeiro!');

  const nomeChar = dadosFichaAtual.nome || dadosFichaAtual.personagem_nome || 'Personagem';
  const ehEdicaoMestre = Boolean(ehMestreGlobal && userIdDestino && userIdDestino !== session.user.id);
  const idDestino = userIdDestino || session.user.id;

  let resultado;

  if (ehEdicaoMestre) {
    resultado = await supabaseClient
      .from('fichas')
      .update({
        nome_personagem: nomeChar,
        dados_ficha: dadosFichaAtual,
        updated_at: new Date()
      })
      .eq('user_id', idDestino);
  } else {
    resultado = await supabaseClient
      .from('fichas')
      .upsert({
        user_id: session.user.id,
        nome_personagem: nomeChar,
        dados_ficha: dadosFichaAtual,
        updated_at: new Date()
      }, { onConflict: 'user_id' });
  }

  if (resultado.error) {
    mostrarPopup('❌ Erro ao salvar: ' + resultado.error.message);
  } else {
    mostrarPopup(ehEdicaoMestre ? '👑 Ficha do jogador atualizada pelo Mestre!' : '💾 Ficha salva na nuvem com sucesso!');
  }
}

async function carregarFichaDoUsuario(userId) {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from('fichas')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('Aviso ao carregar ficha:', error.message);
    return;
  }

  if (data && data.dados_ficha) {
    dadosFichaAtual = data.dados_ficha;
    renderizarFichaNaTela(dadosFichaAtual);
  }
}

function escaparHTML(valor) {
  return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function renderizarFichaNaTela(dados) {
  const container = document.getElementById('container-ficha-carregada');
  if (!container) return;
  const nome = dados?.nome || dados?.personagem_nome || 'Sem Nome';
  const tipo = dados?.tipo_humano || dados?.raca || '-';
  const antecedente = dados?.antecedente || '-';
  const nivel = dados?.nivel || 1;
  const xp = dados?.xp_atual ?? 0;
  container.innerHTML = `
    <div style="background:linear-gradient(135deg,#10141f,#161b2c);padding:1rem;border-radius:6px;border:1px solid #d4af37;">
      <h3 style="color:#f3d075;font-family:Cinzel,serif;">${escaparHTML(nome)}</h3>
      <p><strong>Nível:</strong> ${escaparHTML(nivel)} &nbsp;|&nbsp; <strong>XP:</strong> ${escaparHTML(xp)}</p>
      <p><strong>Tipo Humano:</strong> ${escaparHTML(tipo)} &nbsp;|&nbsp; <strong>Antecedente:</strong> ${escaparHTML(antecedente)}</p>
      <p style="color:#a8a8b3;">Ficha carregada. Abra a ficha completa para visualizar todos os campos e detalhes.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <button onclick="abrirFichaAtualCompleta()">📖 Abrir Ficha Completa</button>
        <button onclick="abrirEditorFichaAtual()" style="background:#315d36;color:#dfffe3;border:1px solid #7fd88b;">✏️ Editar Ficha</button>
      </div>
    </div>`;
}

function abrirCriadorFicha() {
  const modal = document.getElementById('modal-criador-ficha');
  const iframe = document.getElementById('iframe-criador-ficha');
  if (!modal || !iframe) return;
  iframe.src = 'ficha-editor.html?modo=criacao&t=' + Date.now();
  modal.style.display = 'flex';
}

function abrirEditorFichaAtual() {
  if (!dadosFichaAtual) return mostrarPopup('❌ Nenhuma ficha carregada para editar.');
  const modal = document.getElementById('modal-criador-ficha');
  const iframe = document.getElementById('iframe-criador-ficha');
  if (!modal || !iframe) return;
  iframe.src = 'ficha-editor.html?modo=edicao&t=' + Date.now();
  modal.style.display = 'flex';
  iframe.addEventListener('load', function carregarEdicaoUmaVez() {
    iframe.removeEventListener('load', carregarEdicaoUmaVez);
    iframe.contentWindow.postMessage({ type: 'cronicas-camelot-carregar-ficha', dados: dadosFichaAtual, modo: 'edicao', userId: null }, window.location.origin);
  });
}

function abrirEditorFicha(dados, userId = null) {
  if (!dados) return mostrarPopup('❌ Dados da ficha não encontrados.');
  const modal = document.getElementById('modal-criador-ficha');
  const iframe = document.getElementById('iframe-criador-ficha');
  if (!modal || !iframe) return;

  fichaEditandoUserId = userId;
  iframe.src = 'ficha-editor.html?modo=edicao&t=' + Date.now();
  modal.style.display = 'flex';
  iframe.addEventListener('load', function carregarEdicaoUmaVez() {
    iframe.removeEventListener('load', carregarEdicaoUmaVez);
    iframe.contentWindow.postMessage({
      type: 'cronicas-camelot-carregar-ficha',
      dados: dados,
      modo: 'edicao',
      userId: userId
    }, window.location.origin);
  });
}

function fecharCriadorFicha() {
  const modal = document.getElementById('modal-criador-ficha');
  const iframe = document.getElementById('iframe-criador-ficha');
  if (modal) modal.style.display = 'none';
  if (iframe) iframe.src = 'about:blank';
}

function abrirFichaCompletaNoIframe(dados) {
  const conteudoModal = document.getElementById('modal-conteudo-ficha');
  if (!conteudoModal) return;
  conteudoModal.innerHTML = `<iframe id="iframe-ficha-visualizacao" title="Ficha completa do personagem" src="ficha-editor.html?modo=visualizacao&t=${Date.now()}"></iframe>`;
  const iframe = document.getElementById('iframe-ficha-visualizacao');
  iframe.addEventListener('load', () => {
    iframe.contentWindow.postMessage({ type: 'cronicas-camelot-carregar-ficha', dados: dados }, window.location.origin);
  });
}

function abrirFichaAtualCompleta() {
  if (!dadosFichaAtual) return mostrarPopup('❌ Nenhuma ficha carregada.');
  const tituloElem = document.getElementById('modal-titulo-personagem');
  if (tituloElem) tituloElem.innerText = dadosFichaAtual.nome || dadosFichaAtual.personagem_nome || 'Ficha do Cavaleiro';
  abrirFichaCompletaNoIframe(dadosFichaAtual);
  const modal = document.getElementById('modal-ficha-grupo');
  if (modal) modal.style.display = 'flex';
}


// --- FICHAS DO GRUPO ---
async function carregarFichasDoGrupo() {
  if (!supabaseClient) return;
  const lista = document.getElementById('lista-fichas-grupo');
  if (!lista) return;
  lista.innerHTML = '<p style="color: #a8a8b3;">Carregando fichas dos cavaleiros...</p>';

  const { data: { session } } = await supabaseClient.auth.getSession();
  const meuUserId = session?.user?.id || null;

  const { data, error } = await supabaseClient
    .from('fichas')
    .select('*');

  if (error || !data || data.length === 0) {
    lista.innerHTML = '<p style="color: #a8a8b3;">Nenhuma ficha encontrada no grupo.</p>';
    return;
  }

  lista.innerHTML = '';
  
  data.forEach((item) => {
    const card = document.createElement('div');
    card.style.cssText = 'background: #202024; padding: 1rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #29292e; margin-bottom: 8px;';
    
    const infoDiv = document.createElement('div');
    const nomeCavaleiro = item.nome_personagem || 'Cavaleiro Desconhecido';
    infoDiv.innerHTML = `<strong style="color: #fff; font-size: 1.1rem;">${escaparHTML(nomeCavaleiro)}</strong>`;
    
    const acoesDiv = document.createElement('div');
    acoesDiv.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;';

    const botaoVer = document.createElement('button');
    botaoVer.innerText = 'Ver Ficha';
    botaoVer.style.cssText = 'background: #8257e5; color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font-weight: bold;';
    botaoVer.onclick = () => {
      abrirFichaGrupo(item.dados_ficha);
    };
    acoesDiv.appendChild(botaoVer);

    if ((meuUserId && item.user_id === meuUserId) || ehMestreGlobal) {
      const botaoEditar = document.createElement('button');
      botaoEditar.innerText = ehMestreGlobal && item.user_id !== meuUserId ? '👑 Editar como Mestre' : '✏️ Editar';
      botaoEditar.style.cssText = 'background: #315d36; color: #dfffe3; border: 1px solid #7fd88b; padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font-weight: bold;';
      botaoEditar.onclick = () => {
        abrirEditorFicha(item.dados_ficha, item.user_id);
      };
      acoesDiv.appendChild(botaoEditar);
    }

    card.appendChild(infoDiv);
    card.appendChild(acoesDiv);
    lista.appendChild(card);
  });
}

function abrirFichaGrupo(dados) {
  if (!dados) return mostrarPopup('❌ Dados da ficha não encontrados.');
  const tituloElem = document.getElementById('modal-titulo-personagem');
  if (tituloElem) tituloElem.innerText = dados.nome || dados.personagem_nome || 'Ficha do Cavaleiro';
  abrirFichaCompletaNoIframe(dados);
  const modalGrupo = document.getElementById('modal-ficha-grupo');
  if (modalGrupo) modalGrupo.style.display = 'flex';
}


function fecharModalFichaGrupo() {
  const modalGrupo = document.getElementById('modal-ficha-grupo');
  if (modalGrupo) modalGrupo.style.display = 'none';
}

// --- MAPA E MINI-VTT (OTIMIZADO PARA MOBILE) ---
async function fazerUploadMapa() {
  if (!supabaseClient) return alert('Supabase não conectado.');
  const input = document.getElementById('arquivo-mapa');
  if (!input.files || input.files.length === 0) return alert('Selecione uma imagem para o mapa!');

  const file = input.files[0];
  if (!file.type.startsWith('image/')) return mostrarPopup('❌ O mapa precisa ser uma imagem.');
  if (file.size > 12 * 1024 * 1024) return mostrarPopup('❌ O mapa deve ter no máximo 12 MB.');
  const extensao = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fileName = `mapa_${Date.now()}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}.${extensao}`;

  const { error } = await supabaseClient.storage
    .from('galeria')
    .upload(fileName, file);

  if (error) return alert('Erro ao subir imagem: ' + error.message);

  const { data } = supabaseClient.storage
    .from('galeria')
    .getPublicUrl(fileName);
  const publicUrl = data.publicUrl;

  await supabaseClient.from('mapas').upsert({ id: 1, url_mapa: publicUrl });

  exibirMapaNaTela(publicUrl);
  if (canalMesa) {
    canalMesa.send({ type: 'broadcast', event: 'novo_mapa', payload: { url: publicUrl } });
  }
  mostrarPopup('🗺️ Mapa atualizado com sucesso!');
}

async function carregarMapaAtual() {
  if (!supabaseClient) return;
  const { data } = await supabaseClient.from('mapas').select('url_mapa').eq('id', 1).single();
  if (data && data.url_mapa) {
    exibirMapaNaTela(data.url_mapa);
  }
}

function exibirMapaNaTela(url) {
  const container = document.getElementById('container-mapa');
  if (!container) return;

  let zoomControlHTML = '';
  if (ehMestreGlobal) {
    zoomControlHTML = `
      <div style="display: flex; align-items: center; gap: 6px; color: #fff; font-size: 0.85rem;">
        <span>Zoom:</span>
        <input type="range" min="50" max="300" value="${vttZoom}" oninput="alterarZoomMaster(this.value)" style="width: 80px; cursor: pointer;">
        <span id="zoom-label" style="color: #f3d075;">${vttZoom}%</span>
      </div>
      <button id="btn-cadeado-vtt" onclick="alternarMovimentoMapa()" style="background: ${vttMovimentoLivre ? '#04d361' : '#29292e'}; color: #fff; border: 1px solid #4a3d24; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
        ${vttMovimentoLivre ? '🔓 Desbloqueado' : '🔒 Travado'}
      </button>
    `;
  } else {
    zoomControlHTML = `
      <div style="display: flex; align-items: center; gap: 6px; color: #fff; font-size: 0.85rem;">
        <span>Zoom:</span>
        <span id="zoom-label" style="color: #f3d075;">${vttZoom}%</span>
      </div>
    `;
  }

  const alturaMapa = mapaModoImersivo ? '80vh' : '55vh';

  container.innerHTML = `
    <div style="margin-bottom: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; background: #18181b; padding: 8px; border-radius: 6px; border: 1px solid #29292e;">
      <button onclick="alternarGridVTT()" style="padding: 6px 10px; font-size: 0.85rem;">🗺️ Grelha</button>
      <button onclick="abrirModalConfigToken()" style="padding: 6px 10px; font-size: 0.85rem;">🛡️ Meu Token</button>

      ${zoomControlHTML}

      <div style="display: flex; align-items: center; gap: 6px; color: #fff; font-size: 0.85rem;">
        <span>Grid:</span>
        <input type="range" min="20" max="80" value="${vttGridTamanho}" oninput="ajustarGridTamanhoVTT(this.value)" style="width: 70px; cursor: pointer;">
        <span id="grid-size-label" style="color: #f3d075;">${vttGridTamanho}px</span>
      </div>
    </div>
    
    <div id="vtt-canvas" class="vtt-wrapper" style="overflow: hidden; position: relative; width: 100%; height: ${alturaMapa}; border: 1px solid #29292e; border-radius: 6px; background: #0b0d12; display: flex; justify-content: center; align-items: center; touch-action: none; cursor: ${ehMestreGlobal && vttMovimentoLivre ? 'grab' : 'crosshair'}; transition: height 0.3s ease;">
      <div id="vtt-mapa-scaler" style="position: relative; width: 100%; transform: translate(${vttPanX}px, ${vttPanY}px) scale(${vttZoom / 100}); transform-origin: center center; transition: transform 0.05s ease-out; display: flex; justify-content: center; align-items: center;">
        <img src="${escaparHTML(url)}" class="vtt-mapa-img" alt="Mapa Tático" decoding="async" fetchpriority="high" style="width: 100%; display: block; height: auto; pointer-events: none;">
        <div id="vtt-grid-camada" class="vtt-grid ${gridAtivo ? 'ativo' : ''}" style="background-size: ${vttGridTamanho}px ${vttGridTamanho}px; position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none;"></div>
        <div id="vtt-tokens-camada" style="position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none;"></div>
      </div>
    </div>
  `;

  configurarPanMapa();
}

// Configura o arrasto (Pan) do mapa para o Mestre quando destravado
function configurarPanMapa() {
  const canvas = document.getElementById('vtt-canvas');
  if (!canvas) return;

  let estaMovendoMapa = false;
  let inicioX = 0;
  let inicioY = 0;

  const iniciarPan = (e) => {
    if (e.target.closest('.vtt-token')) return;
    
    if (ehMestreGlobal && vttMovimentoLivre) {
      estaMovendoMapa = true;
      inicioX = (e.clientX || e.touches?.[0].clientX) - vttPanX;
      inicioY = (e.clientY || e.touches?.[0].clientY) - vttPanY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    } else {
      darPingNoMapa(e);
    }
  };

  const moverPan = (e) => {
    if (!estaMovendoMapa) return;
    const clientX = e.clientX || e.touches?.[0].clientX;
    const clientY = e.clientY || e.touches?.[0].clientY;

    vttPanX = clientX - inicioX;
    vttPanY = clientY - inicioY;

    atualizarTransformMapaVTT();
    e.preventDefault();
  };

  const pararPan = () => {
    if (estaMovendoMapa) {
      estaMovendoMapa = false;
      if (canvas) canvas.style.cursor = 'grab';
      
      if (canalMesa && ehMestreGlobal) {
        canalMesa.send({
          type: 'broadcast',
          event: 'vtt_zoom',
          payload: { zoom: vttZoom, panX: vttPanX, panY: vttPanY }
        });
      }
    }
  };

  // Pointer Events funcionam para mouse, toque e caneta e evitam
  // listeners globais de touch que podem capturar/interferir com
  // cliques da interface no celular.
  canvas.onpointerdown = iniciarPan;
  canvas.onpointermove = moverPan;
  canvas.onpointerup = pararPan;
  canvas.onpointercancel = pararPan;

}


function alternarMovimentoMapa() {
  if (!ehMestreGlobal) return;
  vttMovimentoLivre = !vttMovimentoLivre;
  
  const btn = document.getElementById('btn-cadeado-vtt');
  const canvas = document.getElementById('vtt-canvas');
  
  if (btn) {
    btn.style.background = vttMovimentoLivre ? '#04d361' : '#29292e';
    btn.innerText = vttMovimentoLivre ? '🔓 Desbloqueado' : '🔒 Travado';
  }
  if (canvas) {
    canvas.style.cursor = vttMovimentoLivre ? 'grab' : 'crosshair';
  }
  mostrarPopup(vttMovimentoLivre ? '🔓 Mapa destravado!' : '🔒 Mapa travado.');
}

function alternarGridVTT() {
  gridAtivo = !gridAtivo;
  const gridDiv = document.getElementById('vtt-grid-camada');
  if (gridDiv) {
    gridDiv.classList.toggle('ativo', gridAtivo);
  }
}

function alterarZoomMaster(valor) {
  if (!ehMestreGlobal) return;
  vttZoom = parseInt(valor);
  atualizarTransformMapaVTT();

  if (canalMesa) {
    canalMesa.send({
      type: 'broadcast',
      event: 'vtt_zoom',
      payload: { zoom: vttZoom, panX: vttPanX, panY: vttPanY }
    });
  }
}

function atualizarTransformMapaVTT() {
  const label = document.getElementById('zoom-label');
  if (label) label.innerText = `${vttZoom}%`;

  const scaler = document.getElementById('vtt-mapa-scaler');
  if (scaler) {
    scaler.style.transform = `translate(${vttPanX}px, ${vttPanY}px) scale(${vttZoom / 100})`;
  }
}

function ajustarGridTamanhoVTT(valor) {
  vttGridTamanho = parseInt(valor);
  const label = document.getElementById('grid-size-label');
  if (label) label.innerText = `${vttGridTamanho}px`;

  const gridDiv = document.getElementById('vtt-grid-camada');
  if (gridDiv) {
    gridDiv.style.backgroundSize = `${vttGridTamanho}px ${vttGridTamanho}px`;
  }
}

function darPingNoMapa(event) {
  if (event.target.classList.contains('vtt-token') || vttMovimentoLivre) return;

  const canvas = document.getElementById('vtt-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  
  const clientX = event.clientX || event.touches?.[0]?.clientX;
  const clientY = event.clientY || event.touches?.[0]?.clientY;
  if (!clientX || !clientY) return;

  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;

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
  tocarSom('ping');
  vibrarPadrao([12]);
  const canvas = document.getElementById('vtt-canvas');
  if (!canvas) return;

  const ping = document.createElement('div');
  ping.className = 'vtt-ping';
  ping.style.left = `${x}%`;
  ping.style.top = `${y}%`;
  canvas.appendChild(ping);

  setTimeout(() => ping.remove(), 1000);
}

// --- MODAL DE CONFIGURAÇÃO DE TOKEN ---
async function abrirModalConfigToken() {
  let modal = document.getElementById('modal-config-token');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-config-token';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 9999; padding: 15px; box-sizing: border-box;';
    document.body.appendChild(modal);
  }

  let imagensHtml = '<p style="color: #a8a8b3; font-size: 0.85rem;">Carregando galeria...</p>';
  if (supabaseClient) {
    const { data } = await supabaseClient.from('galeria_imagens').select('*').order('criado_em', { ascending: false });
    if (data && data.length > 0) {
      imagensHtml = `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; max-height: 120px; overflow-y: auto; background: #0b0d12; padding: 6px; border-radius: 4px; border: 1px solid #29292e;">
          ${data.map(img => `
            <div class="opcao-img-token" onclick="selecionarImgToken('${img.url}', this)" style="cursor: pointer; border: 2px solid transparent; border-radius: 4px; overflow: hidden; height: 45px;">
              <img src="${img.url}" style="width: 100%; height: 100%; object-fit: cover;">
            </div>
          `).join('')}
        </div>
      `;
    } else {
      imagensHtml = '<p style="color: #a8a8b3; font-size: 0.85rem;">Nenhuma imagem na galeria.</p>';
    }
  }

  modal.innerHTML = `
    <div style="background: #151821; border: 2px solid #8257e5; padding: 15px; border-radius: 8px; width: 100%; max-width: 380px; color: #fff; font-family: 'EB Garamond', serif; box-sizing: border-box;">
      <h3 style="color: #f3d075; font-family: 'Cinzel', serif; margin-bottom: 10px; text-align: center; font-size: 1.2rem;">Configurar Meu Token</h3>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <div>
          <label style="display: block; font-size: 0.8rem; color: #e6ca88; margin-bottom: 2px;">Tamanho:</label>
          <select id="token-tamanho-select" style="width: 100%; padding: 6px; background: #0b0d12; color: #fff; border: 1px solid #4a3d24; border-radius: 4px; font-size: 0.85rem;">
            <option value="35">Pequeno</option>
            <option value="45" selected>Padrão</option>
            <option value="65">Médio</option>
            <option value="90">Gigante</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: #e6ca88; margin-bottom: 2px;">HP Máximo:</label>
          <input type="number" id="token-hp-input" value="50" style="width: 100%; padding: 6px; background: #0b0d12; color: #fff; border: 1px solid #4a3d24; border-radius: 4px; font-size: 0.85rem; box-sizing: border-box;">
        </div>
      </div>

      <div style="margin-bottom: 8px;">
        <label style="display: block; font-size: 0.8rem; color: #e6ca88; margin-bottom: 2px;">Escolher Imagem:</label>
        <input type="hidden" id="token-url-escolhida" value="">
        ${imagensHtml}
      </div>

      <div style="margin-bottom: 12px;">
        <label style="display: block; font-size: 0.8rem; color: #e6ca88; margin-bottom: 2px;">Ou Link Direto:</label>
        <input type="text" id="token-url-input" placeholder="https://..." oninput="document.getElementById('token-url-escolhida').value=this.value" style="width: 100%; padding: 6px; background: #0b0d12; color: #fff; border: 1px solid #4a3d24; border-radius: 4px; font-size: 0.85rem; box-sizing: border-box;">
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button onclick="document.getElementById('modal-config-token').style.display='none'" style="background: #29292e; color: #fff; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Cancelar</button>
        <button onclick="confirmarCriacaoToken()" style="background: #8257e5; color: #fff; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">Salvar</button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

function selecionarImgToken(url, elem) {
  document.querySelectorAll('.opcao-img-token').forEach(el => el.style.border = '2px solid transparent');
  elem.style.border = '2px solid #04d361';
  document.getElementById('token-url-escolhida').value = url;
  document.getElementById('token-url-input').value = url;
}

function confirmarCriacaoToken() {
  const tamanho = parseInt(document.getElementById('token-tamanho-select').value) || 45;
  const hpMax = parseInt(document.getElementById('token-hp-input').value) || 50;
  const imagem = document.getElementById('token-url-escolhida').value.trim();
  document.getElementById('modal-config-token').style.display = 'none';
  
  executarAdicionarTokenMesa(tamanho, imagem, hpMax, hpMax);
}

function executarAdicionarTokenMesa(tamanho = 45, imagem = '', hpMax = 50, hpAtual = 50) {
  const userNick = document.getElementById('user-nick-display')?.innerText || document.getElementById('auth-nick')?.value || 'Cavaleiro';
  const tokenID = 'token_' + (userNick.toLowerCase().replace(/[^a-z0-9]/g, '_'));

  criarElementoToken(tokenID, userNick, 10, 10, tamanho, imagem, hpAtual, hpMax, true);
  
  if (canalMesa) {
    canalMesa.send({
      type: 'broadcast',
      event: 'vtt_mover_token',
      payload: { id: tokenID, nome: userNick, x: 10, y: 10, tamanho, imagem, hpAtual, hpMax }
    });
  }
  mostrarPopup('🛡️ Token posicionado na Távola!');
}

function criarElementoToken(id, nome, x, y, tamanho = 45, imagem = '', hpAtual = 50, hpMax = 50, ehMeu = false) {
  const camada = document.getElementById('vtt-tokens-camada');
  if (!camada) return;

  let token = document.getElementById(id);
  if (!token) {
    token = document.createElement('div');
    token.id = id;
    token.className = 'vtt-token';
    camada.appendChild(token);
  }

  token.dataset.tokenId = id;
  token.dataset.tokenNome = nome;
  token.dataset.tokenTamanho = tamanho;
  token.dataset.tokenImagem = imagem;
  token.dataset.tokenHpAtual = hpAtual;
  token.dataset.tokenHpMax = hpMax;

  token.style.width = `${tamanho}px`;
  token.style.height = `${tamanho}px`;
  token.style.borderRadius = '50%';
  token.style.position = 'absolute';
  token.style.transform = 'translate(-50%, -50%)';
  token.style.cursor = 'grab';
  token.style.boxShadow = '0 2px 6px rgba(0,0,0,0.6)';
  token.style.border = '2px solid #f3d075';
  token.style.display = 'flex';
  token.style.alignItems = 'center';
  token.style.justifyContent = 'center';
  token.style.fontWeight = 'bold';
  token.style.fontSize = '0.75rem';
  token.style.color = '#fff';
  token.style.overflow = 'visible';
  token.style.touchAction = 'none';
  token.style.pointerEvents = 'auto';

  if (imagem) {
    token.style.backgroundImage = `url(${imagem})`;
    token.style.backgroundSize = 'cover';
    token.style.backgroundPosition = 'center';
    token.innerText = '';
  } else {
    token.style.backgroundImage = 'none';
    token.style.backgroundColor = '#202024';
    token.innerText = String(nome || '').substring(0, 3).toUpperCase();
  }

  token.style.left = `${x}%`;
  token.style.top = `${y}%`;

  let hpTag = token.querySelector('.vtt-token-hp');
  if (!hpTag) {
    hpTag = document.createElement('div');
    hpTag.className = 'vtt-token-hp';
    hpTag.style.cssText = 'position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%); background: #121214; border: 1px solid #4a3d24; color: #04d361; font-size: 0.6rem; padding: 1px 4px; border-radius: 4px; white-space: nowrap; pointer-events: none; font-family: sans-serif; font-weight: bold;';
    token.appendChild(hpTag);
  }
  hpTag.innerText = `${hpAtual}/${hpMax}`;
  hpTag.style.color = hpAtual <= (hpMax * 0.25) ? '#ff5252' : (hpAtual <= (hpMax * 0.5) ? '#ffab40' : '#04d361');

  // O listener é instalado apenas uma vez. Antes, cada atualização realtime
  // adicionava novos listeners ao window, causando atraso e movimento pesado.
  if ((ehMeu || ehMestreGlobal) && !token.dataset.arrastoConfigurado) {
    token.dataset.arrastoConfigurado = 'true';
    ativarArrastoToken(token);
  }
}

function obterCoordenadasTokenPeloCursor(clientX, clientY) {
  const scaler = document.getElementById('vtt-mapa-scaler');
  const canvas = document.getElementById('vtt-canvas');
  if (!scaler || !canvas) return null;

  const rect = scaler.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  // Usa a caixa REAL do elemento já transformado. Assim o cálculo acompanha
  // zoom e pan e o token fica exatamente sob o cursor.
  let x = ((clientX - rect.left) / rect.width) * 100;
  let y = ((clientY - rect.top) / rect.height) * 100;

  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y))
  };
}

function atualizarPosicaoTokenLocal(token, x, y) {
  token.style.left = `${x}%`;
  token.style.top = `${y}%`;
}

function transmitirMovimentoToken(token, x, y) {
  if (!canalMesa) return;

  const agora = performance.now();
  const ultimo = Number(token.dataset.ultimoBroadcast || 0);
  const intervalo = 35;

  token.dataset.broadcastX = x;
  token.dataset.broadcastY = y;

  if (agora - ultimo < intervalo) {
    if (!token._broadcastAgendado) {
      token._broadcastAgendado = requestAnimationFrame(() => {
        token._broadcastAgendado = null;
        const bx = Number(token.dataset.broadcastX);
        const by = Number(token.dataset.broadcastY);
        transmitirMovimentoToken(token, bx, by);
      });
    }
    return;
  }

  token.dataset.ultimoBroadcast = String(agora);

  canalMesa.send({
    type: 'broadcast',
    event: 'vtt_mover_token',
    payload: {
      id: token.dataset.tokenId,
      nome: token.dataset.tokenNome,
      x,
      y,
      tamanho: Number(token.dataset.tokenTamanho) || 45,
      imagem: token.dataset.tokenImagem || '',
      hpAtual: Number(token.dataset.tokenHpAtual) || 0,
      hpMax: Number(token.dataset.tokenHpMax) || 50
    }
  });
}

function ativarArrastoToken(token) {
  let arrastando = false;
  let moveuDeFato = false;
  let ponteiroAtivo = null;
  let ultimoX = 0;
  let ultimoY = 0;

  const iniciarArrasto = (e) => {
    // Apenas botão esquerdo no mouse.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    arrastando = true;
    moveuDeFato = false;
    ponteiroAtivo = e.pointerId;
    ultimoX = e.clientX;
    ultimoY = e.clientY;

    token.setPointerCapture?.(e.pointerId);
    token.style.cursor = 'grabbing';
    token.classList.add('arrastando');

    e.stopPropagation();
    e.preventDefault();
  };

  const mover = (e) => {
    if (!arrastando) return;
    if (ponteiroAtivo !== null && e.pointerId !== ponteiroAtivo) return;

    // Ignora microscopicamente o mesmo ponto e reduz trabalho desnecessário.
    if (e.clientX === ultimoX && e.clientY === ultimoY) return;
    ultimoX = e.clientX;
    ultimoY = e.clientY;

    const pos = obterCoordenadasTokenPeloCursor(e.clientX, e.clientY);
    if (!pos) return;

    moveuDeFato = true;
    atualizarPosicaoTokenLocal(token, pos.x, pos.y);
    transmitirMovimentoToken(token, pos.x, pos.y);

    e.stopPropagation();
    e.preventDefault();
  };

  const pararArrasto = (e) => {
    if (!arrastando) return;
    if (ponteiroAtivo !== null && e.pointerId !== ponteiroAtivo) return;

    arrastando = false;
    token.releasePointerCapture?.(ponteiroAtivo);
    ponteiroAtivo = null;
    token.style.cursor = 'grab';
    token.classList.remove('arrastando');

    if (!moveuDeFato) {
      const nome = token.dataset.tokenNome || 'Personagem';
      let hpAtual = Number(token.dataset.tokenHpAtual) || 0;
      const hpMax = Number(token.dataset.tokenHpMax) || 50;

      const novoHpStr = prompt(`Gerenciar HP de ${nome} (${hpAtual}/${hpMax}):\nDigite o novo valor ou ajuste com + / - (ex: -5, +5):`, hpAtual);
      if (novoHpStr !== null) {
        const valorTrim = novoHpStr.trim();
        let calculado = hpAtual;

        if (valorTrim.startsWith('+') || valorTrim.startsWith('-')) {
          calculado = Math.max(0, Math.min(hpMax, hpAtual + (parseInt(valorTrim, 10) || 0)));
        } else {
          calculado = Math.max(0, Math.min(hpMax, parseInt(valorTrim, 10) || 0));
        }

        hpAtual = calculado;
        token.dataset.tokenHpAtual = String(hpAtual);

        const hpTag = token.querySelector('.vtt-token-hp');
        if (hpTag) {
          hpTag.innerText = `${hpAtual}/${hpMax}`;
          hpTag.style.color = hpAtual <= (hpMax * 0.25) ? '#ff5252' : (hpAtual <= (hpMax * 0.5) ? '#ffab40' : '#04d361');
        }

        const x = parseFloat(token.style.left) || 0;
        const y = parseFloat(token.style.top) || 0;
        transmitirMovimentoToken(token, x, y);
        mostrarPopup(`❤️ HP de ${nome} atualizado: ${hpAtual}/${hpMax}`);
      }
    }

    e.stopPropagation();
    e.preventDefault();
  };

  token.addEventListener('pointerdown', iniciarArrasto);
  token.addEventListener('pointermove', mover);
  token.addEventListener('pointerup', pararArrasto);
  token.addEventListener('pointercancel', pararArrasto);
}

// --- ROLAGENS DE DADOS ---
function rolarDado(lados) {
  tocarSom('dice');
  vibrarPadrao([22]);
  const resultado = Math.floor(Math.random() * lados) + 1;
  const userNick = document.getElementById('user-nick-display')?.innerText || 'Jogador';
  const descricao = `${userNick} rolou d${lados}`;

  let mensagemExtra = '';
  if (lados === 20) {
    if (resultado === 20) {
      mensagemExtra = ' ✨ BENÇÃO DA DAMA DO LAGO! Crítico!';
    } else if (resultado === 1) {
      mensagemExtra = ' ⚠️ FALHA CRÍTICA!';
    }
  }

  const textoResultado = `${descricao}: ${resultado}${mensagemExtra}`;
  if (lados === 20 && resultado === 20) tocarSom('critical');
  registrarRolagemHistorico(descricao, textoResultado, false);
}

function rolarExpressaoPersonalizada() {
  tocarSom('dice');
  vibrarPadrao([22]);
  const exprInput = document.getElementById('expressao-dado');
  if (!exprInput) return;
  const expr = exprInput.value.trim();
  if (!expr) return alert('Digite uma expressão (ex: 2d20+5)');
  
  try {
    const regex = /^(\d*)d(\d+)([+-]\d+)?$/i;
    const match = expr.match(regex);
    if (!match) return alert('Formato inválido. Use ex: 1d20 ou 2d6+3');

    const qtd = match[1] ? parseInt(match[1]) : 1;
    const lados = parseInt(match[2]);
    const modificador = match[3] ? parseInt(match[3]) : 0;
    if (qtd < 1 || qtd > 100 || lados < 2 || lados > 1000 || Math.abs(modificador) > 10000) {
      return mostrarPopup('❌ Limites da rolagem: até 100 dados, d2–d1000 e modificador de ±10000.');
    }

    let soma = 0;
    let lancamentos = [];
    for (let i = 0; i < qtd; i++) {
      const r = Math.floor(Math.random() * lados) + 1;
      lancamentos.push(r);
      soma += r;
    }

    const totalFinal = soma + modificador;
    const userNick = document.getElementById('user-nick-display')?.innerText || 'Jogador';
    const detalhe = `${qtd}d${lados}${modificador !== 0 ? (modificador > 0 ? '+'+modificador : modificador) : ''} [${lancamentos.join(', ')}]`;
    
    registrarRolagemHistorico(`${userNick} rolou ${detalhe}`, totalFinal, false);
    exprInput.value = '';
  } catch (err) {
    alert('Erro ao processar expressão.');
  }
}

function registrarRolagemHistorico(descricao, resultado, veioDoBroadcast = false) {
  const historico = document.getElementById('historico-rolagens');
  if (!historico) return;

  if (historico.querySelector('p')) historico.innerHTML = '';

  const item = document.createElement('div');
  item.style.cssText = 'background: #202024; padding: 0.5rem 0.8rem; border-radius: 4px; margin-bottom: 0.4rem; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #8257e5; font-size: 0.9rem; gap: 12px;';

  const textoRes = typeof resultado === 'string' ? resultado : `${descricao} = ${resultado}`;
  const descricaoEl = document.createElement('span');
  descricaoEl.style.color = '#a8a8b3';
  descricaoEl.textContent = descricao;
  const resultadoEl = document.createElement('strong');
  resultadoEl.style.cssText = 'color: #04d361; font-size: 1.1rem;';
  resultadoEl.textContent = textoRes;
  item.append(descricaoEl, resultadoEl);

  historico.prepend(item);
  mostrarPopup(`🎲 ${textoRes}`);

  if (!veioDoBroadcast && canalMesa) {
    canalMesa.send({
      type: 'broadcast',
      event: 'nova_rolagem',
      payload: { descricao, resultado: textoRes }
    });
  }
}

// --- GALERIA & IMAGENS ---
async function fazerUploadImagem() {
  if (!supabaseClient) return alert('Supabase não conectado.');
  const input = document.getElementById('arquivo-imagem');
  const categoriaSelect = document.getElementById('categoria-imagem');
  if (!input || !input.files || input.files.length === 0) return alert('Selecione uma imagem!');
  const categoria = categoriaSelect ? categoriaSelect.value : 'Outros';

  const file = input.files[0];
  if (!file.type.startsWith('image/')) return mostrarPopup('❌ Selecione um arquivo de imagem.');
  if (file.size > 8 * 1024 * 1024) return mostrarPopup('❌ A imagem deve ter no máximo 8 MB.');
  const extensao = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fileName = `galeria_${Date.now()}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}.${extensao}`;

  const { error } = await supabaseClient.storage.from('galeria').upload(fileName, file);
  if (error) return alert('Erro no upload: ' + error.message);

  const { data } = supabaseClient.storage.from('galeria').getPublicUrl(fileName);
  const publicUrl = data.publicUrl;

  const { error: dbError } = await supabaseClient.from('galeria_imagens').insert({
    url: publicUrl,
    categoria: categoria,
    criado_em: new Date()
  });

  if (dbError) return alert('Erro ao salvar no banco: ' + dbError.message);

  tocarSom('success');
  mostrarPopup('🖼️ Imagem enviada com sucesso!');
  carregarGaleria();
}

async function carregarGaleria() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from('galeria_imagens')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) return;

  const categorias = ['Personagens', 'Locais', 'Itens', 'Inimigos', 'Outros'];

  categorias.forEach(cat => {
    const container = document.getElementById(`galeria-${cat.toLowerCase()}`) || 
                      document.getElementById(`grid-${cat.toLowerCase()}`);
    
    if (container) {
      const imgsCat = data ? data.filter(img => img.categoria && img.categoria.toLowerCase() === cat.toLowerCase()) : [];
      
      if (imgsCat.length === 0) {
        container.innerHTML = `<p style="color: #a8a8b3; font-size: 0.8rem; padding: 5px;">[${cat}]</p>`;
      } else {
        container.innerHTML = '';
        container.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; padding: 8px;';
        imgsCat.forEach(img => {
          const card = document.createElement('div');
          card.style.cssText = 'background: #202024; border: 1px solid #29292e; border-radius: 6px; overflow: hidden; cursor: pointer;';
          card.innerHTML = `
            <img loading="lazy" decoding="async" src="${escaparHTML(img.url)}" alt="${escaparHTML(img.categoria)}" style="width: 100%; height: 90px; object-fit: cover; display: block;" onerror="this.src='https://via.placeholder.com/120?text=Erro'">
          `;
          card.onclick = () => abrirVisualizadorImagem(img.url, img.categoria);
          container.appendChild(card);
        });
      }
    }
  });

  const gridGeral = document.getElementById('galeria-grid');
  if (gridGeral) {
    gridGeral.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 10px;';
    if (!data || data.length === 0) {
      gridGeral.innerHTML = '<p style="color: #a8a8b3; font-size: 0.9rem;">Nenhuma imagem na galeria.</p>';
    } else {
      gridGeral.innerHTML = '';
      data.forEach(img => {
        const card = document.createElement('div');
        card.style.cssText = 'background: #202024; border: 1px solid #29292e; border-radius: 6px; overflow: hidden; cursor: pointer;';
        card.innerHTML = `
          <img loading="lazy" decoding="async" src="${escaparHTML(img.url)}" alt="${escaparHTML(img.categoria)}" style="width: 100%; height: 110px; object-fit: cover; display: block;" onerror="this.src='https://via.placeholder.com/150?text=Erro'">
          <div style="padding: 0.3rem; font-size: 0.75rem; color: #04d361; text-align: center; background: #121214;">[${img.categoria}]</div>
        `;
        card.onclick = () => abrirVisualizadorImagem(img.url, img.categoria);
        gridGeral.appendChild(card);
      });
    }
  }
}

function abrirVisualizadorImagem(url, categoria) {
  let modal = document.getElementById('modal-visualizador-img');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-visualizador-img';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 9999; padding: 15px; box-sizing: border-box;';
    modal.innerHTML = `
      <div style="position: relative; max-width: 95%; max-height: 85vh; text-align: center;">
        <button onclick="document.getElementById('modal-visualizador-img').style.display='none'" style="position: absolute; top: -35px; right: 0; background: #ff5252; color: #fff; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">✕ Fechar</button>
        <img id="img-ampliada" src="" alt="Zoom" style="max-width: 100%; max-height: 75vh; border-radius: 6px; border: 2px solid #8257e5;">
        <div id="legenda-ampliada" style="color: #fff; margin-top: 8px; font-weight: bold; font-size: 1rem;"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const imgAmpliada = document.getElementById('img-ampliada');
  const legendaAmpliada = document.getElementById('legenda-ampliada');
  if (imgAmpliada) imgAmpliada.src = url;
  if (legendaAmpliada) legendaAmpliada.innerText = `Categoria: ${categoria}`;
  modal.style.display = 'flex';
}

// --- CONTROLE DE MODO IMERSIVO E ESPAÇO DO MAPA ---
function alternarModoImersivoMapa() {
  mapaModoImersivo = !mapaModoImersivo;
  const topo = document.getElementById('topo-geral');
  const painelMestre = document.getElementById('painel-upload-mestre');
  const canvas = document.getElementById('vtt-canvas');
  const btn = document.getElementById('btn-modo-imersivo');

  if (mapaModoImersivo) {
    if (topo) topo.style.display = 'none';
    if (painelMestre) painelMestre.removeAttribute('open');
    if (canvas) canvas.style.height = '80vh';
    if (btn) {
      btn.innerText = '🔙 Restaurar Interface';
      btn.style.background = '#04d361';
      btn.style.color = '#121214';
    }
    mostrarPopup('🔍 Modo Imersivo: Interface recolhida!');
  } else {
    if (topo) topo.style.display = 'block';
    if (canvas) canvas.style.height = '55vh';
    if (btn) {
      btn.innerText = '📐 Maximizar Mapa';
      btn.style.background = '#8257e5';
      btn.style.color = '#fff';
    }
    mostrarPopup('📐 Interface restaurada.');
  }
}

// --- SISTEMA DE TOASTS ---
function mostrarPopup(texto) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; top: 10px; right: 10px; z-index: 99999; display: flex; flex-direction: column; gap: 5px;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = 'background: #18181b; color: #fff; border: 1px solid #8257e5; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px;';
  const icone = document.createElement('span');
  icone.textContent = '⚔️';
  const mensagem = document.createElement('span');
  mensagem.textContent = texto;
  toast.append(icone, mensagem);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================
// EXPORTAÇÕES GLOBAIS
// ==========================================
window.fazerLogin = fazerLogin;
window.fazerCadastro = fazerCadastro;
window.fazerLogout = fazerLogout;
window.mudarAba = mudarAba;
window.importarArquivoJSON = importarArquivoJSON;
window.abrirCriadorFicha = abrirCriadorFicha;
window.fecharCriadorFicha = fecharCriadorFicha;
window.abrirFichaAtualCompleta = abrirFichaAtualCompleta;
window.abrirEditorFichaAtual = abrirEditorFichaAtual;
window.abrirEditorFicha = abrirEditorFicha;
window.salvarFichaNoSupabase = salvarFichaNoSupabase;
window.carregarFichasDoGrupo = carregarFichasDoGrupo;
window.abrirFichaGrupo = abrirFichaGrupo;
window.fecharModalFichaGrupo = fecharModalFichaGrupo;
window.fazerUploadMapa = fazerUploadMapa;
window.alternarGridVTT = alternarGridVTT;
window.alterarZoomMaster = alterarZoomMaster;
window.atualizarTransformMapaVTT = atualizarTransformMapaVTT;
window.ajustarGridTamanhoVTT = ajustarGridTamanhoVTT;
window.darPingNoMapa = darPingNoMapa;
window.abrirModalConfigToken = abrirModalConfigToken;
window.selecionarImgToken = selecionarImgToken;
window.confirmarCriacaoToken = confirmarCriacaoToken;
window.rolarDado = rolarDado;
window.rolarExpressaoPersonalizada = rolarExpressaoPersonalizada;
window.fazerUploadImagem = fazerUploadImagem;
window.alternarMovimentoMapa = alternarMovimentoMapa;
window.alternarModoImersivoMapa = alternarModoImersivoMapa;
window.tocarSom = tocarSom;
