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
let ultimoTokenInteragido = null;
let abasCarregadas = { mapa: false, galeria: false };
let abaAtual = 'ficha';
let pastaGaleriaAtual = 'Todas';
let dadosGaleriaAtual = [];
let imagemMestreAberta = false;
let campanhaAtual = null;
let sistemaAtual = null;
let campanhasDisponiveis = [];

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

  try {
    const abaSalva = localStorage.getItem('cronicas_camelot_aba');
    if (['ficha', 'grupo', 'mapa', 'rolagens', 'galeria'].includes(abaSalva)) {
      mudarAba(abaSalva);
    }
  } catch (err) {}

  if (supabaseClient) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      atualizarInterfaceAuth(session?.user || null);

      if (session?.user) {
        await carregarCampanhasDoUsuario(session.user.id);
        carregarFichaDoUsuario(session.user.id);
      }

      // Se a aba restaurada precisar de dados remotos, carregue somente agora
      // que o Supabase está pronto.
      if (abaAtual === 'mapa' && !abasCarregadas.mapa) {
        abasCarregadas.mapa = true;
        carregarMapaAtual();
      }
      if (abaAtual === 'galeria' && !abasCarregadas.galeria) {
        abasCarregadas.galeria = true;
        carregarGaleria();
      }

      canalMesa = supabaseClient.channel('sala-rpg-geral');
      canalMesa
        .on('broadcast', { event: 'novo_mapa' }, (payload) => {
          if (payload.payload.campanha_id && payload.payload.campanha_id !== obterCampanhaIdAtual()) return;
          exibirMapaNaTela(payload.payload.url);
          mostrarPopup('🗺️ O Mestre atualizou o Mapa de Batalha!');
        })
        .on('broadcast', { event: 'vtt_zoom' }, (payload) => {
          if (payload.payload.campanha_id && payload.payload.campanha_id !== obterCampanhaIdAtual()) return;
          vttZoom = payload.payload.zoom;
          vttPanX = payload.payload.panX || 0;
          vttPanY = payload.payload.panY || 0;
          atualizarTransformMapaVTT();
        })
        .on('broadcast', { event: 'nova_rolagem' }, (payload) => {
          if (payload.payload.campanha_id && payload.payload.campanha_id !== obterCampanhaIdAtual()) return;
          registrarRolagemHistorico(payload.payload.descricao, payload.payload.resultado, true);
        })
        .on('broadcast', { event: 'galeria_mostrar_imagem' }, (payload) => {
          const dados = payload.payload || {};
          if (dados.campanha_id && dados.campanha_id !== obterCampanhaIdAtual()) return;
          if (dados.url) abrirImagemMestre(dados.url, dados.nome || 'Imagem da campanha', dados.pasta || 'Geral', true);
        })
        .on('broadcast', { event: 'galeria_fechar_imagem' }, (payload) => {
          if (payload.payload?.campanha_id && payload.payload.campanha_id !== obterCampanhaIdAtual()) return;
          fecharImagemMestre(true);
        })
        .on('broadcast', { event: 'vtt_ping' }, (payload) => {
          if (payload.payload.campanha_id && payload.payload.campanha_id !== obterCampanhaIdAtual()) return;
          criarEfeitoPing(payload.payload.x, payload.payload.y);
        })
        .on('broadcast', { event: 'vtt_mover_token' }, (payload) => {
          if (payload.payload.campanha_id && payload.payload.campanha_id !== obterCampanhaIdAtual()) return;
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

      // Mapa e galeria agora carregam sob demanda, quando o jogador abre a aba.
      // Isso reduz consultas e trabalho inicial sem alterar o conteúdo dessas abas.
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
    fecharAcoesRapidas();
    fecharCriadorFicha();
    if (typeof fecharModalFichaGrupo === 'function') fecharModalFichaGrupo();
    const visualizador = document.getElementById('modal-visualizador-img');
    if (visualizador) visualizador.style.display = 'none';
    if (typeof fecharImagemMestre === 'function' && imagemMestreAberta) fecharImagemMestre();
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
    await carregarCampanhasDoUsuario(authResult.data.user.id);
    carregarFichaDoUsuario(authResult.data.user.id);
  }
}

async function fazerLogout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  atualizarInterfaceAuth(null);
  dadosFichaAtual = null;
  campanhaAtual = null;
  sistemaAtual = null;
  campanhasDisponiveis = [];
  atualizarContextoCampanha();
  renderizarListaCampanhas();
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
  const painelGaleriaMestre = document.getElementById('painel-galeria-mestre');
  const badgeMestre = document.getElementById('badge-mestre');

  if (user) {
    if (formLogin) formLogin.style.display = 'none';
    if (statusUsuario) statusUsuario.style.display = 'flex';
    
    const nickExibicao = user.user_metadata?.display_name || user.email.split('@')[0];
    const nickDisplay = document.getElementById('user-nick-display');
    if (nickDisplay) nickDisplay.innerText = nickExibicao;

    ehMestreGlobal = (user.email || '').toLowerCase() === 'mestre@rpg.local';
    const btnAbaSistemas = document.getElementById('btn-aba-sistemas');
    const btnNovoSistema = document.getElementById('btn-novo-sistema');
    if (btnAbaSistemas) btnAbaSistemas.style.display = ehMestreGlobal ? 'inline-flex' : 'none';
    if (btnNovoSistema) btnNovoSistema.style.display = ehMestreGlobal ? 'inline-flex' : 'none';
    if (ehMestreGlobal) {
      if (badgeMestre) badgeMestre.style.display = 'inline-block';
      if (painelMapaMestre) painelMapaMestre.style.display = 'block';
      if (painelUploadMestre) painelUploadMestre.style.display = 'block';
      if (painelGaleriaMestre) painelGaleriaMestre.style.display = 'block';
    } else {
      if (badgeMestre) badgeMestre.style.display = 'none';
      if (painelMapaMestre) painelMapaMestre.style.display = 'none';
      if (painelUploadMestre) painelUploadMestre.style.display = 'none';
      if (painelGaleriaMestre) painelGaleriaMestre.style.display = 'none';
    }
  } else {
    ehMestreGlobal = false;
    const btnAbaSistemas = document.getElementById('btn-aba-sistemas');
    const btnNovoSistema = document.getElementById('btn-novo-sistema');
    if (btnAbaSistemas) btnAbaSistemas.style.display = 'none';
    if (btnNovoSistema) btnNovoSistema.style.display = 'none';
    if (formLogin) formLogin.style.display = 'flex';
    if (statusUsuario) statusUsuario.style.display = 'none';
    if (painelMapaMestre) painelMapaMestre.style.display = 'none';
    if (painelUploadMestre) painelUploadMestre.style.display = 'none';
  }
}

// --- CENTRAL DE AÇÕES RÁPIDAS ---
function alternarAcoesRapidas(event) {
  if (event) event.stopPropagation();
  const container = document.getElementById('acoes-rapidas');
  const botao = document.getElementById('btn-acoes-rapidas');
  const menu = document.getElementById('menu-acoes-rapidas');
  if (!container || !botao || !menu) return;

  const aberto = container.classList.toggle('aberto');
  botao.setAttribute('aria-expanded', String(aberto));
  botao.setAttribute('aria-label', aberto ? 'Fechar ações rápidas' : 'Abrir ações rápidas');
  menu.setAttribute('aria-hidden', String(!aberto));
  tocarSom(aberto ? 'success' : 'click');
  vibrarPadrao([aberto ? 14 : 8]);
}

function fecharAcoesRapidas() {
  const container = document.getElementById('acoes-rapidas');
  const botao = document.getElementById('btn-acoes-rapidas');
  const menu = document.getElementById('menu-acoes-rapidas');
  if (!container || !botao || !menu) return;
  container.classList.remove('aberto');
  botao.setAttribute('aria-expanded', 'false');
  botao.setAttribute('aria-label', 'Abrir ações rápidas');
  menu.setAttribute('aria-hidden', 'true');
}

