const path = require('path');
const express = require('express');

const authRouter = require('./routes/auth');
const pmRouter = require('./routes/pm');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use('/api/admin', authRouter);
app.use('/api/pm', pmRouter);

app.use(express.static(path.join(__dirname), { extensions: ['html'], index: 'pm.html' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PM tool server listening on port ${PORT}`);
});
