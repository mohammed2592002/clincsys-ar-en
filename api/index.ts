import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import pg from 'pg';
import compression from 'compression';
import helmet from 'helmet';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const { Pool } = pg;

function getR2ClientConfig() {
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const endpoint = (process.env.R2_ENDPOINT || 'https://164371ba2c7b56b4c1968d64358d3791.r2.cloudflarestorage.com').trim();
  const bucketName = (process.env.R2_BUCKET_NAME || 'coredentsys').trim();
  const publicUrlBase = (process.env.R2_PUBLIC_URL || 'https://pub-050a3f4c17b446f1b37e21711b109c9e.r2.dev').replace(/\/+$/, '');

  const hasConfiguredR2 = accessKeyId.length >= 10 && secretAccessKey.length >= 10;

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: hasConfiguredR2 ? accessKeyId : '00000000000000000000000000000000',
      secretAccessKey: hasConfiguredR2 ? secretAccessKey : '0000000000000000000000000000000000000000000000000000000000000000',
    },
  });

  return { client, hasConfiguredR2, bucketName, publicUrlBase };
}


const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Apply security and performance middlewares
app.use(helmet({
  contentSecurityPolicy: false, // Allow external assets and scripts to load in sandboxed frames
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard: false // Allow embedding in AI Studio preview iframe
}));
app.use(compression());

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}));

// Auto-initialize Database on Vercel/Hostinger/Production Serverless environment
let isDbInitialized = false;
let initDbPromise: Promise<void> | null = null;

async function getDbReady() {
  if (isDbInitialized) return;
  if (!initDbPromise) {
    initDbPromise = initDb().then(() => {
      isDbInitialized = true;
    }).catch(err => {
      console.error('[Database] Database initialization failed:', err);
      initDbPromise = null;
      throw err;
    });
  }
  return initDbPromise;
}

app.use(async (req, res, next) => {
  if (!isDbInitialized) {
    try {
      await getDbReady();
    } catch (err) {
      console.error('[Database] Database initialization middleware failed:', err);
    }
  }
  next();
});

app.get('/api/db-status', (req, res) => {
  const isPostgres = dbClient.getIsPostgres();
  const hasEnv = !!(
    cleanEnvValue(process.env.DATABASE_URL) || 
    cleanEnvValue(process.env.POSTGRES_URL) || 
    cleanEnvValue(process.env.PG_DATABASE_URL) || 
    cleanEnvValue(process.env.PGHOST) || 
    cleanEnvValue(process.env.DB_HOST)
  );

  res.json({
    isPostgres,
    isPostgresConnected: isPostgres,
    hasEnv,
    detectedUrl: dbClient.getDetectedUrl(),
    lastError: dbClient.getLastError() || null,
    environment: {
      has_DATABASE_URL: !!cleanEnvValue(process.env.DATABASE_URL),
      has_POSTGRES_URL: !!cleanEnvValue(process.env.POSTGRES_URL),
      has_PG_DATABASE_URL: !!cleanEnvValue(process.env.PG_DATABASE_URL),
      has_PGHOST: !!cleanEnvValue(process.env.PGHOST),
      has_DB_HOST: !!cleanEnvValue(process.env.DB_HOST),
      NODE_ENV: process.env.NODE_ENV || 'development'
    }
  });
});

