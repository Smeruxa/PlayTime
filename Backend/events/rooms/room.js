class Room {
    status = "created"
    beginer_id
    receiver_id

    constructor(beginer_id, receiver_id) {
        this.beginer_id = beginer_id
        this.receiver_id = receiver_id
        this.status = "request_receiver"
    }

    toJSON() {
        return {
            status: this.status,
            beginer_id: this.beginer_id,
            receiver_id: this.receiver_id
        }
    }
}

module.exports = Room