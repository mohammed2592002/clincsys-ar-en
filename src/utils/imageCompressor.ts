export interface CompressedResult {
  file: File;             // الملف المضغوط جاهز للرفع المباشر إلى Cloudflare R2
  blob: Blob;             // البيانات الثنائية للملف
  previewUrl: string;     // رابط معاينة سريع للعرض في الواجهة (Object URL)
  compressedDataUrl: string; // للتوافق التام مع الأكواد السابقة
  originalSize: number;   // الحجم الأصلي بالبايت
  compressedSize: number; // الحجم الجديد بالبايت
}

/**
 * Compresses and resizes an image File using HTML5 Canvas
 * @param file The input image File
 * @param maxWidth Max width in pixels (default 1600px for medical clarity)
 * @param maxHeight Max height in pixels (default 1600px)
 * @param quality Compression quality 0.0 to 1.0 (default 0.80)
 * @param outputType Output mime type ('image/webp' or 'image/jpeg')
 */
export function compressImage(
  file: File,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.80,
  outputType: 'image/webp' | 'image/jpeg' = 'image/webp'
): Promise<CompressedResult> {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) {
      reject(new Error('الملف المرفق ليس صورة صالحة'));
      return;
    }

    // استخدام ObjectURL بدلاً من FileReader لقراءة أسرع واستهلاك RAM أقل
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('فشل معالجة صيغة الصورة'));
    };

    img.onload = () => {
      // تحرير الذاكرة فور تحميل الصورة
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // حساب الأبعاد الجديدة مع الحفاظ على النسبة والتناسب
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      // 1. ملء الخلفية باللون الأبيض لمنع تحول أجزاء الـ PNG الشفافة إلى لون أسود
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      // تنعيم جودة الصورة أثناء إعادة التكبير/التصغير
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // رسم الصورة
      ctx.drawImage(img, 0, 0, width, height);

      // توليد Base64 Data URL دائم وثابت للتخزين المحلي أوفلاين
      let base64DataUrl = '';
      try {
        base64DataUrl = canvas.toDataURL(outputType, quality);
      } catch (e) {
        console.warn('Could not generate dataURL from canvas:', e);
      }

      // 2. استخدام toBlob بدلاً من toDataURL لتوفير أداء عالي ونقل مباشر لـ R2
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('فشل عملية ضغط الصورة'));
            return;
          }

          // إذا كان الحجم المضغوط أكبر ولم تختلف الأبعاد، يُحتفظ بالملف الأصلي
          if (blob.size >= file.size && width === img.width && height === img.height) {
            const preview = base64DataUrl || URL.createObjectURL(file);
            resolve({
              file: file,
              blob: file,
              previewUrl: preview,
              compressedDataUrl: base64DataUrl || preview,
              originalSize: file.size,
              compressedSize: file.size,
            });
            return;
          }

          // تسمية الملف بالامتداد الجديد (.webp أو .jpg)
          const extension = outputType === 'image/webp' ? '.webp' : '.jpg';
          const newFileName = file.name ? file.name.replace(/\.[^/.]+$/, '') + extension : `image_${Date.now()}${extension}`;
          const compressedFile = new File([blob], newFileName, { type: outputType });
          const preview = base64DataUrl || URL.createObjectURL(blob);

          resolve({
            file: compressedFile,
            blob: blob,
            previewUrl: preview,
            compressedDataUrl: base64DataUrl || preview,
            originalSize: file.size,
            compressedSize: blob.size,
          });
        },
        outputType,
        quality
      );
    };

    img.src = objectUrl;
  });
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 بايت';
  const k = 1024;
  const sizes = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
