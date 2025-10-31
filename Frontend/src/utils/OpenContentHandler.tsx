import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

export default function OpenContentHandler() {
    const navigate = useNavigate()

    useEffect(() => {
        const handler = (_event: any, data: { name: string }) => {
            navigate("/content", { state: { name: data.name } })
        }

        window.electronAPI?.on("open-content", handler)
        return () => {
            window.electronAPI?.off("open-content", handler)
        }
    }, [navigate])

    return null
}