// Clean surrounding quotes or whitespace from environment values
function cleanEnvValue(val: any): string {
  if (typeof val !== 'string') return '';
  let str = val.trim();
  if (str.startsWith('DATABASE_URL=')) {
    str = str.substring('DATABASE_URL='.length).trim();
  }
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

class LocalJsonDbEmulator {
  private filePath = path.join(process.cwd(), 'local_db.json');
  private data: Record<string, any[]> = {};

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        
        // Auto-migration: ensure top-level patientId and clinicId exist for relational queries
        let migrated = false;
        const tablesToSync = ['records', 'appointments', 'prescriptions'];
        tablesToSync.forEach(table => {
          if (Array.isArray(this.data[table])) {
            this.data[table].forEach(row => {
              if (row.data) {
                try {
                  const parsed = JSON.parse(row.data);
                  if (parsed.patientId && !row.patientId) {
                    row.patientId = parsed.patientId;
                    migrated = true;
                  }
                  if (parsed.patient_id && !row.patient_id) {
                    row.patient_id = parsed.patient_id;
                    migrated = true;
                  }
                  if (parsed.clinicId && !row.clinicId) {
                    row.clinicId = parsed.clinicId;
                    migrated = true;
                  }
                  if (parsed.clinic_id && !row.clinic_id) {
                    row.clinic_id = parsed.clinic_id;
                    migrated = true;
                  }
                } catch (e) {}
              }
            });
          }
        });
        if (migrated) {
          this.save();
        }
      } else {
        this.data = {};
      }
    } catch (e) {
      this.data = {};
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[Mock DB] Failed to save database to disk:', e);
    }
  }

  async execute(sql: string, args: any[] = []): Promise<{ rows: any[] }> {
    // Normalize Postgres parameter placeholders $1, $2, ... to standard ? for local emulator
    const normalizedSql = sql.replace(/\$[0-9]+/g, '?');
    const cleanSql = normalizedSql.trim().replace(/\s+/g, ' ');
    const lowerSql = cleanSql.toLowerCase();

    // 1. SELECT for schemas
    if (lowerSql.includes('information_schema.tables') || lowerSql.includes('sqlite_master')) {
      const tables = Object.keys(this.data).map((name) => ({ name }));
      return { rows: tables };
    }

    if (lowerSql.includes('information_schema.columns') || lowerSql.includes('pragma table_info')) {
      return { rows: [
        { name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
        { name: 'clinicId', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'clinic_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'patientId', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'patient_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'table_name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'action', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'record_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'created_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'createdAt', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'payload', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'data', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'content', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'isActive', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'mimeType', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
        { name: 'path', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 }
      ] };
    }

    // 2. CREATE TABLE
    if (lowerSql.startsWith('create table')) {
      const match = cleanSql.match(/create table\s+(?:if not exists\s+)?([a-zA-Z0-9_]+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        if (!this.data[tableName]) {
          this.data[tableName] = [];
          this.save();
        }
      }
      return { rows: [] };
    }

    // 3. ALTER TABLE
    if (lowerSql.startsWith('alter table')) {
      return { rows: [] };
    }

    // 4. INSERT INTO / INSERT OR REPLACE INTO
    if (lowerSql.startsWith('insert')) {
      const match = cleanSql.match(/(?:insert\s+into|insert\s+or\s+replace\s+into|insert\s+or\s+ignore\s+into)\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const cols = match[2].split(',').map(s => s.trim().replace(/["'` ]/g, ''));
        
        if (!this.data[tableName]) {
          this.data[tableName] = [];
        }

        const row: Record<string, any> = {};
        cols.forEach((col, idx) => {
          row[col] = args[idx];
        });

        // Ensure primary key exists
        const pkCol = cols.find(c => c.toLowerCase() === 'id' || c.toLowerCase() === 'path') || 'id';
        const pkVal = row[pkCol];

        this.data[tableName] = this.data[tableName].filter(r => r[pkCol] !== pkVal);
        this.data[tableName].push(row);
        this.save();
      }
      return { rows: [] };
    }

    // 5. UPDATE
    if (lowerSql.startsWith('update')) {
      const match = cleanSql.match(/update\s+([a-zA-Z0-9_]+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const table = this.data[tableName] || [];
        
        // Find ID / PK from args
        const pkCol = lowerSql.includes('where path') ? 'path' : 'id';
        const pkVal = args[args.length - 1];
        const row = table.find(r => r[pkCol] === pkVal);
        if (row) {
          const setPart = cleanSql.split(/set/i)[1].split(/where/i)[0];
          const assignments = setPart.split(',').map(s => s.trim().split('=')[0].trim().replace(/["'` ]/g, ''));
          assignments.forEach((col, idx) => {
            row[col] = args[idx];
          });
          this.save();
        }
      }
      return { rows: [] };
    }

    // 6. DELETE FROM
    if (lowerSql.startsWith('delete from')) {
      const match = cleanSql.match(/delete from\s+([a-zA-Z0-9_]+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        if (this.data[tableName]) {
          if (cleanSql.toLowerCase().includes('created_at <')) {
            const olderThan = args[0];
            this.data[tableName] = this.data[tableName].filter(r => (r.created_at || r.createdAt) >= olderThan);
          } else {
            const pkCol = lowerSql.includes('where path') ? 'path' : 'id';
            const pkVal = args[0];
            this.data[tableName] = this.data[tableName].filter(r => r[pkCol] !== pkVal);
          }
          this.save();
        }
      }
      return { rows: [] };
    }

    // 7. SELECT
    if (lowerSql.startsWith('select')) {
      const match = cleanSql.match(/from\s+([a-zA-Z0-9_]+)/i);
      if (!match) {
        return { rows: [{ '1': 1 }] };
      }

      const tableName = match[1].toLowerCase();
      let table = [...(this.data[tableName] || [])];

      // Filters
      const whereMatch = cleanSql.match(/where\s+(.+?)(?:\s+(?:order\s+by|limit|group\s+by)|$)/i);
      if (whereMatch) {
        const whereClause = whereMatch[1].trim();
        const splitRegex = whereClause.toLowerCase().includes(' or ') ? /\s+or\s+/i : /\s+and\s+/i;
        const conditions = whereClause.split(splitRegex);
        
        let argIdx = 0;
        const filters: ((r: any) => boolean)[] = [];

        for (const condition of conditions) {
          const cond = condition.trim();
          if (cond === '1=1' || !cond) {
            continue;
          }

          // Check for json_extract
          const jsonMatch = cond.match(/json_extract\(data,\s*'\$\.([^']+)'\)\s*(=|!=|<|>|<=|>=|like)\s*\?/i);
          if (jsonMatch) {
            const fieldName = jsonMatch[1];
            const op = jsonMatch[2].toLowerCase();
            const val = args[argIdx++];

            filters.push((r) => {
              try {
                const parsed = safeParseJson(r.data);
                const fieldVal = parsed[fieldName];
                if (fieldVal === undefined || fieldVal === null) return false;

                if (op === '=') return String(fieldVal) === String(val);
                if (op === '!=') return String(fieldVal) !== String(val);
                if (op === 'like') {
                  const searchStr = String(val).replace(/%/g, '');
                  return String(fieldVal).toLowerCase().includes(searchStr.toLowerCase());
                }

                const numVal = Number(val);
                const numFieldVal = Number(fieldVal);
                const isNum = !isNaN(numVal) && !isNaN(numFieldVal);

                if (op === '<') return isNum ? numFieldVal < numVal : String(fieldVal) < String(val);
                if (op === '>') return isNum ? numFieldVal > numVal : String(fieldVal) > String(val);
                if (op === '<=') return isNum ? numFieldVal <= numVal : String(fieldVal) <= String(val);
                if (op === '>=') return isNum ? numFieldVal >= numVal : String(fieldVal) >= String(val);
              } catch (e) {}
              return false;
            });
            continue;
          }

          // Check for standard column operators with ?
          const colParamMatch = cond.match(/^([a-zA-Z0-9_]+)\s*(=|!=|<|>|<=|>=|like)\s*\?$/i);
          if (colParamMatch) {
            const colName = colParamMatch[1];
            const op = colParamMatch[2].toLowerCase();
            const val = args[argIdx++];

            filters.push((r) => {
              const keys = Object.keys(r);
              const matchedKey = keys.find(k => k.toLowerCase() === colName.toLowerCase());
              if (!matchedKey) return false;

              const fieldVal = r[matchedKey];
              if (fieldVal === undefined || fieldVal === null) return false;

              if (op === '=') return String(fieldVal) === String(val);
              if (op === '!=') return String(fieldVal) !== String(val);
              if (op === 'like') {
                const searchStr = String(val).replace(/%/g, '');
                return String(fieldVal).toLowerCase().includes(searchStr.toLowerCase());
              }

              const numVal = Number(val);
              const numFieldVal = Number(fieldVal);
              const isNum = !isNaN(numVal) && !isNaN(numFieldVal);

              if (op === '<') return isNum ? numFieldVal < numVal : String(fieldVal) < String(val);
              if (op === '>') return isNum ? numFieldVal > numVal : String(fieldVal) > String(val);
              if (op === '<=') return isNum ? numFieldVal <= numVal : String(fieldVal) <= String(val);
              if (op === '>=') return isNum ? numFieldVal >= numVal : String(fieldVal) >= String(val);
              return false;
            });
            continue;
          }

          // Check for standard column with static values (e.g., isActive = 1 or isactive = 1)
          const colStaticMatch = cond.match(/^([a-zA-Z0-9_]+)\s*(=|!=|<|>|<=|>=)\s*(.+)$/i);
          if (colStaticMatch) {
            const colName = colStaticMatch[1];
            const op = colStaticMatch[2].toLowerCase();
            const valStr = colStaticMatch[3].trim().replace(/['"`]/g, '');

            filters.push((r) => {
              const keys = Object.keys(r);
              const matchedKey = keys.find(k => k.toLowerCase() === colName.toLowerCase());
              if (!matchedKey) return false;

              const fieldVal = r[matchedKey];
              if (fieldVal === undefined || fieldVal === null) return false;

              if (op === '=') return String(fieldVal) === valStr;
              if (op === '!=') return String(fieldVal) !== valStr;

              const numVal = Number(valStr);
              const numFieldVal = Number(fieldVal);
              const isNum = !isNaN(numVal) && !isNaN(numFieldVal);

              if (op === '<') return isNum ? numFieldVal < numVal : String(fieldVal) < valStr;
              if (op === '>') return isNum ? numFieldVal > numVal : String(fieldVal) > valStr;
              if (op === '<=') return isNum ? numFieldVal <= numVal : String(fieldVal) <= valStr;
              if (op === '>=') return isNum ? numFieldVal >= numVal : String(fieldVal) >= valStr;
              return false;
            });
            continue;
          }
        }

        if (filters.length > 0) {
          if (whereClause.toLowerCase().includes(' or ')) {
            table = table.filter(r => filters.some(f => f(r)));
          } else {
            table = table.filter(r => filters.every(f => f(r)));
          }
        }
      }

      // Group BY date count
      if (lowerSql.includes('group by date')) {
        const counts: Record<string, number> = {};
        table.forEach((r) => {
          try {
            const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
            const date = parsed.date;
            if (date) {
              counts[date] = (counts[date] || 0) + 1;
            }
          } catch (e) {}
        });
        const rows = Object.entries(counts).map(([date, count]) => ({ date, count }));
        return { rows };
      }

      // Group BY clinicId / clinic_id count
      if (lowerSql.includes('group by clinicid') || lowerSql.includes('group by clinic_id')) {
        const counts: Record<string, number> = {};
        table.forEach((r) => {
          let cId = r.clinicId || r.clinic_id || r.clinicid;
          if (!cId && r.data) {
            try {
              const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              cId = parsed.clinicId || parsed.clinic_id;
            } catch (e) {}
          }
          if (cId) {
            counts[cId] = (counts[cId] || 0) + 1;
          }
        });
        const rows = Object.entries(counts).map(([clinicId, count]) => ({ clinicId, count }));
        return { rows };
      }

      // Sorting
      if (lowerSql.includes('order by')) {
        const desc = lowerSql.includes('desc');
        const isCreatedAt = lowerSql.includes('created_at') || lowerSql.includes('createdat');
        table.sort((a, b) => {
          const valA = String(isCreatedAt ? (a.createdAt || a.created_at || '') : (a.id || a.path || ''));
          const valB = String(isCreatedAt ? (b.createdAt || b.created_at || '') : (b.id || b.path || ''));
          return desc ? valB.localeCompare(valA) : valA.localeCompare(valB);
        });
      }

      // Limit
      if (lowerSql.includes('limit')) {
        const limitMatch = lowerSql.match(/limit\s+(\d+)/);
        if (limitMatch) {
          const limitNum = parseInt(limitMatch[1], 10);
          table = table.slice(0, limitNum);
        }
      }

      // Support for COUNT(*) aggregation
      if (lowerSql.includes('count(*)') || lowerSql.includes('count(1)')) {
        let alias = 'count';
        const aliasMatch = lowerSql.match(/count\([^)]+\)\s+as\s+([a-zA-Z0-9_]+)/i);
        if (aliasMatch) {
          alias = aliasMatch[1];
        } else {
          const aliasMatchNoAs = lowerSql.match(/count\([^)]+\)\s+([a-zA-Z0-9_]+)/i);
          if (aliasMatchNoAs && aliasMatchNoAs[1] !== 'from') {
            alias = aliasMatchNoAs[1];
          }
        }
        return { rows: [{ [alias]: table.length }] };
      }

      return { rows: table };
    }

    return { rows: [] };
  }
}

class PostgresDbClient {
  private isPostgres: boolean = false;
  private pgPool: pg.Pool | null = null;
  private poolConfig: any = null;
  private localDb: LocalJsonDbEmulator | null = null;
  private lastError: string | null = null;
  private detectedUrl: string | null = null;

  constructor() {
    let rawPgUrl = cleanEnvValue(
      process.env.DATABASE_URL || 
      process.env.POSTGRES_URL || 
      process.env.PG_DATABASE_URL ||
      ''
    );
    let rawPgHost = cleanEnvValue(process.env.PGHOST || process.env.DB_HOST || '');

    // If PGHOST or DB_HOST was provided as a full postgres:// connection URL, normalize it to pgUrl
    if (rawPgHost.startsWith('postgresql://') || rawPgHost.startsWith('postgres://')) {
      if (!rawPgUrl) {
        rawPgUrl = rawPgHost;
      }
      rawPgHost = '';
    }

    // Ignore internal Dokploy/Docker hostnames that cannot be resolved in this runtime container
    if (rawPgUrl.includes('clinicsys-mo-xo2fyj')) {
      rawPgUrl = '';
    }
    if (rawPgHost.includes('clinicsys-mo-xo2fyj')) {
      rawPgHost = '';
    }

    const pgUrl = rawPgUrl;
    const pgHost = rawPgHost;

    if (pgUrl || pgHost) {
      this.isPostgres = true;
      this.detectedUrl = pgUrl ? pgUrl : `postgresql://${pgHost}`;
      console.log('[Database] PostgreSQL connection credentials detected. Initializing Pool with URL/Host:', this.getDetectedUrl());
      this.poolConfig = pgUrl 
        ? { connectionString: pgUrl } 
        : {
            host: pgHost,
            user: cleanEnvValue(process.env.PGUSER || process.env.DB_USER || 'postgres'),
            password: cleanEnvValue(process.env.PGPASSWORD || process.env.DB_PASSWORD || ''),
            database: cleanEnvValue(process.env.PGDATABASE || process.env.DB_NAME || 'crowndent'),
            port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
          };
      
      // Set connection pooling & keep-alive options to prevent dropped idle TCP sockets
      this.poolConfig.max = 10;
      this.poolConfig.min = 0; // Don't hold open minimum idle sockets that remote firewall drops
      this.poolConfig.idleTimeoutMillis = 10000;
      this.poolConfig.connectionTimeoutMillis = 6000; // 6s connection timeout for fast failover
      this.poolConfig.keepAlive = true;
      this.poolConfig.keepAliveInitialDelayMillis = 5000;
      
      if (pgUrl && (pgUrl.includes('sslmode=require') || pgUrl.includes('supabase') || pgUrl.includes('neon') || pgUrl.includes('hostinger') || pgUrl.includes('aiven') || pgUrl.includes('.com') || pgUrl.includes('.net'))) {
        this.poolConfig.ssl = { rejectUnauthorized: false };
      } else if (process.env.PGSSLMODE === 'require' || process.env.DB_SSL === 'true') {
        this.poolConfig.ssl = { rejectUnauthorized: false };
      }

      this.createPool();
    } else {
      this.isPostgres = false;
      console.log('💡 [Database] No external PostgreSQL environment variables configured. Activating local database emulator...');
      this.localDb = new LocalJsonDbEmulator();
    }
  }

  private createPool() {
    this.pgPool = new Pool(this.poolConfig);
    this.pgPool.on('error', (err) => {
      console.warn('[PostgreSQL Pool Warning] Connection error on idle client:', err.message || err);
      this.lastError = err.message || String(err);
    });
  }

  private async recreatePool() {
    if (this.pgPool) {
      const oldPool = this.pgPool;
      this.pgPool = null;
      try {
        await oldPool.end();
      } catch (e) {
        // Ignore errors on ending dead pool
      }
    }
    this.createPool();
  }

  private isConnectionError(err: any): boolean {
    if (!err) return false;
    const msg = (err.message || String(err)).toLowerCase();
    const code = (err.code || '').toLowerCase();
    return (
      msg.includes('terminated unexpectedly') ||
      msg.includes('connection timeout') ||
      msg.includes('timeout') ||
      msg.includes('closed') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('eai_again') ||
      msg.includes('getaddrinfo') ||
      msg.includes('epipe') ||
      msg.includes('socket') ||
      msg.includes('released') ||
      msg.includes('password authentication failed') ||
      code === 'enotfound' ||
      code === 'eai_again' ||
      code === 'econnrefused' ||
      code === '28p01' ||
      code === '57p01' ||
      code === '57p02' ||
      code === '57p03' ||
      code === '08006' ||
      code === '08001' ||
      code === '08004'
    );
  }

  getIsPostgres() {
    return this.isPostgres;
  }

  getLastError() {
    return this.lastError;
  }

  getDetectedUrl() {
    if (!this.detectedUrl) return 'None';
    // Mask password in DATABASE_URL for security
    try {
      return this.detectedUrl.replace(/(postgresql:\/\/.*?):(.*?)@/, '$1:******@');
    } catch (e) {
      return 'Detected (Hidden Password)';
    }
  }

  async execute(optionsOrSql: string | { sql: string; args?: any[] }): Promise<{ rows: any[] }> {
    let sql: string;
    let args: any[] = [];

    if (typeof optionsOrSql === 'string') {
      sql = optionsOrSql;
    } else {
      sql = optionsOrSql.sql;
      args = optionsOrSql.args || [];
    }

    if (this.isPostgres) {
      let pgSql = sql;
      
      // Auto-translate SQLite INSERT OR REPLACE INTO syntax for Postgres compatibility
      if (pgSql.toLowerCase().includes('insert or replace into')) {
        const match = pgSql.match(/insert\s+or\s+replace\s+into\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)/i);
        if (match) {
          const tableName = match[1];
          const cols = match[2].split(',').map(c => c.trim());
          const pkCol = tableName.toLowerCase() === 'files' ? 'path' : 'id';
          const updateParts = cols
            .filter(c => c.toLowerCase() !== pkCol.toLowerCase())
            .map(c => `${c} = EXCLUDED.${c}`)
            .join(', ');
          
          pgSql = pgSql.replace(/insert\s+or\s+replace\s+into/i, 'INSERT INTO');
          if (updateParts) {
            pgSql += ` ON CONFLICT (${pkCol}) DO UPDATE SET ${updateParts}`;
          } else {
            pgSql += ` ON CONFLICT (${pkCol}) DO NOTHING`;
          }
        }
      }

      let argIndex = 1;
      // Convert SQLite ? syntax to PG $1, $2, ...
      pgSql = pgSql.replace(/\?/g, () => `$${argIndex++}`);
      
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          if (!this.pgPool) {
            this.createPool();
          }
          const result = await this.pgPool!.query(pgSql, args);
          return { rows: result.rows };
        } catch (err: any) {
          this.lastError = err.message || String(err);
          const isConnErr = this.isConnectionError(err);
          const isDnsErr = (err.message && (err.message.includes('getaddrinfo') || err.message.includes('EAI_AGAIN') || err.message.includes('ENOTFOUND'))) || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN';

          if (isDnsErr) {
            console.warn(`[Database Fallback] PostgreSQL hostname cannot be resolved (${err.message}). Seamlessly switching to local database emulator...`);
            this.isPostgres = false;
            if (!this.localDb) {
              this.localDb = new LocalJsonDbEmulator();
            }
            return this.localDb.execute(sql, args);
          }

          if (isConnErr && attempts < maxAttempts) {
            console.warn(`[PostgreSQL Pool Retry] Connection issue detected ("${err.message}"). Re-establishing connection pool (attempt ${attempts}/${maxAttempts})...`);
            await this.recreatePool();
            await new Promise((resolve) => setTimeout(resolve, 150 * attempts));
            continue;
          }

          if (isConnErr) {
            console.warn(`[Database Fallback] PostgreSQL unreachable ("${err.message}"). Safely switching to local database emulator...`);
            this.isPostgres = false;
            if (!this.localDb) {
              this.localDb = new LocalJsonDbEmulator();
            }
            return this.localDb.execute(sql, args);
          }

          console.error(`[PostgreSQL Error] Failed to execute SQL:`, pgSql, `Args:`, args, `Error:`, err);
          throw err;
        }
      }
      return { rows: [] };
    } else {
      if (!this.localDb) {
        this.localDb = new LocalJsonDbEmulator();
      }
      return this.localDb.execute(sql, args);
    }
  }
}

const dbClient = new PostgresDbClient();

function safeParseJson(dataVal: any): any {
  if (dataVal === null || dataVal === undefined) return {};
  if (typeof dataVal === 'object') return dataVal;
  try {
    return JSON.parse(dataVal);
  } catch (e) {
    return {};
  }
}

// Real-time WebSocket synchronizer registry
const wsClients = new Map<string, Set<WebSocket>>();
const handledEvents = new Set<string>();

export function initWebSocketServer(server: any) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: any, socket: any, head: any) => {
    const url = new URL(request.url || '', 'http://localhost');
    if (url.pathname === '/api/sync/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket, req: any) => {
    const url = new URL(req.url || '', 'http://localhost');
    const clinicId = url.searchParams.get('clinicId');
    
    if (!clinicId) {
      ws.close(4000, 'clinicId is required');
      return;
    }

    (ws as any).isAlive = true;
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    if (!wsClients.has(clinicId)) {
      wsClients.set(clinicId, new Set());
    }
    wsClients.get(clinicId)!.add(ws);
    console.log(`[WS] Client connected for clinic ${clinicId}. Total: ${wsClients.get(clinicId)!.size}`);

    ws.on('close', () => {
      const clients = wsClients.get(clinicId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          wsClients.delete(clinicId);
        }
      }
      console.log(`[WS] Client disconnected for clinic ${clinicId}`);
    });

    ws.on('error', (err: any) => {
      console.error(`[WS Error] Clinic ${clinicId}:`, err);
    });

    ws.on('message', (message: string) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed && parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        // ignore parsing issues or custom client messages
      }
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000); // Increased from 20s to 30s to reduce CPU usage

  wss.on('close', () => {
    clearInterval(interval);
  });
}

function broadcastSync(clinicId: string | null, eventData: { eventId?: string; table: string; action: string; id?: string; payload?: any }) {
  if (!clinicId) return;
  
  if (eventData.eventId) {
    if (handledEvents.has(eventData.eventId)) {
      return; // Already broadcasted
    }
    handledEvents.add(eventData.eventId);
    if (handledEvents.size > 500) {
      const firstItem = handledEvents.values().next().value;
      if (firstItem) handledEvents.delete(firstItem);
    }
  }

  const message = JSON.stringify({ ...eventData, clinicId });
  
  const clients = wsClients.get(clinicId);
  if (clients && clients.size > 0) {
    console.log(`[WS Broadcast] Sending to ${clients.size} clients in clinic ${clinicId}:`, eventData);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (err) {
          console.error('[WS Broadcast] Error sending message:', err);
        }
      }
    });
  }

  // Also notify superadmin clients if the event is from a specific clinic
  if (clinicId !== 'superadmin') {
    const superadminClients = wsClients.get('superadmin');
    if (superadminClients && superadminClients.size > 0) {
      console.log(`[WS Broadcast] Forwarding clinic ${clinicId} event to ${superadminClients.size} superadmin clients.`);
      superadminClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            console.error('[WS Broadcast] Error forwarding to superadmin:', err);
          }
        }
      });
    }
  }
}