function focarElementoDepoisDoAba(id) {
  window.setTimeout(() => {
    const elemento = document.getElementById(id);
    if (!elemento) return;
    elemento.focus({ preventScroll: true });
    elemento.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
}

function acaoRapida(tipo) {
  fecharAcoesRapidas();

  if (tipo === 'rolagem') {
    mudarAba('rolagens');
    focarElementoDepoisDoAba('expressao-dado');
    mostrarPopup('🎲 Salão de Rolagens aberto.');
    return;
  }

  if (tipo === 'ataque') {
    const expressao = prompt('⚔️ Ação / Ataque\n\nDigite a rolagem (ex: 1d20+5):', '1d20+0');
    if (expressao === null) return;
    const input = document.getElementById('expressao-dado');
    if (!input) return mostrarPopup('❌ Campo de rolagem não encontrado.');
    mudarAba('rolagens');
    input.value = expressao.trim();
    rolarExpressaoPersonalizada();
    return;
  }

  if (tipo === 'vida') {
    if (!ultimoTokenInteragido || !document.body.contains(ultimoTokenInteragido)) {
      mudarAba('mapa');
      mostrarPopup('❤️ Primeiro toque/clique em um token no mapa para selecioná-lo.');
      return;
    }

    const token = ultimoTokenInteragido;
    const nome = token.dataset.tokenNome || 'Personagem';
    const hpAtual = Number(token.dataset.tokenHpAtual) || 0;
    const hpMax = Number(token.dataset.tokenHpMax) || 50;
    const novoHpStr = prompt(`Gerenciar Vida de ${nome} (${hpAtual}/${hpMax}):\nDigite o novo valor ou ajuste com + / - (ex: -5, +5):`, hpAtual);
    if (novoHpStr === null) return;

    const valorTrim = novoHpStr.trim();
    let calculado = hpAtual;
    if (valorTrim.startsWith('+') || valorTrim.startsWith('-')) {
      calculado = Math.max(0, Math.min(hpMax, hpAtual + (parseInt(valorTrim, 10) || 0)));
    } else {
      calculado = Math.max(0, Math.min(hpMax, parseInt(valorTrim, 10) || 0));
    }

    token.dataset.tokenHpAtual = String(calculado);
    const hpTag = token.querySelector('.vtt-token-hp');
    if (hpTag) {
      hpTag.innerText = `${calculado}/${hpMax}`;
      hpTag.style.color = calculado <= (hpMax * 0.25) ? '#ff5252' : (calculado <= (hpMax * 0.5) ? '#ffab40' : '#04d361');
    }

    const x = parseFloat(token.style.left) || 0;
    const y = parseFloat(token.style.top) || 0;
    transmitirMovimentoToken(token, x, y);
    mostrarPopup(`❤️ Vida de ${nome}: ${calculado}/${hpMax}`);
    tocarSom('success');
    return;
  }

  if (tipo === 'chat') {
    mudarAba('galeria');
    mostrarPopup('💬 Chat & Galeria aberto.');
    return;
  }

  if (tipo === 'nota') {
    const texto = prompt('📝 Nota rápida\n\nDigite sua anotação:');
    if (texto === null || !texto.trim()) return;
    let notas = [];
    try {
      notas = JSON.parse(localStorage.getItem('cronicas_camelot_notas') || '[]');
      if (!Array.isArray(notas)) notas = [];
    } catch (err) {
      notas = [];
    }
    notas.unshift({ texto: texto.trim(), data: new Date().toISOString() });
    localStorage.setItem('cronicas_camelot_notas', JSON.stringify(notas.slice(0, 100)));
    mostrarPopup('📝 Nota salva neste dispositivo.');
    tocarSom('success');
    return;
  }

  if (tipo === 'mapa') {
    mudarAba('mapa');
    mostrarPopup('🗺️ Mapa aberto.');
  }
}

document.addEventListener('pointerdown', (event) => {
  const container = document.getElementById('acoes-rapidas');
  if (container && container.classList.contains('aberto') && !container.contains(event.target)) {
    fecharAcoesRapidas();
  }
});

// ==========================================
// ARQUITETURA MULTICAMPANHA — ETAPA 1
// ==========================================
function atualizarContextoCampanha() {
  const contexto = document.getElementById('contexto-campanha');
  const nome = document.getElementById('campanha-ativa-nome');
  const sistema = document.getElementById('campanha-ativa-sistema');
  if (!contexto || !nome || !sistema) return;

  if (!campanhaAtual) {
    contexto.style.display = 'none';
    nome.textContent = 'Nenhuma campanha';
    sistema.textContent = 'Sistema: —';
    return;
  }

  contexto.style.display = 'flex';
  nome.textContent = campanhaAtual.nome || 'Campanha';
  sistema.textContent = `Sistema: ${sistemaAtual?.nome || 'Não definido'}`;
}

function obterCampanhaIdAtual() {
  return campanhaAtual?.id || null;
}

function salvarCampanhaLocalmente() {
  try {
    if (campanhaAtual?.id) localStorage.setItem('cronicas_camelot_campanha', campanhaAtual.id);
    else localStorage.removeItem('cronicas_camelot_campanha');
  } catch (err) {}
}

async function carregarCampanhasDoUsuario(userId) {
  if (!supabaseClient || !userId) return;
  const lista = document.getElementById('lista-campanhas');
  if (lista) lista.innerHTML = '<div class="estado-galeria">Carregando suas campanhas...</div>';

  const { data, error } = await supabaseClient
    .from('campanhas')
    .select('id,nome,descricao,sistema_id,mestre_id,created_at,updated_at,sistemas(id,nome,descricao,configuracao)')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Erro ao carregar campanhas:', error);
    if (lista) lista.innerHTML = '<div class="estado-galeria">Não foi possível carregar as campanhas. Execute a migração SQL da Etapa 1 no Supabase.</div>';
    return;
  }

  campanhasDisponiveis = data || [];
  let idSalvo = null;
  try { idSalvo = localStorage.getItem('cronicas_camelot_campanha'); } catch (err) {}

  const escolhida = campanhasDisponiveis.find(c => c.id === idSalvo) || campanhasDisponiveis[0] || null;
  if (escolhida) await selecionarCampanha(escolhida.id, false);
  else {
    campanhaAtual = null;
    sistemaAtual = null;
    atualizarContextoCampanha();
    renderizarListaCampanhas();
  }

  const btn = document.getElementById('btn-nova-campanha');
  if (btn) btn.style.display = ehMestreGlobal ? 'inline-flex' : 'none';
}

async function selecionarCampanha(campanhaId, mostrarFeedback = true) {
  const campanha = campanhasDisponiveis.find(c => c.id === campanhaId);
  if (!campanha) return;

  campanhaAtual = campanha;
  sistemaAtual = campanha.sistemas || null;
  salvarCampanhaLocalmente();
  atualizarContextoCampanha();
  renderizarListaCampanhas();

  // Limpa estados carregados de recursos da campanha anterior.
  dadosFichaAtual = null;
  abasCarregadas = { mapa: false, galeria: false };
  dadosGaleriaAtual = [];
  pastaGaleriaAtual = 'Todas';

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) carregarFichaDoUsuario(session.user.id);

  if (abaAtual === 'mapa') { abasCarregadas.mapa = true; carregarMapaAtual(); }
  if (abaAtual === 'galeria') { abasCarregadas.galeria = true; carregarGaleria(true); }

  if (mostrarFeedback) mostrarPopup(`🏰 Campanha ativa: ${campanha.nome}`);
}

