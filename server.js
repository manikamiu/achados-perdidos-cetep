const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const uploadDir = path.join(ROOT, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(ROOT, 'database.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    phone TEXT DEFAULT '',
    social TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('perdido','encontrado')),
    location TEXT NOT NULL,
    item_date TEXT NOT NULL,
    image TEXT,
    status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto','devolvido')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Migração automática para bancos criados em versões anteriores.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
for (const [column, definition] of [['phone', "TEXT DEFAULT ''"], ['social', "TEXT DEFAULT ''"], ['avatar', "TEXT DEFAULT ''"]]) {
  if (!userColumns.includes(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-esta-chave-em-producao-ceu-azul',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(ROOT, 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
  }
});
const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Envie uma imagem JPG, PNG, WEBP ou GIF.'));
  }
});

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  next();
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, phone: user.phone || '', social: user.social || '', avatar: user.avatar || '' }; }

app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Informe um nome entre 2 e 60 caracteres.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (password.length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name, email, hash);
    const user = publicUser({ id: result.lastInsertRowid, name, email });
    req.session.user = user;
    res.status(201).json({ user });
  } catch (err) {
    console.error('ERRO AO CRIAR CONTA:', err);

    if (String(err.code).includes('SQLITE_CONSTRAINT')) {
        return res.status(409).json({
            error: 'Este e-mail já possui cadastro.'
        });
    }

    res.status(500).json({
        error: 'Não foi possível criar sua conta.'
    });
}
});
app.post('/api/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const found = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!found || !(await bcrypt.compare(password, found.password_hash))) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  req.session.user = publicUser(found);
  res.json({ user: req.session.user });
});
const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 *  1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Envie uma foto JPG, PNG, WEBP ou GIF.'));
  }
});
app.patch('/api/profile', auth, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Falha ao enviar foto.' });
    try {
      const name = String(req.body.name || '').trim();
      const phone = String(req.body.phone || '').trim();
      const social = String(req.body.social || '').trim();
      if (name.length < 2 || name.length > 60) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'O nome deve ter entre 2 e 60 caracteres.' });
      }
      if (phone.length > 30 || social.length > 160) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Confira o tamanho do telefone e da rede social.' });
      }
      const previous = db.prepare('SELECT avatar FROM users WHERE id=?').get(req.session.user.id);
      const avatar = req.file ? `/uploads/${req.file.filename}` : (previous?.avatar || '');
      db.prepare('UPDATE users SET name=?, phone=?, social=?, avatar=? WHERE id=?')
        .run(name, phone, social, avatar, req.session.user.id);
      const updated = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id));
      req.session.user = updated;
      if (req.file && previous?.avatar) {
        const oldPath = path.join(ROOT, previous.avatar.replace(/^\//, ''));
        if (oldPath.startsWith(uploadDir) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      res.json({ user: updated });
    } catch (e) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Não foi possível atualizar seu perfil.' });
    }
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/items', (req, res) => {
  const q = String(req.query.q || '').trim();
  const kind = ['perdido','encontrado'].includes(req.query.kind) ? req.query.kind : '';
  const category = String(req.query.category || '').trim();
  const status = ['aberto','devolvido'].includes(req.query.status) ? req.query.status : '';
  let sql = `SELECT items.*, users.name AS reporter FROM items JOIN users ON users.id=items.user_id WHERE 1=1`;
  const args = [];
  if (q) { sql += ` AND (items.title LIKE ? OR items.description LIKE ? OR items.location LIKE ?)`; args.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (kind) { sql += ' AND items.kind=?'; args.push(kind); }
  if (category) { sql += ' AND items.category=?'; args.push(category); }
  if (status) { sql += ' AND items.status=?'; args.push(status); }
  sql += ' ORDER BY items.created_at DESC';
  res.json({ items: db.prepare(sql).all(...args), currentUserId: req.session.user?.id || null });
});
app.post('/api/items', auth, (req, res) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Falha ao enviar imagem.' });
    try {
      const { title, description, category, kind, location, item_date } = req.body;
      if (![title, description, category, kind, location, item_date].every(v => String(v || '').trim())) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
      }
      if (!['perdido','encontrado'].includes(kind)) return res.status(400).json({ error: 'Tipo de registro inválido.' });
      const result = db.prepare(`INSERT INTO items (user_id,title,description,category,kind,location,item_date,image)
        VALUES (?,?,?,?,?,?,?,?)`).run(req.session.user.id, String(title).trim().slice(0,90), String(description).trim().slice(0,1200), category, kind, String(location).trim().slice(0,120), item_date, req.file ? `/uploads/${req.file.filename}` : null);
      res.status(201).json({ item: db.prepare('SELECT items.*, users.name AS reporter FROM items JOIN users ON users.id=items.user_id WHERE items.id=?').get(result.lastInsertRowid) });
    } catch (e) { res.status(500).json({ error: 'Não foi possível salvar o registro.' }); }
  });
});
app.patch('/api/items/:id/resolve', auth, (req, res) => {
  const result = db.prepare("UPDATE items SET status='devolvido' WHERE id=? AND user_id=? AND status='aberto'").run(Number(req.params.id), req.session.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Registro não encontrado ou não pertence à sua conta.' });
  res.json({ ok: true });
});
app.delete('/api/items/:id', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(Number(req.params.id), req.session.user.id);
  if (!item) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.prepare('DELETE FROM items WHERE id=?').run(item.id);
  if (item.image) { const file = path.join(ROOT, item.image.replace(/^\//, '')); if (file.startsWith(uploadDir) && fs.existsSync(file)) fs.unlinkSync(file); }
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => res.status(500).json({ error: 'Ocorreu um erro inesperado.' }));
app.listen(PORT, () => console.log(`☁️ Céu Azul no ar: http://localhost:${PORT}`));
