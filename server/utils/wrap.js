const { ZodError } = require('zod');
const { bad } = require('./ApiError');
module.exports.wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Validate with a zod schema; throws 400 with field messages.
module.exports.parse = (schema, data) => {
  try { return schema.parse(data); } catch (e) {
    if (e instanceof ZodError) throw bad('Validation failed', e.errors.map((x) => ({ field: x.path.join('.'), message: x.message })));
    throw e;
  }
};
module.exports.escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
