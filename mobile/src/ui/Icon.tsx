import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

const paths = {
    chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z M7 9h10M7 13h6',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    person: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2',
    search: 'm21 21-4.5-4.5',
    plus: 'M12 5v14M5 12h14',
    back: 'm15 18-6-6 6-6',
    close: 'm6 6 12 12M6 18 18 6',
    chevron: 'm9 5 7 7-7 7',
    check: 'm5 12 4 4L19 6',
    doubleCheck: 'm2 12 4 4L16 6m-4 10L22 6',
    phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.69 2.79a2 2 0 0 1-.45 2.11L8.08 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.57 2.79.69A2 2 0 0 1 22 16.92Z',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8',
    send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
    attach: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49L13 2.5a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-11 3 3 5-5',
    lock: 'M7 11V7a5 5 0 0 1 10 0v4',
    settings:
        'm12 3 2 3 3 .5.5 3L21 12l-3.5 2.5-.5 3-3 .5-2 3-2-3-3-.5-.5-3L3 12l3.5-2.5.5-3 3-.5 2-3Z',
    room: 'M3 10 12 3l9 7v11H3V10Zm6 11v-7h6v7',
    image: 'm3 17 6-6 4 4 3-3 5 5',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5',
    play: 'm8 5 11 7-11 7V5Z',
    pause: 'M8 5v14M16 5v14',
    pin: 'm16 9 3 3-6 1-1 6-3-3-5-5 6-1 1-6 3 3M8 16l-5 5',
    reply: 'm9 5-7 7 7 7M2 12h12a8 8 0 0 1 8 8',
    edit: 'm16 3 5 5-13 13H3v-5L16 3ZM13 6l5 5',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    copy: 'M8 8V3h13v13h-5',
    download: 'M12 3v12m-5-5 5 5 5-5M3 15v6h18v-6',
    upload: 'M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6',
    logout: 'M9 21H3V3h6M9 12h12m-5-5 5 5-5 5',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
    monitor: 'M8 21h8M12 17v4',
    wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
    smile: 'M8 14s1 3 4 3 4-3 4-3M8 9h.01M16 9h.01',
    volume: 'm11 5-6 4H2v6h3l6 4V5ZM15 8a5 5 0 0 1 0 8M18 5a9 9 0 0 1 0 14',
    mail: 'm3 5 9 7 9-7',
    info: 'M12 11v6M12 7h.01',
    star: 'm12 2 3 6.5 7 .8-5 5 1.5 7-6.5-3.5L5.5 21 7 14.3l-5-5 7-.8L12 2Z',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6',
} as const;
export type IconName = keyof typeof paths | 'more';
export function Icon({
    name,
    size = 22,
    color = colors.text,
}: {
    name: IconName;
    size?: number;
    color?: string;
}) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {name === 'more' ? (
                [5, 12, 19].map((c) => (
                    <Circle
                        key={c}
                        cx={c}
                        cy={12}
                        r={1}
                        fill={color}
                    />
                ))
            ) : (
                <Path d={paths[name]} />
            )}
            {name === 'people' && (
                <Circle
                    cx={9}
                    cy={7}
                    r={4}
                />
            )}
            {name === 'person' && (
                <Circle
                    cx={12}
                    cy={6}
                    r={4}
                />
            )}
            {name === 'search' && (
                <Circle
                    cx={10.5}
                    cy={10.5}
                    r={7.5}
                />
            )}
            {['smile', 'info'].includes(name) && (
                <Circle
                    cx={12}
                    cy={12}
                    r={10}
                />
            )}
            {name === 'settings' && (
                <Circle
                    cx={12}
                    cy={12}
                    r={3}
                />
            )}
            {name === 'lock' && (
                <Rect
                    x={4}
                    y={11}
                    width={16}
                    height={11}
                    rx={2}
                />
            )}
            {name === 'copy' && (
                <Rect
                    x={3}
                    y={8}
                    width={13}
                    height={13}
                    rx={2}
                />
            )}
            {name === 'monitor' && (
                <Rect
                    x={2}
                    y={3}
                    width={20}
                    height={14}
                    rx={2}
                />
            )}
            {['image', 'mail'].includes(name) && (
                <Rect
                    x={3}
                    y={3}
                    width={18}
                    height={18}
                    rx={3}
                />
            )}
            {name === 'image' && (
                <Circle
                    cx={8}
                    cy={8}
                    r={1.5}
                />
            )}
        </Svg>
    );
}
