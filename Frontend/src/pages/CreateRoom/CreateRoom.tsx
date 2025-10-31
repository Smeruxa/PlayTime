import styles from "./CreateRoom.module.css"
import { useNavigate } from "react-router-dom"
import { useSocket } from "../../server/SocketContext"
import { useState } from "react"

export default function CreateRoom() {
    const navigate = useNavigate()
    const { socket } = useSocket()
    const [name, setName] = useState<string | null>(null)

    const createParty = () => {
        if (!socket || !name) return 

        socket.emit("room:create")
    }

    return ( 
        <div className={styles.body}>
            <div className={styles.card}>
                <span className={styles.title}>Создать комнату</span>
                <div className={styles.contentWrapper}>
                    <div className={styles.content}>
                        <input 
                            placeholder="Введите название комнаты" 
                            className={styles.input} 
                            maxLength={15} 
                            onChange={(e: React.ChangeEvent<Element>) => {
                                //setName(e.)
                            }}
                        />
                        <div className={styles.buttonsWrapper}>
                            <button className={styles.button} onClick={createParty}>Создать</button>
                            <button className={styles.button} onClick={() => navigate("/content")}>Отмена</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}