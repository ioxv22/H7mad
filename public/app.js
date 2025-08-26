// Frontend logic: fetch files, filter, upload, comments, sidebar, and previews
const SUBJECTS = ['رياضيات','فيزياء','كيمياء','أحياء','لغة عربية','لغة إنجليزية'];

function el(tag, attrs={}, ...children){
  const e = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k.startsWith('on') && typeof v === 'function') e[k] = v;
    else if(k === 'class') e.className = v;
    else if(v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for(const c of children){ if(c==null) continue; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  return e;
}

function initSubjects(){
  const grid = document.getElementById('subjectsGrid');
  const filter = document.getElementById('subjectFilter');
  const select = document.getElementById('subject');
  const sidebarList = document.getElementById('sidebarSubjects');

  SUBJECTS.forEach(s => {
    const icons = { 'رياضيات':'➗','فيزياء':'🔬','كيمياء':'⚗️','أحياء':'🧬','لغة عربية':'📖','لغة إنجليزية':'📝' };
    const icon = icons[s] || '📚';

    // Subject card
    grid.appendChild(el('div',{class:'subject-card', tabindex:'0', role:'button', onclick:()=>{filter.value=s; fetchAndRender();}},
      el('span',{class:'icon'},icon), el('span',{class:'name'},s)
    ));

    // Filters options
    const opt = el('option',{value:s},s);
    filter.appendChild(opt.cloneNode(true));
    select.appendChild(opt);

    // Sidebar entry
    const link = el('a',{href:'#', onclick:(e)=>{e.preventDefault(); filter.value=s; fetchAndRender();}},
      el('span',{}, icon),
      el('span',{}, ' '+s)
    );
    sidebarList.appendChild(el('li',{}, link, el('span',{class:'count', id:`count-${s}`}, '')));
  });
}

async function fetchFiles(){
  const subject = document.getElementById('subjectFilter').value;
  const type = document.getElementById('typeFilter').value;
  const q = document.getElementById('searchInput').value.trim();
  const url = new URL('/api/files', location.origin);
  if(subject) url.searchParams.set('subject', subject);
  if(type) url.searchParams.set('type', type);
  if(q) url.searchParams.set('q', q);
  const res = await fetch(url);
  return res.json();
}

function fmtSize(bytes){ if(bytes < 1024) return bytes + ' ب'; const kb = bytes/1024; if(kb < 1024) return kb.toFixed(1)+' ك.ب'; const mb = kb/1024; return mb.toFixed(1)+' م.ب'; }
function fmtDate(iso){ try { return new Date(iso).toLocaleString('ar-EG'); } catch { return iso; } }

function renderThumb(file){
  const t = file.type;
  if(t === 'image') return el('div',{class:'file-thumb'}, el('img',{src:file.url, alt:file.title||file.originalName}));
  if(t === 'video') return el('div',{class:'file-thumb'}, el('video',{src:file.url, controls:false, muted:true, preload:'metadata'}));
  const icon = t==='pdf'?'📄':t==='word'?'📝':'📁';
  return el('div',{class:'file-thumb'}, el('div',{}, icon));
}

function renderTags(keywords){
  if(!keywords || !keywords.length) return null;
  const wrap = el('div',{class:'tag-list'});
  keywords.forEach(k=>wrap.appendChild(el('span',{class:'tag'}, k)));
  return wrap;
}

async function renderFiles(){
  const list = document.getElementById('filesList');
  list.innerHTML = '';
  const files = await fetchFiles();
  // Update sidebar counts
  const counts = SUBJECTS.reduce((acc,s)=> (acc[s]=0, acc), {});
  files.forEach(f=>{ counts[f.subject] = (counts[f.subject]||0) + 1; });
  SUBJECTS.forEach(s=>{ const elc = document.getElementById(`count-${s}`); if(elc) elc.textContent = counts[s] ? String(counts[s]) : ''; });

  if(!files.length){ list.appendChild(el('div',{class:'card'},'لا توجد ملفات مطابقة.')); return; }

  files.forEach(f => {
    const card = el('div',{class:'file-card'},
      renderThumb(f),
      el('div',{class:'file-body'},
        el('div',{class:'title'}, f.title||f.originalName),
        el('div',{class:'meta'}, `${f.subject} • ${fmtSize(f.size)} • ${fmtDate(f.uploadedAt)} • بواسطة ${f.uploaderName} (${f.uploaderRole})`),
        renderTags(f.keywords),
        el('div',{class:'actions'},
          el('a',{class:'btn icon-btn', href:`/api/files/${f.id}/download`}, 'تحميل'),
          el('span',{class:'badge'}, (f.type||'ملف').toUpperCase()),
          el('button',{class:'btn', onclick:()=>openComments(f)}, 'التعليقات'),
          // Admin delete button (visible in admin mode)
          el('button',{class:'btn danger', style:'display:none', 'data-admin-delete':f.id, onclick:()=>deleteFileAdmin(f.id)}, 'حذف')
        )
      )
    );
    list.appendChild(card);
  });
}

async function fetchAndRender(){ await renderFiles(); applyAdminVisibility(); }

function bindSearch(){
  document.getElementById('searchBtn').addEventListener('click', fetchAndRender);
  document.getElementById('searchInput').addEventListener('keyup', (e)=>{ if(e.key==='Enter') fetchAndRender(); });
  document.getElementById('subjectFilter').addEventListener('change', fetchAndRender);
  document.getElementById('typeFilter').addEventListener('change', fetchAndRender);
}

function bindUpload(){
  const form = document.getElementById('uploadForm');
  const status = document.getElementById('uploadStatus');
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    status.textContent = 'جارٍ الرفع...';
    const fd = new FormData(form);
    try{
      const res = await fetch('/api/upload',{ method:'POST', body:fd });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error||'فشل الرفع');
      status.textContent = data.message;
      form.reset();
      fetchAndRender();
    }catch(err){ status.textContent = err.message; }
  });
}

