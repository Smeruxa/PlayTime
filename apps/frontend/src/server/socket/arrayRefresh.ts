export function createArrayRefresh<T>(
    emit: (callback: (payload: unknown) => void) => void,
    receive: (rows: T[]) => void,
    exhausted: () => void = () => {}
) {
    let disposed = false
    let active = false
    let dirty = false
    let attempts = 0
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const schedule = (delay: number) => {
        if (disposed || timer) return
        timer = setTimeout(() => {
            timer = undefined
            run()
        }, delay)
    }
    const run = () => {
        if (disposed || active) return
        active = true
        const request = ++generation
        const finish = (payload: unknown) => {
            if (disposed || request !== generation || !active) return
            active = false
            clearTimeout(deadline)
            generation += 1
            if (!Array.isArray(payload)) {
                if (attempts < 3) schedule([250, 500, 1000][attempts++])
                else {
                    attempts = 0
                    dirty = false
                    exhausted()
                }
                return
            }
            attempts = 0
            receive(payload as T[])
            if (dirty) {
                dirty = false
                schedule(75)
            }
        }
        deadline = setTimeout(() => finish(null), 5000)
        emit(finish)
    }
    return {
        refresh(immediate = false) {
            if (disposed) return
            if (active) {
                dirty = true
                return
            }
            if (timer) return
            attempts = 0
            if (immediate) run()
            else schedule(75)
        },
        dispose() {
            disposed = true
            generation += 1
            clearTimeout(timer)
            clearTimeout(deadline)
        }
    }
}
