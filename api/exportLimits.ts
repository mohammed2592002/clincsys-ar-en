// Export-only working-set guards. RSS is a soft stop, not a container limit.
export const EXPORT_RSS_LIMIT = 1024 * 1024 * 1024;
export const LEGACY_FINANCE_MAX_BYTES = 64 * 1024 * 1024;
export const EXPORT_WRITE_BYTES = 512 * 1024;
export function checkExportMemory() {
  if (process.memoryUsage().rss >= EXPORT_RSS_LIMIT)
    throw Object.assign(new Error('Export memory safety limit reached'), { code: 'EXPORT_MEMORY_LIMIT' });
}
