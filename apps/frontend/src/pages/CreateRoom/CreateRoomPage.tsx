import type { ChangeEvent } from "react"
import { CreateRoomView } from "./CreateRoomView"
import { useCreateRoom } from "./useCreateRoom"

export default function CreateRoomPage() {
    const { name, setName, error, createParty, navigate } = useCreateRoom()
    return (
        <CreateRoomView
            name={name}
            error={error}
            onNameChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onCreate={createParty}
            onCancel={() => navigate("/content")}
        />
    )
}
