from unittest import TestCase

from gateway_failover import GatewayFailover


class TestGatewayFailover(TestCase):
    def test_requires_two_consecutive_failures_and_healthy_alternate(self):
        health = GatewayFailover()
        self.assertIsNone(health.record("primary", {"primary": False, "secondary": True}, 1))
        self.assertEqual(health.record("primary", {"primary": False, "secondary": True}, 2), "secondary")

    def test_never_selects_failed_or_once_healthy_alternate(self):
        health = GatewayFailover()
        for tick in range(8):
            self.assertIsNone(health.record("primary", {"primary": False, "secondary": False}, tick))
        self.assertIsNone(health.record("primary", {"primary": False, "secondary": True}, 9))
        self.assertIsNone(health.record("primary", {"primary": False, "secondary": False}, 10))

    def test_active_recovery_clears_consecutive_failures(self):
        health = GatewayFailover()
        self.assertIsNone(health.record("primary", {"primary": False, "secondary": True}, 1))
        self.assertIsNone(health.record("primary", {"primary": True, "secondary": True}, 2))
        self.assertIsNone(health.record("primary", {"primary": False, "secondary": True}, 3))

    def test_failback_after_30_seconds_of_stable_primary(self):
        health = GatewayFailover()
        for tick in range(10):
            self.assertIsNone(health.record("secondary", {"primary": True, "secondary": True}, tick))
        self.assertIsNone(health.record("secondary", {"primary": False, "secondary": True}, 10))
        self.assertIsNone(health.record("secondary", {"primary": True, "secondary": True}, 11))
        self.assertIsNone(health.record("secondary", {"primary": True, "secondary": True}, 40.99))
        self.assertEqual(health.record("secondary", {"primary": True, "secondary": True}, 41), "primary")

    def test_failure_of_secondary_can_return_traffic_early(self):
        health = GatewayFailover()
        self.assertIsNone(health.record("secondary", {"primary": True, "secondary": False}, 1))
        self.assertEqual(health.record("secondary", {"primary": True, "secondary": False}, 2), "primary")
