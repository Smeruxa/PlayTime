import type { ComponentType } from "react"
import {
    IconBell,
    IconEnvelope,
    IconMic,
    IconPhone,
    IconPlusSquare,
    IconScreen,
    IconSend,
    IconShield,
    IconUsers,
} from "../icons/PlayTimeIcons"

type IconComponent = ComponentType<{ className?: string; size?: number }>

export type ShowcaseFeature = {
    icon: IconComponent
    title: string
    text: string
    points: readonly string[]
    variant: "chat" | "voice" | "screen"
}

export type ShowcaseExtra = {
    icon: IconComponent
    title: string
    text: string
}

export const showcaseFeatures: readonly ShowcaseFeature[] = [
    {
        icon: IconEnvelope,
        title: "Комнаты и личные диалоги",
        text: "Общий чат команды или разговор один на один — всё в одном списке, с поиском и превью последних сообщений.",
        points: ["Комнаты с историей и реакциями", "Личные диалоги с онлайн-статусом", "Поиск по переписке"],
        variant: "chat",
    },
    {
        icon: IconPhone,
        title: "Звонки в один клик",
        text: "Личный созвон или группа в комнате — прямо из шапки чата, без перехода в другой сервис.",
        points: ["Групповой эфир в комнате", "Микрофон и завершение звонка", "Видно, кто сейчас в эфире"],
        variant: "voice",
    },
    {
        icon: IconScreen,
        title: "Совместная работа",
        text: "Покажите экран во время разговора — обсудите задачу, не переключая окна.",
        points: ["Демонстрация рабочего стола", "Мини-превью эфира", "Всё в том же окне PlayTime"],
        variant: "screen",
    },
]

export const showcaseExtras: readonly ShowcaseExtra[] = [
    {
        icon: IconMic,
        title: "Голосовые сообщения",
        text: "Запишите голос прямо в чате — когда быстрее сказать, чем писать.",
    },
    {
        icon: IconShield,
        title: "Личные диалоги",
        text: "Разговоры один на один доступны только участникам.",
    },
    {
        icon: IconUsers,
        title: "Друзья и профили",
        text: "Контакты, аватары и статусы — видно, кто на связи.",
    },
    {
        icon: IconBell,
        title: "Уведомления",
        text: "Настройте оповещения для комнат и личных чатов.",
    },
    {
        icon: IconPlusSquare,
        title: "Комнаты по приглашению",
        text: "Создайте комнату и добавьте только нужных людей.",
    },
    {
        icon: IconSend,
        title: "Быстрая отправка",
        text: "Сообщения, вложения и эмодзи — в одной строке ввода.",
    },
]
