// Educational portal for Grade 11 with admin delete and live chat
// Backend: Node + Express + Multer + Socket.IO. Stores metadata and comments in JSON files.

const http = require('http');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
// CORS origins for dev/prod
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
const ENV_ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = ENV_ALLOWED.length ? ENV_ALLOWED : DEFAULT_ALLOWED_ORIGINS;

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET','POST','DELETE'], credentials: true }
}); // supports public chat and DMs

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'Hamadk2010@'; // simple admin key via header x-admin-key

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const FILES_DB = path.join(DATA_DIR, 'files.json');
const COMMENTS_DB = path.join(DATA_DIR, 'comments.json');
const CHAT_DB = path.join(DATA_DIR, 'chat.json');

// Ensure folders and DB files exist
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(PUBLIC_DIR);
ensureDir(UPLOADS_DIR);
ensureDir(DATA_DIR);
if (!fs.existsSync(FILES_DB)) fs.writeFileSync(FILES_DB, '[]', 'utf8');
if (!fs.existsSync(COMMENTS_DB)) fs.writeFileSync(COMMENTS_DB, '{}', 'utf8');
if (!fs.existsSync(CHAT_DB)) fs.writeFileSync(CHAT_DB, '[]', 'utf8');

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR)); // serve files for previews
app.use(express.static(PUBLIC_DIR));

// Subjects whitelist
const SUBJECTS = ['رياضيات', 'فيزياء', 'كيمياء', 'أحياء', 'لغة عربية', 'لغة إنجليزية'];

// Type detection
function detectType(filename, mimetype) {
  const ext = (path.extname(filename) || '').toLowerCase();
  if (mimetype === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (
    mimetype === 'application/msword' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.doc' || ext === '.docx'
  ) return 'word';
  if (mimetype.startsWith('image/') || ['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)) return 'image';
  if (mimetype.startsWith('video/') || ['.mp4','.webm','.mov','.m4v'].includes(ext)) return 'video';
  return 'other';
}

// Multer storage and filter
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname) || '';
    cb(null, `${id}${ext}`);
  },
});

const allowedMimes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png','image/jpeg','image/gif','image/webp',
  'video/mp4','video/webm','video/quicktime'
]);
const fileFilter = (req, file, cb) => {
  if (allowedMimes.has(file.mimetype)) return cb(null, true);
  // Fallback by extension
  const ext = (path.extname(file.originalname) || '').toLowerCase();
  if (['.pdf','.doc','.docx','.png','.jpg','.jpeg','.gif','.webp','.mp4','.webm','.mov','.m4v'].includes(ext)) return cb(null, true);
  cb(new Error('نوع الملف غير مدعوم. يُقبل PDF وWord والصور والفيديوهات القصيرة'));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// Helpers to read/write JSON DBs safely
async function readJson(file, fallback) {
  try { const txt = await fsp.readFile(file, 'utf8'); return txt ? JSON.parse(txt) : fallback; } catch (_) { return fallback; }
}
async function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

// GET /api/files?subject=&q=&type=
app.get('/api/files', async (req, res) => {
  const { subject = '', q = '', type = '' } = req.query;
  const all = await readJson(FILES_DB, []);
  const subjectTrim = String(subject).trim();
  const qTrim = String(q).trim().toLowerCase();
  const typeTrim = String(type).trim();

  let filtered = all;
  if (subjectTrim) filtered = filtered.filter((f) => f.subject === subjectTrim);
  if (typeTrim) filtered = filtered.filter((f) => f.type === typeTrim);
  if (qTrim) {
    filtered = filtered.filter((f) => {
      const hay = [f.title, f.originalName, ...(f.keywords||[])].join(' ').toLowerCase();
      return hay.includes(qTrim);
    });
  }
  filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  res.json(filtered);
});

// POST /api/upload (fields: title, subject, uploaderName, uploaderRole, keywords) + file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { title = '', subject = '', uploaderName = 'مستخدم', uploaderRole = 'طالب', keywords = '' } = req.body;
    if (!req.file) return res.status(400).json({ error: 'يرجى اختيار ملف' });
    const subjectClean = String(subject).trim();
    if (!SUBJECTS.includes(subjectClean)) return res.status(400).json({ error: 'المادة غير صحيحة' });

    const kw = String(keywords)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);

    const type = detectType(req.file.originalname, req.file.mimetype);

    const record = {
      id: path.parse(req.file.filename).name,
      title: String(title).trim() || req.file.originalname,
      subject: subjectClean,
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      type,
      keywords: kw,
      uploaderName: String(uploaderName).trim() || 'مستخدم',
      uploaderRole: ['طالب', 'معلم'].includes(uploaderRole) ? uploaderRole : 'طالب',
      uploadedAt: new Date().toISOString(),
    };
    const all = await readJson(FILES_DB, []);
    all.push(record);
    await writeJson(FILES_DB, all);
    res.json({ message: 'تم رفع الملف بنجاح', file: record });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'حدث خطأ أثناء الرفع' });
  }
});