// Sidebar toggle
function bindSidebar(){
  const btn = document.getElementById('toggleSidebar');
  const sidebar = document.getElementById('sidebar');
  btn.addEventListener('click', ()=> sidebar.classList.toggle('open'));
  sidebar.addEventListener('click', (e)=>{ if(e.target === sidebar) sidebar.classList.remove('open'); });
}

// Modal for comments
function openModal(){ document.getElementById('modal').setAttribute('aria-hidden','false'); }
function closeModal(){ document.getElementById('modal').setAttribute('aria-hidden','true'); }
function bindModal(){ document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', closeModal)); }

async function openComments(file){
  openModal();
  document.getElementById('modalTitle').textContent = `التعليقات — ${file.title||file.originalName}`;
  document.getElementById('commentFileId').value = file.id;
  await loadComments(file.id);
}

async function loadComments(fileId){
  const cont = document.getElementById('commentsContainer');
  cont.innerHTML = 'جارٍ التحميل...';
  const res = await fetch(`/api/files/${fileId}/comments`);
  const items = await res.json();
  cont.innerHTML = '';
  if(!items.length){ cont.appendChild(el('div',{class:'comment'},'لا توجد تعليقات بعد.')); return; }
  items.forEach(c=>{
    cont.appendChild(el('div',{class:'comment'},
      el('div',{class:'who'}, `${c.name} • ${fmtDate(c.createdAt)}`),
      el('div',{}, c.text)
    ));
  });
}

function bindCommentForm(){
  const form = document.getElementById('commentForm');
  const status = document.getElementById('commentStatus');
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    status.textContent = 'جارٍ الإرسال...';
    const fileId = document.getElementById('commentFileId').value;
    const name = document.getElementById('commentName').value.trim();
    const text = document.getElementById('commentText').value.trim();
    if(!text){ status.textContent = 'اكتب تعليقًا.'; return; }
    const res = await fetch(`/api/files/${fileId}/comments`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, text }) });
    const data = await res.json();
    if(!res.ok){ status.textContent = data.error||'فشل إضافة التعليق'; return; }
    status.textContent = data.message;
    document.getElementById('commentText').value='';
    await loadComments(fileId);
  });
}