function renderizarListaCampanhas() {
  const lista = document.getElementById('lista-campanhas');
  if (!lista) return;
  if (!campanhasDisponiveis.length) {
    lista.innerHTML = '<div class="estado-galeria">Nenhuma campanha disponível.</div>';
    return;
  }

  lista.innerHTML = '';
  campanhasDisponiveis.forEach(campanha => {
    const card = document.createElement('article');
    card.className = 'card-campanha' + (campanhaAtual?.id === campanha.id ? ' ativa' : '');
    const sistema = campanha.sistemas?.nome || 'Sistema não definido';
    const mestre = campanha.mestre_id && campanha.mestre_id === campanhaAtual?.mestre_id ? 'Mestre da campanha' : 'Campanha compartilhada';
    card.innerHTML = `
      <div class="card-campanha-conteudo">
        <span class="card-campanha-icone">🏰</span>
        <div><h3>${escaparHTML(campanha.nome)}</h3>
        <p>${escaparHTML(campanha.descricao || 'Sem descrição.')}</p>
        <span class="card-campanha-meta">⚙️ ${escaparHTML(sistema)} · ${escaparHTML(mestre)}</span></div>
      </div>
      <button type="button" class="btn-selecionar-campanha" onclick="selecionarCampanha('${campanha.id}')">${campanhaAtual?.id === campanha.id ? '✓ Campanha ativa' : 'Entrar nesta campanha'}</button>`;
    lista.appendChild(card);
  });
}

async function abrirNovaCampanha() {
  if (!ehMestreGlobal) return;
  const painel = document.getElementById('painel-nova-campanha');
  if (painel) painel.style.display = 'block';
  const select = document.getElementById('nova-campanha-sistema');
  if (select) {
    select.innerHTML = '<option value="">Carregando sistemas...</option>';
    const {data,error}=await supabaseClient.from('sistemas').select('id,nome,configuracao').order('nome',{ascending:true});
    if(error){ select.innerHTML='<option value="">Erro ao carregar sistemas</option>'; console.error(error); }
    else {
      select.innerHTML=(data||[]).map(s=>`<option value="${s.id}">${escaparHTML(s.nome)}${s.configuracao?.tipo==='legado'?' — legado':''}</option>`).join('');
      const preferido=sistemaAtual?.id || (data||[]).find(s=>s.configuracao?.tipo==='legado')?.id || data?.[0]?.id;
      if(preferido) select.value=preferido;
    }
  }
  document.getElementById('nova-campanha-nome')?.focus();
}

function fecharNovaCampanha() {
  const painel = document.getElementById('painel-nova-campanha');
  if (painel) painel.style.display = 'none';
}

async function criarNovaCampanha() {
  if (!supabaseClient || !ehMestreGlobal) return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return mostrarPopup('❌ Faça login como Mestre para criar uma campanha.');

  const nomeInput = document.getElementById('nova-campanha-nome');
  const descricaoInput = document.getElementById('nova-campanha-descricao');
  const nome = nomeInput?.value.trim();
  const descricao = descricaoInput?.value.trim() || '';
  if (!nome) return mostrarPopup('❌ Informe o nome da campanha.');

  const sistemaId = document.getElementById('nova-campanha-sistema')?.value || null;
  if (!sistemaId) return mostrarPopup('❌ Selecione o sistema RPG da campanha.');

  const { data, error } = await supabaseClient
    .from('campanhas')
    .insert({ nome, descricao, sistema_id: sistemaId, mestre_id: session.user.id })
    .select('id,nome,descricao,sistema_id,mestre_id,created_at,updated_at,sistemas(id,nome,descricao,configuracao)')
    .single();

  if (error) return mostrarPopup('❌ Não foi possível criar a campanha: ' + error.message);

  const { error: membroError } = await supabaseClient.from('campanha_membros').insert({ campanha_id: data.id, user_id: session.user.id, papel: 'mestre' });
  if (membroError) console.warn('Campanha criada, mas vínculo do Mestre falhou:', membroError.message);

  campanhasDisponiveis.push(data);
  await selecionarCampanha(data.id);
  fecharNovaCampanha();
  if (nomeInput) nomeInput.value = '';
  if (descricaoInput) descricaoInput.value = '';
  mostrarPopup(`⚔️ Campanha "${nome}" criada com dados separados.`);
}


// ==========================================
// SISTEMAS RPG — ETAPA 3 / CONSTRUTOR VISUAL
// ==========================================
const DADOS_DISPONIVEIS_SISTEMA = ['d4','d6','d8','d10','d12','d20','d100'];
const TIPOS_CAMPO = [
  {value:'texto',label:'Texto'},
  {value:'numero',label:'Número'},
  {value:'area',label:'Texto longo'},
  {value:'checkbox',label:'Caixa de seleção'},
  {value:'select',label:'Lista de opções'}
];
const CAMPOS_SISTEMA_PADRAO = {
  atributos: [{nome:'Força', sigla:'FOR'}, {nome:'Destreza', sigla:'DES'}, {nome:'Constituição', sigla:'CON'}],
  recursos: [{nome:'Vida', sigla:'HP', tipo:'numero'}, {nome:'Energia', sigla:'EN', tipo:'numero'}],
  pericias: [{nome:'Percepção', atributo:'FOR'}],
  campos: [{nome:'História', tipo:'area'}]
};
let builderSistema = { dados: [], atributos: [], recursos: [], pericias: [], campos: [], secoes: [] };
let builderEtapaAtual = 1;

function normalizarCampoBuilder(campo, fallbackTipo='texto') {
  return {
    id: campo?.id || ('campo_' + Math.random().toString(36).slice(2,10)),
    nome: campo?.nome || 'Novo Campo',
    sigla: campo?.sigla || '',
    tipo: campo?.tipo || fallbackTipo,
    atributo: campo?.atributo || '',
    largura: Number(campo?.largura || 1),
    obrigatorio: !!campo?.obrigatorio,
    placeholder: campo?.placeholder || '',
    valor_padrao: campo?.valor_padrao ?? '',
    opcoes: Array.isArray(campo?.opcoes) ? [...campo.opcoes] : [],
    formula: campo?.formula || '',
    calculado: !!campo?.calculado,
    rolagem: campo?.rolagem || '',
    valor_maximo: campo?.valor_maximo ?? '',
    ajuda: campo?.ajuda || ''
  };
}

function gerarCatalogoCampos() {
  return [
    ...builderSistema.atributos.map((x,i)=>({id:x.id||`atributo_${i}`, nome:x.nome, grupo:'Atributo', tipo:'numero'})),
    ...builderSistema.recursos.map((x,i)=>({id:x.id||`recurso_${i}`, nome:x.nome, grupo:'Recurso', tipo:x.tipo||'numero'})),
    ...builderSistema.pericias.map((x,i)=>({id:x.id||`pericia_${i}`, nome:x.nome, grupo:'Perícia', tipo:'numero'})),
    ...builderSistema.campos.map((x,i)=>({id:x.id||`campo_${i}`, nome:x.nome, grupo:'Campo', tipo:x.tipo||'texto'}))
  ];
}

function gerarLayoutPadrao() {
  const catalogo = gerarCatalogoCampos();
  const porGrupo = g => catalogo.filter(x=>x.grupo===g).map(x=>x.id);
  return [
    {id:'sec_identidade', titulo:'Identidade', icone:'📜', colunas:2, campos:[]},
    {id:'sec_atributos', titulo:'Atributos', icone:'🛡️', colunas:3, campos:porGrupo('Atributo')},
    {id:'sec_recursos', titulo:'Recursos', icone:'❤️', colunas:3, campos:porGrupo('Recurso')},
    {id:'sec_pericias', titulo:'Perícias', icone:'🎯', colunas:2, campos:porGrupo('Perícia')},
    {id:'sec_registro', titulo:'Registro', icone:'📚', colunas:1, campos:porGrupo('Campo')}
  ];
}

function normalizarSecao(secao) {
  return {
    id: secao?.id || ('sec_' + Math.random().toString(36).slice(2,10)),
    titulo: secao?.titulo || 'Nova seção',
    icone: secao?.icone || '◆',
    colunas: Math.min(4, Math.max(1, Number(secao?.colunas || 1))),
    campos: Array.isArray(secao?.campos) ? [...secao.campos] : []
  };
}

