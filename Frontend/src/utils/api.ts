export async function login(email: string, password: string) {
    const res = await fetch("https://", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Login failed")
    }
    return res.json()
}

export async function register(username: string, email: string, password: string) {
    const res = await fetch("https:, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
    })
    if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Registration failed")
    }
    return res.json()
}

export async function tokenValid(token: string) {
    const res = await fetch("https:", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
    })
    if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Token validation failed")
    }
    return res.json()
}