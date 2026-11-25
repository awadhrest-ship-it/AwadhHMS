const { ApiError } = require('../utils/ApiError');
const notFoundHandler = (req, _res, next) => next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
// Centralised error handler - safe messages, proper status codes.
function errorHandler(err, _req, res, _next) {
  let status = err.status || 500, message = err.message, details = err.details;
  if (err.name === 'ValidationError') { status = 400; message = 'Validation failed'; details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })); }
  else if (err.name === 'CastError') { status = 400; message = `Invalid ${err.path}`; }
  else if (err.code === 11000) { status = 409; message = `Duplicate value for ${Object.keys(err.keyPattern || {}).join(', ') || 'unique field'}`; }
  if (status >= 500) { console.error(err); if (process.env.NODE_ENV === 'production') message = 'Internal server error'; }
  res.status(status).json({ success: false, message, ...(details ? { details } : {}) });
}
module.exports = { notFoundHandler, errorHandler };