async function publishSyncEvent(clinicId: string, tableName: string, action: string, recordId?: string, fullData?: any, predefinedEventId?: string): Promise<string | null> {
  if (!clinicId) return null;
  const eventId = predefinedEventId || ('ev_' + Math.random().toString(36).substring(2, 15));
  const now = Date.now();
  const payloadStr = fullData ? JSON.stringify(fullData) : '';
  try {
    await dbClient.execute({
      sql: `INSERT INTO server_sync_events (id, clinic_id, table_name, action, record_id, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [eventId, clinicId, tableName, action, recordId || '', now, payloadStr]
    });
    console.log(`[Sync Engine] Event published: ${eventId} for ${tableName}:${action}`);
    
    // Broadcast via WebSockets instantly (sub-second latency!)
    broadcastSync(clinicId, { eventId, table: tableName, action, id: recordId, payload: fullData });

    // Clean up old events (older than 30 minutes) - increased from 10 minutes to reduce database operations
    const thirtyMinutesAgo = now - 30 * 60 * 1000;
    dbClient.execute({
      sql: `DELETE FROM server_sync_events WHERE created_at < ?`,
      args: [thirtyMinutesAgo]
    }).catch(err => console.error('[Sync Engine] Error cleaning up old events:', err));
    
    return eventId;
  } catch (err) {
    console.error('[Sync Engine] Failed to publish sync event:', err);
    return null;
  }
}

const ALLOWED_TABLES = [
  'clinics', 'users', 'patients', 'appointments', 'records', 'prescriptions',
  'custom_medications', 'custom_categories', 'inventory', 'billing',
  'closings', 'laboratories', 'lab_orders', 'lab_work_types', 'renewals', 'shifts', 'expenses',
  'system_settings', 'announcements', 'superadmin_credentials', 'xrays', 'teeth'
];

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
}

const tableSchemas: Record<string, ColumnInfo[]> = {};

function tableHasColumn(tableName: string, colName: string): boolean {
  const schema = tableSchemas[tableName];
  if (!schema) return false;
  const colLower = colName.toLowerCase();
  return schema.some(c => c.name.toLowerCase() === colLower);
}

async function loadTableSchemas() {
  try {
    if (dbClient.getIsPostgres()) {
      // Query Postgres schema tables
      const tablesResult = await dbClient.execute(`
        SELECT table_name as name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      
      await Promise.all(
        tablesResult.rows.map(async (row) => {
          const tableName = row.name as string;
          try {
            // Get columns and primary key information for Postgres
            const infoResult = await dbClient.execute({
              sql: `
                SELECT 
                  c.column_name as name, 
                  c.data_type as type, 
                  CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END as notnull,
                  c.column_default as dflt_value,
                  CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 1 ELSE 0 END as pk
                FROM information_schema.columns c
                LEFT JOIN information_schema.key_column_usage kcu 
                  ON c.table_name = kcu.table_name 
                  AND c.column_name = kcu.column_name
                LEFT JOIN information_schema.table_constraints tc 
                  ON kcu.table_name = tc.table_name 
                  AND kcu.constraint_name = tc.constraint_name
                  AND tc.constraint_type = 'PRIMARY KEY'
                WHERE c.table_name = ? AND c.table_schema = 'public'
              `,
              args: [tableName]
            });
            tableSchemas[tableName] = infoResult.rows.map((r: any) => ({
              name: r.name,
              type: r.type,
              notnull: Number(r.notnull),
              dflt_value: r.dflt_value,
              pk: Number(r.pk),
            }));
          } catch (e) {
            console.warn(`[PostgreSQL] Failed to load columns for ${tableName}:`, e);
          }
        })
      );
      console.log('[PostgreSQL] Table schemas loaded successfully in parallel.');
    } else {
      const tablesResult = await dbClient.execute("SELECT name FROM sqlite_master WHERE type='table'");
      
      await Promise.all(
        tablesResult.rows.map(async (row) => {
          const tableName = row.name as string;
          try {
            const infoResult = await dbClient.execute(`PRAGMA table_info(${tableName})`);
            tableSchemas[tableName] = infoResult.rows.map((r: any) => ({
              name: r.name,
              type: r.type,
              notnull: Number(r.notnull),
              dflt_value: r.dflt_value,
              pk: Number(r.pk),
            }));
          } catch (e) {
            console.warn(`[SQLite Fallback] Failed to load table_info for ${tableName}:`, e);
          }
        })
      );
      console.log('[SQLite Fallback] Table schemas loaded successfully in parallel.');
    }
  } catch (err) {
    console.error('[Database] Error loading table schemas:', err);
  }
}

function mapDataToColumns(tableName: string, finalId: string, data: any, clinicId?: string | null, patientId?: string | null, createdAt?: string) {
  const tableKey = tableName.toLowerCase();
  const columns = tableSchemas[tableName] || tableSchemas[tableKey] || [];
  
  if (columns.length === 0) {
    const isExcludedClinic = ['files', 'system_settings', 'announcements', 'superadmin_credentials'].includes(tableKey);
    const hasPatient = ['records', 'appointments', 'prescriptions', 'xrays', 'teeth'].includes(tableKey);
    const cols = ['id', 'data'];
    const vals: any[] = [finalId, JSON.stringify(data)];
    if (clinicId && !isExcludedClinic) { cols.push('clinicId'); vals.push(clinicId); }
    if (patientId && hasPatient) { cols.push('patientId'); vals.push(patientId); }
    if (createdAt && tableKey !== 'files') { cols.push('createdAt'); vals.push(createdAt); }
    return { cols, vals };
  }

  const cols: string[] = [];
  const vals: any[] = [];

  for (const col of columns) {
    const colName = col.name;
    const colNameLower = colName.toLowerCase();

    // 1. Primary keys or ID columns for legacy tables
    const isPrimaryKey = colNameLower === 'id' ||
      (tableKey === 'patients' && colNameLower === 'patient_id') ||
      (tableKey === 'appointments' && colNameLower === 'appointment_id') ||
      (tableKey === 'prescriptions' && colNameLower === 'prescription_id') ||
      (tableKey === 'records' && colNameLower === 'session_id');

    if (isPrimaryKey) {
      cols.push(colName);
      vals.push(finalId);
      continue;
    }

    // 2. data column
    if (colNameLower === 'data') {
      cols.push(colName);
      vals.push(JSON.stringify(data));
      continue;
    }

    // 3. clinic ID
    if (colNameLower === 'clinicid' || colNameLower === 'clinic_id') {
      cols.push(colName);
      vals.push(clinicId || data?.clinicId || data?.clinic_id || '');
      continue;
    }

    // 4. patient ID
    if (colNameLower === 'patientid' || colNameLower === 'patient_id') {
      cols.push(colName);
      vals.push(patientId || data?.patientId || data?.patient_id || '');
      continue;
    }

    // 5. created at
    if (colNameLower === 'createdat' || colNameLower === 'created_at') {
      cols.push(colName);
      vals.push(createdAt || data?.createdAt || data?.created_at || new Date().toISOString());
      continue;
    }

    // 6. Generic data fields: extract from data object
    let val = data?.[colName];
    if (val === undefined) {
      // try camelCase version
      const camelCaseName = colName.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      val = data?.[camelCaseName];
    }
    if (val === undefined) {
      // try snake_case version
      const snakeCaseName = colName.replace(/([A-Z])/g, "_$1").toLowerCase();
      val = data?.[snakeCaseName];
    }

    if (val !== undefined) {
      cols.push(colName);
      if (typeof val === 'object' && val !== null) {
        vals.push(JSON.stringify(val));
      } else {
        vals.push(val);
      }
    } else if (col.notnull && col.dflt_value === null) {
      // Column is NOT NULL and has no default value, we must provide a safe fallback default!
      cols.push(colName);
      const colTypeLower = col.type.toLowerCase();
      if (colTypeLower.includes('int') || colTypeLower.includes('dec') || colTypeLower.includes('num') || colTypeLower.includes('real') || colTypeLower.includes('double')) {
        vals.push(0);
      } else {
        vals.push('');
      }
    }
  }

  return { cols, vals };
}

// Migration Engine: Version-controlled database schema migrations
async function runMigrations() {
  try {
    // Ensure migration tracking table exists
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT
      );
    `);

    // Fetch applied migration IDs
    const res = await dbClient.execute(`SELECT id FROM schema_migrations`);
    const appliedIds = new Set(res.rows.map((r: any) => String(r.id)));

    const migrations = [
      {
        id: '20260810_001_initial_base_schema',
        up: async () => {
          console.log('[Schema Migration] Executing 20260810_001_initial_base_schema...');
          
          // 1. Ensure server_sync_events table exists
          await dbClient.execute(`
            CREATE TABLE IF NOT EXISTS server_sync_events (
              id TEXT PRIMARY KEY,
              clinic_id TEXT,
              table_name TEXT,
              action TEXT,
              record_id TEXT,
              created_at BIGINT,
              payload TEXT
            );
          `);

          // 2. Base tables creation
          const tables = [
            `CREATE TABLE IF NOT EXISTS clinics (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS prescriptions (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS custom_medications (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS custom_categories (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS billing (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS closings (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS laboratories (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS lab_orders (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS lab_work_types (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS renewals (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mimeType TEXT, data TEXT);`,
            `CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, content TEXT, bgColor TEXT, textColor TEXT, isActive INTEGER, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS superadmin_credentials (id TEXT PRIMARY KEY, email TEXT, password TEXT, updatedAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS system_settings (id TEXT PRIMARY KEY, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS xrays (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, data TEXT, createdAt TEXT);`,
            `CREATE TABLE IF NOT EXISTS teeth (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, data TEXT, createdAt TEXT);`
          ];

          await Promise.all(
            tables.map(async (sql) => {
              try {
                await dbClient.execute(sql);
              } catch (err) {
                console.warn(`[PostgreSQL Init] Table creation note: ${sql.substring(0, 50)}...`);
              }
            })
          );

          // 3. Ensure columns exist
          const columnsToVerify = [
            { table: 'clinics', column: 'clinicId', type: 'TEXT' },
            { table: 'users', column: 'clinicId', type: 'TEXT' },
            { table: 'patients', column: 'clinicId', type: 'TEXT' },
            { table: 'patients', column: 'id', type: 'TEXT' },
            { table: 'appointments', column: 'clinicId', type: 'TEXT' },
            { table: 'appointments', column: 'id', type: 'TEXT' },
            { table: 'appointments', column: 'patientId', type: 'TEXT' },
            { table: 'records', column: 'clinicId', type: 'TEXT' },
            { table: 'records', column: 'patientId', type: 'TEXT' },
            { table: 'prescriptions', column: 'clinicId', type: 'TEXT' },
            { table: 'prescriptions', column: 'id', type: 'TEXT' },
            { table: 'prescriptions', column: 'patientId', type: 'TEXT' },
            { table: 'custom_medications', column: 'clinicId', type: 'TEXT' },
            { table: 'custom_categories', column: 'clinicId', type: 'TEXT' },
            { table: 'inventory', column: 'clinicId', type: 'TEXT' },
            { table: 'billing', column: 'clinicId', type: 'TEXT' },
            { table: 'closings', column: 'clinicId', type: 'TEXT' },
            { table: 'laboratories', column: 'clinicId', type: 'TEXT' },
            { table: 'lab_orders', column: 'clinicId', type: 'TEXT' },
            { table: 'lab_work_types', column: 'clinicId', type: 'TEXT' },
            { table: 'shifts', column: 'clinicId', type: 'TEXT' },
            { table: 'clinics', column: 'createdAt', type: 'TEXT' },
            { table: 'users', column: 'createdAt', type: 'TEXT' },
            { table: 'patients', column: 'createdAt', type: 'TEXT' },
            { table: 'appointments', column: 'createdAt', type: 'TEXT' },
            { table: 'records', column: 'createdAt', type: 'TEXT' },
            { table: 'prescriptions', column: 'createdAt', type: 'TEXT' },
            { table: 'custom_medications', column: 'createdAt', type: 'TEXT' },
            { table: 'custom_categories', column: 'createdAt', type: 'TEXT' },
            { table: 'inventory', column: 'createdAt', type: 'TEXT' },
            { table: 'billing', column: 'createdAt', type: 'TEXT' },
            { table: 'closings', column: 'createdAt', type: 'TEXT' },
            { table: 'laboratories', column: 'createdAt', type: 'TEXT' },
            { table: 'lab_orders', column: 'createdAt', type: 'TEXT' },
            { table: 'lab_work_types', column: 'createdAt', type: 'TEXT' },
            { table: 'renewals', column: 'clinicId', type: 'TEXT' },
            { table: 'renewals', column: 'createdAt', type: 'TEXT' },
            { table: 'shifts', column: 'createdAt', type: 'TEXT' },
            { table: 'announcements', column: 'bgColor', type: 'TEXT' },
            { table: 'announcements', column: 'textColor', type: 'TEXT' }
          ];

          await Promise.all(
            columnsToVerify.map(async (item) => {
              try {
                await dbClient.execute(`ALTER TABLE ${item.table} ADD COLUMN IF NOT EXISTS ${item.column} ${item.type}`);
              } catch (err) {
                // ignore
              }
            })
          );

          await loadTableSchemas();

          // 4. Backfill demo data
          await seedDemoData();

          // 5. Indexing and optimizations
          if (dbClient.getIsPostgres()) {
            const tablesToConvert = ALLOWED_TABLES.filter(t => tableHasColumn(t, 'data'));
            
            for (const t of tablesToConvert) {
              try {
                await dbClient.execute(`
                  UPDATE ${t} 
                  SET data = '{}' 
                  WHERE data IS NULL 
                     OR TRIM(data::text) = '' 
                     OR data::text = 'undefined' 
                     OR data::text = 'null' 
                     OR (LEFT(TRIM(data::text), 1) NOT IN ('{', '['))
                `);
              } catch (e) {}

              try {
                await dbClient.execute(`ALTER TABLE ${t} ALTER COLUMN data TYPE JSONB USING (CASE WHEN data IS NULL OR TRIM(data::text) = '' THEN '{}'::jsonb ELSE data::jsonb END)`);
              } catch (e) {}

              try {
                await dbClient.execute(`CREATE INDEX IF NOT EXISTS idx_${t}_data_gin ON ${t} USING gin (data)`);
              } catch (e) {}
            }

            const bTreeIndexes = [
              { name: 'idx_clinics_clinicId', table: 'clinics', col: 'clinicId' },
              { name: 'idx_users_clinicId', table: 'users', col: 'clinicId' },
              { name: 'idx_patients_clinicId', table: 'patients', col: 'clinicId' },
              { name: 'idx_appointments_clinicId', table: 'appointments', col: 'clinicId' },
              { name: 'idx_appointments_patientId', table: 'appointments', col: 'patientId' },
              { name: 'idx_records_clinicId', table: 'records', col: 'clinicId' },
              { name: 'idx_records_patientId', table: 'records', col: 'patientId' },
              { name: 'idx_prescriptions_clinicId', table: 'prescriptions', col: 'clinicId' },
              { name: 'idx_server_sync_events_clinic_id', table: 'server_sync_events', col: 'clinic_id' },
              { name: 'idx_server_sync_events_created_at', table: 'server_sync_events', col: 'created_at' }
            ];

            for (const idx of bTreeIndexes) {
              if (tableHasColumn(idx.table, idx.col)) {
                try {
                  await dbClient.execute(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.col})`);
                } catch (e) {}
              }
            }
          }
        }
      },
      {
        id: '20260810_002_fix_sync_events_bigint',
        up: async () => {
          console.log('[Schema Migration] Executing 20260810_002_fix_sync_events_bigint...');
          if (dbClient.getIsPostgres()) {
            try {
              await dbClient.execute(`ALTER TABLE server_sync_events ALTER COLUMN created_at TYPE BIGINT USING created_at::bigint;`);
            } catch (e) {
              console.warn('[PostgreSQL Migration] Note on altering server_sync_events created_at to BIGINT:', e);
            }
          }
        }
      },
      {
        id: '20260811_001_remove_demo_data',
        up: async () => {
          console.log('[Schema Migration] Executing seedDemoData...');
          await seedDemoData();
        }
      },
      {
        id: '20260815_001_ensure_renewals_clinic_id',
        up: async () => {
          console.log('[Schema Migration] Executing 20260815_001_ensure_renewals_clinic_id...');
          try {
            await dbClient.execute(`ALTER TABLE renewals ADD COLUMN IF NOT EXISTS clinicId TEXT;`);
          } catch (e) {
            try {
              await dbClient.execute(`ALTER TABLE renewals ADD COLUMN clinicId TEXT;`);
            } catch (e2) {}
          }
          try {
            await dbClient.execute(`ALTER TABLE renewals ADD COLUMN IF NOT EXISTS createdAt TEXT;`);
          } catch (e) {
            try {
              await dbClient.execute(`ALTER TABLE renewals ADD COLUMN createdAt TEXT;`);
            } catch (e2) {}
          }
          try {
            await dbClient.execute(`CREATE INDEX IF NOT EXISTS idx_renewals_clinicId ON renewals (clinicId);`);
          } catch (e) {}
          await loadTableSchemas();
        }
      }
    ];

    for (const m of migrations) {
      if (!appliedIds.has(m.id)) {
        console.log(`[Schema Migration] Running migration: ${m.id}`);
        await m.up();
        const now = new Date().toISOString();
        await dbClient.execute({
          sql: `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
          args: [m.id, now]
        });
        console.log(`[Schema Migration] Applied migration: ${m.id}`);
      } else {
        console.log(`[Schema Migration] Migration already applied: ${m.id}`);
      }
    }
  } catch (err) {
    console.error('[Schema Migration] Error in migration engine:', err);
  }
}

// Database Schema Initialization
async function initDb() {
  if (dbClient.getIsPostgres()) {
    try {
      await dbClient.execute(`
        CREATE OR REPLACE FUNCTION json_extract(json_text text, path text)
        RETURNS text AS $$
        DECLARE
          clean_path text;
          result text;
        BEGIN
          clean_path := replace(path, '$.', '');
          BEGIN
            result := (json_text::json)->>clean_path;
          EXCEPTION WHEN OTHERS THEN
            BEGIN
              result := (json_text::jsonb)->>clean_path;
            EXCEPTION WHEN OTHERS THEN
              result := NULL;
            END;
          END;
          RETURN result;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;

        CREATE OR REPLACE FUNCTION json_extract(json_val jsonb, path text)
        RETURNS text AS $$
        DECLARE
          clean_path text;
        BEGIN
          clean_path := replace(path, '$.', '');
          RETURN json_val->>clean_path;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;

        CREATE OR REPLACE FUNCTION json_extract(json_val json, path text)
        RETURNS text AS $$
        DECLARE
          clean_path text;
        BEGIN
          clean_path := replace(path, '$.', '');
          RETURN json_val->>clean_path;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;
      `);
    } catch (e) {
      console.error('[PostgreSQL] Failed to create custom json_extract function:', e);
    }
  }

  // Execute Versioned Migration System
  await runMigrations();

  // Start background sync events daily cleanup scheduler
  startSyncEventsCleanupScheduler();

  isDbInitialized = true;
}

// Background daily cron job to clean up older server_sync_events to keep tables lightweight
function startSyncEventsCleanupScheduler() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  
  const performCleanup = async () => {
    try {
      console.log('[Cleanup Scheduler] Running daily cleanup of synchronized events older than 7 days...');
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      const result = await dbClient.execute({
        sql: `DELETE FROM server_sync_events WHERE created_at < ?`,
        args: [sevenDaysAgo]
      });
      
      console.log('[Cleanup Scheduler] Daily cleanup completed successfully.');
    } catch (err: any) {
      console.error('[Cleanup Scheduler] Error during daily synchronized events cleanup:', err);
    }
  };

  // Run once on startup (after 5 seconds to not interfere with boot)
  setTimeout(performCleanup, 5000);

  // Run every 24 hours
  setInterval(performCleanup, ONE_DAY_MS);
}

// Clean up existing demo/mock data to make database fully blank
async function cleanupDemoData() {
  try {
    console.log('[PostgreSQL] Cleaning up any existing demo/mock data to make database fully blank...');
    
    const demoClinics = ['clinic_active_demo', 'clinic_expired_demo', 'clinic_alternative_demo'];
    const demoUsers = ['user_active_demo', 'user_expired_demo', 'user_alternative_demo'];
    const demoPatients = ['patient_1', 'patient_2', 'patient_3'];
    const demoAppointments = ['appointment_1', 'appointment_2'];
    const demoRecords = ['record_1'];
    const demoPrescriptions = ['prescription_1'];
    const demoInventory = ['inventory_1', 'inventory_2'];
    const demoLaboratories = ['lab_1'];
    const demoLabOrders = ['lab_order_1'];

    // Delete rows belonging to these clinics or IDs
    for (const id of demoClinics) {
      await dbClient.execute({ sql: `DELETE FROM clinics WHERE id = ?`, args: [id] });
    }
    for (const id of demoUsers) {
      await dbClient.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [id] });
    }
    
    // Clean tables for the rest
    const tablesWithClinicId = [
      'users', 'patients', 'appointments', 'records', 'prescriptions', 
      'custom_medications', 'custom_categories', 'inventory', 'billing', 
      'closings', 'laboratories', 'lab_orders', 'lab_work_types', 'shifts', 'expenses'
    ];
    
    for (const table of tablesWithClinicId) {
      for (const cid of demoClinics) {
        try {
          await dbClient.execute({ sql: `DELETE FROM ${table} WHERE clinicId = ?`, args: [cid] });
        } catch (e) {
          // ignore table errors if empty/missing
        }
      }
    }

    // Direct deletes by ID just in case
    for (const id of demoPatients) {
      try { await dbClient.execute({ sql: `DELETE FROM patients WHERE id = ?`, args: [id] }); } catch(e){}
    }
    for (const id of demoAppointments) {
      try { await dbClient.execute({ sql: `DELETE FROM appointments WHERE id = ?`, args: [id] }); } catch(e){}
    }
    for (const id of demoRecords) {
      try { await dbClient.execute({ sql: `DELETE FROM records WHERE id = ?`, args: [id] }); } catch(e){}
    }
    for (const id of demoPrescriptions) {
      try { await dbClient.execute({ sql: `DELETE FROM prescriptions WHERE id = ?`, args: [id] }); } catch(e){}
    }
    for (const id of demoInventory) {
      try { await dbClient.execute({ sql: `DELETE FROM inventory WHERE id = ?`, args: [id] }); } catch(e){}
    }
    for (const id of demoLaboratories) {
      try { await dbClient.execute({ sql: `DELETE FROM laboratories WHERE id = ?`, args: [id] }); } catch(e){}
    }
    for (const id of demoLabOrders) {
      try { await dbClient.execute({ sql: `DELETE FROM lab_orders WHERE id = ?`, args: [id] }); } catch(e){}
    }

    console.log('[PostgreSQL] Cleanup of demo/mock data completed.');
  } catch (err) {
    console.error('[PostgreSQL] Error during demo data cleanup:', err);
  }
}

// Seed Demo/Default Multi-Tenant Dental Clinics
async function seedDemoData() {
  try {
    const activeClinicId = 'clinic_active_demo';
    
    // 1. Check and seed clinics/users
    const clinicsCount = await dbClient.execute(`SELECT count(*) as count FROM clinics`);
    const count = Number((clinicsCount.rows[0] as any).count);
    if (count === 0) {
      console.log('[PostgreSQL] Seeding default multi-tenant clinics...');
      
      // Future Expiry Date
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const expiresAt = futureDate.toISOString();

      // Active Clinic Demo
      const activeClinicData = {
        id: activeClinicId,
        name: 'عيادة الابتسامة المشرقة (نشط)',
        nameAr: 'عيادة الابتسامة المشرقة (نشط)',
        nameEn: 'Bright Smile Clinic',
        email: 'active-owner@clinic.com',
        password: 'password123',
        isActive: true,
        subscriptionExpiresAt: expiresAt,
        doctorName: 'د. أحمد السعيد',
        doctorPhone: '01011112222',
        doctorSpecialtyAr: 'استشاري زراعة وتجميل الأسنان',
        doctorSpecialtyEn: 'Dental Implant Consultant',
        clinicHours: '12:00 PM - 9:00 PM',
        address: 'شارع جامعة الدول العربية، المهندسين',
        staffPin: '1234',
        createdAt: new Date().toISOString()
      };
      await dbClient.execute({
        sql: `INSERT INTO clinics (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
        args: [activeClinicId, activeClinicId, JSON.stringify(activeClinicData), activeClinicData.createdAt]
      });

      const activeUserId = 'user_active_demo';
      const activeUserData = {
        uid: activeUserId,
        id: activeUserId,
        email: 'active-owner@clinic.com',
        name: 'د. أحمد السعيد',
        clinicId: activeClinicId,
        role: 'owner',
        createdAt: new Date().toISOString()
      };
      await dbClient.execute({
        sql: `INSERT INTO users (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
        args: [activeUserId, activeClinicId, JSON.stringify(activeUserData), activeUserData.createdAt]
      });

      // Expired Clinic Demo
      const expiredClinicId = 'clinic_expired_demo';
      const expiredClinicData = {
        id: expiredClinicId,
        name: 'مستوصف الشفاء لطب الأسنان (غير نشط)',
        nameAr: 'مستوصف الشفاء لطب الأسنان (غير نشط)',
        nameEn: 'Al-Shifa Dental Clinic',
        email: 'expired-owner@clinic.com',
        password: 'password123',
        isActive: false,
        subscriptionExpiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // expired 5 days ago
        doctorName: 'د. سارة الراوي',
        doctorPhone: '01122223333',
        doctorSpecialtyAr: 'أخصائي علاج الجذور والتركيبات',
        doctorSpecialtyEn: 'Endodontics Specialist',
        clinicHours: '2:00 PM - 10:00 PM',
        address: 'شارع قصر العيني، القاهرة',
        staffPin: '1234',
        createdAt: new Date().toISOString()
      };
      await dbClient.execute({
        sql: `INSERT INTO clinics (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
        args: [expiredClinicId, expiredClinicId, JSON.stringify(expiredClinicData), expiredClinicData.createdAt]
      });

      const expiredUserId = 'user_expired_demo';
      const expiredUserData = {
        uid: expiredUserId,
        id: expiredUserId,
        email: 'expired-owner@clinic.com',
        name: 'د. سارة الراوي',
        clinicId: expiredClinicId,
        role: 'owner',
        createdAt: new Date().toISOString()
      };
      await dbClient.execute({
        sql: `INSERT INTO users (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
        args: [expiredUserId, expiredClinicId, JSON.stringify(expiredUserData), expiredUserData.createdAt]
      });

      // Alternative/Isolated Clinic Demo
      const alternativeClinicId = 'clinic_alternative_demo';
      const alternativeClinicData = {
        id: alternativeClinicId,
        name: 'عيادة كير لتجميل الأسنان (معزولة تماماً)',
        nameAr: 'عيادة كير لتجميل الأسنان (معزولة تماماً)',
        nameEn: 'Care Dental Clinic',
        email: 'dentist-clinic2@clinic.com',
        password: 'password123',
        isActive: true,
        subscriptionExpiresAt: expiresAt,
        doctorName: 'د. رامي يوسف',
        doctorPhone: '01233334444',
        doctorSpecialtyAr: 'أخصائي طب وجراحة فم وأسنان',
        doctorSpecialtyEn: 'GP Dentist',
        clinicHours: '10:00 AM - 6:00 PM',
        address: 'مصر الجديدة، القاهرة',
        staffPin: '1234',
        createdAt: new Date().toISOString()
      };
      await dbClient.execute({
        sql: `INSERT INTO clinics (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
        args: [alternativeClinicId, alternativeClinicId, JSON.stringify(alternativeClinicData), alternativeClinicData.createdAt]
      });

      const alternativeUserId = 'user_alternative_demo';
      const alternativeUserData = {
        uid: alternativeUserId,
        id: alternativeUserId,
        email: 'dentist-clinic2@clinic.com',
        name: 'د. رامي يوسف',
        clinicId: alternativeClinicId,
        role: 'owner',
        createdAt: new Date().toISOString()
      };
      await dbClient.execute({
        sql: `INSERT INTO users (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
        args: [alternativeUserId, alternativeClinicId, JSON.stringify(alternativeUserData), alternativeUserData.createdAt]
      });

      console.log('[PostgreSQL] Default clinics & users seeded.');
    } else {
      console.log('[PostgreSQL] Clinics table already has data, skipped clinic seeding.');
    }

    // 2. Check and seed patient records, appointments, inventory, and labs
    const patientsCheck = await dbClient.execute(`SELECT count(*) as count FROM patients`);
    if (Number((patientsCheck.rows[0] as any).count) === 0) {
      console.log('[PostgreSQL] Patients table is empty, seeding rich medical records for clinic_active_demo...');
      
      const todayStr = new Date().toISOString().split('T')[0];
      
      // Patients
      const patients = [
        {
          id: 'patient_1',
          name: 'محمد علي أحمد',
          phone: '01020304050',
          age: '34',
          medicalHistory: 'لا يوجد حساسية، مريض ضغط دم متحكم به',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          toothChart: {
            '11': { toothNumber: 11, condition: 'decayed', notes: 'تسوس بسيط بالسطح الإطباقي' }
          }
        },
        {
          id: 'patient_2',
          name: 'فاطمة عبد الرحمن',
          phone: '01122334455',
          age: '28',
          medicalHistory: 'حساسية من البنسلين',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          toothChart: {
            '16': { toothNumber: 16, condition: 'filled', notes: 'حشو بلاتين قديم' }
          }
        },
        {
          id: 'patient_3',
          name: 'أحمد محمود حسن',
          phone: '01223344556',
          age: '45',
          medicalHistory: 'مريض سكري',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          toothChart: {}
        }
      ];

      for (const patient of patients) {
        await dbClient.execute({
          sql: `INSERT OR REPLACE INTO patients (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
          args: [patient.id, activeClinicId, JSON.stringify(patient), patient.createdAt]
        });
      }

      // Appointments
      const appointments = [
        {
          id: 'appointment_1',
          patientId: 'patient_1',
          patientName: 'محمد علي أحمد',
          patientPhone: '01020304050',
          date: todayStr,
          time: '17:00',
          treatmentType: 'كشف واستشارة',
          price: 150,
          notes: 'كشف لأول مرة وشكوى من ألم في الفك العلوي',
          status: 'scheduled',
          paidAmount: 0,
          remainingAmount: 150,
          invoiceStatus: 'pending_payment',
          dateTime: `${todayStr}T17:00`,
          createdAt: new Date().toISOString()
        },
        {
          id: 'appointment_2',
          patientId: 'patient_2',
          patientName: 'فاطمة عبد الرحمن',
          patientPhone: '01122334455',
          date: todayStr,
          time: '19:30',
          treatmentType: 'حشو تجميلي',
          price: 600,
          notes: 'جلسة حشو الضرس 16',
          status: 'waiting',
          paidAmount: 600,
          remainingAmount: 0,
          invoiceStatus: 'paid',
          dateTime: `${todayStr}T19:30`,
          createdAt: new Date().toISOString()
        }
      ];

      for (const appt of appointments) {
        await dbClient.execute({
          sql: `INSERT OR REPLACE INTO appointments (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
          args: [appt.id, activeClinicId, JSON.stringify(appt), appt.createdAt]
        });
      }

      // Records (Visits/History)
      const records = [
        {
          id: 'record_1',
          date: todayStr,
          treatment: 'كشف مبدئي وأشعة تشخيصية',
          cost: 150,
          notes: 'تم عمل فحص كامل وكتابة خطة علاجية لخلع ضرس العقل',
          invoiceStatus: 'pending_payment',
          paymentMethod: 'cash',
          createdAt: new Date().toISOString()
        }
      ];

      for (const rec of records) {
        await dbClient.execute({
          sql: `INSERT OR REPLACE INTO records (id, clinicId, patientId, data, createdAt) VALUES (?, ?, ?, ?, ?)`,
          args: [rec.id, activeClinicId, 'patient_1', JSON.stringify(rec), rec.createdAt]
        });
      }

      // Prescriptions
      const prescriptions = [
        {
          id: 'prescription_1',
          patientId: 'patient_1',
          patientName: 'محمد علي أحمد',
          patientAge: '34',
          date: todayStr,
          medications: [
            { name: 'Augmentin 1g', dose: 'قرص واحد', frequency: 'كل 12 ساعة', duration: '5 أيام' },
            { name: 'Brufen 600mg', dose: 'قرص عند اللزوم', frequency: 'بعد الأكل', duration: '3 أيام' }
          ],
          notes: 'يرجى شرب كمية كافية من الماء مع العلاج.',
          createdAt: new Date().toISOString()
        }
      ];

      for (const pres of prescriptions) {
        await dbClient.execute({
          sql: `INSERT OR REPLACE INTO prescriptions (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
          args: [pres.id, activeClinicId, JSON.stringify(pres), pres.createdAt]
        });
      }

      // Inventory items (Products)
      const inventoryItems = [
        {
          id: 'inventory_1',
          nameAr: 'مخدر موضعي (بنج أسنان)',
          catAr: 'مواد تخدير',
          stock: 45,
          price: 250,
          rating: 5,
          descAr: 'علبة بنج أسنان مخصص لعمليات اللثة والخلع والزراعة',
          img: '',
          createdAt: new Date().toISOString()
        },
        {
          id: 'inventory_2',
          nameAr: 'حشوات ضوئية تجميلية Composite',
          catAr: 'حشوات',
          stock: 12,
          price: 450,
          rating: 4,
          descAr: 'حقنة كومبوزيت تجميلية بدرجات ألوان متعددة',
          img: '',
          createdAt: new Date().toISOString()
        }
      ];

      for (const inv of inventoryItems) {
        await dbClient.execute({
          sql: `INSERT OR REPLACE INTO inventory (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
          args: [inv.id, activeClinicId, JSON.stringify(inv), inv.createdAt]
        });
      }

      // Laboratories
      const laboratories = [
        {
          id: 'lab_1',
          name: 'معمل رويال لتركيبات الأسنان',
          phone: '01234567890',
          email: 'royal@lab.com',
          address: 'وسط البلد، القاهرة',
          createdAt: new Date().toISOString()
        }
      ];

      for (const lab of laboratories) {
        await dbClient.execute({
          sql: `INSERT OR REPLACE INTO laboratories (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
          args: [lab.id, activeClinicId, JSON.stringify(lab), lab.createdAt]
        });
      }

      // Lab Orders
      const labOrders = [
        {
          id: 'lab_order_1',
          doctorId: 'user_active_demo',
          doctorName: 'د. أحمد السعيد',
          patientId: 'patient_2',
          patientName: 'فاطمة عبد الرحمن',
          patientPhone: '01122334455',
          laboratoryId: 'lab_1',
          laboratoryName: 'معمل رويال لتركيبات الأسنان',
          workType: 'زيركون Zircon Crown',
          toothNumbers: '14',
          shadeColor: 'A1',
          sentDate: todayStr,
          expectedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          cost: 800,
          paymentStatus: 'unpaid',
          status: 'sent',
          createdAt: new Date().toISOString()
        }
      ];

      for (const order of labOrders) {
        await dbClient.execute({
          sql: `INSERT OR REPLACE INTO lab_orders (id, clinicId, data, createdAt) VALUES (?, ?, ?, ?)`,
          args: [order.id, activeClinicId, JSON.stringify(order), order.createdAt]
        });
      }

      console.log('[PostgreSQL] Seeding initial medical records completed.');
    } else {
      console.log('[PostgreSQL] Patients table already has data, skipped patient seeding.');
    }

    console.log('[PostgreSQL] Database seeding check completed successfully!');
  } catch (err) {
    console.error('[PostgreSQL] Error seeding clinics/patient data:', err);
  }
}

// Path segment parsing helper
function parsePath(pathStr: string) {
  const parts = pathStr.split('/').filter(Boolean);
  
  if (parts[0] === 'clinics') {
    if (parts.length === 1) {
      return { tableName: 'clinics', clinicId: null, patientId: null, docId: null };
    }
    if (parts.length === 2) {
      return { tableName: 'clinics', clinicId: null, patientId: null, docId: parts[1] };
    }
    
    const clinicId = parts[1];
    if (parts[2] === 'patients') {
      if (parts.length === 3) {
        return { tableName: 'patients', clinicId, patientId: null, docId: null };
      }
      if (parts.length === 4) {
        return { tableName: 'patients', clinicId, patientId: null, docId: parts[3] };
      }
      return {
        tableName: parts[4],
        clinicId,
        patientId: parts[3],
        docId: parts[5] || null
      };
    }
    
    return {
      tableName: parts[2],
      clinicId,
      patientId: null,
      docId: parts[3] || null
    };
  }
  
  if (parts.length === 1) {
    return { tableName: parts[0], clinicId: null, patientId: null, docId: null };
  }
  if (parts.length === 2) {
    return { tableName: parts[0], clinicId: null, patientId: null, docId: parts[1] };
  }
  
  return { tableName: pathStr, clinicId: null, patientId: null, docId: null };
}

// Generic Database Queries Router
app.post('/api/db', async (req, res) => {
  const { action, path: pathStr, constraints, id, data } = req.body;
  
  const { tableName, clinicId, patientId, docId } = parsePath(pathStr || '');
  
  if (!tableName || !ALLOWED_TABLES.includes(tableName)) {
    return res.status(400).send(`Unauthorized table action for path: ${pathStr}`);
  }

  // Determine actual column support
  const hasClinicId = !['files', 'system_settings', 'announcements', 'superadmin_credentials'].includes(tableName);
  const hasPatientId = ['records', 'appointments', 'prescriptions', 'xrays', 'teeth'].includes(tableName);
  const hasCreatedAt = tableName !== 'files';

  try {
    if (action === 'getAppointmentsCounts') {
      if (!clinicId) {
        return res.status(400).send('ClinicId is required for getAppointmentsCounts');
      }
      const queryStr = `SELECT json_extract(data, '$.date') as date, COUNT(*) as count FROM appointments WHERE clinicId = ? GROUP BY date`;
      const dbResult = await dbClient.execute({ sql: queryStr, args: [clinicId] });
      const counts: Record<string, number> = {};
      dbResult.rows.forEach((row: any) => {
        if (row.date) {
          counts[row.date] = Number(row.count);
        }
      });
      return res.json(counts);
    }

    // 1. GET ALL DOCUMENTS (getDocs)
    if (action === 'getDocs') {
      let queryStr = `SELECT * FROM ${tableName} WHERE 1=1`;
      const args: any[] = [];
      
      if (clinicId && hasClinicId) {
        queryStr += ` AND (clinicId = ? OR json_extract(data, '$.clinicId') = ? OR json_extract(data, '$.clinic_id') = ?)`;
        args.push(clinicId, clinicId, clinicId);
      }
      if (patientId && hasPatientId) {
        queryStr += ` AND (patientId = ? OR json_extract(data, '$.patientId') = ? OR json_extract(data, '$.patient_id') = ?)`;
        args.push(patientId, patientId, patientId);
      }
      
      let orderByStr = '';
      let limitStr = '';
      
      let orderByField: string | null = null;
      let orderByDirection: 'asc' | 'desc' = 'asc';
      let startAfterConstraint: any = null;
      
      if (Array.isArray(constraints)) {
        for (const c of constraints) {
          if (c.type === 'orderBy') {
            orderByField = c.field;
            orderByDirection = c.direction === 'desc' ? 'desc' : 'asc';
          } else if (c.type === 'startAfter') {
            startAfterConstraint = c;
          }
        }
      }

      if (startAfterConstraint && orderByField) {
        const startAfterDoc = startAfterConstraint.docSnap;
        const startDocId = startAfterDoc?.id;
        const startDocData = startAfterDoc?.data;
        let startVal: any = undefined;
        
        if (startDocData) {
          startVal = startDocData[orderByField];
          if (startVal === undefined) {
            const snakeCaseName = orderByField.replace(/([A-Z])/g, "_$1").toLowerCase();
            const camelCaseName = orderByField.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            startVal = startDocData[snakeCaseName] !== undefined ? startDocData[snakeCaseName] : startDocData[camelCaseName];
          }
        }
        
        if (startVal === undefined && startDocId) {
          try {
            const rowResult = await dbClient.execute({
              sql: `SELECT * FROM ${tableName} WHERE id = ?`,
              args: [startDocId]
            });
            if (rowResult.rows.length > 0) {
              const row = rowResult.rows[0];
              const colKeys = Object.keys(row);
              const matchedCol = colKeys.find(k => k.toLowerCase() === orderByField!.toLowerCase());
              if (matchedCol && row[matchedCol] !== null && row[matchedCol] !== undefined) {
                startVal = row[matchedCol];
              } else if (row.data) {
                try {
                  const parsedData = safeParseJson(row.data);
                  startVal = parsedData[orderByField!];
                  if (startVal === undefined) {
                    const snakeCaseName = orderByField!.replace(/([A-Z])/g, "_$1").toLowerCase();
                    const camelCaseName = orderByField!.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
                    startVal = parsedData[snakeCaseName] !== undefined ? parsedData[snakeCaseName] : parsedData[camelCaseName];
                  }
                } catch (e) {}
              }
            }
          } catch (err) {
            console.error('[PostgreSQL startAfter] Fallback fetch error:', err);
          }
        }
        
        const columns = tableSchemas[tableName] || [];
        const isColumn = columns.some(c => c.name.toLowerCase() === orderByField!.toLowerCase());
        const orderCol = isColumn ? orderByField : `json_extract(data, '$.${orderByField}')`;
        const safeVal = startVal !== undefined && startVal !== null ? String(startVal) : '';

        if (startDocId) {
          if (orderByDirection === 'desc') {
            queryStr += ` AND (COALESCE(${orderCol}, '') < ? OR (COALESCE(${orderCol}, '') = ? AND id < ?))`;
            args.push(safeVal, safeVal, startDocId);
          } else {
            queryStr += ` AND (COALESCE(${orderCol}, '') > ? OR (COALESCE(${orderCol}, '') = ? AND id > ?))`;
            args.push(safeVal, safeVal, startDocId);
          }
        } else if (startVal !== undefined && startVal !== null) {
          const compOp = orderByDirection === 'desc' ? '<' : '>';
          queryStr += ` AND COALESCE(${orderCol}, '') ${compOp} ?`;
          args.push(safeVal);
        }
      }
      
      if (Array.isArray(constraints)) {
        for (const c of constraints) {
          if (c.type === 'where') {
            const field = c.field;
            const op = c.op;
            const value = c.value;
            
            let sqlOp = '=';
            if (op === '==' || op === '=') sqlOp = '=';
            else if (op === '<') sqlOp = '<';
            else if (op === '>') sqlOp = '>';
            else if (op === '<=') sqlOp = '<=';
            else if (op === '>=') sqlOp = '>=';
            else if (op === '!=') sqlOp = '!=';
            
            if (field === 'clinicId' || field === 'clinic_id') {
              if (hasClinicId) {
                queryStr += ` AND (clinicId ${sqlOp} ? OR json_extract(data, '$.clinicId') ${sqlOp} ? OR json_extract(data, '$.clinic_id') ${sqlOp} ?)`;
                args.push(value, value, value);
              }
            } else if (field === 'patientId' || field === 'patient_id') {
              if (hasPatientId) {
                queryStr += ` AND (patientId ${sqlOp} ? OR json_extract(data, '$.patientId') ${sqlOp} ? OR json_extract(data, '$.patient_id') ${sqlOp} ?)`;
                args.push(value, value, value);
              }
            } else {
              queryStr += ` AND json_extract(data, '$.${field}') ${sqlOp} ?`;
              args.push(value);
            }
          } else if (c.type === 'orderBy') {
            const columns = tableSchemas[tableName] || [];
            const isColumn = columns.some(col => col.name.toLowerCase() === c.field.toLowerCase());
            const orderCol = isColumn ? c.field : `json_extract(data, '$.${c.field}')`;
            const dirStr = c.direction === 'desc' ? 'DESC' : 'ASC';
            orderByStr = ` ORDER BY COALESCE(${orderCol}, '') ${dirStr}, id ${dirStr}`;
          } else if (c.type === 'limit') {
            limitStr = ` LIMIT ${Number(c.limit)}`;
          }
        }
      }
      
      const sql = queryStr + orderByStr + limitStr;
      const dbResult = await dbClient.execute({ sql, args });
      const items = dbResult.rows.map((row: any) => {
        try {
          const item = safeParseJson(row.data);
          const colData: any = {};
          for (const key of Object.keys(row)) {
            if (key !== 'data' && row[key] !== null && row[key] !== undefined) {
              colData[key] = row[key];
            }
          }
          return { ...colData, ...item, id: row.id || item.id };
        } catch (e) {
          const colData: any = {};
          for (const key of Object.keys(row)) {
            if (key !== 'data' && row[key] !== null && row[key] !== undefined) {
              colData[key] = row[key];
            }
          }
          return { ...colData, id: row.id };
        }
      });
      return res.json(items);
    }
    
    // 2. GET SINGLE DOCUMENT (getDoc)
    if (action === 'getDoc') {
      const finalId = id || docId;
      if (!finalId) {
        return res.status(400).send('Document ID is required');
      }
      const sql = `SELECT * FROM ${tableName} WHERE id = ?`;
      const dbResult = await dbClient.execute({ sql, args: [finalId] });
      if (dbResult.rows.length === 0) {
        return res.json(null);
      }
      try {
        const row = dbResult.rows[0];
        const item = safeParseJson(row.data);
        const colData: any = {};
        for (const key of Object.keys(row)) {
          if (key !== 'data' && row[key] !== null && row[key] !== undefined) {
            colData[key] = row[key];
          }
        }
        return res.json({ ...colData, ...item, id: finalId });
      } catch (e) {
        return res.json(null);
      }
    }
    
    // 3. ADD NEW DOCUMENT (addDoc)
    if (action === 'addDoc') {
      const finalId = data?.id || 'doc_' + Math.random().toString(36).substring(2, 15);
      const targetClinicId = clinicId || data?.clinicId || data?.clinic_id;
      const targetPatientId = patientId || data?.patientId || data?.patient_id;

      const fullData = { ...data, id: finalId };
      if (targetClinicId) fullData.clinicId = targetClinicId;
      if (targetPatientId) fullData.patientId = targetPatientId;
      
      const createdAt = data?.createdAt || new Date().toISOString();
      const { cols, vals } = mapDataToColumns(tableName, finalId, fullData, targetClinicId, targetPatientId, createdAt);
      
      const placeholders = cols.map(() => '?').join(', ');
      let sql = '';
      if (dbClient.getIsPostgres()) {
        const columns = tableSchemas[tableName] || [];
        const pkCol = columns.find(c => c.pk === 1)?.name || (tableName === 'files' ? 'path' : 'id');
        const updateSetParts = cols
          .filter(c => c.toLowerCase() !== pkCol.toLowerCase())
          .map(c => `${c} = EXCLUDED.${c}`)
          .join(', ');
        
        if (updateSetParts) {
          sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO UPDATE SET ${updateSetParts}`;
        } else {
          sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO NOTHING`;
        }
      } else {
        sql = `INSERT OR REPLACE INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`;
      }
      
      await dbClient.execute({ sql, args: vals });

      if (targetClinicId) {
        const evId = 'ev_' + Math.random().toString(36).substring(2, 15);
        broadcastSync(targetClinicId, { eventId: evId, table: tableName, action: 'add', id: finalId, payload: fullData });
        publishSyncEvent(targetClinicId, tableName, 'add', finalId, fullData, evId).then((actualId) => {
          if (actualId) handledEvents.add(actualId);
        });
      }

      return res.json(fullData);
    }
    
    // 4. SET DOCUMENT (setDoc - Overwrite/Create)
    if (action === 'setDoc') {
      const finalId = id || docId || data?.id;
      if (!finalId) {
        return res.status(400).send('Document ID is required for setDoc');
      }
      let finalData = { ...data, id: finalId };
      
      if (req.body.options?.merge) {
        try {
          const selectSql = `SELECT * FROM ${tableName} WHERE id = ?`;
          const selectResult = await dbClient.execute({ sql: selectSql, args: [finalId] });
          if (selectResult.rows.length > 0) {
            const row = selectResult.rows[0];
            let existing: any = {};
            if (row.data) {
              existing = safeParseJson(row.data);
            }
            finalData = { ...row, ...existing, ...data, id: finalId };
          }
        } catch (e) {
          // ignore parsing errors
        }
      }

      const targetClinicId = clinicId || finalData?.clinicId || finalData?.clinic_id || data?.clinicId || data?.clinic_id;
      const targetPatientId = patientId || finalData?.patientId || finalData?.patient_id || data?.patientId || data?.patient_id;
      
      if (targetClinicId) finalData.clinicId = targetClinicId;
      if (targetPatientId) finalData.patientId = targetPatientId;
      
      const createdAt = finalData.createdAt || data?.createdAt || new Date().toISOString();
      const { cols, vals } = mapDataToColumns(tableName, finalId, finalData, targetClinicId, targetPatientId, createdAt);
      
      const placeholders = cols.map(() => '?').join(', ');
      let sql = '';
      if (dbClient.getIsPostgres()) {
        const columns = tableSchemas[tableName] || [];
        const pkCol = columns.find(c => c.pk === 1)?.name || (tableName === 'files' ? 'path' : 'id');
        const updateSetParts = cols
          .filter(c => c.toLowerCase() !== pkCol.toLowerCase())
          .map(c => `${c} = EXCLUDED.${c}`)
          .join(', ');
        
        if (updateSetParts) {
          sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO UPDATE SET ${updateSetParts}`;
        } else {
          sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO NOTHING`;
        }
      } else {
        sql = `INSERT OR REPLACE INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`;
      }
      
      await dbClient.execute({ sql, args: vals });

      if (targetClinicId) {
        const evId = 'ev_' + Math.random().toString(36).substring(2, 15);
        broadcastSync(targetClinicId, { eventId: evId, table: tableName, action: 'set', id: finalId, payload: finalData });
        publishSyncEvent(targetClinicId, tableName, 'set', finalId, finalData, evId).then((actualId) => {
          if (actualId) handledEvents.add(actualId);
        });
      }

      return res.json(finalData);
    }
    
    // 5. UPDATE DOCUMENT (updateDoc)
    if (action === 'updateDoc') {
      const finalId = id || docId;
      if (!finalId) {
        return res.status(400).send('Document ID is required for updateDoc');
      }
      const selectSql = `SELECT * FROM ${tableName} WHERE id = ?`;
      const selectResult = await dbClient.execute({ sql: selectSql, args: [finalId] });
      
      let existing: any = {};
      if (selectResult.rows.length > 0) {
        const row = selectResult.rows[0];
        let parsedData: any = {};
        if (row.data) {
          parsedData = safeParseJson(row.data);
        }
        existing = { ...row, ...parsedData };
      }
      
      const updated = { ...existing, ...data, id: finalId };
      const { cols, vals } = mapDataToColumns(tableName, finalId, updated, clinicId, patientId, updated.createdAt);
      
      const columns = tableSchemas[tableName] || [];
      const pkCol = columns.find(c => c.pk === 1)?.name || 'id';
      
      const setParts: string[] = [];
      const setVals: any[] = [];
      
      for (let i = 0; i < cols.length; i++) {
        if (cols[i].toLowerCase() !== pkCol.toLowerCase()) {
          setParts.push(`${cols[i]} = ?`);
          setVals.push(vals[i]);
        }
      }
      
      setVals.push(finalId);
      const updateSql = `UPDATE ${tableName} SET ${setParts.join(', ')} WHERE ${pkCol} = ?`;
      await dbClient.execute({ sql: updateSql, args: setVals });

      const targetClinicId = clinicId || updated?.clinicId || updated?.clinic_id || data?.clinicId || data?.clinic_id;
      if (targetClinicId) {
        const evId = 'ev_' + Math.random().toString(36).substring(2, 15);
        broadcastSync(targetClinicId, { eventId: evId, table: tableName, action: 'update', id: finalId, payload: updated });
        publishSyncEvent(targetClinicId, tableName, 'update', finalId, updated, evId).then((actualId) => {
          if (actualId) handledEvents.add(actualId);
        });
      }

      return res.json(updated);
    }
    
    // 6. DELETE DOCUMENT (deleteDoc)
    if (action === 'deleteDoc') {
      const finalId = id || docId;
      if (!finalId) {
        return res.status(400).send('Document ID is required');
      }

      // Perform cascading deletes before/after deleting the parent record
      if (tableName === 'clinics') {
        const cascadeTables = [
          'users',
          'patients',
          'appointments',
          'records',
          'prescriptions',
          'custom_medications',
          'custom_categories',
          'inventory',
          'billing',
          'closings',
          'laboratories',
          'lab_orders',
          'lab_work_types',
          'shifts',
          'expenses'
        ];
        for (const t of cascadeTables) {
          try {
            await dbClient.execute({ sql: `DELETE FROM ${t} WHERE clinicId = ?`, args: [finalId] });
            console.log(`[PostgreSQL Cascade] Cleaned up ${t} records for deleted clinic: ${finalId}`);
          } catch (cascadeErr) {
            console.error(`[PostgreSQL Cascade] Error cleaning up ${t} for clinic ${finalId}:`, cascadeErr);
          }
        }
      } else if (tableName === 'patients') {
        const patientCascadeTables = ['records', 'appointments', 'prescriptions', 'xrays', 'teeth'];
        for (const t of patientCascadeTables) {
          try {
            await dbClient.execute({ sql: `DELETE FROM ${t} WHERE patientId = ?`, args: [finalId] });
          } catch (cascadeErr) {
            console.error(`[PostgreSQL Cascade] Error cleaning up ${t} for patient ${finalId}:`, cascadeErr);
          }
        }
        console.log(`[PostgreSQL Cascade] Cleaned up all sub-records for deleted patient: ${finalId}`);
      }

      let deletedData: any = {};
      try {
        const selectSql = `SELECT data FROM ${tableName} WHERE id = ?`;
        const selectResult = await dbClient.execute({ sql: selectSql, args: [finalId] });
        if (selectResult.rows.length > 0) {
          deletedData = safeParseJson(selectResult.rows[0].data);
        }
      } catch (e) {
        // ignore parsing or selection errors
      }

      const sql = `DELETE FROM ${tableName} WHERE id = ?`;
      await dbClient.execute({ sql, args: [finalId] });

      const targetClinicId = clinicId;
      if (targetClinicId) {
        const payloadData = { id: finalId, ...deletedData };
        const evId = 'ev_' + Math.random().toString(36).substring(2, 15);
        broadcastSync(targetClinicId, { eventId: evId, table: tableName, action: 'delete', id: finalId, payload: payloadData });
        publishSyncEvent(targetClinicId, tableName, 'delete', finalId, payloadData, evId).then((actualId) => {
          if (actualId) handledEvents.add(actualId);
        });
      }

      return res.json({ success: true });
    }
    
    res.status(400).send('Invalid action');
  } catch (err: any) {
    console.error('Error in /api/db endpoint:', err);
    res.status(500).send(err.message || 'Database execution error');
  }
});

// Bulk/Batch Database Syncing Endpoint for Offline Processing
app.post('/api/db/batch', async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty batch items' });
  }

  const processedIds: (number | string)[] = [];
  const errors: any[] = [];

  for (const item of items) {
    const { id: itemId, action, path: pathStr, docId, data, options } = item;
    const { tableName, clinicId, patientId, docId: parsedDocId } = parsePath(pathStr || '');

    if (!tableName || !ALLOWED_TABLES.includes(tableName)) {
      errors.push({ itemId, error: `Unauthorized table: ${tableName}` });
      continue;
    }

    try {
      const finalId = docId || parsedDocId || data?.id;

      if (action === 'addDoc' || action === 'setDoc') {
        let fullData = { ...data, id: finalId || ('doc_' + Math.random().toString(36).substring(2, 15)) };
        
        if (action === 'setDoc' && options?.merge && finalId) {
          try {
            const selectSql = `SELECT * FROM ${tableName} WHERE id = ?`;
            const selectResult = await dbClient.execute({ sql: selectSql, args: [finalId] });
            if (selectResult.rows.length > 0) {
              const row = selectResult.rows[0];
              let existing: any = {};
              if (row.data) {
                existing = safeParseJson(row.data);
              }
              fullData = { ...row, ...existing, ...data, id: finalId };
            }
          } catch (e) {
            // ignore select error
          }
        }

        if (clinicId) fullData.clinicId = clinicId;
        if (patientId) fullData.patientId = patientId;

        const createdAt = fullData.createdAt || new Date().toISOString();
        const { cols, vals } = mapDataToColumns(tableName, fullData.id, fullData, clinicId, patientId, createdAt);
        const placeholders = cols.map(() => '?').join(', ');

        let sql = '';
        if (dbClient.getIsPostgres()) {
          const columns = tableSchemas[tableName] || [];
          const pkCol = columns.find(c => c.pk === 1)?.name || (tableName === 'files' ? 'path' : 'id');
          const updateSetParts = cols
            .filter(c => c.toLowerCase() !== pkCol.toLowerCase())
            .map(c => `${c} = EXCLUDED.${c}`)
            .join(', ');

          if (updateSetParts) {
            sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO UPDATE SET ${updateSetParts}`;
          } else {
            sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO NOTHING`;
          }
        } else {
          sql = `INSERT OR REPLACE INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`;
        }

        await dbClient.execute({ sql, args: vals });
        if (itemId !== undefined) processedIds.push(itemId);
      } else if (action === 'updateDoc') {
        if (!finalId) continue;
        const selectSql = `SELECT * FROM ${tableName} WHERE id = ?`;
        const selectResult = await dbClient.execute({ sql: selectSql, args: [finalId] });
        let currentData: any = {};
        if (selectResult.rows.length > 0) {
          const row = selectResult.rows[0];
          let parsedData: any = {};
          if (row.data) {
            parsedData = safeParseJson(row.data);
          }
          currentData = { ...row, ...parsedData };
        }
        const updated = { ...currentData, ...data, id: finalId };
        if (clinicId) updated.clinicId = clinicId;
        if (patientId) updated.patientId = patientId;

        const createdAt = updated.createdAt || new Date().toISOString();
        const { cols, vals } = mapDataToColumns(tableName, finalId, updated, clinicId, patientId, createdAt);
        const placeholders = cols.map(() => '?').join(', ');

        let sql = '';
        if (dbClient.getIsPostgres()) {
          const columns = tableSchemas[tableName] || [];
          const pkCol = columns.find(c => c.pk === 1)?.name || (tableName === 'files' ? 'path' : 'id');
          const updateSetParts = cols
            .filter(c => c.toLowerCase() !== pkCol.toLowerCase())
            .map(c => `${c} = EXCLUDED.${c}`)
            .join(', ');

          if (updateSetParts) {
            sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO UPDATE SET ${updateSetParts}`;
          } else {
            sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO NOTHING`;
          }
        } else {
          sql = `INSERT OR REPLACE INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`;
        }

        await dbClient.execute({ sql, args: vals });
        if (itemId !== undefined) processedIds.push(itemId);
      } else if (action === 'deleteDoc') {
        if (!finalId) continue;
        const sql = `DELETE FROM ${tableName} WHERE id = ?`;
        await dbClient.execute({ sql, args: [finalId] });
        if (itemId !== undefined) processedIds.push(itemId);
      }
    } catch (err: any) {
      console.error(`[Batch Sync Item Error] itemId: ${itemId}`, err);
      errors.push({ itemId, error: err.message || err.toString() });
    }
  }

  return res.json({
    success: true,
    processedIds,
    processedCount: processedIds.length,
    errorsCount: errors.length,
    errors
  });
});

// REST endpoint to retrieve new sync events for clients where EventSource is blocked or unstable
app.get('/api/sync/updates', async (req, res) => {
  const clinicId = req.query.clinicId as string;
  const since = Number(req.query.since || 0);

  if (!clinicId) {
    return res.status(400).send('clinicId query parameter is required');
  }

  try {
    const isSuperAdmin = clinicId === 'superadmin';
    const result = isSuperAdmin
      ? await dbClient.execute({
          sql: `SELECT id, clinic_id, table_name, action, record_id, created_at, payload FROM server_sync_events WHERE created_at > ? ORDER BY created_at ASC`,
          args: [since]
        })
      : await dbClient.execute({
          sql: `SELECT id, clinic_id, table_name, action, record_id, created_at, payload FROM server_sync_events WHERE clinic_id = ? AND created_at > ? ORDER BY created_at ASC`,
          args: [clinicId, since]
        });

    const events = result.rows.map(row => ({
      id: row.id,
      clinicId: row.clinic_id,
      table: row.table_name,
      action: row.action,
      recordId: row.record_id,
      createdAt: Number(row.created_at),
      payload: row.payload ? safeParseJson(row.payload) : undefined
    }));

    res.json(events);
  } catch (err: any) {
    res.status(500).send(err.message || 'Error fetching sync updates');
  }
});

// Authentication endpoints
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).send('Email and password are required');
  }
  const uid = 'user_' + Math.random().toString(36).substring(2, 10);
  res.json({ uid, email });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).send('Email and password are required');
  }
  const emailClean = email.trim().toLowerCase();
  
  try {
    // 1. Search users table for custom credentials
    const result = await dbClient.execute({
      sql: `SELECT id, data FROM users WHERE json_extract(data, '$.email') = ? LIMIT 1`,
      args: [emailClean]
    });
    
    if (result.rows.length === 0) {
      // 2. Search clinics table (for master emails)
      const clinicResult = await dbClient.execute({
        sql: `SELECT id, data FROM clinics WHERE json_extract(data, '$.email') = ? LIMIT 1`,
        args: [emailClean]
      });
      if (clinicResult.rows.length === 0) {
        return res.status(404).send('البريد الإلكتروني غير مسجل في النظام السحابي (Email not registered)');
      }
      const clinic = safeParseJson(clinicResult.rows[0].data);
      return res.json({ uid: clinic.id, email: clinic.email });
    }
    
    const user = safeParseJson(result.rows[0].data);
    res.json({ uid: user.uid || user.id, email: user.email });
  } catch (e: any) {
    console.error('Login error:', e);
    res.status(500).send('Database connection failure during verification');
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

// Ensure local uploads directory exists
const uploadsFolder = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder, { recursive: true });
}
app.use('/uploads', express.static(uploadsFolder));

// Helper to construct R2 File Key according to standard structure: clinics/{clinicId}/{category}/{fileName}
function buildR2FileKey(rawClinicId?: string, rawCategory?: string, rawFolder?: string, fileName?: string): string {
  let clinicId = (rawClinicId || '').trim();
  let category = (rawCategory || '').trim();
  const folder = (rawFolder || '').trim();

  if (folder.startsWith('clinics/')) {
    const parts = folder.split('/').filter(Boolean);
    if (parts.length >= 2 && !clinicId) {
      clinicId = parts[1];
    }
    if (parts.length >= 3 && (!category || category === 'uploads')) {
      category = parts[2];
    }
  }

  const cleanClinicId = (clinicId || 'global').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanCategory = (category || 'attachments').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanName = `${Date.now()}_${(fileName || `file_${Date.now()}`).replace(/[^a-zA-Z0-9.-]/g, '_')}`;

  return `clinics/${cleanClinicId}/${cleanCategory}/${cleanName}`;
}

// Cloudflare R2 Direct Upload Presigned URL Generator
app.post('/api/get-upload-url', async (req, res) => {
  try {
    const { fileName, fileType, folder, category, clinicId } = req.body || {};
    const contentType = fileType || 'application/octet-stream';
    const fileKey = buildR2FileKey(clinicId, category, folder, fileName);
    const { client, bucketName, publicUrlBase } = getR2ClientConfig();

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
    const publicUrl = `${publicUrlBase}/${fileKey}`;

    return res.json({
      uploadUrl,
      publicUrl,
      key: fileKey,
      fileKey
    });
  } catch (error: any) {
    console.error('[Cloudflare R2 Presigned URL Error]', error);
    return res.status(500).json({ error: error.message || 'Error generating presigned R2 upload URL' });
  }
});

app.get('/api/get-upload-url', async (req, res) => {
  try {
    const fileName = req.query.fileName as string;
    const fileType = (req.query.fileType as string) || 'application/octet-stream';
    const folder = req.query.folder as string;
    const category = req.query.category as string;
    const clinicId = req.query.clinicId as string;
    const fileKey = buildR2FileKey(clinicId, category, folder, fileName);
    const { client, bucketName, publicUrlBase } = getR2ClientConfig();

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
    const publicUrl = `${publicUrlBase}/${fileKey}`;

    return res.json({
      uploadUrl,
      publicUrl,
      key: fileKey,
      fileKey
    });
  } catch (error: any) {
    console.error('[Cloudflare R2 Presigned URL Error]', error);
    return res.status(500).json({ error: error.message || 'Error generating presigned R2 upload URL' });
  }
});

// File Uploads Endpoint (Cloudflare R2 Upload with Automatic Local Disk Storage Fallback)
app.post('/api/upload', async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files uploaded');
  }
  
  const fileKey = Object.keys(req.files)[0];
  const uploadedFile = req.files[fileKey] as any;
  const originalName = uploadedFile.name || `file_${Date.now()}.jpg`;
  
  const folder = (req.body && req.body.folder) || (req.query && (req.query.folder as string)) || '';
  const category = (req.body && req.body.category) || (req.query && (req.query.category as string)) || '';
  const clinicId = (req.body && req.body.clinicId) || (req.query && (req.query.clinicId as string)) || '';

  const fileKeyName = buildR2FileKey(clinicId, category, folder, originalName);
  const cleanFileName = path.basename(fileKeyName);

  // Helper to save file locally on disk and DB
  const saveToLocalDisk = async (reason?: string) => {
    try {
      if (!fs.existsSync(uploadsFolder)) {
        fs.mkdirSync(uploadsFolder, { recursive: true });
      }
      const localFilePath = path.join(uploadsFolder, cleanFileName);
      if (uploadedFile.data) {
        fs.writeFileSync(localFilePath, uploadedFile.data);
      } else if (uploadedFile.mv) {
        await uploadedFile.mv(localFilePath);
      }

      const publicUrl = `/api/files?path=${encodeURIComponent(cleanFileName)}`;

      await dbClient.execute({
        sql: `INSERT OR REPLACE INTO files (path, mimeType, data) VALUES (?, ?, ?)`,
        args: [cleanFileName, uploadedFile.mimetype || 'image/png', '']
      });

      console.log(`[File Upload] Saved locally to server disk (${reason || 'local fallback'}). Public URL: ${publicUrl}`);
      return res.json({ path: publicUrl, publicUrl, success: true, mode: 'local' });
    } catch (localErr: any) {
      console.error('[File Upload Local Storage Error]', localErr);
      return res.status(500).send('Could not save uploaded file locally: ' + (localErr.message || localErr.toString()));
    }
  };

  const { client, hasConfiguredR2, bucketName, publicUrlBase } = getR2ClientConfig();

  if (hasConfiguredR2) {
    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKeyName,
        ContentType: uploadedFile.mimetype || 'application/octet-stream',
        Body: uploadedFile.data
      });

      await client.send(command);
      const publicUrl = `${publicUrlBase}/${fileKeyName}`;

      await dbClient.execute({
        sql: `INSERT OR REPLACE INTO files (path, mimeType, data) VALUES (?, ?, ?)`,
        args: [publicUrl, uploadedFile.mimetype || 'image/png', '']
      });

      console.log(`[File Upload R2 Success] File key: ${fileKeyName}, URL: ${publicUrl}`);
      return res.json({ path: publicUrl, publicUrl, key: fileKeyName, success: true, mode: 'r2' });
    } catch (err: any) {
      console.warn('[Cloudflare R2 Storage Warning] R2 upload failed, falling back to local server storage:', err.message || err);
      return await saveToLocalDisk(err.message || 'R2 error');
    }
  } else {
    console.log('[File Upload Info] R2 credentials not configured or missing in env. Saving file to local server storage.');
    return await saveToLocalDisk('R2 credentials not set');
  }
});