function iniciarBuilderSistema(config = null) {
  const c = config || CAMPOS_SISTEMA_PADRAO;
  builderSistema = {
    dados: Array.isArray(config?.dados) ? [...config.dados] : ['d20'],
    atributos: Array.isArray(c.atributos) ? c.atributos.map(x=>normalizarCampoBuilder(x,'numero')) : [],
    recursos: Array.isArray(c.recursos) ? c.recursos.map(x=>normalizarCampoBuilder(x,x.tipo||'numero')) : [],
    pericias: Array.isArray(c.pericias) ? c.pericias.map(x=>normalizarCampoBuilder(x,'numero')) : [],
    campos: Array.isArray(c.campos) ? c.campos.map(x=>normalizarCampoBuilder(x,x.tipo||'texto')) : [],
    secoes: Array.isArray(config?.secoes) && config.secoes.length ? config.secoes.map(normalizarSecao) : []
  };
  if (!builderSistema.secoes.length) builderSistema.secoes = gerarLayoutPadrao();
  sincronizarIdsComLayout();
  renderizarBuilderSistema();
}

function sincronizarIdsComLayout() {
  const usados = new Set();
  ['atributos','recursos','pericias','campos'].forEach(tipo=>builderSistema[tipo].forEach((x,i)=>{
    if(!x.id || usados.has(x.id)) x.id=`${tipo.slice(0,-1)}_${Date.now().toString(36)}_${i}`;
    usados.add(x.id);
  }));
  const validos = new Set(gerarCatalogoCampos().map(x=>x.id));
  builderSistema.secoes.forEach(s=>s.campos=s.campos.filter(id=>validos.has(id)));
}

function mudarEtapaBuilder(etapa) {
  builderEtapaAtual = etapa;
  document.querySelectorAll('.builder-etapa').forEach((b,i)=>b.classList.toggle('ativo',i===etapa-1));
  document.querySelectorAll('.builder-etapa-conteudo').forEach((el,i)=>el.classList.toggle('ativo',i===etapa-1));
  if(etapa===2) renderizarSecoesBuilder();
  if(etapa===3) renderizarPreviewBuilder();
}

function abrirNovoSistema() {
  if (!ehMestreGlobal) return;
  document.getElementById('sistema-editando-id').value = '';
  document.getElementById('titulo-editor-sistema').textContent = '👑 Criar novo sistema';
  document.getElementById('novo-sistema-nome').value = '';
  document.getElementById('novo-sistema-descricao').value = '';
  if(document.getElementById('sistema-cor-primaria')) document.getElementById('sistema-cor-primaria').value='#c5a059';
  if(document.getElementById('sistema-cor-fundo')) document.getElementById('sistema-cor-fundo').value='#080a0f';
  if(document.getElementById('sistema-cor-painel')) document.getElementById('sistema-cor-painel').value='#151821';
  iniciarBuilderSistema();
  mudarEtapaBuilder(1);
  document.getElementById('painel-novo-sistema').style.display = 'block';
  document.getElementById('novo-sistema-nome').focus();
}
function fecharNovoSistema() { document.getElementById('painel-novo-sistema').style.display='none'; }
function escSistema(v){ return escaparHTML(v); }

