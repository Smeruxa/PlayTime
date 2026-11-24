export type BannerParticleKind = 'sakura' | 'snow' | 'stars' | 'ember';
export type BannerParticleData = {
    x: number;
    y: number;
    drift: number;
    radius: number;
    duration: number;
    phase: number;
    color: string;
};

export function bannerParticles(kind: BannerParticleKind): BannerParticleData[] {
    const count = kind === 'stars' ? 10 : kind === 'sakura' ? 12 : 14;
    const colors =
        kind === 'sakura'
            ? ['#FFC0D8', '#FFB7D4', '#FFE0EC', '#FF9EC4', '#FFD0E5']
            : kind === 'ember'
            ? ['#FFC878', '#FFA050', '#FFDC8C', '#FFB45A']
            : kind === 'stars'
            ? ['#2EE7FF', '#FFFFFF', '#6EC8FF', '#FFF8DC']
            : ['#FFFFFF', '#D8ECFF'];
    return Array.from({ length: count }, (_, index) => ({
        x: 30 + ((index * 83) % 540),
        y: 42 + ((index * 47) % 135),
        drift: (index % 2 ? -1 : 1) * (18 + (index % 5) * 5),
        radius:
            kind === 'sakura'
                ? 7 + (index % 4)
                : kind === 'snow'
                ? 4 + (index % 3)
                : 1.5 + (index % 4) * 0.35,
        duration: (kind === 'ember' ? 5000 : kind === 'stars' ? 6500 : 10000) + (index % 5) * 850,
        phase: (0.25 + index * 0.137) % 0.9,
        color: colors[index % colors.length],
    }));
}