// Delete file endpoint (Preserves physical file on Cloudflare R2 to ensure DB backup durability and prevent broken image links)
app.post('/api/delete-file', async (req, res) => {
  const { url, key } = req.body || {};
  let rawInput = key || url;
  
  if (!rawInput || typeof rawInput !== 'string') {
    return res.status(200).json({ success: true, message: 'No file specified for retention processing' });
  }

  let fileKey = String(rawInput).trim();
  console.log(`[Cloudflare R2 Retention] File deletion request received for key/URL: "${fileKey}". Physical deletion on R2 skipped to preserve image files for database backups.`);

  return res.json({ 
    success: true, 
    message: 'File preserved on Cloudflare R2 for backup durability', 
    key: fileKey 
  });
});


// Retrieve uploaded files endpoint (Serves directly from physical disk with database fallback for older entries)
app.get('/api/files', async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).send('File path is required');
  }
  
  try {
    const fileName = path.basename(filePath);
    const fullPath = path.join(process.cwd(), 'uploads', fileName);
    
    // 1. Try to serve from physical disk first (VPS mode)
    if (fs.existsSync(fullPath)) {
      // Fetch mimeType from DB metadata if available
      let mimeType = 'application/octet-stream';
      try {
        const result = await dbClient.execute({
          sql: `SELECT mimeType FROM files WHERE path = ?`,
          args: [filePath]
        });
        if (result.rows.length > 0 && result.rows[0].mimeType) {
          mimeType = String(result.rows[0].mimeType).trim();
        } else {
          // Fallback guess based on file extension
          const ext = path.extname(fileName).toLowerCase();
          if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
          else if (ext === '.gif') mimeType = 'image/gif';
          else if (ext === '.pdf') mimeType = 'application/pdf';
          else if (ext === '.webp') mimeType = 'image/webp';
          else if (ext === '.svg') mimeType = 'image/svg+xml';
        }
      } catch (dbErr) {
        // ignore DB read error, proceed with stream serving
      }
      
      const safeMimeType = (mimeType && typeof mimeType === 'string' && mimeType.trim()) ? mimeType : 'application/octet-stream';
      res.setHeader('Content-Type', safeMimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      const stream = fs.createReadStream(fullPath);
      return stream.pipe(res);
    }
    
    // 2. Fallback: retrieve from database (for backward-compatibility with pre-existing uploads)
    const result = await dbClient.execute({
      sql: `SELECT mimeType, data FROM files WHERE path = ?`,
      args: [filePath]
    });
    
    if (result.rows.length === 0 || !result.rows[0].data) {
      return res.status(404).send('File not found');
    }
    
    const { mimeType: rawMime, data } = result.rows[0] as any;
    const fileBuffer = Buffer.from(data, 'base64');
    
    const safeMimeType = (rawMime && typeof rawMime === 'string' && rawMime.trim()) ? rawMime : 'application/octet-stream';
    res.setHeader('Content-Type', safeMimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(fileBuffer);
  } catch (err: any) {
    console.error('File retrieval physical storage error:', err);
    res.status(500).send('Could not retrieve requested file');
  }
});

