from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping


Slot = Literal["primary", "secondary"]
SLOTS: tuple[Slot, Slot] = ("primary", "secondary")


@dataclass
class ProbeStreak:
    successes: int = 0
    failures: int = 0
    healthy_since: float | None = None

    def record(self, healthy: bool, now: float) -> None:
        if healthy:
            if self.healthy_since is None:
                self.healthy_since = now
            self.successes += 1
            self.failures = 0
        else:
            self.successes = 0
            self.failures += 1
            self.healthy_since = None


class GatewayFailover:
    def __init__(self, failures: int = 2, successes: int = 2, failback_seconds: float = 30) -> None:
        self.failures = failures
        self.successes = successes
        self.failback_seconds = failback_seconds
        self.streaks = {slot: ProbeStreak() for slot in SLOTS}

    def record(self, active: Slot, probes: Mapping[Slot, bool], now: float) -> Slot | None:
        for slot in SLOTS:
            self.streaks[slot].record(probes[slot], now)
        alternate = "primary" if active == "secondary" else "secondary"
        current, candidate = self.streaks[active], self.streaks[alternate]
        if current.failures >= self.failures and candidate.successes >= self.successes:
            return alternate
        if (
            active == "secondary"
            and current.successes >= self.successes
            and candidate.successes >= self.successes
            and candidate.healthy_since is not None
            and now - candidate.healthy_since >= self.failback_seconds
        ):
            return "primary"
        return None
