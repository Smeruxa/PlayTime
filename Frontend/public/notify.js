const { ipcRenderer } = require("electron")
const note = document.getElementById("note")
const nameDiv = document.getElementById("name")
const textDiv = document.getElementById("text")
const closeAllBtn = document.getElementById("closeAll")

closeAllBtn.onclick = () => {
    ipcRenderer.send("close-all-notifications")
}

ipcRenderer.on("push-notification", (_, data) => {
    if (notifySound) {
        notifySound.currentTime = 0
        notifySound.play().catch(() => {})
    }

    nameDiv.innerText = data.name
    textDiv.innerText = data.text

    note.style.opacity = 0
    note.style.transform = "translateY(-20px)"
    setTimeout(() => {
        note.style.transition = "opacity 0.5s, transform 0.5s"
        note.style.opacity = 1
        note.style.transform = "translateY(0)"
    }, 10)

    setTimeout(() => {
        note.style.opacity = 0
        note.style.transform = "translateY(-20px)"
    }, 5000)

    note.onclick = () => {
        ipcRenderer.send("notification-clicked", { name: data.name })
    }
})