// GET /api/superadmin/analytics - Global and Clinic-level Usage Stats
app.get('/api/superadmin/analytics', async (req, res) => {
  try {
    const todayStr = (req.query.today as string) || new Date().toISOString().split('T')[0];
    
    // 1. Fetch clinics from DB
    const clinicsResult = await dbClient.execute("SELECT id, data FROM clinics");
    const totalClinics = clinicsResult.rows.length;
    let activeClinics = 0;
    let inactiveClinics = 0;
    
    // 2. Fetch aggregate stats per clinic
    const patientsCounts = await dbClient.execute("SELECT clinicId, COUNT(*) as count FROM patients GROUP BY clinicId");
    const appointmentsCounts = await dbClient.execute("SELECT clinicId, COUNT(*) as count FROM appointments GROUP BY clinicId");
    const closingsCounts = await dbClient.execute("SELECT clinicId, COUNT(*) as count FROM closings GROUP BY clinicId");
    const shiftsCounts = await dbClient.execute("SELECT clinicId, COUNT(*) as count FROM shifts GROUP BY clinicId");
    
    const patientsMap = new Map(patientsCounts.rows.map(r => [r.clinicId || r.clinicid, Number(r.count)]));
    const appointmentsMap = new Map(appointmentsCounts.rows.map(r => [r.clinicId || r.clinicid, Number(r.count)]));
    const shiftsMap = new Map(shiftsCounts.rows.map(r => [r.clinicId || r.clinicid, Number(r.count)]));
    
    let totalPatients = 0;
    const clinicUsageList: any[] = [];
    
    for (const row of clinicsResult.rows) {
      const id = row.id as string;
      const data = safeParseJson(row.data);
      
      const isActive = data.isActive !== false;
      if (isActive) {
        activeClinics++;
      } else {
        inactiveClinics++;
      }
      
      const numPatients = patientsMap.get(id) || 0;
      totalPatients += numPatients;
      const numAppointments = appointmentsMap.get(id) || 0;
      const numShifts = shiftsMap.get(id) || 0;
      
      clinicUsageList.push({
        id,
        name: data.name || 'عيادة غير مسماة',
        nameAr: data.nameAr || '',
        nameEn: data.nameEn || '',
        doctorName: data.doctorName || 'غير محدد',
        isActive,
        numPatients,
        numAppointments,
        numShifts,
        createdAt: data.createdAt || ''
      });
    }

    // Sort usage list by total patients desc, then total appointments desc
    clinicUsageList.sort((a, b) => b.numPatients - a.numPatients || b.numAppointments - a.numAppointments);

    // 3. Interactive Today's Stats
    // Today's Appointments
    const todayAppointmentsResult = await dbClient.execute({
      sql: `SELECT COUNT(*) as count FROM appointments WHERE json_extract(data, '$.date') = ? OR json_extract(data, '$.appointment_date') = ?`,
      args: [todayStr, todayStr]
    });
    const todayAppointments = Number(todayAppointmentsResult.rows[0]?.count || 0);

    // Today's Prescriptions
    const todayPrescriptionsResult = await dbClient.execute({
      sql: `SELECT COUNT(*) as count FROM prescriptions WHERE createdAt LIKE ? OR json_extract(data, '$.date') = ?`,
      args: [`${todayStr}%`, todayStr]
    });
    const todayPrescriptions = Number(todayPrescriptionsResult.rows[0]?.count || 0);

    // Today's billing/invoice transactions
    const todayBillingResult = await dbClient.execute({
      sql: `SELECT data FROM billing WHERE createdAt LIKE ? OR json_extract(data, '$.date') = ?`,
      args: [`${todayStr}%`, todayStr]
    });
    let todayRevenuesSum = 0;
    let todayRevenuesCount = todayBillingResult.rows.length;
    for (const row of todayBillingResult.rows) {
      const item = safeParseJson(row.data);
      todayRevenuesSum += Number(item.amountPaid || item.paid || item.amount || 0);
    }

    // 4. Total Subscriptions / Renewals Income (مجموع الاشتراكات المدفوعة بالمنظومة)
    let totalSubscriptionsIncome = 0;
    let totalRenewalsCount = 0;
    try {
      const renewalsResult = await dbClient.execute("SELECT id, data FROM renewals");
      for (const row of renewalsResult.rows) {
        let rData = safeParseJson(row.data);
        if (!rData || Object.keys(rData).length === 0) {
          rData = row;
        }
        if (!rData) continue;
        const amt = Number(rData.amount || (row as any).amount || 0);
        if (amt > 0) {
          totalSubscriptionsIncome += amt;
          totalRenewalsCount++;
        }
      }
    } catch (e) {
      console.warn('Error calculating subscription income for analytics:', e);
    }

    res.json({
      globalStats: {
        totalClinics,
        activeClinics,
        inactiveClinics,
        totalPatients,
        todayAppointments,
        todayPrescriptions,
        todayRevenuesSum,
        todayRevenuesCount,
        totalSubscriptionsIncome,
        totalRenewalsCount
      },
      clinicUsage: clinicUsageList
    });
  } catch (err: any) {
    console.error('[Analytics Error] Failed to generate dashboard analytics:', err);
    res.status(500).send(err.message || 'Error compiling analytics');
  }
});

