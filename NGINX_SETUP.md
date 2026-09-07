# دليل إعداد Nginx وتكوين سيرفر الـ VPS (Hostinger VPS)

هذا الدليل يشرح كيفية إعداد خادم **Nginx** كـ **Reverse Proxy** لتشغيل نظام العيادات الخاص بك بأعلى كفاءة وأقل استهلاك لموارد السيرفر (CPU & RAM).

---

## 💡 لماذا نستخدم Nginx؟
1. **السرعة الخارقة**: خادم Nginx يستطيع تقديم ملفات الـ React الثابتة (`HTML`, `JS`, `CSS`) بسرعة تزيد بـ **10 أضعاف** مقارنة بتمريرها عبر سيرفر Node.js.
2. **توفير ذاكرة السيرفر (RAM)**: يعالج Nginx الطلبات الثابتة مباشرة، مما يترك تطبيق Node.js متفرغاً بالكامل لمعالجة العمليات البرمجية وطلبات قاعدة البيانات.
3. **الاستقرار**: يعمل Nginx كـ Shield (درع حماية) أمام تطبيق Node.js، مما يسهل معالجة اتصالات الـ WebSockets المستقرة دون انقطاع.

---

## 🛠️ خطوات الإعداد على سيرفر الـ VPS الخاص بك

### 1. تثبيت Nginx ومستلزمات التشغيل
قم بتسجيل الدخول إلى سيرفر الـ VPS الخاص بك عبر الـ SSH ثم نفذ الأوامر التالية:

```bash
# تحديث السيرفر
sudo apt update && sudo apt upgrade -y

# تثبيت Nginx
sudo apt install nginx -y

# تشغيل Nginx وتفعيله عند الإقلاع
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 2. تجهيز كود المشروع على السيرفر
تأكد من بناء المشروع (Build) للحصول على ملفات الـ React الثابتة داخل مجلد `dist`:

```bash
# تثبيت الحزم وبناء المشروع
npm install
npm run build
```

قم بنسخ مسار مجلد الـ `dist` الكامل على السيرفر (مثلاً: `/var/www/clinic-system/dist`).

---

### 3. إعداد ملف تكوين Nginx (Nginx Configuration)
قم بإنشاء ملف تكوين جديد لموقعك داخل Nginx:

```bash
sudo nano /etc/nginx/sites-available/clinic-system
```

قم بنسخ التكوين التالي ولصقه داخل الملف (مع تعديل اسم الدومين والمسارات حسب سيرفرك):

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN.com www.YOUR_DOMAIN.com; # ضع الدومين الخاص بك هنا

    # 1. خدمة ملفات الـ React الثابتة مباشرة عبر Nginx (فائقة السرعة وموفرة للرام)
    root /var/www/clinic-system/dist; # ضع المسار الكامل لمجلد الـ dist هنا
    index index.html;

    # معالجة الروابط الداخلية للـ React SPA (Single Page Application)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 2. تمرير طلبات الـ API إلى تطبيق Node.js (Running on Port 3000)
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 3. إعداد مخصص واتصال مستقر للـ WebSockets (Sync Engine) لمنع الانقطاع
    location /api/sync/ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # تفعيل ترقية الاتصال لـ Websocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # منع إغلاق الاتصال تلقائياً من قبل السيرفر (زيادة فترات المهلة للاتصالات الخاملة)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # تخصيص حجم الملفات المسموح برفعها (مثال: 50 ميجابايت للأشعة والملفات الكبيرة)
    client_max_body_size 50M;
}
```

احفظ واغلق الملف (`Ctrl+O` ثم `Enter` ثم `Ctrl+X`).

---

### 4. تفعيل التكوين الجديد واختبار Nginx
قم بتفعيل الرابط واختبار التكوين لضمان عدم وجود أخطاء في الـ Syntax:

```bash
# تفعيل الموقع الجديد
sudo ln -s /etc/nginx/sites-available/clinic-system /etc/nginx/sites-enabled/

# تعطيل الموقع الافتراضي لـ Nginx (إذا لم تكن تستخدمه)
sudo rm /etc/nginx/sites-enabled/default

# اختبار ملفات التكوين
sudo nginx -t
```

إذا ظهرت لك رسالة تفيد بنجاح الاختبار (`syntax is ok` & `test is successful`)، قم بإعادة تشغيل Nginx لتطبيق التغييرات:

```bash
sudo systemctl restart nginx
```

---

### 5. تشغيل تطبيق الـ Node.js في الخلفية باستخدام PM2
لضمان استمرار عمل السيرفر الخلفي (Backend) في الخلفية للأبد وحتى بعد إغلاق الـ Terminal أو إعادة تشغيل السيرفر، يفضل استخدام **PM2**:

```bash
# تثبيت PM2 عالمياً
sudo npm install pm2 -g

# تشغيل السيرفر الخلفي الخاص بك
pm2 start dist/server.cjs --name "clinic-backend"

# تفعيل الإقلاع التلقائي مع السيرفر لـ PM2
pm2 startup
pm2 save
```

---

### 6. تأمين الموقع وتركيب شهادة SSL مجانية (HTTPS)
لتأمين الاتصالات وتفعيل بروتوكول الـ HTTPS والـ `wss://` بأمان تام، استخدم أداة **Certbot**:

```bash
sudo apt install certbot python3-certbot-nginx -y

# استخراج شهادة الـ SSL وتركيبها تلقائياً على Nginx
sudo certbot --nginx -d YOUR_DOMAIN.com -d www.YOUR_DOMAIN.com
```

اتبع التعليمات التي تظهر على الشاشة. سيقوم Certbot تلقائياً بتحديث ملف إعداد Nginx الخاص بك ليدعم الـ HTTPS بأعلى معايير الأمان وتحويل جميع طلبات الـ HTTP العادية إلى HTTPS بأمان تام!

🚀 **مبروك! السيرفر الخاص بك مهيأ الآن بأعلى كفاءة تشغيلية واحترافية كاملة لتشغيل نظام العيادات واستقبال آلاف المرضى دون استهلاك زائد للموارد!**
