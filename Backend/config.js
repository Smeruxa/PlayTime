const { Pool } = require('pg')

const pool = new Pool({
    user: '',
    host: 'localhost',
    database: '',
    password: '',
    port: 0
})

const JWT_SECRET = ""

module.exports = { pool, JWT_SECRET}