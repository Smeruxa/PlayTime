import { useCallback } from "react"
import type { Socket } from "socket.io-client"
import { encryptDmPlaintext, fetchFriendDmPublicKey, getDmSecretKey } from "../../dmE2ee"
import { encryptRoomPlaintext } from "../../roomE2ee"
import { ensureRoomSymmetricKey } from "./ensureRoomSymmetricKey"
import { encodeMediaMessage } from "../../mediaEncryption"
import type { MessageOutbox } from "../../messageOutbox"
import type { DisplayMessage } from "../../types"
import { DM_PLAIN_MAX, ROOM_PLAIN_MAX } from "./constants"
import { displayMedia, normalizeOutgoingContent } from "./rowDisplay"
import type { AttachmentSendMeta, VoiceSendMeta } from "./types"

type Options = {
    socket: Socket | null
    outbox: MessageOutbox | null
    chatKey: string
    name: string
    id: number
    disabled?: boolean
    isRoom: boolean
    myName: string | null
    myUserId: number | null
    messages: DisplayMessage[]
    setError: (message: string | null) => void
    stopTyping: () => void
}

export function useQueuedMessageSender({
    socket,
    outbox,
    chatKey,
    name,
    id,
    isRoom,
    disabled = false,
    myName,
    myUserId,
    messages,
    setError,
    stopTyping
}: Options) {
    return useCallback(
        async (
            raw: string,
            replyToId?: number | null,
            voice?: VoiceSendMeta,
            attachment?: AttachmentSendMeta
        ): Promise<boolean> => {
            if (disabled) return false
            setError(null)
            const content = voice
                ? encodeMediaMessage(voice.media)
                : attachment
                  ? encodeMediaMessage(attachment.media)
                  : normalizeOutgoingContent(raw)
            if (content == null || !socket || !outbox || !myName || id <= 0) return false
            const maximum = isRoom ? ROOM_PLAIN_MAX : DM_PLAIN_MAX
            if (content.length > maximum) {
                setError(`Не более ${maximum} символов`)
                return false
            }
            const secretKey = isRoom ? null : getDmSecretKey(myUserId)
            if (!isRoom && !secretKey) {
                setError("Нет ключа шифрования. Обновите страницу.")
                return false
            }
            const replyId = replyToId && replyToId > 0 ? replyToId : undefined
            const reply = messages.find((message) => message.id === replyId)
            const media = {
                ...(voice ? { voiceKey: voice.voiceKey, voiceDurationSec: voice.voiceDurationSec } : {}),
                ...(attachment
                    ? {
                          attachmentKey: attachment.attachmentKey,
                          attachmentMime: attachment.attachmentMime,
                          attachmentFilename: attachment.attachmentFilename,
                          attachmentSize: attachment.attachmentSize
                      }
                    : {})
            }
            outbox.enqueue(
                chatKey,
                {
                    ...displayMedia(
                        content,
                        voice ? { key: voice.voiceKey, durationSec: voice.voiceDurationSec } : undefined,
                        attachment
                            ? {
                                  key: attachment.attachmentKey,
                                  mime: attachment.attachmentMime,
                                  filename: attachment.attachmentFilename,
                                  sizeBytes: attachment.attachmentSize
                              }
                            : undefined
                    ),
                    data: Date.now(),
                    from: myName,
                    read: false,
                    reply: reply
                        ? {
                              id: reply.id,
                              author: reply.from ?? (reply.me ? myName : name),
                              preview: reply.text
                          }
                        : null
                },
                async (signal) => {
                    if (isRoom) {
                        const roomKey = await ensureRoomSymmetricKey(socket, id, myUserId, setError)
                        if (!roomKey) throw new Error("Ключ комнаты недоступен. Обновите чат.")
                        return {
                            roomId: id,
                            content: encryptRoomPlaintext(content, roomKey.key, roomKey.epoch),
                            replyToId: replyId,
                            ...media
                        }
                    }
                    const peerKey = await fetchFriendDmPublicKey(socket, name, signal, id)
                    if (!peerKey || !secretKey) {
                        throw new Error("Ключ собеседника недоступен или изменился. Проверьте уведомление о ключе.")
                    }
                    return {
                        username: name,
                        peerUserId: id,
                        message: encryptDmPlaintext(content, peerKey, secretKey),
                        replyToId: replyId,
                        ...media
                    }
                }
            )
            stopTyping()
            return true
        },
        [
            disabled,
            socket,
            outbox,
            chatKey,
            name,
            id,
            isRoom,
            myName,
            myUserId,
            messages,
            setError,
            stopTyping
        ]
    )
}
