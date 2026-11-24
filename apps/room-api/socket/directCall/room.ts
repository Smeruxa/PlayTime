export default class Room {
    status: string
    beginer_id: number
    receiver_id: number

    constructor(beginer_id: number, receiver_id: number) {
        this.beginer_id = beginer_id
        this.receiver_id = receiver_id
        this.status = "request_receiver"
    }

    toJSON(): { status: string; beginer_id: number; receiver_id: number } {
        return {
            status: this.status,
            beginer_id: this.beginer_id,
            receiver_id: this.receiver_id
        }
    }
}
