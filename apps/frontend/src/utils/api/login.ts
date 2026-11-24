import { API_BASE } from "../../config"
import { fetchAuthJson } from "./requestDeadline"
export class EmailVerificationRequired extends Error {}

export async function login(email: string, password: string) {
    const { response: res, body } = await fetchAuthJson(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-PlayTime-Device": `${window.electronAPI ? "PlayTime" : "PlayTime Web"} - ${navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : "Linux"}`
        },
        credentials: "include",
        body: JSON.stringify({ email, password })
    })
    if (!res.ok) {
        if (body.verificationRequired) throw new EmailVerificationRequired(body.error)
        throw new Error(body.error || "Login failed")
    }
    return body
}
