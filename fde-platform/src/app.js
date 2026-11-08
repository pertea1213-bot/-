'use strict';
const path = require('path');
const express = require('express');
const { createApi } = require('./api');

function createApp({ db, clock, isProd = false, demoPassword = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', createApi(db, { clock, isProd, demoPassword }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: isProd ? '1h' : 0 }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.status === 400)) return res.status(400).json({ error: '요청 본문(JSON) 형식이 올바르지 않습니다.' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: '요청이 너무 큽니다.' });
    console.error(err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });
  return app;
}

module.exports = { createApp };
