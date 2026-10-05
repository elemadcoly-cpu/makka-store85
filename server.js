const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ROOT = __dirname;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

if (IS_PRODUCTION && !JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Add a PostgreSQL database and connect its DATABASE_URL variable.');
}
if (IS_PRODUCTION && (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD)) {
  throw new Error('ADMIN_USER and ADMIN_PASSWORD are required on first production startup.');
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename: (_, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, Date.now() + '-' + safe);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new Error('يسمح فقط بصور JPG/PNG/WebP/GIF'));
    cb(null, true);
  }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins(
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      old_price NUMERIC(12,2),
      emoji TEXT DEFAULT '🛍️',
      image TEXT,
      badge TEXT DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders(
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS order_items(
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      quantity INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  `);

  const admin = await pool.query('SELECT id FROM admins LIMIT 1');
  if (!admin.rowCount) {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'Makka@12345';
    const hash = await bcrypt.hash(password, 12);
    await pool.query('INSERT INTO admins(username,password_hash) VALUES($1,$2)', [username, hash]);
  }

  const count = await pool.query('SELECT COUNT(*)::int AS c FROM products');
  if (count.rows[0].c === 0) {
    const seed = [
      ['كاميرا مراقبة داخلية','كاميرات',185,225,'📷','الأكثر طلباً',20,'كاميرا داخلية ذكية للمراقبة المنزلية'],
      ['كاميرا خارجية ذكية','كاميرات',320,390,'🎥','جديد',12,'كاميرا خارجية مناسبة للمراقبة والحماية'],
      ['سماعات لاسلكية','إلكترونيات',149,199,'🎧','خصم',25,'سماعات لاسلكية بجودة صوت ممتازة'],
      ['ساعة ذكية','إلكترونيات',229,299,'⌚','مميز',15,'ساعة ذكية للاستخدام اليومي'],
      ['عطر فاخر','تجميل',179,220,'🧴','خصم',18,'عطر فاخر مناسب للاستخدام اليومي والمناسبات'],
      ['منتج عناية بالبشرة','تجميل',95,120,'✨','جديد',30,'منتج مختار للعناية بالبشرة'],
      ['شاحن سريع','إكسسوارات',65,85,'🔌','',40,'شاحن سريع عملي'],
      ['حامل هاتف للسيارة','إكسسوارات',55,75,'📱','',35,'حامل هاتف ثابت للسيارة']
    ];
    for (const x of seed) {
      await pool.query(`INSERT INTO products(name,category,price,old_price,emoji,badge,stock,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, x);
    }
  }
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    req.admin = jwt.verify(token, JWT_SECRET || 'development-secret');
    next();
  } catch {
    res.status(401).json({ error: 'غير مصرح. سجل الدخول أولاً.' });
  }
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'makka-store' }); }
  catch { res.status(503).json({ ok: false }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = await pool.query('SELECT * FROM admins WHERE username=$1', [username]);
    const admin = result.rows[0];
    if (!admin || !(await bcrypt.compare(password || '', admin.password_hash))) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET || 'development-secret', { expiresIn: '8h' });
    res.json({ token, username: admin.username });
  } catch (e) { res.status(500).json({ error: 'تعذر تسجيل الدخول' }); }
});

