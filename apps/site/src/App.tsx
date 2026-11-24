import { lazy, Suspense } from "react"
import { useSiteVisit } from "./analytics/useSiteVisit"
import SiteLoading from "./SiteLoading"
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"))
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"))
const AdminTicketsPage = lazy(() => import("./pages/AdminTicketsPage"))
const AdminReportsPage = lazy(() => import("./pages/AdminReportsPage"))
import { Routes, Route, Navigate } from "react-router-dom"
const LandingPage = lazy(() => import("./pages/LandingPage"))
const LoginPage = lazy(() => import("./pages/LoginPage"))
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"))
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"))
const AdminPlansPage = lazy(() => import("./pages/AdminPlansPage"))
const AdminAuditPage = lazy(() => import("./pages/AdminAuditPage"))
const AdminSystemPage = lazy(() => import("./pages/AdminSystemPage"))
const ReleasesAdminPage = lazy(() => import("./pages/ReleasesAdminPage"))
const LegalPage = lazy(() => import("./pages/LegalPage"))

export default function App() {
    useSiteVisit()
    return (
        <Suspense fallback={<SiteLoading />}>
            <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/legal/terms" element={<LegalPage kind="terms" />} />
                <Route path="/legal/privacy" element={<LegalPage kind="privacy" />} />
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/feedback" element={<FeedbackPage />} />
                <Route path="/admin/requests" element={<AdminTicketsPage />} />
                <Route path="/login" element={<Navigate to="/admin" replace />} />
                <Route path="/admin" element={<LoginPage />} />
                <Route path="/admin/panel" element={<AdminDashboardPage />} />
                <Route path="/admin/people" element={<AdminUsersPage />} />
                <Route path="/admin/plans" element={<AdminPlansPage />} />
                <Route path="/admin/report-panel" element={<AdminReportsPage />} />
                <Route path="/admin/activity" element={<AdminAuditPage />} />
                <Route path="/admin/system" element={<AdminSystemPage />} />
                <Route path="/admin/release-panel" element={<ReleasesAdminPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Suspense>
    )
}
