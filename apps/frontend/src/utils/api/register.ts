import { API_BASE } from "../../config"
import { fetchAuthJson } from "./requestDeadline"

export async function register(username: string, email: string, password: string) {
    const { response: res, body } = await fetchAuthJson(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
    })
    if (!res.ok) {
        throw new Error(body.error || "Registration failed")
    }
    return body
}
