import { useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useSessionSocket, useCallState } from "../../server/socketContext"
import Talk from "./Remake/Talk"
import type { CallProps } from "../../types"
import Loading from "../../components/Loading/Loading"

type LocationState = {
    name?: string
    roomId?: string | number
    incoming?: boolean
    isParty?: boolean
    roomName?: string
}

export default function TalkPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { myName } = useSessionSocket()
    const { setActiveCall } = useCallState()
    const state = location.state as LocationState | null

    const isParty = state?.isParty === true && state?.roomId != null
    const hasCallState = isParty || (state?.name != null && state?.roomId != null)
    const canRender = hasCallState && myName != null

    useEffect(() => {
        if (!hasCallState) {
            navigate("/content", { replace: true })
        }
    }, [hasCallState, navigate])

    if (!state) {
        return null
    }

    if (!canRender) {
        return hasCallState ? <Loading /> : null
    }

    const call: CallProps = isParty
        ? {
              names: [state.roomName ?? "Комната", myName],
              roomId: Number(state.roomId),
              incoming: false,
              isParty: true
          }
        : {
              names: [state.name!, myName],
              roomId: state.roomId!,
              incoming: state.incoming ?? false
          }

    return <Talk call={call} setShow={() => navigate("/content", { replace: true })} setActiveCall={setActiveCall} />
}
