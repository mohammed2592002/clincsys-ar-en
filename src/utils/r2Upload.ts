import { compressImage } from './imageCompressor';
import { authHeaders } from '../dbClient';

/**
 * Uploads a file directly to Cloudflare R2 using the standardized key structure:
 * `clinics/{clinicId}/{category}/{fileName}`
 * 
 * Automatically compresses images before uploading to save bandwidth and Cloudflare storage.
 * Bypasses local server storage completely and returns the public CDN URL.
 * 
 * @param file File or Blob to upload
 * @param category Category of file (e.g. 'xrays', 'prescriptions', 'logos', 'inventory', 'attachments')
 * @param clinicIdOrFileName Database unique ID of the clinic or fallback file name
 * @param originalFileName Optional fallback file name
 * @returns Promise<string> The public R2 URL of the uploaded file
 */
export async function uploadFileToR2(
  file: File | Blob,
  category: string = 'attachments',
  clinicIdOrFileName?: string,
  originalFileName?: string
): Promise<string> {
  let targetCategory = category || 'attachments';
  let targetClinicId = '';
  let targetFileName = '';

  if (clinicIdOrFileName && originalFileName) {
    targetClinicId = clinicIdOrFileName;
    targetFileName = originalFileName;
  } else if (clinicIdOrFileName && !originalFileName) {
    const hasExtension = /\.[a-zA-Z0-9]{2,4}$/.test(clinicIdOrFileName);
    const looksLikeFile = hasExtension || (clinicIdOrFileName.includes('_') && !clinicIdOrFileName.startsWith('clinic_'));
    if (looksLikeFile) {
      targetFileName = clinicIdOrFileName;
    } else {
      targetClinicId = clinicIdOrFileName;
    }
  }

  const fileName = (file as File).name || targetFileName || `file_${Date.now()}.jpg`;

  let fileToUpload: File | Blob = file;

  // Automatically compress image files before sending to Cloudflare R2
  if (file.type && file.type.startsWith('image/')) {
    try {
      const fileObj = file instanceof File ? file : new File([file], fileName, { type: file.type || 'image/jpeg' });
      const { file: compressedFile } = await compressImage(fileObj, 1600, 1600, 0.80, 'image/webp');
      if (compressedFile) {
        fileToUpload = compressedFile;
      }
    } catch (compressErr) {
      console.warn('Auto compression before R2 upload skipped or failed:', compressErr);
    }
  }

  // The compressed file carries the extension that matches its real content
  // (e.g. .webp after compression), so prefer its name over the original's.
  const uploadName = (fileToUpload as File).name || fileName;

  // Preferred path: direct browser -> Cloudflare R2 upload through a presigned URL.
  // The server only authorizes and records the upload; the file bytes never pass
  // through it, so server memory stays flat no matter how many uploads run at once.
  // Any failure here (presign down, R2 CORS not configured yet, confirm error)
  // falls back to the classic server-side /api/upload below.
  try {
    const presignRes = await fetch('/api/get-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        fileName: uploadName,
        category: targetCategory,
        ...(targetClinicId ? { clinicId: targetClinicId } : {}),
      }),
    });
    if (presignRes.ok) {
      const presign = await presignRes.json();
      if (presign.uploadUrl && presign.key) {
        const putRes = await fetch(presign.uploadUrl, {
          method: 'PUT',
          // The Content-Type is part of the signature and must match exactly.
          headers: { 'Content-Type': presign.contentType || fileToUpload.type || 'application/octet-stream' },
          body: fileToUpload,
        });
        if (putRes.ok) {
          const confirmRes = await fetch('/api/confirm-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              key: presign.key,
              ...(targetClinicId ? { clinicId: targetClinicId } : {}),
            }),
          });
          if (confirmRes.ok) {
            const confirmData = await confirmRes.json();
            if (confirmData.publicUrl) {
              return confirmData.publicUrl;
            }
          }
        }
      }
    }
  } catch (directErr) {
    console.warn('Direct R2 upload unavailable, falling back to server upload:', directErr);
  }

  const formData = new FormData();
  formData.append('file', fileToUpload, uploadName);
  formData.append('category', targetCategory);
  if (targetClinicId) {
    formData.append('clinicId', targetClinicId);
  }

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { ...authHeaders() },
    body: formData,
  });

  if (!res.ok) {
    const errMsg = await res.text();
    throw new Error(`فشل رفع الملف إلى Cloudflare R2: ${errMsg}`);
  }

  const data = await res.json();
  const publicUrl = data.publicUrl || data.path;

  if (!publicUrl) {
    throw new Error('لم يتم إرجاع رابط Cloudflare R2 الصحيح للملف');
  }

  return publicUrl;
}

/**
 * Converts a base64 Data URL, Blob, or raw byte string into a Blob object for direct cloud storage upload
 */
export function dataUrlToBlob(dataUrl: string | Blob | File): Blob {
  if (!dataUrl) {
    return new Blob([], { type: 'image/webp' });
  }
  if (dataUrl instanceof Blob) {
    return dataUrl;
  }
  if (typeof dataUrl !== 'string') {
    return new Blob([], { type: 'image/webp' });
  }

  // Handle standard base64 Data URL
  if (dataUrl.includes(',')) {
    try {
      const arr = dataUrl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (err) {
      console.warn('Error parsing base64 string in dataUrlToBlob:', err);
    }
  }

  return new Blob([dataUrl], { type: 'image/webp' });
}

/**
 * Retains files on Cloudflare R2 bucket even when removed from DB UI,
 * ensuring DB backup restores never encounter broken image 404 links.
 */
export async function deleteFileFromR2(fileUrlOrKey: string): Promise<boolean> {
  if (!fileUrlOrKey || typeof fileUrlOrKey !== 'string') return true;
  const trimmed = fileUrlOrKey.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return true; // No R2 object to process
  }
  try {
    const res = await fetch('/api/delete-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ url: trimmed, key: trimmed }),
    });
    return res.ok;
  } catch (err) {
    console.warn('R2 file retention notice:', err);
    return true;
  }
}
