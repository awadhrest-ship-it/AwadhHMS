require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { runMigrations } = require('./index');
connectDB().then(() => runMigrations({ log: (r) => console.log('Migration complete (safe to re-run):', r) })).then(() => mongoose.disconnect()).catch((e) => { console.error(e); process.exit(1); });
