const { Schema, model } = require('mongoose');
const Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));
// next('RES', 4) -> "RES-0001"
Counter.next = async (key, pad = 4, prefix = key) => {
  const c = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(c.seq).padStart(pad, '0')}`;
};
module.exports = Counter;
