import {authHeaders} from '../dbClient';

// Private local files need the same bearer header as API reads. Never append a
// session token to an image URL or forward it to an external storage hostname.
export async function resolveMediaPreview(source: string): Promise<string> {
  if (!source || /^(data:|blob:)/.test(source)) return source;
  const url = new URL(source, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname !== '/api/files') return source;
  url.searchParams.delete('token');
  const response = await fetch(url.href, {headers: authHeaders(), cache:'no-store'});
  if (!response.ok) throw new Error('Unable to load the private image');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('The file is not an image');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read the image'));
    reader.readAsDataURL(blob);
  });
}