function renderizarBuilderSistema(){
  const chips=document.getElementById('builder-dados');
  if(chips) chips.innerHTML=DADOS_DISPONIVEIS_SISTEMA.map(d=>`<button type="button" class="builder-chip ${builderSistema.dados.includes(d)?'ativo':''}" onclick="alternarDadoSistema('${d}')">${d}</button>`).join('');
  renderListaBuilder('atributos'); renderListaBuilder('recursos'); renderListaBuilder('pericias'); renderListaBuilder('campos');
  sincronizarIdsComLayout();
  if(builderEtapaAtual===2) renderizarSecoesBuilder();
  if(builderEtapaAtual===3) renderizarPreviewBuilder();
}
function alternarDadoSistema(d){ builderSistema.dados=builderSistema.dados.includes(d)?builderSistema.dados.filter(x=>x!==d):[...builderSistema.dados,d]; renderizarBuilderSistema(); }
function adicionarCampoSistema(tipo){
  const defaults={atributos:{nome:'Novo Atributo',sigla:'ATR',tipo:'numero'},recursos:{nome:'Novo Recurso',sigla:'REC',tipo:'numero'},pericias:{nome:'Nova Perícia',atributo:'',tipo:'numero'},campos:{nome:'Novo Campo',tipo:'texto',ajuda:'',opcoes:[]}};
  builderSistema[tipo].push(normalizarCampoBuilder(defaults[tipo],defaults[tipo].tipo));
  sincronizarIdsComLayout(); renderizarBuilderSistema();
}
function atualizarCampoSistema(tipo,index,chave,valor){ if(builderSistema[tipo]?.[index]) builderSistema[tipo][index][chave]=valor; }
function removerCampoSistema(tipo,index){
  const campo=builderSistema[tipo][index];
  builderSistema[tipo].splice(index,1);
  if(campo?.id) builderSistema.secoes.forEach(s=>s.campos=s.campos.filter(id=>id!==campo.id));
  sincronizarIdsComLayout(); renderizarBuilderSistema();
}
function moverCampoSistema(tipo,index,direcao){
  const arr=builderSistema[tipo], novo=index+direcao;
  if(novo<0||novo>=arr.length)return;
  [arr[index],arr[novo]]=[arr[novo],arr[index]]; renderizarBuilderSistema();
}
function renderListaBuilder(tipo){
  const el=document.getElementById('builder-'+tipo); if(!el) return;
  const lista=builderSistema[tipo];
  if(!lista.length){ el.innerHTML='<div class="estado-galeria">Nenhum campo configurado.</div>'; return; }
  el.innerHTML=lista.map((item,i)=>{
    const nav=`<div class="builder-movimento"><button type="button" onclick="moverCampoSistema('${tipo}',${i},-1)" ${i===0?'disabled':''}>↑</button><button type="button" onclick="moverCampoSistema('${tipo}',${i},1)" ${i===lista.length-1?'disabled':''}>↓</button></div>`;
    const tipoSelect=`<select onchange="atualizarCampoSistema('${tipo}',${i},'tipo',this.value)">${TIPOS_CAMPO.map(t=>`<option value="${t.value}" ${item.tipo===t.value?'selected':''}>${t.label}</option>`).join('')}</select>`;
    const opcoes=(item.opcoes||[]).join(', ');
    return `<details class="builder-item-avancado" open>
      <summary><span><strong>${escSistema(item.nome||'Campo')}</strong><small>${escSistema(item.sigla||item.tipo||'campo')}</small></span><span>${nav}</span></summary>
      <div class="builder-item-corpo">
        <div class="builder-linha"><input value="${escSistema(item.nome)}" oninput="atualizarCampoSistema('${tipo}',${i},'nome',this.value);renderizarPreviewBuilder()" placeholder="Nome">
        ${tipo==='atributos'||tipo==='recursos'?`<input value="${escSistema(item.sigla||'')}" maxlength="8" oninput="atualizarCampoSistema('${tipo}',${i},'sigla',this.value)" placeholder="Sigla">`:''}
        ${tipo==='pericias'?`<input value="${escSistema(item.atributo||'')}" oninput="atualizarCampoSistema('pericias',${i},'atributo',this.value)" placeholder="Atributo relacionado">`:''}
        <button type="button" class="btn-remover-campo" onclick="removerCampoSistema('${tipo}',${i})">✕</button></div>
        <div class="builder-opcoes builder-opcoes-avancadas">
          <label>Tipo ${tipoSelect}</label>
          <label>Colunas <select onchange="atualizarCampoSistema('${tipo}',${i},'largura',this.value)">${[1,2,3,4].map(n=>`<option value="${n}" ${Number(item.largura)===n?'selected':''}>${n}</option>`).join('')}</select></label>
          <label class="builder-check"><input type="checkbox" ${item.obrigatorio?'checked':''} onchange="atualizarCampoSistema('${tipo}',${i},'obrigatorio',this.checked)"> obrigatório</label>
          <label class="builder-check"><input type="checkbox" ${item.calculado?'checked':''} onchange="atualizarCampoSistema('${tipo}',${i},'calculado',this.checked);renderizarBuilderSistema()"> calculado</label>
        </div>
        <div class="builder-opcoes builder-opcoes-avancadas">
          <label>Placeholder <input value="${escSistema(item.placeholder)}" oninput="atualizarCampoSistema('${tipo}',${i},'placeholder',this.value)"></label>
          <label>Valor padrão <input value="${escSistema(item.valor_padrao)}" oninput="atualizarCampoSistema('${tipo}',${i},'valor_padrao',this.value)"></label>
          <label>Ajuda <input value="${escSistema(item.ajuda)}" oninput="atualizarCampoSistema('${tipo}',${i},'ajuda',this.value)"></label>
          ${item.tipo==='select'?`<label>Opções <input value="${escSistema(opcoes)}" oninput="atualizarCampoSistema('${tipo}',${i},'opcoes',this.value.split(',').map(x=>x.trim()).filter(Boolean))" placeholder="Humano, Elfo, Orc"></label>`:''}
          ${item.tipo==='numero'?`<label>Valor máximo <input type="number" value="${escSistema(item.valor_maximo)}" oninput="atualizarCampoSistema('${tipo}',${i},'valor_maximo',this.value)"></label>`:''}
          ${item.calculado?`<label class="builder-formula">Fórmula <input value="${escSistema(item.formula)}" oninput="atualizarCampoSistema('${tipo}',${i},'formula',this.value)" placeholder="FOR + DES + 2"></label>`:''}
          ${item.tipo==='numero'?`<label>Rolagem <input value="${escSistema(item.rolagem)}" oninput="atualizarCampoSistema('${tipo}',${i},'rolagem',this.value)" placeholder="1d20 + FOR"></label>`:''}
        </div>
      </div>
    </details>`;
  }).join('');
}
function adicionarSecaoSistema(){
  builderSistema.secoes.push(normalizarSecao({titulo:'Nova seção',icone:'◆',colunas:1,campos:[]}));
  renderizarSecoesBuilder();
}
function removerSecaoSistema(index){ if(builderSistema.secoes.length<=1)return mostrarPopup('⚠️ O sistema precisa ter pelo menos uma seção.'); builderSistema.secoes.splice(index,1); renderizarSecoesBuilder(); }
function moverSecaoSistema(index,direcao){ const novo=index+direcao; if(novo<0||novo>=builderSistema.secoes.length)return; [builderSistema.secoes[index],builderSistema.secoes[novo]]=[builderSistema.secoes[novo],builderSistema.secoes[index]]; renderizarSecoesBuilder(); }
function atualizarSecaoSistema(index,chave,valor){ if(builderSistema.secoes[index]) builderSistema.secoes[index][chave]=chave==='colunas'?Number(valor):valor; }
function alternarCampoSecao(secaoIndex,campoId){
  const s=builderSistema.secoes[secaoIndex]; if(!s)return;
  s.campos=s.campos.includes(campoId)?s.campos.filter(x=>x!==campoId):[...s.campos,campoId];
  renderizarSecoesBuilder();
}
function renderizarSecoesBuilder(){
  const el=document.getElementById('builder-secoes'); if(!el)return;
  const catalogo=gerarCatalogoCampos();
  el.innerHTML=builderSistema.secoes.map((s,i)=>`<div class="builder-secao-card">
    <div class="builder-secao-cabecalho"><div class="builder-secao-titulo"><input class="builder-icone" value="${escSistema(s.icone)}" maxlength="3" oninput="atualizarSecaoSistema(${i},'icone',this.value)"><input value="${escSistema(s.titulo)}" oninput="atualizarSecaoSistema(${i},'titulo',this.value)" placeholder="Título da seção"></div><div class="builder-movimento"><button type="button" onclick="moverSecaoSistema(${i},-1)" ${i===0?'disabled':''}>↑</button><button type="button" onclick="moverSecaoSistema(${i},1)" ${i===builderSistema.secoes.length-1?'disabled':''}>↓</button><button type="button" onclick="removerSecaoSistema(${i})">✕</button></div></div>
    <div class="builder-secao-opcoes"><label>Colunas <select onchange="atualizarSecaoSistema(${i},'colunas',this.value)">${[1,2,3,4].map(n=>`<option value="${n}" ${s.colunas===n?'selected':''}>${n}</option>`).join('')}</select></label></div>
    <div class="builder-catalogo-campos">${catalogo.length?catalogo.map(c=>`<label class="builder-campo-toggle"><input type="checkbox" ${s.campos.includes(c.id)?'checked':''} onchange="alternarCampoSecao(${i},'${c.id}')"><span>${escSistema(c.nome)}</span><small>${c.grupo}</small></label>`).join(''):'<span class="texto-vazio">Crie componentes na etapa 1.</span>'}</div>
  </div>`).join('');
}

function renderizarPreviewBuilder(){
  const el=document.getElementById('builder-preview'); if(!el)return;
  const catalogo=gerarCatalogoCampos();
  const mapa=new Map(catalogo.map(x=>[x.id,x]));
  const identidade=`<section class="preview-secao"><h4>📜 Identidade</h4><div class="preview-grid cols-2"><div><label>Nome do Personagem</label><input placeholder="Ex.: Sir Lancelot"></div><div><label>Nível</label><input type="number" placeholder="1"></div></div></section>`;
  const secoes=builderSistema.secoes.map(s=>`<section class="preview-secao"><h4>${escSistema(s.icone)} ${escSistema(s.titulo)}</h4><div class="preview-grid cols-${s.colunas}">${s.campos.map(id=>{const c=mapa.get(id);if(!c)return '';return `<div class="preview-campo span-${Math.min(4,Number(c.largura||1))}"><label>${escSistema(c.nome)}${c.obrigatorio?' *':''}</label>${c.tipo==='area'?'<textarea rows="3" placeholder="Texto longo..."></textarea>':c.tipo==='checkbox'?'<label class="preview-checkbox"><input type="checkbox"> marcado</label>':`<input type="${c.tipo==='numero'?'number':'text'}" placeholder="${escSistema(c.placeholder||'')}">`}</div>`;}).join('')}</div></section>`).join('');
  el.innerHTML=`<div class="preview-ficha"><div class="preview-cabecalho"><h3>${escSistema(document.getElementById('novo-sistema-nome')?.value||'Novo Sistema')}</h3><p>Ficha de personagem</p></div>${identidade}${secoes||'<p class="texto-vazio">Nenhuma seção configurada.</p>'}</div>`;
}

document.addEventListener('input', function(e){
  if(e.target?.id==='novo-sistema-nome' && builderEtapaAtual===3) renderizarPreviewBuilder();
});

