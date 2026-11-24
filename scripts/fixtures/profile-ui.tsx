import { useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom"
import type { Socket } from "socket.io-client"
import { SessionContext, PresenceContext, socketContextDefaultValue } from "../../apps/frontend/src/server/socketContext/context"
import { getPlanLimits, type PlanSlug } from "../../apps/shared/subscription/planCatalog"
import { visibleAvatarEffect, visibleBannerEffect } from "../../apps/shared/subscription/profileCustomization"
import type { UserPublicProfile } from "../../apps/frontend/src/types"
import { AppShell } from "../../apps/frontend/src/ui/layout/AppShell"
import { ConversationList } from "../../apps/frontend/src/ui/layout/ConversationList"
import ProfilePage from "../../apps/frontend/src/pages/Profile/ProfilePage"
import FriendsPage from "../../apps/frontend/src/pages/Friends/FriendsPage"
import { ChatHeader } from "../../apps/frontend/src/features/chat/components/ChatHeader"
import { ProfileDrawer } from "../../apps/frontend/src/ui/layout/ProfileDrawer"
import UserProfileModal from "../../apps/frontend/src/components/UserProfileModal/UserProfileModal"
import { useDmPeerHeaderProfile } from "../../apps/frontend/src/features/chat/hooks/useDmPeerHeaderProfile"
import { useFriendsAvatars } from "../../apps/frontend/src/pages/Friends/useFriendsAvatars"
import { useTalkParticipantAvatars } from "../../apps/frontend/src/pages/Talk/Remake/hooks/useTalkParticipantAvatars"
import DirectCallParticipants from "../../apps/frontend/src/pages/Talk/Remake/components/DirectCallParticipants"
import "../../apps/frontend/src/index.css"

const profiles: Record<string, UserPublicProfile> = Object.fromEntries(
    ["alex", "mira"].map((username) => [
        username,
        {
            username,
            email: username === "alex" ? "alex@example.test" : undefined,
            status: "На связи",
            bio: "Музыка, игры и хорошие разговоры.",
            avatar: null,
            profileBanner: null,
            profileAvatarEffect: "orbit",
            profileBannerEffect: "sakura",
            profileBannerSticker: "heart_eyes",
            createdAt: "2026-01-12T12:00:00.000Z",
            isSelf: username === "alex"
        }
    ])
)
const friends = [{ id: 2, friend_username: "mira", status: "accepted", is_room: false }]
const noIncoming: never[] = []
const noOutgoing: string[] = []
const listeners = new Map<string, Set<(...args: any[]) => void>>()
const updates: unknown[] = []
const accountActions: { event: string; data: unknown }[] = []
const accountFixture = new URLSearchParams(window.location.search).has("account")
let failSave = false
let currentPlan: PlanSlug = "pro"
let viewerUsername = "alex"
function receive(event: string, ...args: unknown[]) {
    listeners.get(event)?.forEach((callback) => callback(...args))
}
const socket = {
    connected: true,
    on(event: string, callback: (...args: any[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(callback)
        return this
    },
    off(event: string, callback: (...args: any[]) => void) {
        listeners.get(event)?.delete(callback)
        return this
    },
    emit(event: string, data: any, callback?: (response: any) => void) {
        setTimeout(() => {
            if (event === "profile:get") {
                const username = data?.username || "alex"
                const profile = { ...profiles[username] }
                const limits = getPlanLimits(username === "alex" ? currentPlan : "pro")
                profile.isSelf = username === viewerUsername
                if (!profile.isSelf) delete profile.email
                profile.profileAvatarEffect = visibleAvatarEffect(limits, profile.profileAvatarEffect)
                profile.profileBannerEffect = visibleBannerEffect(limits, profile.profileBannerEffect)
                if (!limits.profileBannerAllowed) profile.profileBanner = null
                if (!limits.profileBannerAllowed || !limits.profileBannerEffectsAllowed) {
                    profile.profileBannerSticker = "none"
                }
                callback?.({ profile })
            } else if (event === "profile:update") {
                updates.push(data)
                if (failSave) return callback?.({ success: false, err: "Не удалось сохранить профиль" })
                Object.assign(profiles.alex, data)
                profiles.alex.status = String(data.status ?? "")
                    .trim()
                    .slice(0, 120)
                profiles.alex.bio = String(data.bio ?? "")
                    .trim()
                    .slice(0, 1000)
                for (const key of ["avatar", "profileBanner"]) if (profiles.alex[key] === "") profiles.alex[key] = null
                callback?.({ success: true })
                receive("profile:updated", { username: "alex" })
            } else if (event === "profile:friendsAvatars")
                callback?.(
                    Object.fromEntries(
                        Object.entries(profiles).map(([name, profile]) => [
                            name,
                            { avatar: profile.avatar, profileAvatarEffect: profile.profileAvatarEffect }
                        ])
                    )
                )
            else if (event === "friend:list") callback?.(friends)
            else if (event === "friend:outgoingList") callback?.([])
            else if (event === "room:list") callback?.([])
            else if (event === "profile:setDmPublicKey") callback?.({ success: true })
            else if (event === "user:changePassword" || event === "user:deleteAccount") {
                accountActions.push({ event, data })
                callback?.(
                    event === "user:changePassword" && data.currentPassword === "current-test-password"
                        ? { success: true }
                        : { success: false, err: "Неверный пароль" }
                )
            }
        }, 30)
        return this
    }
} as unknown as Socket

function Conversation() {
    const [drawer, setDrawer] = useState(false)
    const [modal, setModal] = useState(false)
    const visual = useDmPeerHeaderProfile(socket, "mira", true)
    const { avatarMap, avatarsReady } = useTalkParticipantAvatars(socket)
    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
            <ChatHeader
                name="mira"
                is_room={false}
                startCallError={null}
                onStartCall={() => setModal(true)}
                onStartRoomVoice={() => {}}
                onOpenRoomSettings={() => {}}
                onOpenFriendProfile={() => setDrawer(true)}
                dmHeaderVisual={visual}
            />
            <div style={{ padding: 24 }}>
                <DirectCallParticipants
                    names={["mira", "alex"]}
                    myName="alex"
                    valueSound={100}
                    setValueSound={() => {}}
                    avatarByUsername={avatarMap}
                    stageReady={avatarsReady}
                />
            </div>
            <ProfileDrawer open={drawer} username="mira" onClose={() => setDrawer(false)} />
            {modal && <UserProfileModal username="mira" onClose={() => setModal(false)} />}
        </div>
    )
}

function Fixture() {
    const location = useLocation()
    const [plan, setPlan] = useState<PlanSlug>("pro")
    const [inspection, setInspection] = useState<"drawer" | "modal" | null>(null)
    const { avatarByUsername } = useFriendsAvatars(socket, friends as any, noIncoming, noOutgoing)
    Object.assign(window, {
        profileUi: {
            updates,
            accountActions,
            setPlan: (value: PlanSlug) => {
                currentPlan = value
                setPlan(value)
            },
            inspectSelf: (surface: "drawer" | "modal" | null) => {
                viewerUsername = surface ? "mira" : "alex"
                setInspection(surface)
            },
            failSave: (value: boolean) => {
                failSave = value
            },
            update: (username: string, patch: Partial<UserPublicProfile>) => {
                Object.assign(profiles[username], patch)
                receive("profile:updated", { username })
            },
            receive,
            listenerCount: () => Object.fromEntries([...listeners].map(([event, callbacks]) => [event, callbacks.size]))
        }
    })
    return (
        <SessionContext.Provider
            value={{
                ...socketContextDefaultValue,
                socket,
                myName: inspection ? "mira" : "alex",
                myUserId: 1,
                token: accountFixture ? "isolated-account-fixture" : null,
                planSlug: plan,
                planLimits: getPlanLimits(plan)
            }}
        >
            <PresenceContext.Provider value={new Set(["mira"])}>
                <AppShell
                    showConversationList={location.pathname === "/content"}
                    conversationList={
                        <ConversationList
                            users={[{ id: 2, name: "mira", is_room: false }]}
                            selected={0}
                            avatarByUsername={avatarByUsername}
                            setUser={() => {}}
                            setSelected={() => {}}
                        />
                    }
                    onOpenSettings={() => {}}
                    onLogout={() => {}}
                >
                    <Routes>
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route path="/friends" element={<FriendsPage />} />
                        <Route path="/content" element={<Conversation />} />
                    </Routes>
                </AppShell>
                {inspection === "drawer" ? (
                    <ProfileDrawer
                        open
                        username="alex"
                        onClose={() => {
                            viewerUsername = "alex"
                            setInspection(null)
                        }}
                    />
                ) : null}
                {inspection === "modal" ? (
                    <UserProfileModal
                        username="alex"
                        onClose={() => {
                            viewerUsername = "alex"
                            setInspection(null)
                        }}
                    />
                ) : null}
            </PresenceContext.Provider>
        </SessionContext.Provider>
    )
}

createRoot(document.getElementById("root")!).render(
    <MemoryRouter initialEntries={["/profile"]}>
        <Fixture />
    </MemoryRouter>
)
