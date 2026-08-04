const path = require('path');
const express = require('express');

const { router: appointmentsRouter } = require('./routes/appointments');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use('/api/admin', adminRouter);
app.use('/api', appointmentsRouter);

app.use(express.static(path.join(__dirname), { extensions: ['html'], index: 'consulting-booking.html' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Consulting schedule server listening on port ${PORT}`);
});
