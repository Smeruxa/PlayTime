import React from "react"
import ReactDOM from "react-dom/client"
import "./index.css"
import App from "./App"

import { HashRouter as Router } from "react-router-dom"

document.documentElement.dataset.runtime = window.electronAPI ? "desktop" : "web"

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement)

root.render(
    <React.StrictMode>
        <Router>
            <App />
        </Router>
    </React.StrictMode>
)
