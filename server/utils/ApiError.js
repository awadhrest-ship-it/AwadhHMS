class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const bad = (m, d) => new ApiError(400, m, d);
const forbidden = (m = 'You do not have permission to do this') => new ApiError(403, m);
const notFound = (m = 'Not found') => new ApiError(404, m);
const conflict = (m, d) => new ApiError(409, m, d);
module.exports = { ApiError, bad, forbidden, notFound, conflict };