// GET /api/superadmin/income-stats - Income analytics for SuperAdmin based on clinic subscriptions and renewals
app.get('/api/superadmin/income-stats', async (req, res) => {
  try {
    const period = (req.query.period as string) || 'daily';
    const targetDate = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const startDate = (req.query.startDate as string) || targetDate;
    const endDate = (req.query.endDate as string) || targetDate;

    let fromDate = targetDate;
    let toDate = targetDate;

    if (period === 'daily') {
      fromDate = targetDate;
      toDate = targetDate;
    } else if (period === 'weekly') {
      const d = new Date(targetDate);
      d.setDate(d.getDate() - 6);
      fromDate = d.toISOString().split('T')[0];
      toDate = targetDate;
    } else if (period === 'monthly') {
      const yearMonth = targetDate.length >= 7 ? targetDate.substring(0, 7) : targetDate;
      fromDate = `${yearMonth}-01`;
      const [y, m] = yearMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      toDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    } else if (period === 'custom') {
      fromDate = startDate;
      toDate = endDate;
    }

    // 1. Fetch clinics
    const clinicsResult = await dbClient.execute("SELECT id, data FROM clinics");
    const clinicMap = new Map<string, { name: string; doctorName: string; isActive: boolean }>();
    for (const row of clinicsResult.rows) {
      const cData = safeParseJson(row.data) || row;
      clinicMap.set(row.id, {
        name: cData.name || cData.nameAr || 'عيادة غير مسماة',
        doctorName: cData.doctorName || 'دكتور غير محدد',
        isActive: cData.isActive !== false
      });
    }

    const clinicStats = new Map<string, {
      clinicId: string;
      clinicName: string;
      doctorName: string;
      isActive: boolean;
      totalIncome: number;
      totalTransactions: number;
      cash: number;
      card: number;
      instapay: number;
      wallet: number;
    }>();

    clinicMap.forEach((info, cId) => {
      clinicStats.set(cId, {
        clinicId: cId,
        clinicName: info.name,
        doctorName: info.doctorName,
        isActive: info.isActive,
        totalIncome: 0,
        totalTransactions: 0,
        cash: 0,
        card: 0,
        instapay: 0,
        wallet: 0
      });
    });

    const recentTransactions: Array<{
      id: string;
      clinicId: string;
      clinicName: string;
      doctorName: string;
      amount: number;
      method: string;
      date: string;
      notes?: string;
    }> = [];

    const normMethod = (methodStr: string | undefined): 'cash' | 'card' | 'instapay' | 'wallet' => {
      if (!methodStr) return 'cash';
      const m = methodStr.toLowerCase().trim()
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه');
      if (m === 'cash' || m.includes('كاش') || m.includes('نقدي') || m.includes('نقدى')) return 'cash';
      if (m === 'card' || m === 'visa' || m.includes('فيزا') || m.includes('بطاق') || m.includes('كارت') || m.includes('شبك')) return 'card';
      if (m === 'instapay' || m.includes('انستا') || m.includes('اينستا')) return 'instapay';
      if (m === 'wallet' || m.includes('محفظ')) return 'wallet';
      return 'cash';
    };

    // 2. Fetch renewal records (Subscriptions revenue for SuperAdmin)
    const renewalsResult = await dbClient.execute("SELECT id, data FROM renewals");
    for (const row of renewalsResult.rows) {
      let rData = safeParseJson(row.data);
      if (!rData || Object.keys(rData).length === 0) {
        rData = row;
      }
      if (!rData) continue;

      const cId = rData.clinicId || row.clinicId;
      if (!cId) continue;

      const amt = Number(rData.amount || row.amount || 0);
      if (amt <= 0) continue;

      const renewedAt = rData.renewedAt || row.renewedAt || rData.createdAt || row.createdAt || new Date().toISOString();
      const rawMethod = rData.paymentMethod || rData.method || row.paymentMethod || row.method || 'cash';
      const dateOnly = renewedAt ? renewedAt.split('T')[0] : '';

      if (period !== 'all') {
        if (dateOnly < fromDate || dateOnly > toDate) continue;
      }

      const methodKey = normMethod(rawMethod);
      const cInfo = clinicMap.get(cId);
      const cName = rData.clinicName || (cInfo ? cInfo.name : 'عيادة مجهولة');

      let stat = clinicStats.get(cId);
      if (!stat) {
        stat = {
          clinicId: cId,
          clinicName: cName,
          doctorName: cInfo ? cInfo.doctorName : '-',
          isActive: cInfo ? cInfo.isActive : true,
          totalIncome: 0,
          totalTransactions: 0,
          cash: 0,
          card: 0,
          instapay: 0,
          wallet: 0
        };
        clinicStats.set(cId, stat);
      }

      stat.totalIncome += amt;
      stat.totalTransactions += 1;
      if (methodKey === 'cash') stat.cash += amt;
      else if (methodKey === 'card') stat.card += amt;
      else if (methodKey === 'instapay') stat.instapay += amt;
      else if (methodKey === 'wallet') stat.wallet += amt;

      const methodArabic = methodKey === 'cash' ? 'كاش'
        : methodKey === 'card' ? 'فيزا'
        : methodKey === 'instapay' ? 'إنستاباي'
        : 'محفظة إلكترونية';

      recentTransactions.push({
        id: row.id || rData.id || 'ren_' + Math.random().toString(36).substring(2, 9),
        clinicId: cId,
        clinicName: cName,
        doctorName: cInfo ? cInfo.doctorName : '-',
        amount: amt,
        method: methodArabic,
        date: renewedAt,
        notes: rData.notes || ''
      });
    }

    recentTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const clinicIncomeList = Array.from(clinicStats.values());
    clinicIncomeList.sort((a, b) => b.totalIncome - a.totalIncome);

    let totalIncome = 0;
    let totalTransactions = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    let instapayTotal = 0;
    let walletTotal = 0;

    clinicIncomeList.forEach(c => {
      totalIncome += c.totalIncome;
      totalTransactions += c.totalTransactions;
      cashTotal += c.cash;
      cardTotal += c.card;
      instapayTotal += c.instapay;
      walletTotal += c.wallet;
    });

    res.json({
      summary: {
        totalIncome,
        totalTransactions,
        cashTotal,
        cardTotal,
        instapayTotal,
        walletTotal,
        activeClinicsCount: clinicMap.size
      },
      clinicIncomeList,
      recentTransactions: recentTransactions.slice(0, 100)
    });
  } catch (err: any) {
    console.error('Error fetching superadmin subscription income stats:', err);
    res.status(500).send(err.message || 'Error fetching income stats');
  }
});

