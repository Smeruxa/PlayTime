import AnimatedRoutes from "./routes/AnimatedRoutes"
import IncomingCallHandler from "./utils/IncomingCallHandler"
import Titlebar from "./components/Titlebar/Titlebar"
import OpenContentHandler from "./utils/OpenContentHandler"
import { SocketProvider } from "./server/socketContext"
import { AccountStatusProvider } from "./auth/AccountStatus"

export default function App() {
    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100dvh",
                overflow: "hidden",
                backgroundColor: "#161616",
                display: "flex",
                flexDirection: "column"
            }}
        >
            <Titlebar />
            <SocketProvider>
                <AccountStatusProvider>
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            display: "flex",
                            flexDirection: "column",
                            position: "relative"
                        }}
                    >
                        <IncomingCallHandler />
                        <OpenContentHandler />
                        <div
                            style={{
                                flex: 1,
                                minHeight: 0,
                                display: "flex",
                                flexDirection: "column"
                            }}
                        >
                            <AnimatedRoutes />
                        </div>
                    </div>
                </AccountStatusProvider>
            </SocketProvider>
        </div>
    )
}