async function carregarSistemas(){
  if(!supabaseClient) return;
  const lista=document.getElementById('lista-sistemas'); if(!lista) return;
  const {data,error}=await supabaseClient.from('sistemas').select('id,nome,descricao,configuracao,criado_por,created_at').order('created_at',{ascending:true});
  if(error){ lista.innerHTML='<div class="estado-galeria">Execute a atualização SQL da Etapa 2 no Supabase.</div>'; console.error(error); return; }
  lista.innerHTML='';
  (data||[]).forEach(s=>{
    const card=document.createElement('article'); card.className='card-sistema'+(s.configuracao?.tipo==='legado'?' legado':'');
    const cfg=s.configuracao||{};
    const resumo=[`${(cfg.dados||[]).length} dados`,`${(cfg.atributos||[]).length} atributos`,`${(cfg.recursos||[]).length} recursos`,`${(cfg.pericias||[]).length} perícias`].join(' · ');
    card.innerHTML=`<div class="card-sistema-topo"><div><h3>⚙️ ${escaparHTML(s.nome)}</h3><p>${escaparHTML(s.descricao||'Sem descrição.')}</p><div class="card-sistema-meta">${escaparHTML(resumo)}</div></div>${cfg.tipo==='legado'?'<span class="badge-legado">LEGADO</span>':''}</div><div class="card-sistema-acoes"><button class="btn-sistema-acao" onclick="abrirFichaDoSistema('${s.id}')">📖 Abrir Ficha</button>${ehMestreGlobal?`<button class="btn-sistema-acao" onclick="editarSistema('${s.id}')">✏️ Editar</button>`:''}</div>`;
    lista.appendChild(card);
  });
}
async function editarSistema(id){
  const s=(await supabaseClient.from('sistemas').select('*').eq('id',id).single()).data; if(!s)return;
  document.getElementById('sistema-editando-id').value=s.id;
  document.getElementById('titulo-editor-sistema').textContent='⚒️ Editar sistema';
  document.getElementById('novo-sistema-nome').value=s.nome||''; document.getElementById('novo-sistema-descricao').value=s.descricao||'';
  iniciarBuilderSistema(s.configuracao||{}); const tema=s.configuracao?.tema||{}; if(document.getElementById('sistema-cor-primaria')) document.getElementById('sistema-cor-primaria').value=tema.corPrimaria||'#c5a059'; if(document.getElementById('sistema-cor-fundo')) document.getElementById('sistema-cor-fundo').value=tema.corFundo||'#080a0f'; if(document.getElementById('sistema-cor-painel')) document.getElementById('sistema-cor-painel').value=tema.corPainel||'#151821'; document.getElementById('painel-novo-sistema').style.display='block'; document.getElementById('novo-sistema-nome').focus();
}
async function salvarSistema(){
  if(!ehMestreGlobal) return; const nome=document.getElementById('novo-sistema-nome')?.value.trim(); if(!nome)return mostrarPopup('❌ Informe o nome do sistema.');
  const descricao=document.getElementById('novo-sistema-descricao')?.value.trim()||''; const id=document.getElementById('sistema-editando-id')?.value||null;
  sincronizarIdsComLayout();
  const config={versao:3,tipo:'generico',dados:[...builderSistema.dados],atributos:builderSistema.atributos.map(x=>({...x})),recursos:builderSistema.recursos.map(x=>({...x})),pericias:builderSistema.pericias.map(x=>({...x})),campos:builderSistema.campos.map(x=>({...x})),secoes:builderSistema.secoes.map(x=>({...x,campos:[...x.campos]})),tema:{corPrimaria:document.getElementById('sistema-cor-primaria')?.value||'#c5a059',corFundo:document.getElementById('sistema-cor-fundo')?.value||'#080a0f',corPainel:document.getElementById('sistema-cor-painel')?.value||'#151821'},ficha:'ficha-generica.html'};
  let q=supabaseClient.from('sistemas'); const payload={nome,descricao,configuracao:config,updated_at:new Date().toISOString()};
  const result=id?await q.update(payload).eq('id',id).select().single():await q.insert({...payload,criado_por:(await supabaseClient.auth.getUser()).data.user?.id}).select().single();
  if(result.error)return mostrarPopup('❌ Erro ao salvar sistema: '+result.error.message);
  fecharNovoSistema(); await carregarSistemas(); mostrarPopup(`⚙️ Sistema "${nome}" salvo com sucesso!`);
}
async function abrirFichaDoSistema(id){
  const {data,error}=await supabaseClient.from('sistemas').select('*').eq('id',id).single(); if(error||!data)return mostrarPopup('❌ Sistema não encontrado.');
  sistemaAtual=data;
  const modal=document.getElementById('modal-criador-ficha'), iframe=document.getElementById('iframe-criador-ficha'); if(!modal||!iframe)return;
  if(data.configuracao?.tipo==='legado') iframe.src='ficha-editor.html?modo=criacao&t='+Date.now(); else iframe.src='ficha-generica.html?modo=criacao&sistema='+encodeURIComponent(id)+'&t='+Date.now();
  const titulo=document.querySelector('#modal-criador-ficha .modal-ficha-cabecalho h2'); if(titulo)titulo.textContent=`⚔️ Ficha — ${data.nome}`;
  modal.style.display='flex';
}

// --- NAVEGAÇÃO DE ABAS ---
function mudarAba(nomeAba, evento) {
  const abasValidas = ['ficha', 'campanhas', 'sistemas', 'grupo', 'mapa', 'rolagens', 'galeria'];
  if (!abasValidas.includes(nomeAba)) return;

  const paineis = document.querySelectorAll('.painel');
  paineis.forEach(p => p.classList.remove('ativo'));
  const botoes = document.querySelectorAll('.abas-navegacao button');
  botoes.forEach(b => b.classList.remove('ativo'));

  const abaAlvo = document.getElementById(`aba-${nomeAba}`) || document.getElementById(nomeAba);
  if (abaAlvo) abaAlvo.classList.add('ativo');

  if (evento && evento.currentTarget) {
    evento.currentTarget.classList.add('ativo');
  } else {
    const botaoAba = document.querySelector(`.abas-navegacao button[onclick*="'${nomeAba}'"]`);
    if (botaoAba) botaoAba.classList.add('ativo');
  }

  abaAtual = nomeAba;
  try { localStorage.setItem('cronicas_camelot_aba', nomeAba); } catch (err) {}

  // Carregamento sob demanda: a mesa abre mais rápido e cada recurso é
  // consultado somente quando realmente é necessário.
  if (nomeAba === 'mapa' && !abasCarregadas.mapa && supabaseClient) {
    abasCarregadas.mapa = true;
    carregarMapaAtual();
  }
  if (nomeAba === 'galeria' && !abasCarregadas.galeria && supabaseClient) {
    abasCarregadas.galeria = true;
    carregarGaleria();
  }
  if (nomeAba === 'sistemas' && supabaseClient) carregarSistemas();
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
  if (!obterCampanhaIdAtual()) return alert('Selecione uma campanha antes de salvar a ficha.');

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
        updated_at: new Date(),
        campanha_id: obterCampanhaIdAtual()
      })
      .eq('user_id', idDestino)
      .eq('campanha_id', obterCampanhaIdAtual());
  } else {
    resultado = await supabaseClient
      .from('fichas')
      .upsert({
        user_id: session.user.id,
        nome_personagem: nomeChar,
        dados_ficha: dadosFichaAtual,
        updated_at: new Date(),
        campanha_id: obterCampanhaIdAtual()
      }, { onConflict: 'user_id,campanha_id' });
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
    .eq('campanha_id', obterCampanhaIdAtual())
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
  if (!campanhaAtual) return mostrarPopup('❌ Selecione uma campanha antes de criar a ficha.');
  if (sistemaAtual?.configuracao?.tipo === 'legado' || sistemaAtual?.configuracao?.ficha === 'ficha-editor.html') {
    iframe.src = 'ficha-editor.html?modo=criacao&t=' + Date.now();
  } else {
    iframe.src = 'ficha-generica.html?modo=criacao&sistema=' + encodeURIComponent(sistemaAtual?.id || '') + '&t=' + Date.now();
  }
  const titulo = document.querySelector('#modal-criador-ficha .modal-ficha-cabecalho h2');
  if (titulo) titulo.textContent = `⚔️ Criar Nova Ficha — ${sistemaAtual?.nome || 'Sistema RPG'}`;
  modal.style.display = 'flex';
}

