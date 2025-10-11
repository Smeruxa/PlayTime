import AnimatedRoutes from "./routes/AnimatedRoutes"
import IncomingCallHandler from "./utils/IncomingCallHandler/IncomingCallHandler"
import { SocketProvider } from "./server/SocketContext"

export default function App() {
    return (
        <div style={{position:"relative", width:"100%", height:"100vh", overflow:"hidden", backgroundColor:"#161616"}}>
            <SocketProvider>
                <IncomingCallHandler />
                <AnimatedRoutes />
            </SocketProvider>
        </div>
    )
}
