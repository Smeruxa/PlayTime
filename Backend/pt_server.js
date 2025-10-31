const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const authRoutes = require("./routes/auth")
const { authSocket } = require("./middlewares/authMiddleware")

const events = [
    require("./events/friendship"), 
    require("./events/messages"),
    require("./events/rooms/rooms"),
    require("./events/account")
]

const app = express()

app.use(cors({
    origin: "http://localhost:3000",
    credentials: true
}));
app.use(express.json())
app.use("/playtime/auth", authRoutes)

const server = http.createServer(app)

const io = new Server(server, {
    cors: { origin: "*" },
    path: "/playtime/socket.io"
})

io.use(authSocket)

io.on("connection", socket => {
    socket.join(socket.user.id.toString())
    console.log("Client connected", socket.user.username)

    events.forEach((entry) => entry(io, socket))
    socket.on("get:username", (callback) => {
        if (typeof callback === "function") callback(socket.user.username)
    })
    socket.on("disconnect", () => console.log("Client disconnected", socket.user.username))
})

server.listen(8080, () => console.log("Server running on port 8080"))