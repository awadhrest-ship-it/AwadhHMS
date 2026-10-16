require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');

if (!process.env.JWT_SECRET) { console.error('JWT_SECRET is not set. Copy server/.env.example to server/.env'); process.exit(1); }
const PORT = process.env.PORT || 5000;
connectDB().then(() => app.listen(PORT, () => console.log(`Awadh Palace HMS API on http://localhost:${PORT}`)))
  .catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
