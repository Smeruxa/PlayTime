export type AdminNavItem = {
    to: string
    label: string
    hint: string
}

export const ADMIN_NAV: AdminNavItem[] = [
    { to: "/admin/panel", label: "Обзор", hint: "Сводка и статус" },
    { to: "/admin/people", label: "Пользователи", hint: "Поиск, тарифы, блок" },
    { to: "/admin/release-panel", label: "Релизы", hint: "Публикация сборок" },
    { to: "/admin/requests", label: "Тикеты", hint: "Идеи и ошибки" },
    { to: "/admin/report-panel", label: "Жалобы", hint: "Обращения пользователей" },
    { to: "/admin/plans", label: "Тарифы", hint: "Лимиты планов" },
    { to: "/admin/activity", label: "Журнал", hint: "Действия админов" },
    { to: "/admin/system", label: "Система", hint: "Health и сервисы" },
]
