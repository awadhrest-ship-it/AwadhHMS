const { Schema, model } = require('mongoose');
module.exports = model('Permission', new Schema({
  code: { type: String, unique: true, required: true }, label: String, module: String,
}));
