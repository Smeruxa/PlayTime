import { RegistrationView } from "./RegistrationView"
import { useRegistrationForm } from "./useRegistrationForm"

export default function RegistrationPage() {
    const f = useRegistrationForm()
    return (
        <RegistrationView
            username={f.username}
            email={f.email}
            error={f.error}
            loading={f.loading}
            successText={f.successText}
            fadeOut={f.fadeOut}
            countdown={f.countdown}
            legalAccepted={f.legalAccepted}
            onLegalAcceptedChange={f.setLegalAccepted}
            onUsernameChange={f.setUsername}
            onEmailChange={f.setEmail}
            onPasswordChange={f.setPassword}
            onPasswordRepeatChange={f.setPasswordRepeat}
            onRegister={f.handleRegistration}
            onBack={() => f.navigate("/")}
        />
    )
}
