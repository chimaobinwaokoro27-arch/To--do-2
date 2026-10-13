import express from 'express';

const app = express();
app.use(express.json());

app.post('/test-body', (req, res) => {
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('Body type:', typeof req.body);
  res.json({ 
    received: req.body,
    hasBody: !!req.body,
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length']
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
