import { useEffect, useState } from 'react';
import type { CallController } from '../CallController';
import type { CallSnapshot } from '../types';

export function useCallSnapshot(controller: CallController): CallSnapshot {
    const [snapshot, setSnapshot] = useState(controller.snapshot);
    useEffect(() => controller.subscribe(setSnapshot), [controller]);
    return snapshot;
}