function abrirEditorFichaAtual() {
  if (!dadosFichaAtual) return mostrarPopup('❌ Nenhuma ficha carregada para editar.');
  const modal = document.getElementById('modal-criador-ficha');
  const iframe = document.getElementById('iframe-criador-ficha');
  if (!modal || !iframe) return;
  iframe.src = (sistemaAtual?.configuracao?.tipo === 'legado' || sistemaAtual?.configuracao?.ficha === 'ficha-editor.html') ? ('ficha-editor.html?modo=edicao&t=' + Date.now()) : ('ficha-generica.html?modo=edicao&sistema=' + encodeURIComponent(sistemaAtual?.id || '') + '&t=' + Date.now());
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
  iframe.src = (sistemaAtual?.configuracao?.tipo === 'legado' || sistemaAtual?.configuracao?.ficha === 'ficha-editor.html') ? ('ficha-editor.html?modo=edicao&t=' + Date.now()) : ('ficha-generica.html?modo=edicao&sistema=' + encodeURIComponent(sistemaAtual?.id || '') + '&t=' + Date.now());
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
    .select('*')
    .eq('campanha_id', obterCampanhaIdAtual());

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

  const campanhaId = obterCampanhaIdAtual();
  if (!campanhaId) return alert('Selecione uma campanha antes de publicar o mapa.');
  const { data: mapaExistente } = await supabaseClient.from('mapas').select('id').eq('campanha_id', campanhaId).limit(1).maybeSingle();
  if (mapaExistente?.id) await supabaseClient.from('mapas').update({ url_mapa: publicUrl }).eq('id', mapaExistente.id).eq('campanha_id', campanhaId);
  else await supabaseClient.from('mapas').insert({ url_mapa: publicUrl, campanha_id: campanhaId });

  exibirMapaNaTela(publicUrl);
  if (canalMesa) {
    canalMesa.send({ type: 'broadcast', event: 'novo_mapa', payload: { url: publicUrl, campanha_id: obterCampanhaIdAtual() } });
  }
  mostrarPopup('🗺️ Mapa atualizado com sucesso!');
}

async function carregarMapaAtual() {
  if (!supabaseClient) return;
  const campanhaId = obterCampanhaIdAtual();
  if (!campanhaId) return;
  const { data } = await supabaseClient.from('mapas').select('url_mapa').eq('campanha_id', campanhaId).limit(1).maybeSingle();
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
          payload: { zoom: vttZoom, panX: vttPanX, panY: vttPanY, campanha_id: obterCampanhaIdAtual() }
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
      payload: { zoom: vttZoom, panX: vttPanX, panY: vttPanY, campanha_id: obterCampanhaIdAtual() }
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
      payload: { x, y, campanha_id: obterCampanhaIdAtual() }
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
    const { data } = await supabaseClient.from('galeria_imagens').select('*').eq('campanha_id', obterCampanhaIdAtual()).order('criado_em', { ascending: false });
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
      hpMax: Number(token.dataset.tokenHpMax) || 50,
      campanha_id: obterCampanhaIdAtual()
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

    ultimoTokenInteragido = token;

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
      payload: { descricao, resultado: textoRes, campanha_id: obterCampanhaIdAtual() }
    });
  }
}

// --- GALERIA & IMAGENS ---
function normalizarPastaGaleria(valor) {
  const limpa = String(valor || 'Geral')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (limpa || 'Geral').slice(0, 60);
}

function escaparAtributoHTML(valor) {
  return escaparHTML(String(valor ?? ''));
}