// Admin mode toggle and simple key storage
let ADMIN_MODE = false;
let ADMIN_KEY = '';
function applyAdminVisibility(){
  document.querySelectorAll('[data-admin-delete]').forEach(btn=>{
    btn.style.display = ADMIN_MODE ? '' : 'none';
  });
}
async function deleteFileAdmin(id){
  if(!ADMIN_MODE){ alert('لست في وضع المشرف'); return; }
  if(!confirm('تأكيد حذف الملف؟')) return;
  const res = await fetch(`/api/files/${id}`, { method:'DELETE', headers:{ 'x-admin-key': ADMIN_KEY }});
  const data = await res.json().catch(()=>({}));
  if(!res.ok){ alert(data.error||'فشل حذف الملف'); return; }
  await fetchAndRender();
  applyAdminVisibility();
}
function bindAdmin(){
  const btn = document.getElementById('adminModeBtn');
  btn.addEventListener('click', async ()=>{
    if(!ADMIN_MODE){
      const key = prompt('أدخل مفتاح المشرف');
      if(!key) return;
      ADMIN_KEY = key;
      ADMIN_MODE = true;
      btn.textContent = 'خروج من وضع المشرف';
      applyAdminVisibility();
    } else {
      ADMIN_MODE = false; ADMIN_KEY=''; btn.textContent = 'وضع المشرف'; applyAdminVisibility();
    }
  });
}

// Chat (Socket.IO)
let socket;
function bindChat(){
  socket = io();
  const chatBox = document.querySelector('.chat-box');
  // Collapse by default
  if(chatBox && !chatBox.classList.contains('collapsed')) chatBox.classList.add('collapsed');
  const chatTitle = chatBox?.querySelector('h4');
  chatTitle?.addEventListener('click', ()=> chatBox.classList.toggle('collapsed'));

  const list = document.getElementById('chatMessages');
  const form = document.getElementById('chatForm');
  const nameInput = document.getElementById('chatName');
  const textInput = document.getElementById('chatText');
  const setNameBtn = document.getElementById('setNameBtn');
  const usersBox = document.getElementById('chatUsers');
  const dmForm = document.getElementById('dmForm');
  const dmTo = document.getElementById('dmTo');
  const dmText = document.getElementById('dmText');

  function appendMsg(m){
    const row = el('div',{class:'chat-msg'},
      el('div',{class:'who'}, `${m.name||'مشارك'} • ${fmtDate(m.time||new Date())}`),
      el('div',{}, m.text||'')
    );
    list.appendChild(row); list.scrollTop = list.scrollHeight;
  }

  function renderUsers(users){
    usersBox.innerHTML = '';
    dmTo.innerHTML = '';
    users.forEach(u=>{
      const isMe = socket.id === u.id;
      const label = isMe ? `${u.name} (أنا)` : u.name;
      usersBox.appendChild(el('div',{}, label));
      if(!isMe){ dmTo.appendChild(el('option',{value:u.id}, u.name)); }
    });
  }

  socket.on('connect', ()=>{
    const nm = (nameInput.value||'').trim();
    if(nm) socket.emit('chat:setName', nm);
  });
  socket.on('chat:users', renderUsers);
  socket.on('chat:history', (msgs)=>{ list.innerHTML=''; msgs.forEach(appendMsg); });
  socket.on('chat:message', appendMsg);
  socket.on('chat:dm', (m)=>{
    const row = el('div',{class:'chat-msg'},
      el('div',{class:'who'}, `خاص من ${m.fromName} • ${fmtDate(m.time)}`),
      el('div',{}, m.text)
    );
    list.appendChild(row); list.scrollTop = list.scrollHeight;
  });

  setNameBtn.addEventListener('click', ()=>{
    const nm = (nameInput.value||'').trim();
    if(nm) socket.emit('chat:setName', nm);
  });

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const nm = (nameInput.value||'').trim() || 'مشارك';
    const text = (textInput.value||'').trim();
    if(!text) return;
    socket.emit('chat:message', { name: nm, text });
    textInput.value='';
  });

  dmForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    const to = dmTo.value; const text = (dmText.value||'').trim();
    if(!to || !text) return;
    socket.emit('chat:dm', { to, text });
    dmText.value = '';
  });
}

// Init
window.addEventListener('DOMContentLoaded', ()=>{
  initSubjects();
  bindSearch();
  bindUpload();
  bindSidebar();
  bindModal();
  bindCommentForm();
  bindAdmin();
  bindChat();
  fetchAndRender();
});