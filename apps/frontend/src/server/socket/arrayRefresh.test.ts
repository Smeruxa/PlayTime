import { createArrayRefresh } from "./arrayRefresh"
afterEach(() => jest.useRealTimers())
test("one in-flight request coalesces duplicate events, rejects object ACKs and stops after three retries", () => {
    jest.useFakeTimers()
    const callbacks: ((payload: unknown) => void)[] = []
    const receive = jest.fn(),
        exhausted = jest.fn()
    const refresh = createArrayRefresh<number>((callback) => callbacks.push(callback), receive, exhausted)
    refresh.refresh(true)
    refresh.refresh()
    refresh.refresh()
    expect(callbacks).toHaveLength(1)
    for (let attempt = 0; attempt < 4; attempt += 1) {
        callbacks[attempt]({ err: "budget" })
        jest.advanceTimersByTime(1000)
    }
    expect(callbacks).toHaveLength(4)
    expect(receive).not.toHaveBeenCalled()
    expect(exhausted).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(30_000)
    expect(callbacks).toHaveLength(4)
    refresh.dispose()
})
