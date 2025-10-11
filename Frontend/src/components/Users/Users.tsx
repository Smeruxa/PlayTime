import styles from "./Users.module.css"
import User from "../User/User"
import { UserProps } from "../../types"

interface UsersProps {
    setUser: (index: number) => void,
    users: UserProps[]
}

export default function Users({ setUser, users }: UsersProps) {
    return (
        <div className={styles.users}>
            {users.length > 0 ? (
                users.map((user, index) => (
                    <User
                        key={index}
                        name={user.name}
                        message={user.messages[0]?.text}
                        onClick={() => setUser(index)}
                    />
                ))
            ) : (
                <span>Нет друзей :(</span>
            )}
        </div>
    )
}