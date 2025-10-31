const Redis = require("ioredis")
const { Pool } = require("pg")
const redis = new Redis()

const pool = new Pool({
    user: '',
    host: '',
    database: '',
    password: '',
    port: 0
})

const JWT_SECRET = ""
module.exports = { pool, JWT_SECRET, redis }