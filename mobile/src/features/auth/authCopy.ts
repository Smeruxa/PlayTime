import type { AuthMode } from './hooks/useAuthentication';

export function authCopy(mode: AuthMode, done: boolean, sent: boolean) {
    switch (mode) {
        case 'login':
            return {
                title: 'Свои люди.\nВсегда рядом.',
                eyebrow: 'РАЗГОВОРЫ БЕЗ РАССТОЯНИЙ',
                description: 'Чаты, голос и ваши комнаты — теперь в кармане.',
                submit: 'Войти',
            };
        case 'register':
            return {
                title: 'Начните\nс разговора.',
                eyebrow: 'НОВЫЙ АККАУНТ',
                description: 'Один аккаунт на компьютере и телефоне.',
                submit: 'Создать аккаунт',
            };
        case 'verify':
            return {
                title: done ? 'Почта\nподтверждена.' : 'Проверьте\nсвою почту.',
                eyebrow: 'ПОДТВЕРЖДЕНИЕ ПОЧТЫ',
                description: done
                    ? 'Можно войти в аккаунт с вашим паролем.'
                    : 'Введите 6 цифр из письма. Код действует 15 минут.',
                submit: 'Подтвердить почту',
            };
        case 'recovery':
            return {
                title: done ? 'Доступ\nвосстановлен.' : 'Вернём вас\nк разговорам.',
                eyebrow: 'ВОССТАНОВЛЕНИЕ ДОСТУПА',
                description: done
                    ? 'Можно войти в аккаунт с вашим паролем.'
                    : sent
                    ? 'Если аккаунт существует, код уже отправлен. Проверьте также папку Спам.'
                    : 'Отправим код для смены пароля.',
                submit: sent ? 'Сохранить новый пароль' : 'Отправить код',
            };
    }
}