// GET /api/broadcasts/active - Fetch current system-wide alert/announcement
app.get('/api/broadcasts/active', async (req, res) => {
  try {
    const result = await dbClient.execute("SELECT * FROM announcements WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1");
    if (result.rows.length === 0) {
      return res.json(null);
    }
    const row = result.rows[0] as any;
    return res.json({
      id: row.id,
      content: row.content,
      bgColor: row.bgColor || '#059669',
      textColor: row.textColor || '#ffffff',
      isActive: Number(row.isActive) === 1,
      createdAt: row.createdAt
    });
  } catch (err: any) {
    console.error('Error fetching active broadcast:', err);
    res.status(500).send(err.message || 'Failed to fetch broadcasts');
  }
});

// POST /api/broadcasts - Set/Clear system-wide alert/announcement
app.post('/api/broadcasts', async (req, res) => {
  const { content, bgColor, textColor } = req.body;
  try {
    // Disable any current active announcements
    await dbClient.execute("UPDATE announcements SET isActive = 0");
    
    if (content && content.trim()) {
      const id = 'ann_' + Math.random().toString(36).substring(2, 10);
      const createdAt = new Date().toISOString();
      const bg = (bgColor && typeof bgColor === 'string' ? bgColor.trim() : '') || '#059669';
      const text = (textColor && typeof textColor === 'string' ? textColor.trim() : '') || '#ffffff';

      try {
        await dbClient.execute("ALTER TABLE announcements ADD COLUMN bgColor TEXT");
      } catch (e) {}
      try {
        await dbClient.execute("ALTER TABLE announcements ADD COLUMN textColor TEXT");
      } catch (e) {}

      await dbClient.execute({
        sql: "INSERT INTO announcements (id, content, bgColor, textColor, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        args: [id, content.trim(), bg, text, 1, createdAt]
      });
      return res.json({ id, content: content.trim(), bgColor: bg, textColor: text, isActive: true, createdAt });
    }
    
    return res.json({ success: true, cleared: true });
  } catch (err: any) {
    console.error('Error updating system-wide broadcast:', err);
    res.status(500).send(err.message || 'Failed to update system-wide broadcast');
  }
});