async function fazerUploadImagem() {
  if (!supabaseClient) return mostrarPopup('❌ Supabase não conectado.');
  if (!ehMestreGlobal) return mostrarPopup('❌ Apenas o Mestre pode organizar a biblioteca.');

  const input = document.getElementById('arquivo-imagem');
  const nomeInput = document.getElementById('nome-imagem');
  const pastaInput = document.getElementById('pasta-imagem');
  const visibilidadeInput = document.getElementById('visibilidade-imagem');
  if (!input || !input.files || input.files.length === 0) return mostrarPopup('❌ Selecione uma imagem.');

  const file = input.files[0];
  if (!file.type.startsWith('image/')) return mostrarPopup('❌ Selecione um arquivo de imagem.');
  if (file.size > 12 * 1024 * 1024) return mostrarPopup('❌ A imagem deve ter no máximo 12 MB.');

  const pasta = normalizarPastaGaleria(pastaInput?.value || 'Geral');
  const nome = String(nomeInput?.value || file.name.replace(/\.[^.]+$/, '')).trim().slice(0, 120) || 'Imagem sem nome';
  const publica = (visibilidadeInput?.value || 'publica') === 'publica';
  const extensao = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const identificador = (window.crypto?.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const campanhaId = obterCampanhaIdAtual();
  if (!campanhaId) return mostrarPopup('❌ Selecione uma campanha antes de enviar imagens.');
  const storagePath = `${campanhaId}/${pasta}/${Date.now()}_${identificador}.${extensao}`;
  const bucketGaleria = publica ? 'galeria' : 'galeria-privada';

  const btn = document.querySelector('.btn-publicar-galeria');
  if (btn) { btn.disabled = true; btn.dataset.textoOriginal = btn.textContent; btn.textContent = '⏳ Enviando...'; }

  try {
    const { error: uploadError } = await supabaseClient.storage.from(bucketGaleria).upload(storagePath, file, { cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;

    let imageUrl = null;
    if (publica) {
      const { data: publicData } = supabaseClient.storage.from('galeria').getPublicUrl(storagePath);
      imageUrl = publicData?.publicUrl || null;
    } else {
      const { data: signedData, error: signedError } = await supabaseClient.storage.from('galeria-privada').createSignedUrl(storagePath, 3600);
      if (signedError) throw signedError;
      imageUrl = signedData?.signedUrl || null;
    }
    if (!imageUrl) throw new Error('Não foi possível obter a URL da imagem.');

    const { error: dbError } = await supabaseClient.from('galeria_imagens').insert({
      url: imageUrl,
      categoria: pasta,
      pasta: pasta,
      nome: nome,
      publico: publica,
      storage_path: storagePath,
      criado_por: (await supabaseClient.auth.getUser()).data.user?.id || null,
      campanha_id: obterCampanhaIdAtual(),
      criado_em: new Date().toISOString()
    });
    if (dbError) throw dbError;

    tocarSom('success');
    mostrarPopup(publica ? '🌐 Imagem publicada para os jogadores.' : '🔒 Imagem salva na pasta oculta.');
    if (input) input.value = '';
    if (nomeInput) nomeInput.value = '';
    await carregarGaleria(true);
  } catch (error) {
    console.error('Erro no upload da galeria:', error);
    mostrarPopup('❌ Erro ao enviar imagem: ' + (error.message || 'erro desconhecido'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.textoOriginal || '📤 Adicionar à Biblioteca'; }
  }
}

async function prepararUrlsGaleria(imagens) {
  const lista = Array.isArray(imagens) ? imagens : [];
  return Promise.all(lista.map(async (img) => {
    const item = { ...img };
    if (!item.publico && item.storage_path) {
      const { data, error } = await supabaseClient.storage.from('galeria-privada').createSignedUrl(item.storage_path, 3600);
      if (!error && data?.signedUrl) item.url = data.signedUrl;
    }
    return item;
  }));
}

async function carregarGaleria(forcar = false) {
  if (!supabaseClient) return;
  const status = document.getElementById('status-galeria');
  if (status) status.textContent = 'Sincronizando...';

  let query = supabaseClient
    .from('galeria_imagens')
    .select('id,url,categoria,pasta,nome,publico,storage_path,criado_em,criado_por,campanha_id')
    .eq('campanha_id', obterCampanhaIdAtual())
    .order('criado_em', { ascending: false });

  if (!ehMestreGlobal) query = query.eq('publico', true);

  const { data, error } = await query;
  if (error) {
    console.error('Erro ao carregar galeria:', error);
    if (status) status.textContent = 'Erro de sincronização';
    const grid = document.getElementById('galeria-grid');
    if (grid) grid.innerHTML = '<div class="estado-galeria">Não foi possível carregar a biblioteca.</div>';
    return;
  }

  dadosGaleriaAtual = await prepararUrlsGaleria(data);
  renderizarPastasGaleria(dadosGaleriaAtual);
  renderizarGaleria(dadosGaleriaAtual);
  if (status) status.textContent = `${dadosGaleriaAtual.length} recurso${dadosGaleriaAtual.length === 1 ? '' : 's'}`;
}

function renderizarPastasGaleria(imagens) {
  const container = document.getElementById('galeria-pastas');
  if (!container) return;

  const nomes = [...new Set(imagens.map(img => String(img.pasta || img.categoria || 'Geral')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const todas = ['Todas', ...nomes];
  if (!todas.includes(pastaGaleriaAtual)) pastaGaleriaAtual = 'Todas';

  container.innerHTML = '';
  todas.forEach(pasta => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pasta-galeria' + (pasta === pastaGaleriaAtual ? ' ativa' : '');
    btn.textContent = pasta === 'Todas' ? '📚 Todas' : `📁 ${pasta}`;
    btn.onclick = (event) => filtrarGaleriaPasta(pasta, event);
    container.appendChild(btn);
  });
}

function filtrarGaleriaPasta(pasta, event) {
  pastaGaleriaAtual = pasta || 'Todas';
  document.querySelectorAll('#galeria-pastas .pasta-galeria').forEach(btn => btn.classList.remove('ativa'));
  if (event?.currentTarget) event.currentTarget.classList.add('ativa');
  else document.querySelectorAll('#galeria-pastas .pasta-galeria').forEach(btn => {
    const texto = btn.textContent.replace(/^📚 |^📁 /, '');
    if (texto === pastaGaleriaAtual) btn.classList.add('ativa');
  });
  renderizarGaleria(dadosGaleriaAtual);
}

function renderizarGaleria(imagens) {
  const grid = document.getElementById('galeria-grid');
  if (!grid) return;

  const filtradas = pastaGaleriaAtual === 'Todas'
    ? imagens
    : imagens.filter(img => String(img.pasta || img.categoria || 'Geral') === pastaGaleriaAtual);

  if (!filtradas.length) {
    grid.innerHTML = `<div class="estado-galeria">${pastaGaleriaAtual === 'Todas' ? 'Nenhuma imagem na biblioteca.' : 'Esta pasta está vazia.'}</div>`;
    return;
  }

  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();
  filtradas.forEach(img => {
    const pasta = String(img.pasta || img.categoria || 'Geral');
    const nome = String(img.nome || 'Imagem sem nome');
    const card = document.createElement('article');
    card.className = 'card-imagem-galeria' + (img.publico ? '' : ' imagem-oculta');

    const media = document.createElement('div');
    media.className = 'thumb-galeria';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = img.url;
    image.alt = nome;
    image.onerror = () => { image.style.opacity = '0.25'; };
    media.appendChild(image);

    const info = document.createElement('div');
    info.className = 'info-imagem-galeria';
    const titulo = document.createElement('strong');
    titulo.textContent = nome;
    const meta = document.createElement('span');
    meta.textContent = `${img.publico ? '🌐 Público' : '🔒 Oculto'} · ${pasta}`;
    info.append(titulo, meta);

    const acoes = document.createElement('div');
    acoes.className = 'acoes-imagem-galeria';
    const btnAbrir = document.createElement('button');
    btnAbrir.type = 'button';
    btnAbrir.className = 'btn-mini-galeria';
    btnAbrir.textContent = '🔎 Abrir';
    btnAbrir.onclick = () => abrirVisualizadorImagem(img.url, pasta, nome);
    acoes.appendChild(btnAbrir);

    if (ehMestreGlobal) {
      const btnMostrar = document.createElement('button');
      btnMostrar.type = 'button';
      btnMostrar.className = 'btn-mini-galeria btn-mostrar-galeria';
      btnMostrar.textContent = '📺 Mostrar para todos';
      btnMostrar.onclick = () => mostrarImagemParaTodos(img);
      acoes.appendChild(btnMostrar);
    }

    card.append(media, info, acoes);
    fragment.appendChild(card);
  });
  grid.appendChild(fragment);
}

function mostrarImagemParaTodos(img) {
  if (!ehMestreGlobal || !img?.url || !canalMesa) return mostrarPopup('❌ Apenas o Mestre pode mostrar imagens.');
  const dados = {
    url: img.url,
    nome: img.nome || 'Imagem da campanha',
    pasta: img.pasta || img.categoria || 'Geral'
  };
  abrirImagemMestre(dados.url, dados.nome, dados.pasta, false);
  canalMesa.send({ type: 'broadcast', event: 'galeria_mostrar_imagem', payload: dados });
  tocarSom('success');
  mostrarPopup('📺 Imagem enviada para todos os jogadores.');
}

function abrirImagemMestre(url, nome, pasta, veioDoBroadcast = false) {
  const modal = document.getElementById('modal-imagem-mestre');
  const img = document.getElementById('imagem-mestre-preview');
  const titulo = document.getElementById('imagem-mestre-titulo');
  const pastaEl = document.getElementById('imagem-mestre-pasta');
  if (!modal || !img) return;

  img.src = url;
  if (titulo) titulo.textContent = nome || 'Imagem da campanha';
  if (pastaEl) pastaEl.textContent = pasta || 'Geral';
  modal.style.display = 'flex';
  imagemMestreAberta = true;
  document.body.classList.add('imagem-mestre-aberta');
  if (veioDoBroadcast) {
    tocarSom('ping');
    vibrarPadrao([20, 30, 20]);
  }
}

function fecharImagemMestre(veioDoBroadcast = false) {
  const modal = document.getElementById('modal-imagem-mestre');
  if (!modal) return;
  modal.style.display = 'none';
  imagemMestreAberta = false;
  document.body.classList.remove('imagem-mestre-aberta');

  if (!veioDoBroadcast && ehMestreGlobal && canalMesa) {
    canalMesa.send({ type: 'broadcast', event: 'galeria_fechar_imagem', payload: { campanha_id: obterCampanhaIdAtual() } });
  }
}

function abrirVisualizadorImagem(url, pasta, nome = 'Imagem da campanha') {
  let modal = document.getElementById('modal-visualizador-img');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-visualizador-img';
    modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.9); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 9999; padding: 15px; box-sizing: border-box;';
    modal.innerHTML = `
      <div style="position:relative; max-width:95%; max-height:90vh; text-align:center;">
        <button type="button" onclick="document.getElementById('modal-visualizador-img').style.display='none'" style="position:absolute; top:-40px; right:0; background:#ff5252; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-weight:bold;">✕ Fechar</button>
        <img id="img-ampliada" src="" alt="" style="max-width:100%; max-height:78vh; border-radius:8px; border:2px solid #d4af37; display:block; margin:auto;">
        <div id="legenda-ampliada" style="color:#fff; margin-top:10px; font-weight:bold; font-size:1rem;"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const imgAmpliada = document.getElementById('img-ampliada');
  const legendaAmpliada = document.getElementById('legenda-ampliada');
  if (imgAmpliada) { imgAmpliada.src = url; imgAmpliada.alt = nome; }
  if (legendaAmpliada) legendaAmpliada.textContent = `${nome} · 📁 ${pasta}`;
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
window.alternarAcoesRapidas = alternarAcoesRapidas;
window.acaoRapida = acaoRapida;
window.fazerLogin = fazerLogin;
window.fazerCadastro = fazerCadastro;
window.fazerLogout = fazerLogout;
window.mudarAba = mudarAba;
window.selecionarCampanha = selecionarCampanha;
window.abrirNovaCampanha = abrirNovaCampanha;
window.fecharNovaCampanha = fecharNovaCampanha;
window.criarNovaCampanha = criarNovaCampanha;
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
window.carregarGaleria = carregarGaleria;
window.filtrarGaleriaPasta = filtrarGaleriaPasta;
window.mostrarImagemParaTodos = mostrarImagemParaTodos;
window.abrirImagemMestre = abrirImagemMestre;
window.fecharImagemMestre = fecharImagemMestre;
window.alternarMovimentoMapa = alternarMovimentoMapa;
window.alternarModoImersivoMapa = alternarModoImersivoMapa;
window.tocarSom = tocarSom;
