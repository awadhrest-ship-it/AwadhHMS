const tasks = require('./tasks');
module.exports = { ...tasks, supplies: require('./supplies'), reports: require('./reports'), performance: require('./performance').performance };
