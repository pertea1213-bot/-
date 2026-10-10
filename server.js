const path = require('path');
const express = require('express');

const authRouter = require('./routes/auth');
const pmRouter = require('./routes/pm');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use('/api/admin', authRouter);
app.use('/api/pm', pmRouter);

// fde-platform 은 자체 서버·DB 를 가진 별도 앱이다. 루트 정적 서빙으로 소스·DB(비밀번호 해시 포함)가 노출되지 않게 막는다.
app.use('/fde-platform', (req, res) => res.status(404).end());

app.use(express.static(path.join(__dirname), { extensions: ['html'], index: 'pm.html' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PM tool server listening on port ${PORT}`);
});
