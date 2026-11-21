// Global documents keep their full JSON shape, including nested website content.
// This is a SQL export, not a new SQL restore path in the application.
export function systemSettingsSql(settings: ReadonlyArray<{id: string; [key: string]: unknown}>): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  let sql = '\n-- Global system settings (JSON documents)\n';
  sql += 'CREATE TABLE IF NOT EXISTS system_settings (id VARCHAR(255) PRIMARY KEY, data TEXT);\n';
  for (const setting of settings) {
    // Also filter here, even though the server excludes this document already.
    if (setting.id === 'auth_secret') continue;
    sql += `INSERT INTO system_settings (id, data) VALUES (${quote(setting.id)}, ${quote(JSON.stringify(setting))});\n`;
  }
  return sql;
}