// POST /api/superadmin/login - Verify superadmin login credentials
app.post('/api/superadmin/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'يرجى تقديم البريد الإلكتروني وكلمة المرور' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPass = String(password).trim();

  try {
    const result = await dbClient.execute({
      sql: "SELECT email, password FROM superadmin_credentials WHERE id = 'main'",
      args: []
    });

    if (result.rows.length > 0) {
      const storedEmail = String(result.rows[0].email || '').trim().toLowerCase();
      const storedPass = String(result.rows[0].password || '').trim();
      if (cleanEmail === storedEmail && cleanPass === storedPass) {
        return res.json({ success: true });
      } else {
        return res.json({ success: false, message: 'بيانات اعتماد مدير النظام غير صحيحة' });
      }
    } else {
      // Default credentials before admin ever changes them
      if (cleanEmail === 'admin@crowndent.com' && cleanPass === 'admin123') {
        return res.json({ success: true });
      } else {
        return res.json({ success: false, message: 'بيانات اعتماد مدير النظام غير صحيحة' });
      }
    }
  } catch (err: any) {
    console.error('Error during superadmin login verification:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء التحقق من بيانات مدير النظام' });
  }
});

// GET /api/superadmin/credentials - Get current superadmin email
app.get('/api/superadmin/credentials', async (req, res) => {
  try {
    const result = await dbClient.execute("SELECT email FROM superadmin_credentials WHERE id = 'main'");
    if (result.rows.length > 0) {
      return res.json({ email: result.rows[0].email || 'admin@crowndent.com' });
    }
    return res.json({ email: 'admin@crowndent.com' });
  } catch (err: any) {
    res.status(500).json({ message: 'Error fetching superadmin credentials' });
  }
});

// POST /api/superadmin/credentials - Change superadmin email & password
app.post('/api/superadmin/credentials', async (req, res) => {
  const { currentPassword, newEmail, newPassword } = req.body || {};
  if (!currentPassword || !newEmail || !newPassword) {
    return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة (كلمة المرور الحالية، البريد الجديد، كلمة المرور الجديدة)' });
  }

  const cleanCurrentPass = String(currentPassword).trim();
  const cleanNewEmail = String(newEmail).trim().toLowerCase();
  const cleanNewPass = String(newPassword).trim();

  if (cleanNewPass.length < 6) {
    return res.status(400).json({ success: false, message: 'يجب أن لا تقل كلمة المرور الجديدة عن 6 خانات' });
  }

  try {
    const checkRes = await dbClient.execute("SELECT password FROM superadmin_credentials WHERE id = 'main'");
    let expectedPass = 'admin123';
    if (checkRes.rows.length > 0 && checkRes.rows[0].password) {
      expectedPass = String(checkRes.rows[0].password).trim();
    }

    if (cleanCurrentPass !== expectedPass) {
      return res.status(400).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة!' });
    }

    const updatedAt = new Date().toISOString();
    await dbClient.execute({
      sql: `INSERT OR REPLACE INTO superadmin_credentials (id, email, password, updatedAt) VALUES ('main', ?, ?, ?)`,
      args: [cleanNewEmail, cleanNewPass, updatedAt]
    });

    return res.json({ success: true, email: cleanNewEmail, message: 'تم تحديث بيانات اعتماد مدير النظام بنجاح!' });
  } catch (err: any) {
    console.error('Error changing superadmin credentials:', err);
    res.status(500).json({ success: false, message: 'فشل تغيير بيانات الاعتماد: ' + (err.message || err.toString()) });
  }
});

// Global Express Error Handling Middleware to catch any unhandled exceptions in route handlers
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Global Error Handler] Caught unexpected server-side error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({
    error: 'InternalServerError',
    message: process.env.NODE_ENV === 'production' 
      ? 'حدث خطأ داخلي غير متوقع في الخادم. تم تسجيل الخطأ للمراجعة.' 
      : (err.message || err.toString())
  });
});

// Setup Vite & Static Files Serving
async function startServer() {
  await initDb();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, locate 'dist' dynamically and robustly:
    let distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(path.join(__dirname, 'index.html'))) {
      distPath = __dirname;
    } else if (fs.existsSync(path.join(__dirname, 'dist', 'index.html'))) {
      distPath = path.join(__dirname, 'dist');
    }

    console.log(`[CrownDent API fallback] Production mode: Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CrownDent Server] Multi-Tenant Dental SaaS running on http://localhost:${PORT}`);
  });
}

const isMainFile = process.argv[1] && (process.argv[1].endsWith('api/index.ts') || process.argv[1].endsWith('api/index'));
if (!process.env.VERCEL && isMainFile) {
  startServer();
}

export { app, initDb };
export default app;