import { AuthView } from "./AuthView"
import { useAuthForm } from "./useAuthForm"

export default function AuthPage() {
    const { setEmail, setPassword, error, loading, handleLogin, navigate } = useAuthForm()
    return (
        <AuthView
            error={error}
            loading={loading}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onLogin={handleLogin}
            onGoRegister={() => navigate("/registration")}
            onChooseMethod={!window.electronAPI ? () => navigate("/") : undefined}
        />
    )
}
