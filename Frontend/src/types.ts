export type Message = {
    me: boolean;
    text: string;
    data: number;
};

export type UserProps = {
    name: string;
    is_room: boolean;
    id: number;
};

export type MessageType = { 
    id: number, 
    sender_username: string, 
    receiver_username: string, 
    content: string, 
    created_at: string, 
    read: boolean,
    me: boolean 
}

export type CallProps = {
    names: (string | null)[];
    roomId: string;
    incoming: boolean;
};