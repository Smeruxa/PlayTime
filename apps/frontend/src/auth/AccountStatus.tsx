import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useSessionSocket } from "../server/socketContext"
import { tokenValid } from "../utils/api"

export type AccountStatus = {
    id: number
    username: string
    email: string | null
    isGuest: boolean
    registrationPending: boolean
}
const AccountContext = createContext<{ account: AccountStatus | null; reloadAccount: () => Promise<void> }>({
    account: null,
    reloadAccount: async () => {}
})

export function AccountStatusProvider({ children }: { children: ReactNode }) {
    const { token } = useSessionSocket()
    const [state, setState] = useState<{ token: string; account: AccountStatus } | null>(null)
    const request = useRef(0)
    const currentToken = useRef(token)
    currentToken.current = token
    const reloadAccount = useCallback(async () => {
        if (!token) return
        const generation = ++request.current
        const response = await tokenValid(token)
        if (generation === request.current && token === currentToken.current && response.valid && response.user)
            setState({ token, account: response.user })
    }, [token])
    useEffect(() => {
        void reloadAccount().catch(() => {})
        return () => {
            request.current += 1
        }
    }, [reloadAccount])
    return (
        <AccountContext.Provider value={{ account: state?.token === token ? state.account : null, reloadAccount }}>
            {children}
        </AccountContext.Provider>
    )
}

export const useAccountStatus = () => useContext(AccountContext)
