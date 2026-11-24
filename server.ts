import 'dotenv/config';
import express from 'express';
import app from './api/index';
import { initDb, closeDatabase } from './api/index';
import path from 'path';
import fs from 'fs';

const SHUTDOWN_TIMEOUT_MS = process.env.SHUTDOWN_TIMEOUT_MS ? parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) : 10000;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function startServer() {
  try {
    // Local server-side database initialization
    await initDb();
  } catch (dbError) {
    console.error('[CrownDent Server] Database initialization failed on startup:', dbError);
  }

  try {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      // In production, locate 'dist' dynamically and robustly:
      // 1. Try __dirname (if server.cjs is bundled inside dist/)
      // 2. Try path.join(__dirname, '..', 'dist') (if bundled inside dist-server/ parallel to dist/)
      // 3. Try path.join(__dirname, 'dist') (if running server.js/ts from app root)
      // 4. Fallback to path.join(process.cwd(), 'dist')
      let distPath = path.join(process.cwd(), 'dist');
      if (fs.existsSync(path.join(__dirname, 'index.html'))) {
        distPath = __dirname;
      } else if (fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))) {
        distPath = path.join(__dirname, '..', 'dist');
      } else if (fs.existsSync(path.join(__dirname, 'dist', 'index.html'))) {
        distPath = path.join(__dirname, 'dist');
      }

      console.log(`[CrownDent Server] Production mode: Serving static files from: ${distPath}`);

      // Keep non-production hosts (demo/staging) out of search-engine indexes:
      // only the real site should rank, and demo content is test data.
      // Hosts come from NOINDEX_HOSTS (comma-separated), defaulting to the demo.
      const noindexHosts = (process.env.NOINDEX_HOSTS || 'demo.coredentsys.cloud')
        .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      app.use((req, res, next) => {
        if (noindexHosts.includes((req.hostname || '').toLowerCase())) {
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        }
        next();
      });

      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[CrownDent Server] Multi-Tenant Dental SaaS running on http://localhost:${PORT}`);
    });

    const { initWebSocketServer } = await import('./api/index');
    const wss = initWebSocketServer(server);

    // Graceful shutdown: stop accepting new connections, let in-flight requests
    // finish (bounded by SHUTDOWN_TIMEOUT_MS), close the DB pool, then exit.
    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[CrownDent Server] ${signal} received. Draining in-flight requests...`);

      const forceTimer = setTimeout(() => {
        console.error('[CrownDent Server] Drain timeout reached. Forcing exit.');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceTimer.unref();

      // Close realtime sync sockets so they don't hold the server open
      wss.clients.forEach((client) => client.close(1001, 'server shutting down'));
      wss.close();

      // Stop accepting new connections; the callback fires once active requests end
      server.close(async () => {
        try {
          await closeDatabase();
        } catch (e) {
          console.error('[CrownDent Server] Error closing database pool:', e);
        }
        console.log('[CrownDent Server] Shutdown complete.');
        process.exit(0);
      });
      // Idle keep-alive connections would otherwise delay the close
      server.closeIdleConnections();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    server.on('error', (err) => {
      console.error('[CrownDent Server] Express listener encountered an error:', err);
    });
  } catch (serverError) {
    console.error('[CrownDent Server] Failed to start server:', serverError);
  }
}

startServer();
