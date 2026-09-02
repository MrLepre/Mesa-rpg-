const SUPABASE_URL = 'https://rolrbrtpqbchyxmjmvzr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mJmJfELKk4O1HCTzoKxDdw_EWaiv4j1';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const canalMesa = supabaseClient.channel('sala-rpg-geral');

let dadosFichaAtual = null;

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  atualizarInterfaceAuth(session?.user || null);

  if (session?.user) {
    carregarFichaDoUsuario(session.user.id);
  }

  canalMesa
    .on('broadcast', { event: 'novo_mapa' }, (payload) => {
      exibirMapaNaTela(payload.payload.url);
      mostrarPopup('🗺️ O Mestre atualizou o Mapa de Batalha!');
    })
    .subscribe();

  carregarMapaAtual();
});

function nickParaEmail(nick) {
  const nickTratado = nick.trim().toLowerCase().replace(/\s+/g, '');
  return `${nickTratado}@rpg.local`;
}

async function fazerCadastro() {
  const nick = document.getElementById('auth-nick').value;
  const password = document.getElementById('auth-senha').value;

  if (!nick || !password) return alert('Informe Nick e senha!');

  const emailFake = nickParaEmail(nick);

  const { data, error } = await supabaseClient.auth.signUp({
    email: emailFake,
    password: password,
    options: {
      data: { display_name: nick }
    }
  });

  if (error) {
    mostrarPopup('❌ Erro no cadastro: ' + error.message);
  } else {
    mostrarPopup('✅ Conta criada com sucesso! Clique em Entrar.');
  }
}

async function fazerLogin() {
  const nick = document.getElementById('auth-nick').value;
  const password = document.getElementById('auth-senha').value;

  if (!nick || !password) return alert('Informe Nick e senha!');

  const emailFake = nickParaEmail(nick);

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: emailFake,
    password: password
  });

  if (error) {
    mostrarPopup('❌ Nick ou senha incorretos.');
  } else {
    mostrarPopup('✅ Login realizado!');
    atualizarInterfaceAuth(data.user);
    carregarFichaDoUsuario(data.user.id);
  }
}

async function fazerLogout() {
  await supabaseClient.auth.signOut();
  atualizarInterfaceAuth(null);
  dadosFichaAtual = null;
  document.getElementById('container-ficha-carregada').innerHTML = '<p style="color: #a8a8b3;">Faça login para visualizar sua ficha.</p>';
  mostrarPopup('Desconectado.');
}

function atualizarInterfaceAuth(user) {
  const formLogin = document.getElementById('form-login');
  const statusUsuario = document.getElementById('status-usuario');
  const painelMestre = document.getElementById('painel-mestre-mapa');
  const badgeMestre = document.getElementById('badge-mestre');

  if (user) {
    formLogin.style.display = 'none';
    statusUsuario.style.display = 'flex';
    
    const nickExibicao = user.user_metadata?.display_name || user.email.split('@')[0];
    document.getElementById('user-nick-display').innerText = nickExibicao;

    if (nickExibicao.toLowerCase() === 'mestre') {
      badgeMestre.style.display = 'inline-block';
      if (painelMestre) painelMestre.style.display = 'block';
    } else {
      badgeMestre.style.display = 'none';
      if (painelMestre) painelMestre.style.display = 'none';
    }
  } else {
    formLogin.style.display = 'flex';
    statusUsuario.style.display = 'none';
    if (painelMestre) painelMestre.style.display = 'none';
    badgeMestre.style.display = 'none';
  }
}

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
  const { data: { session } } = await supabaseClient.auth.getSession();
  
  if (!session) {
    return alert('Você precisa estar logado para salvar sua ficha!');
  }
  if (!dadosFichaAtual) {
    return alert('Importe um arquivo JSON de ficha primeiro!');
  }

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
    mostrarPopup('💾 Ficha vinculada e salva na nuvem com sucesso!');
  }
}

async function carregarFichaDoUsuario(userId) {
  const { data } = await supabaseClient
    .from('fichas')
    .select('dados_ficha')
    .eq('user_id', userId)
    .single();

  if (data && data.dados_ficha) {
    dadosFichaAtual = data.dados_ficha;
    renderizarFichaNaTela(dadosFichaAtual);
    mostrarPopup('⚡ Sua ficha salva foi carregada da nuvem!');
  }
}

function renderizarFichaNaTela(dados) {
  const container = document.getElementById('container-ficha-carregada');
  container.innerHTML = `
    <div style="background-color: #121214; padding: 1rem; border-radius: 6px; border: 1px solid #8257e5;">
      <h3 style="color: #04d361; font-size: 1.4rem;">${dados.nome || dados.personagem_nome || 'Sem Nome'}</h3>
      <p><strong>Nível:</strong> ${dados.nivel || 3} | <strong>Antecedente:</strong> ${dados.antecedente || 'Nenhum'}</p>
      <pre style="background: #202024; padding: 0.5rem; margin-top: 1rem; border-radius: 4px; max-height: 200px; overflow: auto; font-size: 0.8rem; color: #a8a8b3;">${JSON.stringify(dados, null, 2)}</pre>
    </div>
  `;
}

async function atualizarMapaParaTodos() {
  const url = document.getElementById('url-novo-mapa').value;
  if (!url) return alert('Informe a URL da imagem do mapa!');

  await supabaseClient
    .from('mapas')
    .upsert({ id: 1, url_mapa: url, updated_at: new Date() });

  exibirMapaNaTela(url);

  canalMesa.send({
    type: 'broadcast',
    event: 'novo_mapa',
    payload: { url }
  });

  mostrarPopup('🗺️ Mapa atualizado para toda a mesa!');
}

async function carregarMapaAtual() {
  const { data } = await supabaseClient
    .from('mapas')
    .select('url_mapa')
    .eq('id', 1)
    .single();

  if (data && data.url_mapa) {
    exibirMapaNaTela(data.url_mapa);
  }
}

function exibirMapaNaTela(url) {
  const img = document.getElementById('img-mapa');
  const texto = document.getElementById('mapa-vazio-texto');

  if (url) {
    img.src = url;
    img.style.display = 'block';
    texto.style.display = 'none';
  }
}

function mudarAba(nomeAba, evento) {
  const paineis = document.querySelectorAll('.painel');
  paineis.forEach(p => p.classList.remove('ativo'));
  const botoes = document.querySelectorAll('.abas-navegacao button');
  botoes.forEach(b => b.classList.remove('ativo'));

  document.getElementById(`aba-${nomeAba}`).classList.add('ativo');
  if (evento && evento.currentTarget) evento.currentTarget.classList.add('ativo');
}

function mostrarPopup(texto) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = texto;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
