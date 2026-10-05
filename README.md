# متجر مكة — نسخة جاهزة للنشر على Railway

هذه النسخة تستخدم **PostgreSQL** بدل SQLite حتى تكون مناسبة للاستضافة السحابية، مع لوحة الإدارة والمنتجات والطلبات والمخزون.

## 1) المتطلبات
- حساب Railway.
- حساب GitHub (موصى به) أو Railway CLI.
- Node.js 18+ للتجربة المحلية.

## 2) أهم المتغيرات في Railway
أضف إلى خدمة التطبيق:
- `DATABASE_URL` ← اربطها بمتغير DATABASE_URL من خدمة PostgreSQL.
- `JWT_SECRET` ← قيمة عشوائية طويلة.
- `ADMIN_USER` ← اسم مستخدم الإدارة.
- `ADMIN_PASSWORD` ← كلمة مرور قوية.
- `NODE_ENV=production`
- `UPLOAD_DIR=./uploads`

## 3) نشر المشروع عبر GitHub
1. ارفع هذا المجلد إلى مستودع GitHub خاص.
2. في Railway اختر New Project ثم Deploy from GitHub Repo.
3. اختر المستودع.
4. من المشروع اختر + New → Database → PostgreSQL.
5. افتح خدمة التطبيق → Variables وأضف المتغيرات أعلاه.
6. اجعل `DATABASE_URL` مرجعاً إلى `DATABASE_URL` في خدمة PostgreSQL.
7. انتظر اكتمال النشر.
8. من Networking اختر Generate Domain.
9. افتح الرابط الناتج، ثم `/admin` للوحة الإدارة.

Railway يوفّر متغيرات PostgreSQL ومنها DATABASE_URL تلقائياً عند إنشاء قاعدة PostgreSQL.

## 4) الصور المرفوعة من لوحة الإدارة
الصور الموجودة داخل `uploads/` ليست قاعدة بيانات. في Railway، إذا أردت أن تبقى الصور بعد إعادة تشغيل/إعادة نشر الخدمة، أضف Volume للخدمة واجعل مسار التركيب متوافقاً مع `UPLOAD_DIR`.

للبداية يمكنك أيضاً استخدام روابط صور خارجية من لوحة الإدارة.

## 5) تجربة محلية
أنشئ PostgreSQL محلياً، ثم:

```bash
npm install
```

أنشئ `.env` أو اضبط متغيرات البيئة:

```text
NODE_ENV=development
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
JWT_SECRET=local-development-secret
ADMIN_USER=admin
ADMIN_PASSWORD=Makka@12345
UPLOAD_DIR=./uploads
```

ثم:

```bash
npm start
```

المتجر: `http://localhost:3000`
لوحة الإدارة: `http://localhost:3000/admin`
فحص الصحة: `http://localhost:3000/health`

## 6) ملاحظات أمنية
- لا تضع `.env` داخل GitHub.
- استخدم كلمة مرور إدارة قوية.
- غيّر JWT_SECRET قبل الإنتاج.
- احتفظ بنسخة احتياطية من قاعدة PostgreSQL.
