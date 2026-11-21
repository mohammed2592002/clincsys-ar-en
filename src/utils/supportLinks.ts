import type {SocialContact} from '../types';

// Empty or relative hrefs navigate back into the clinic instead of to support.
export function normalizeSupportUrl(contact: Pick<SocialContact, 'platform' | 'url'>): string {
  const raw = String(contact.url || '').trim();
  if (!raw) return '';
  if (contact.platform === 'email') {
    const address = raw.replace(/^mailto:/i, '');
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? 'mailto:' + address : '';
  }
  let candidate = raw;
  if (contact.platform === 'telegram') {
    if (/^@[A-Za-z0-9_]{5,32}$/.test(raw)) candidate = 'https://t.me/' + raw.slice(1);
    else if (/^(t\.me|telegram\.me)\/[A-Za-z0-9_]+$/.test(raw)) candidate = 'https://' + raw;
  }
  try {
    const url = new URL(candidate);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}
export function configuredSocialLinks(links: SocialContact[] = []): SocialContact[] {
  return links.map(link => ({...link, url: normalizeSupportUrl(link)})).filter(link => link.url);
}
