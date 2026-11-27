const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let currentUser = null;
let authMode = 'login';
let cachedItems = [];
let toastTimer;

async function api(url, options={}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Algo deu errado.');
  return data;
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
function escapeHTML(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function dateBR(value) {
  if (!value) return '—';
  const [y,m,d] = value.slice(0,10).split('-');
  return `${d}/${m}/${y}`;
}
function itemCard(item, own=false) {
  const image = item.image ? `<img src="${escapeHTML(item.image)}" alt="Foto de ${escapeHTML(item.title)}" loading="lazy">` : '☁';
  const kind = item.kind === 'perdido' ? 'Perdido' : 'Encontrado';
  const status = item.status === 'devolvido' ? '<span class="tag done">Devolvido</span>' : '<span class="tag">Em aberto</span>';
  return `<article class="item-card">
    <div class="item-photo">${image}</div><div class="item-info"><div class="item-tags"><span class="tag ${item.kind==='perdido'?'lost':''}">${kind}</span>${status}</div>
    <h4 title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</h4><p>${escapeHTML(item.description)}</p>
    <div class="item-meta"><span>⌖ ${escapeHTML(item.location)}</span><span>${dateBR(item.item_date)}</span></div>
    <div class="item-actions"><button class="mini-btn" data-detail="${item.id}">Ver detalhes</button>${own && item.status==='aberto'?`<button class="mini-btn" data-resolve="${item.id}">Devolvido ✓</button>`:''}${own?`<button class="mini-btn danger" data-delete="${item.id}">Excluir</button>`:''}</div></div></article>`;
}
function renderItems(items, target, own=false) {
  const el = $(target);
  el.innerHTML = items.length ? items.map(item => itemCard(item, own)).join('') : '<div class="empty-state">Nenhum registro por aqui ainda. ☁<br>Que tal adicionar o primeiro?</div>';
}
async function loadItems() {
  const params = new URLSearchParams();
  const q = $('#searchInput')?.value.trim(); const kind = $('#kindFilter')?.value; const category = $('#categoryFilter')?.value; const status = $('#statusFilter')?.value;
  if (q) params.set('q', q); if (kind) params.set('kind', kind); if (category) params.set('category', category); if (status) params.set('status', status);
  const data = await api(`/api/items?${params}`); cachedItems = data.items;
  const all = data.items;
  $('#totalCount').textContent = all.length;
  $('#lostCount').textContent = all.filter(i=>i.kind==='perdido'&&i.status==='aberto').length;
  $('#foundCount').textContent = all.filter(i=>i.kind==='encontrado'&&i.status==='aberto').length;
  renderItems(all.slice(0,3), '#recentItems');
  renderItems(all, '#allItems');
  renderItems(all.filter(i=>currentUser && i.user_id===currentUser.id), '#myItems', true);
}
async function refreshUser() {
  const data = await api('/api/me'); currentUser = data.user;
  $('#loginPanelTitle').textContent = currentUser ? `Olá, ${currentUser.name.split(' ')[0]}!` : 'Entre para participar!';
  $('#loginPanelText').textContent = currentUser ? 'Sua conta está conectada.' : 'Publique um item perdido ou encontrado.';
  $('#loginPanelBtn').textContent = currentUser ? 'Sair da conta' : 'Fazer login →';
  $('#accountBtn').innerHTML = currentUser?.avatar ? `<img class="account-avatar" src="${escapeHTML(currentUser.avatar)}" alt="Foto do perfil">` : (currentUser ? '●' : '♙');
  await loadItems();
}
function showView(view) {
  const titles = {home:'Olá! Seja bem-vindo(a)!',items:'Mural de itens',new:'Cadastrar um item',mine:'Meus registros'};
  $('#pageTitle').textContent = titles[view] || titles.home;
  $$('.view-section').forEach(el=>el.classList.add('hidden'));
  $('#itemsView').classList.toggle('hidden', view!=='items');
  $('#newView').classList.toggle('hidden', view!=='new');
  $('#mineView').classList.toggle('hidden', view!=='mine');
  $('.hero-window').classList.toggle('hidden', view!=='home');
  $('.stats-grid').classList.toggle('hidden', view!=='home');
  $('.content-grid').classList.toggle('hidden', view!=='home');
  $$('.dock-btn[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  if (view==='items'||view==='mine') loadItems().catch(e=>toast(e.message));
  if (view==='new' && !currentUser) openAuth();
  window.scrollTo({top:0,behavior:'smooth'});
}
function openAuth(mode='login') { $('#authModal').classList.remove('hidden'); setAuthMode(mode); }
function setAuthMode(mode) {
  authMode=mode;
  $$('.auth-tab').forEach(b=>b.classList.toggle('active',b.dataset.authTab===mode));
  $('#nameField').classList.toggle('hidden',mode!=='register');
  $('#nameField input').required=mode==='register';
  $('#authTitle').textContent=mode==='login'?'Que bom ter você aqui!':'Crie sua conta ☁';
  $('#authSubtitle').textContent=mode==='login'?'Entre na sua conta para participar.':'É rapidinho! Depois você já pode publicar.';
  $('#authForm [name=password]').autocomplete=mode==='login'?'current-password':'new-password';
  $('.auth-submit').textContent=mode==='login'?'Entrar na conta →':'Criar minha conta →';
}
function closeModal(id){$('#'+id).classList.add('hidden');}
async function showDetail(id) {
  const item = cachedItems.find(i=>i.id===Number(id)) || (await api('/api/items')).items.find(i=>i.id===Number(id));
  if(!item) return toast('Este item não está mais disponível.');
  const photo=item.image?`<img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.title)}">`:'☁';
  $('#detailContent').innerHTML=`<div class="item-photo">${photo}</div><div><div class="item-tags"><span class="tag ${item.kind==='perdido'?'lost':''}">${item.kind==='perdido'?'Perdido':'Encontrado'}</span><span class="tag">${escapeHTML(item.category)}</span><span class="tag ${item.status==='devolvido'?'done':''}">${item.status==='devolvido'?'Devolvido':'Em aberto'}</span></div><h2>${escapeHTML(item.title)}</h2><p>${escapeHTML(item.description)}</p><div class="detail-meta">⌖ Local: ${escapeHTML(item.location)}<br>▦ Data: ${dateBR(item.item_date)}<br>♡ Publicado por: ${escapeHTML(item.reporter)}<br>✧ Registro: #${item.id}</div></div>`;
  $('#detailModal').classList.remove('hidden');
}

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.go)));
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
$$('[data-auth-tab]').forEach(b=>b.addEventListener('click',()=>setAuthMode(b.dataset.authTab)));
function openProfile() {
  if (!currentUser) return openAuth();
  const form = $('#profileForm');
  form.elements.name.value = currentUser.name || '';
  form.elements.phone.value = currentUser.phone || '';
  form.elements.social.value = currentUser.social || '';
  $('#profileEmail').value = currentUser.email || '';
  $('#profileAvatarPreview').innerHTML = currentUser.avatar
    ? `<img src="${escapeHTML(currentUser.avatar)}" alt="Sua foto de perfil">`
    : '૮₍ ˶• ༝ •˶₎ა';
  $('#profileAvatarInput').value = '';
  $('#profileModal').classList.remove('hidden');
}
$('#accountBtn').addEventListener('click',()=>currentUser?openProfile():openAuth());
$('#loginPanelBtn').addEventListener('click',async()=>{
  if(currentUser){try{await api('/api/logout',{method:'POST'});await refreshUser();toast('Você saiu da sua conta.');}catch(e){toast(e.message)}}else openAuth();
});
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault(); const form=new FormData(e.currentTarget); const payload=Object.fromEntries(form.entries());
  try{const data=await api(`/api/${authMode==='login'?'login':'register'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});currentUser=data.user;closeModal('authModal');e.currentTarget.reset();await refreshUser();toast(`Bem-vindo(a), ${currentUser.name.split(' ')[0]}! ☁`);if(!$('#newView').classList.contains('hidden'))showView('new');}
  catch(err){toast(err.message)}
});
$('#profileAvatarInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { e.target.value = ''; toast('A foto deve ter no máximo 5 MB.'); return; }
  const reader = new FileReader();
  reader.onload = () => { $('#profileAvatarPreview').innerHTML = `<img src="${reader.result}" alt="Prévia da foto de perfil">`; };
  reader.readAsDataURL(file);
});
$('#profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  try {
    const data = await api('/api/profile', { method: 'PATCH', body: form });
    currentUser = data.user;
    closeModal('profileModal');
    await refreshUser();
    toast('Perfil atualizado com sucesso! ☁');
  } catch (err) { toast(err.message); }
});

$('#itemForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!currentUser){openAuth();return;}
  const form=new FormData(e.currentTarget);
  try{await api('/api/items',{method:'POST',body:form});e.currentTarget.reset();$('#imagePreview').innerHTML='<span>▧</span> A prévia da foto aparecerá aqui';await loadItems();toast('Item publicado no mural! ✦');showView('items');}
  catch(err){toast(err.message)}
});
$('#imageInput').addEventListener('change',e=>{
  const file=e.target.files[0];const preview=$('#imagePreview');if(!file){preview.innerHTML='<span>▧</span> A prévia da foto aparecerá aqui';return;}
  if(file.size>5*1024*1024){e.target.value='';toast('A imagem deve ter no máximo 5 MB.');return;}
  const reader=new FileReader();reader.onload=()=>preview.innerHTML=`<img src="${reader.result}" alt="Prévia da imagem enviada">`;reader.readAsDataURL(file);
});
let searchTimer;['searchInput','kindFilter','categoryFilter','statusFilter'].forEach(id=>$('#'+id).addEventListener(id==='searchInput'?'input':'change',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadItems().catch(e=>toast(e.message)),id==='searchInput'?250:0)}));
document.addEventListener('click',async e=>{
  const detail=e.target.closest('[data-detail]');if(detail){showDetail(detail.dataset.detail).catch(err=>toast(err.message));return;}
  const resolve=e.target.closest('[data-resolve]');if(resolve){try{await api(`/api/items/${resolve.dataset.resolve}/resolve`,{method:'PATCH'});await loadItems();toast('Registro atualizado como devolvido! ♡');}catch(err){toast(err.message)}return;}
  const del=e.target.closest('[data-delete]');if(del){if(!confirm('Tem certeza de que deseja excluir este registro?'))return;try{await api(`/api/items/${del.dataset.delete}`,{method:'DELETE'});await loadItems();toast('Registro excluído.');}catch(err){toast(err.message)}}
});
$('#themeToggle').addEventListener('click',()=>{document.body.classList.toggle('dark');const dark=document.body.classList.contains('dark');$('#themeToggle').textContent=dark?'☀':'☾';try{localStorage.setItem('ceu-azul-theme',dark?'dark':'light')}catch{}});
$('#helpBtn').addEventListener('click',()=>toast('Dica: faça login para publicar, atualizar ou excluir seus próprios registros.'));
$('#today').textContent=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric'}).format(new Date());
function updateClock(){ $('#clock').textContent=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date()); }
updateClock();setInterval(updateClock,30000);
try{if(localStorage.getItem('ceu-azul-theme')==='dark'){document.body.classList.add('dark');$('#themeToggle').textContent='☀'}}catch{}
refreshUser().catch(err=>toast(err.message));