// DELETE /api/files/:id (admin only)
app.delete('/api/files/:id', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'غير مصرح: مفتاح المشرف غير صحيح' });

    const { id } = req.params;
    const all = await readJson(FILES_DB, []);
    const idx = all.findIndex((f) => f.id === id);
    if (idx === -1) return res.status(404).json({ error: 'الملف غير موجود' });

    const item = all[idx];
    const filepath = path.join(UPLOADS_DIR, item.filename);
    if (fs.existsSync(filepath)) {
      try { await fsp.unlink(filepath); } catch (_) {}
    }

    all.splice(idx, 1);
    await writeJson(FILES_DB, all);

    // Remove comments for this file
    const commentsMap = await readJson(COMMENTS_DB, {});
    if (commentsMap[id]) {
      delete commentsMap[id];
      await writeJson(COMMENTS_DB, commentsMap);
    }

    res.json({ message: 'تم حذف الملف' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'فشل حذف الملف' });
  }
});

// Download endpoint
app.get('/api/files/:id/download', async (req, res) => {
  const { id } = req.params;
  const all = await readJson(FILES_DB, []);
  const item = all.find((f) => f.id === id);
  if (!item) return res.status(404).send('الملف غير موجود');
  const filepath = path.join(UPLOADS_DIR, item.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('الملف غير موجود');
  res.download(filepath, item.originalName);
});

// Comments
app.get('/api/files/:id/comments', async (req, res) => {
  const { id } = req.params;
  const map = await readJson(COMMENTS_DB, {});
  res.json(map[id] || []);
});

app.post('/api.files/:id/comments', async (req, res, next) => next()); // compatibility typo guard (noop)

app.post('/api/files/:id/comments', async (req, res) => {
  const { id } = req.params;
  const { name = 'مستخدم', text = '' } = req.body || {};
  const content = String(text).trim();
  if (!content) return res.status(400).json({ error: 'نص التعليق مطلوب' });
  const comment = { id: uuidv4(), name: String(name).trim() || 'مستخدم', text: content, createdAt: new Date().toISOString() };
  const map = await readJson(COMMENTS_DB, {});
  const arr = map[id] || [];
  arr.push(comment);
  map[id] = arr;
  await writeJson(COMMENTS_DB, map);
  res.json({ message: 'تم إضافة التعليق', comment });
});

// Chat history endpoint
app.get('/api/chat/history', async (req, res) => {
  const msgs = await readJson(CHAT_DB, []);
  res.json(msgs.slice(-100));
});

// Socket.IO chat with presence and private messages
const onlineUsers = new Map(); // socket.id -> { id, name }
io.on('connection', async (socket) => {
  // Identify user
  let user = { id: socket.id, name: `مشارك-${String(socket.id).slice(-4)}` };
  socket.on('chat:setName', (name) => {
    const nm = String(name||'').trim().slice(0,40) || user.name;
    user = { ...user, name: nm };
    onlineUsers.set(socket.id, user);
    io.emit('chat:users', Array.from(onlineUsers.values()));
  });

  // Add to presence and send history
  onlineUsers.set(socket.id, user);
  io.emit('chat:users', Array.from(onlineUsers.values()));
  try { const history = await readJson(CHAT_DB, []); socket.emit('chat:history', history.slice(-50)); } catch {}

  // Public message
  socket.on('chat:message', async (payload) => {
    const name = String(payload?.name || user.name).slice(0, 40);
    const text = String(payload?.text || '').slice(0, 600).trim();
    if (!text) return;
    const msg = { id: uuidv4(), name, text, time: new Date().toISOString() };
    io.emit('chat:message', msg);
    const msgs = await readJson(CHAT_DB, []);
    msgs.push(msg);
    const trimmed = msgs.slice(-500);
    await writeJson(CHAT_DB, trimmed);
  });

  // Private message
  socket.on('chat:dm', (payload) => {
    const to = String(payload?.to||'');
    const text = String(payload?.text||'').slice(0,600).trim();
    if(!to || !text) return;
    const targetSocket = io.sockets.sockets.get(to);
    if(!targetSocket) return;
    const dm = { id: uuidv4(), from: user.id, fromName: user.name, to, text, time: new Date().toISOString() };
    socket.emit('chat:dm', dm); // echo to sender
    targetSocket.emit('chat:dm', dm); // deliver to recipient
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('chat:users', Array.from(onlineUsers.values()));
  });
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});