export const MAX_SCREEN_FRAME_LENGTH = 1_500_000
const screenDataUrl = /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/]+={0,2}(?![\s\S])/i

export function isValidScreenFrame(frame: unknown): frame is string {
    return typeof frame === "string" && frame.length <= MAX_SCREEN_FRAME_LENGTH && screenDataUrl.test(frame)
}
