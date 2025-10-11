const jwt = require("jsonwebtoken")
const { JWT_SECRET } = require("../config")

function authSocket(socket, next) {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error("Authentication error"))
    try {
        const payload = jwt.verify(token, JWT_SECRET)
        socket.user = payload
        next()
    } catch {
        next(new Error("Authentication error"))
    }
}

module.exports = { authSocket }