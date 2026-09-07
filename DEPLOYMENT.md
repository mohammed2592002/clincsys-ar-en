# تعليمات النشر على سيرفر Ubuntu مع Docker

## المتطلبات
- سيرفر Ubuntu مع Docker و Docker Compose
- قاعدة بيانات PostgreSQL
- متغيرات البيئة في ملف `.env`

## خطوات النشر

### 1. إعداد ملف البيئة
```bash
# إنشاء ملف .env
cat > .env << 'EOF'
DATABASE_URL=postgresql://user:password@localhost:5432/crowndent
PORT=3000
NODE_ENV=production
EOF
```

### 2. بناء وتشغيل الحاوية
```bash
# بناء الصورة
docker-compose build

# تشغيل الحاوية
docker-compose up -d

# عرض السجلات
docker-compose logs -f
```

### 3. مراقبة الأداء
```bash
# مراقبة استهلاك الموارد
docker stats

# مراقبة السجلات
docker-compose logs -f app

# إعادة تشغيل الحاوية
docker-compose restart
```

### 4. التحديثات
```bash
# سحب التحديثات
git pull

# إعادة البناء والتشغيل
docker-compose down
docker-compose build
docker-compose up -d
```

## إعداد Nginx (اختياري)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## استكشاف الأخطاء

```bash
# عرض سجلات الحاوية
docker-compose logs app

# الدخول للحاوية
docker-compose exec app sh

# إعادة بناء من الصفر
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```
