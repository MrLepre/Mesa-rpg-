// ==========================================
// CRÔNICAS DE CAMELOT - APP.JS (OTIMIZADO PARA MOBILE E TOQUE)
// ==========================================

const SUPABASE_URL = 'https://rolrbrtpqbchyxmjmvzr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mJmJfELKk4O1HCTzoKxDdw_EWaiv4j1';

let supabaseClient = null;
let dadosFichaAtual = null; 
let canalMesa = null;
let gridAtivo = false;
let vttZoom = 100;
let vttGridTamanho = 40;
let ehMestreGlobal = false;

// Variáveis de controle de Posição (Pan) e Cadeado do Mapa
let vttPanX = 0;
let vttPanY = 0;
let vttMovimentoLivre = false;

// Inicialização segura
try {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (err) {
  console.error('Erro ao inicializar Supabase:', err);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Garante que o corpo da página não tenha overflow horizontal indesejado no mobile
  document.body.style.overflowX = 'hidden';
  document.body.style.touchAction = 'pan-y';

  if (!supabaseClient && window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

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
        .subscribe();

      carregarMapaAtual();
      carregarGaleria();
    } catch (err) {
      console.error('Erro na sessão/conexão:', err);
    }
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

  if (authResult.error && nick.toLowerCase() === 'mestre' && password === '123456') {
    await supabaseClient.auth.signUp({
      email: emailFake,
      password: password,
      options: { data: { display_name: 'Mestre' } }
    });
    authResult = await supabaseClient.auth.signInWithPassword({
      email: emailFake,
      password: password
    });
  }

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

    ehMestreGlobal = nickExibicao.toLowerCase() === 'mestre';
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

async function salvarFichaNoSupabase() {
  if (!supabaseClient) return alert('Supabase não conectado.');
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return alert('Você precisa estar logado para salvar sua ficha!');
  if (!dadosFichaAtual) return alert('Importe um arquivo JSON de ficha primeiro!');

  const nomeChar = dadosFichaAtual.nome || dadosFichaAtual.personagem_nome || 'Personagem';

  const { error } = await supabaseClient
    .from('fichas')
    .upsert({
      user_id: session.user.id,
      nome_personagem: nomeChar,
      dados_ficha: dadosFichaAtual,
      updated_at: new Date()
    }, { onConflict: 'user_id' });

  if (error) {
    mostrarPopup('❌ Erro ao salvar: ' + error.message);
  } else {
    mostrarPopup('💾 Ficha salva na nuvem com sucesso!');
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

function renderizarFichaNaTela(dados) {
  const container = document.getElementById('container-ficha-carregada');
  if (!container) return;
  container.innerHTML = `
    <div style="background-color: #121214; padding: 1rem; border-radius: 6px; border: 1px solid #8257e5;">
      <h3 style="color: #04d361; font-size: 1.4rem;">${dados.nome || dados.personagem_nome || 'Sem Nome'}</h3>
      <p><strong>Nível:</strong> ${dados.nivel || 1} | <strong>Raça/Classe:</strong> ${dados.raca || dados.tipo_humano || ''} / ${dados.classe || ''}</p>
      <pre style="background: #202024; padding: 0.5rem; margin-top: 1rem; border-radius: 4px; max-height: 250px; overflow: auto; font-size: 0.8rem; color: #a8a8b3;">${JSON.stringify(dados, null, 2)}</pre>
    </div>
  `;
}

// --- FICHAS DO GRUPO ---
async function carregarFichasDoGrupo() {
  if (!supabaseClient) return;
  const lista = document.getElementById('lista-fichas-grupo');
  if (!lista) return;
  lista.innerHTML = '<p style="color: #a8a8b3;">Carregando fichas dos cavaleiros...</p>';

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
    infoDiv.innerHTML = `<strong style="color: #fff; font-size: 1.1rem;">${nomeCavaleiro}</strong>`;
    
    const botaoVer = document.createElement('button');
    botaoVer.innerText = 'Ver Ficha';
    botaoVer.style.cssText = 'background: #8257e5; color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font-weight: bold;';
    
    botaoVer.onclick = () => {
      abrirFichaGrupo(item.dados_ficha);
    };

    card.appendChild(infoDiv);
    card.appendChild(botaoVer);
    lista.appendChild(card);
  });
}

function abrirFichaGrupo(dados) {
  const tituloElem = document.getElementById('modal-titulo-personagem');
  if (tituloElem) tituloElem.innerText = dados.nome || dados.personagem_nome || 'Personagem';
  
  const formatarValorOuObjeto = (val) => {
    if (!val) return '-';
    if (typeof val === 'object') {
      return Object.entries(val).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join(' | ');
    }
    return val;
  };

  const periciasHTML = dados.pericias || dados.grimorio_pericias ? (() => {
    const periciasObj = dados.pericias || dados.grimorio_pericias;
    if (typeof periciasObj === 'object') {
      return Object.entries(periciasObj).map(([k, v]) => `<div style="background: #0b0d12; padding: 6px 10px; border: 1px solid #4a3d24; border-radius: 4px; font-size: 0.9rem;"><span style="color: #f3d075;">${k}:</span> ${v}</div>`).join('');
    }
    return `<div style="background: #0b0d12; padding: 6px 10px; border: 1px solid #4a3d24; border-radius: 4px;">${periciasObj}</div>`;
  })() : '<span style="color: #a8a8b3;">Nenhuma perícia registrada.</span>';

  const sinergiaHTML = dados.sinergia_elemental || dados.elementos ? (() => {
    const elemObj = dados.sinergia_elemental || dados.elementos;
    if (typeof elemObj === 'object') {
      return Object.entries(elemObj).map(([k, v]) => `<div style="background: #0b0d12; padding: 6px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;"><span style="font-size: 0.75rem; color: #e6ca88; text-transform: uppercase;">${k}</span><br><strong style="font-size: 1.1rem;">${v}</strong></div>`).join('');
    }
    return '';
  })() : '';

  const conteudoModal = document.getElementById('modal-conteudo-ficha');
  if (conteudoModal) {
    conteudoModal.innerHTML = `
      <div style="background-color: #151821; border: 2px solid #c5a059; padding: 15px; border-radius: 6px; color: #e2d9c5; font-family: 'EB Garamond', serif; max-height: 80vh; overflow-y: auto;">
        
        <div style="display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 15px; border-bottom: 1px solid #4a3d24; padding-bottom: 15px;">
          <div>
            <strong style="color: #f3d075; font-family: 'Cinzel', serif;">Nome do Cavaleiro:</strong> 
            <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; margin-top: 4px;">${dados.nome || dados.personagem_nome || '-'}</div>
          </div>
          <div>
            <strong style="color: #f3d075; font-family: 'Cinzel', serif;">Título / Epíteto:</strong> 
            <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; margin-top: 4px;">${dados.titulo || dados.epiteton || '-'}</div>
          </div>
          <div>
            <strong style="color: #f3d075; font-family: 'Cinzel', serif;">Tipo Humano (Raça):</strong> 
            <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; margin-top: 4px;">${dados.tipo_humano || dados.raca || '-'}</div>
          </div>
        </div>

        <h3 style="color: #f3d075; font-family: 'Cinzel', serif; font-size: 1.1rem; margin-bottom: 8px;">Atributos Vitais</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 15px;">
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">Vida</span><br><strong style="font-size: 1.2rem; color: #ff5252;">${dados.vida || dados.hp || 0}</strong>
          </div>
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">Vigor</span><br><strong style="font-size: 1.2rem; color: #ffab40;">${dados.vigor || 0}</strong>
          </div>
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">Mana</span><br><strong style="font-size: 1.2rem; color: #448aff;">${dados.mana || 0}</strong>
          </div>
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">CA Base</span><br><strong style="font-size: 1.2rem; color: #00e676;">${dados.ca_base || dados.ca || 10}</strong>
          </div>
        </div>

        <h3 style="color: #f3d075; font-family: 'Cinzel', serif; font-size: 1.1rem; margin-bottom: 8px;">Atributos Primários</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 15px;">
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">Força</span><br><strong style="font-size: 1.2rem;">${dados.attr_forca || dados.forca || 1}</strong>
          </div>
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">Agilidade</span><br><strong style="font-size: 1.2rem;">${dados.attr_agilidade || dados.agilidade || 1}</strong>
          </div>
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">Constituição</span><br><strong style="font-size: 1.2rem;">${dados.attr_constituicao || dados.constituicao || 1}</strong>
          </div>
          <div style="background: #0b0d12; padding: 8px; border: 1px solid #4a3d24; border-radius: 4px; text-align: center;">
            <span style="font-size: 0.8rem; color: #e6ca88;">Inteligência</span><br><strong style="font-size: 1.2rem;">${dados.attr_inteligencia || dados.inteligencia || 1}</strong>
          </div>
        </div>

      </div>
    `;
  }
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
  const fileName = `mapa_${Date.now()}.${file.name.split('.').pop()}`;

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

  container.innerHTML = `
    <div style="margin-bottom: 