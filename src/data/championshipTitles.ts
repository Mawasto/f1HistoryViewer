export const CHAMPIONSHIP_TITLES: Record<string, number> = {
    farina: 1,
    ascari: 2,
    fangio: 5,
    hawthorn: 1,
    brabham: 3,
    hill: 2,
    clark: 2,
    hulme: 1,
    stewart: 3,
    fittipaldi: 2,
    hunt: 1,
    lauda: 3,
    andretti: 1,
    schekter: 1,
    jones: 1,
    piquet: 3,
    prost: 4,
    senna: 3,
    mansell: 1,
    schumacher: 7,
    hakkinen: 2,
    hill_damon: 1,
    villeneuve: 1,
    raikkonen: 1,
    alonso: 2,
    hamilton: 7,
    button: 1,
    vettel: 4,
    rosberg: 1,
    max_verstappen: 4,
}

export const getChampionshipTitles = (driverId: string | undefined): number => {
    if (!driverId) return 0
    const titles = CHAMPIONSHIP_TITLES[driverId]
    return typeof titles === 'number' ? titles : 0
}