app.get('/api/products', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE active=TRUE ORDER BY id DESC');
  res.json(rows);
});
app.get('/api/products/all', auth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM products ORDER BY id DESC');
  res.json(rows);
});
app.post('/api/products', auth, async (req, res) => {
  const { name, category, price, old_price, emoji, image, badge, stock, description } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'الاسم والقسم مطلوبان' });
  const { rows } = await pool.query(`INSERT INTO products(name,category,price,old_price,emoji,image,badge,stock,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [name, category, Number(price)||0, old_price === '' ? null : Number(old_price), emoji||'🛍️', image||'', badge||'', Number(stock)||0, description||'']);
  res.json(rows[0]);
});
app.put('/api/products/:id', auth, async (req, res) => {
  const id = Number(req.params.id), p = req.body;
  const { rows } = await pool.query(`UPDATE products SET name=$1,category=$2,price=$3,old_price=$4,emoji=$5,image=$6,badge=$7,stock=$8,description=$9,active=$10,updated_at=NOW() WHERE id=$11 RETURNING *`, [p.name,p.category,Number(p.price)||0,p.old_price===''?null:Number(p.old_price),p.emoji||'🛍️',p.image||'',p.badge||'',Number(p.stock)||0,p.description||'',p.active===0?false:true,id]);
  res.json(rows[0]);
});
app.delete('/api/products/:id', auth, async (req, res) => { await pool.query('DELETE FROM products WHERE id=$1', [Number(req.params.id)]); res.json({ok:true}); });
app.post('/api/upload', auth, upload.single('image'), (req,res) => { if(!req.file) return res.status(400).json({error:'لم يتم اختيار صورة'}); res.json({url:'/uploads/'+req.file.filename}); });

app.post('/api/orders', async (req,res) => {
  const { customer_name, phone, address, notes, items } = req.body || {};
  if (!customer_name || !phone || !Array.isArray(items) || !items.length) return res.status(400).json({error:'بيانات الطلب غير مكتملة'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let total = 0, lines = [];
    for (const item of items) {
      const q = Math.max(1, Math.min(99, Number(item.quantity)||1));
      const r = await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE', [Number(item.product_id)]);
      const p = r.rows[0];
      if (!p) throw new Error('أحد المنتجات غير متاح');
      if (p.stock < q) throw new Error(`الكمية المتاحة من ${p.name} هي ${p.stock}`);
      total += Number(p.price) * q;
      lines.push({p,q});
    }
    const order = await client.query('INSERT INTO orders(customer_name,phone,address,notes,total) VALUES($1,$2,$3,$4,$5) RETURNING id,total', [customer_name,phone,address||'',notes||'',total]);
    for (const {p,q} of lines) {
      await client.query('INSERT INTO order_items(order_id,product_id,product_name,price,quantity) VALUES($1,$2,$3,$4,$5)', [order.rows[0].id,p.id,p.name,p.price,q]);
      await client.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2', [q,p.id]);
    }
    await client.query('COMMIT');
    res.status(201).json({id: order.rows[0].id, total: Number(order.rows[0].total)});
  } catch(e) { await client.query('ROLLBACK'); res.status(400).json({error:e.message || 'تعذر إنشاء الطلب'}); }
  finally { client.release(); }
});

app.get('/api/orders', auth, async (_req,res) => {
  const orders = await pool.query('SELECT * FROM orders ORDER BY id DESC');
  const items = await pool.query('SELECT * FROM order_items ORDER BY id');
  const byOrder = new Map();
  for (const item of items.rows) { if(!byOrder.has(item.order_id)) byOrder.set(item.order_id,[]); byOrder.get(item.order_id).push(item); }
  res.json(orders.rows.map(o => ({...o, items: byOrder.get(o.id)||[]})));
});
app.put('/api/orders/:id/status', auth, async (req,res) => {
  const allowed=['new','processing','shipped','completed','cancelled'];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:'حالة غير صحيحة'});
  await pool.query('UPDATE orders SET status=$1 WHERE id=$2',[req.body.status,Number(req.params.id)]); res.json({ok:true});
});
app.delete('/api/orders/:id', auth, async (req,res) => { await pool.query('DELETE FROM orders WHERE id=$1',[Number(req.params.id)]); res.json({ok:true}); });
app.get('/api/stats', auth, async (_req,res) => {
  const [products,orders,pending,revenue,lowStock] = await Promise.all([
    pool.query('SELECT COUNT(*)::int c FROM products WHERE active=TRUE'),
    pool.query('SELECT COUNT(*)::int c FROM orders'),
    pool.query("SELECT COUNT(*)::int c FROM orders WHERE status IN ('new','processing')"),
    pool.query("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='cancelled'"),
    pool.query('SELECT COUNT(*)::int c FROM products WHERE active=TRUE AND stock<=5')
  ]);
  res.json({products:products.rows[0].c,orders:orders.rows[0].c,pending:pending.rows[0].c,revenue:Number(revenue.rows[0].n),lowStock:lowStock.rows[0].c});
});

app.use(express.static(path.join(ROOT,'public')));
app.get('/admin',(req,res)=>res.sendFile(path.join(ROOT,'public','admin.html')));
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));

async function start() {
  await init();
  app.listen(PORT, '0.0.0.0', () => console.log(`Makka Store running on port ${PORT}`));
}
start().catch(err => { console.error(err); process.exit(1); });

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
