import 'dotenv/config';
import express from 'express';
import app from './api/index';
import { initDb } from './api/index';
import path from 'path';
import fs from 'fs';

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
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[CrownDent Server] Multi-Tenant Dental SaaS running on http://localhost:${PORT}`);
    });

    const { initWebSocketServer } = await import('./api/index');
    initWebSocketServer(server);

    server.on('error', (err) => {
      console.error('[CrownDent Server] Express listener encountered an error:', err);
    });
  } catch (serverError) {
    console.error('[CrownDent Server] Failed to start server:', serverError);
  }
}

startServer();
