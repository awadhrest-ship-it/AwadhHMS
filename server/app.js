const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_URL || 'http://localhost:5173').split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));
// Photo uploads arrive as the raw request body (no multipart dependency); validated in services/storage.js
app.use(express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: process.env.UPLOAD_MAX_BYTES || '8mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);
module.exports = app;
