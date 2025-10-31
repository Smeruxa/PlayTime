import AnimatedRoutes from "./routes/AnimatedRoutes"
import IncomingCallHandler from "./utils/IncomingCallHandler"
import Titlebar from "./components/Titlebar/Titlebar"
import OpenContentHandler from "./utils/OpenContentHandler"
import { SocketProvider } from "./server/SocketContext"

export default function App() {
    return (
        <div style={{position:"relative", width:"100%", height:"100vh", overflow:"hidden", backgroundColor:"#161616"}}>
            <SocketProvider>
                <Titlebar />
                <IncomingCallHandler />
                <OpenContentHandler />
                <AnimatedRoutes />
            </SocketProvider>
        </div>
    )
}
