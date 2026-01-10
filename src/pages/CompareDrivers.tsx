import { useEffect, useMemo, useState } from 'react'

type Driver = {
    driverId: string
    givenName: string
    familyName: string
    dateOfBirth?: string
    permanentNumber?: string
    code?: string
    nationality?: string
}

const DRIVER_CACHE_KEY = 'allDrivers_cache_v3'
const DRIVER_STATS_CACHE_PREFIX = 'driver_stats_cache_v3_'
const ACTIVE_STATUS_CACHE_PREFIX = 'active_driver_ids_'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

async function fetchJsonWithBackoff(url: string, maxRetries = 6, baseDelay = 600): Promise<any> {
    let attempt = 0
    while (attempt < maxRetries) {
        const res = await fetch(url)
        if (res.status === 429) {
            await sleep(baseDelay * (attempt + 1))
            attempt++
            continue
        }
        if (!res.ok) throw new Error(`Request failed: ${url}`)
        return res.json()
    }
    throw new Error(`Request repeatedly rate-limited: ${url}`)
}

async function fetchPaginatedRaces(urlBuilder: (offset: number, limit: number) => string): Promise<any[]> {
    const limit = 100
    let offset = 0
    let total = Infinity
    const races: any[] = []

    while (offset === 0 || offset < total) {
        const url = urlBuilder(offset, limit)
        const data = await fetchJsonWithBackoff(url)
        const mr = data?.MRData
        total = parseInt(mr?.total ?? '0', 10) || 0
        const page = mr?.RaceTable?.Races ?? []
        races.push(...page)

        offset += limit
        await sleep(500)
    }

    return races
}

async function fetchDriversRateLimited(): Promise<Driver[]> {
    const cached = sessionStorage.getItem(DRIVER_CACHE_KEY)
    if (cached) {
        try {
            const parsed = JSON.parse(cached)
            if (Array.isArray(parsed)) return parsed
        } catch {}
    }

    const limit = 100
    let offset = 0
    let total = Infinity
    const all: Driver[] = []

    while (offset === 0 || offset < total) {
        let attempt = 0
        let success = false

        while (attempt < 6 && !success) {
            const url = `https://api.jolpi.ca/ergast/f1/drivers/?limit=${limit}&offset=${offset}`
            const res = await fetch(url)
            if (res.status === 429) {
                await sleep(600 * (attempt + 1))
                attempt++
                continue
            }
            if (!res.ok) throw new Error(`Failed to fetch drivers at offset ${offset}`)

            const data = await res.json()
            const mr = data?.MRData
            total = parseInt(mr?.total ?? '0', 10) || 0
            const drivers: Driver[] = mr?.DriverTable?.Drivers ?? []
            all.push(...drivers)
            success = true
        }

        if (!success) throw new Error('Driver list request was repeatedly rate-limited. Please try again soon.')
        offset += limit
        await sleep(500)
    }

    try { sessionStorage.setItem(DRIVER_CACHE_KEY, JSON.stringify(all)) } catch {}
    return all
}

type ConstructorBreakdown = {
    constructorId: string
    name: string
    races: number
    wins: number
    points: number
    firstSeason: number
    firstRound: number
}

type DriverCareerStats = {
    racesStarted: number
    wins: number
    poles: number
    seasons: number
    pointsBySeason: Record<string, number>
    constructorBreakdown: ConstructorBreakdown[]
}

type ActiveLookup = { ids: Set<string>; constructorByDriver: Record<string, string> }

async function fetchActiveDriverIds(): Promise<ActiveLookup> {
    const currentYear = new Date().getFullYear()
    const seasonsToTry = ['current', String(currentYear - 1)]

    for (const season of seasonsToTry) {
        const cacheKey = `${ACTIVE_STATUS_CACHE_PREFIX}${season}`
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) {
            try {
                const parsed: { ids: string[]; constructors: Record<string, string> } = JSON.parse(cached)
                if (parsed?.ids && Array.isArray(parsed.ids) && parsed.constructors) {
                    return { ids: new Set(parsed.ids), constructorByDriver: parsed.constructors }
                }
            } catch {}
        }

        const data = await fetchJsonWithBackoff(`https://api.jolpi.ca/ergast/f1/${season}/last/results.json`)
        const races: any[] = data?.MRData?.RaceTable?.Races ?? []
        if (!Array.isArray(races) || races.length === 0) continue

        const results: any[] = races[0]?.Results ?? []
        const constructors: Record<string, string> = {}
        const ids = results
            .map((r) => {
                const id = r?.Driver?.driverId
                const constructorName = r?.Constructor?.name
                if (id && constructorName) constructors[id] = constructorName
                return id
            })
            .filter((id): id is string => Boolean(id))

        const unique = Array.from(new Set(ids))
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ ids: unique, constructors })) } catch {}
        return { ids: new Set(unique), constructorByDriver: constructors }
    }

    throw new Error('No recent race results available to determine active drivers.')
}

async function fetchDriverCareerStats(driverId: string): Promise<DriverCareerStats> {
    const cacheKey = `${DRIVER_STATS_CACHE_PREFIX}${driverId}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
        try {
            return JSON.parse(cached)
        } catch {}
    }

    const resultsRaces = await fetchPaginatedRaces((offset, limit) =>
        `https://api.jolpi.ca/ergast/f1/drivers/${driverId}/results.json?limit=${limit}&offset=${offset}`
    )

    const qualifyingRaces = await fetchPaginatedRaces((offset, limit) =>
        `https://api.jolpi.ca/ergast/f1/drivers/${driverId}/qualifying.json?limit=${limit}&offset=${offset}`
    )

    const pointsBySeason: Record<string, number> = {}
    let wins = 0
    const constructorMap: Record<string, ConstructorBreakdown> = {}

    for (const race of resultsRaces) {
        const result = Array.isArray(race?.Results) ? race.Results[0] : undefined
        if (!result) continue
        const season = race?.season
        const round = race?.round
        const seasonNum = Number(season)
        const roundNum = Number(round)
        const seasonRank = Number.isFinite(seasonNum) ? seasonNum : Number.MAX_SAFE_INTEGER
        const roundRank = Number.isFinite(roundNum) ? roundNum : Number.MAX_SAFE_INTEGER

        if (season) {
            const pts = parseFloat(result.points ?? '0') || 0
            pointsBySeason[season] = (pointsBySeason[season] ?? 0) + pts
        }
        if (result.position === '1') wins++

        const cid = result?.Constructor?.constructorId ?? result?.Constructor?.name ?? 'unknown'
        const cname = result?.Constructor?.name ?? cid
        if (!constructorMap[cid]) {
            constructorMap[cid] = {
                constructorId: cid,
                name: cname,
                races: 0,
                wins: 0,
                points: 0,
                firstSeason: seasonRank,
                firstRound: roundRank,
            }
        } else {
            const existing = constructorMap[cid]
            const isEarlier =
                seasonRank < existing.firstSeason ||
                (seasonRank === existing.firstSeason && roundRank < existing.firstRound)
            if (isEarlier) {
                existing.firstSeason = seasonRank
                existing.firstRound = roundRank
            }
        }
        constructorMap[cid].races += 1
        constructorMap[cid].points += parseFloat(result.points ?? '0') || 0
        if (result.position === '1') constructorMap[cid].wins += 1
    }

    let poles = 0
    for (const race of qualifyingRaces) {
        const quali = Array.isArray(race?.QualifyingResults) ? race.QualifyingResults[0] : undefined
        if (!quali) continue
        if (quali.position === '1') poles++
    }

    const seasons = Object.keys(pointsBySeason).length
    const stats: DriverCareerStats = {
        racesStarted: resultsRaces.length,
        wins,
        poles,
        seasons,
        pointsBySeason,
        constructorBreakdown: Object.values(constructorMap).sort((a, b) => {
            if (a.firstSeason !== b.firstSeason) return a.firstSeason - b.firstSeason
            return a.firstRound - b.firstRound
        }),
    }

    try { sessionStorage.setItem(cacheKey, JSON.stringify(stats)) } catch {}
    return stats
}

const CompareDrivers = () => {
    const [drivers, setDrivers] = useState<Driver[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [nameA, setNameA] = useState('')
    const [nameB, setNameB] = useState('')
    const [statsA, setStatsA] = useState<DriverCareerStats | null>(null)
    const [statsB, setStatsB] = useState<DriverCareerStats | null>(null)
    const [statsLoadingA, setStatsLoadingA] = useState(false)
    const [statsLoadingB, setStatsLoadingB] = useState(false)
    const [statsErrorA, setStatsErrorA] = useState('')
    const [statsErrorB, setStatsErrorB] = useState('')
    const [isActiveA, setIsActiveA] = useState<boolean | null>(null)
    const [isActiveB, setIsActiveB] = useState<boolean | null>(null)
    const [activeError, setActiveError] = useState('')
    const [activeConstructorA, setActiveConstructorA] = useState('')
    const [activeConstructorB, setActiveConstructorB] = useState('')

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            setError('')
            try {
                const list = await fetchDriversRateLimited()
                const sorted = list.slice().sort((a, b) => {
                    const nameA = `${a.givenName} ${a.familyName}`.toLowerCase()
                    const nameB = `${b.givenName} ${b.familyName}`.toLowerCase()
                    return nameA.localeCompare(nameB)
                })
                if (!cancelled) setDrivers(sorted)
            } catch {
                if (!cancelled) setError('Failed to load drivers. Please retry in a moment.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [])

    const selectedA = useMemo(() => {
        const target = nameA.trim().toLowerCase()
        if (!target) return undefined
        return drivers.find((d) => `${d.givenName} ${d.familyName}`.toLowerCase() === target)
    }, [drivers, nameA])

    const selectedB = useMemo(() => {
        const target = nameB.trim().toLowerCase()
        if (!target) return undefined
        return drivers.find((d) => `${d.givenName} ${d.familyName}`.toLowerCase() === target)
    }, [drivers, nameB])

    useEffect(() => {
        const driverId = selectedA?.driverId
        if (!driverId) {
            setStatsA(null)
            setStatsErrorA('')
            setStatsLoadingA(false)
            return
        }

        let cancelled = false
        ;(async () => {
            setStatsLoadingA(true)
            setStatsErrorA('')
            try {
                const career = await fetchDriverCareerStats(driverId)
                if (!cancelled) setStatsA(career)
            } catch {
                if (!cancelled) setStatsErrorA('Failed to load driver stats. Please retry in a moment.')
            } finally {
                if (!cancelled) setStatsLoadingA(false)
            }
        })()

        return () => { cancelled = true }
    }, [selectedA])

    useEffect(() => {
        const driverId = selectedB?.driverId
        if (!driverId) {
            setStatsB(null)
            setStatsErrorB('')
            setStatsLoadingB(false)
            return
        }

        let cancelled = false
        ;(async () => {
            setStatsLoadingB(true)
            setStatsErrorB('')
            try {
                const career = await fetchDriverCareerStats(driverId)
                if (!cancelled) setStatsB(career)
            } catch {
                if (!cancelled) setStatsErrorB('Failed to load driver stats. Please retry in a moment.')
            } finally {
                if (!cancelled) setStatsLoadingB(false)
            }
        })()

        return () => { cancelled = true }
    }, [selectedB])

    useEffect(() => {
        if (!selectedA && !selectedB) return
        let cancelled = false
        ;(async () => {
            setActiveError('')
            try {
                const activeLookup = await fetchActiveDriverIds()
                if (!cancelled) {
                    setIsActiveA(selectedA ? activeLookup.ids.has(selectedA.driverId) : null)
                    setIsActiveB(selectedB ? activeLookup.ids.has(selectedB.driverId) : null)
                    setActiveConstructorA(selectedA ? activeLookup.constructorByDriver[selectedA.driverId] ?? '' : '')
                    setActiveConstructorB(selectedB ? activeLookup.constructorByDriver[selectedB.driverId] ?? '' : '')
                }
            } catch {
                if (!cancelled) setActiveError('Could not determine active status.')
            }
        })()
        return () => { cancelled = true }
    }, [selectedA, selectedB])

    const ready = selectedA && selectedB

    const renderDriverBlock = (label: string, driver: Driver | undefined, stats: DriverCareerStats | null, statsLoading: boolean, statsError: string, isActive: boolean | null, activeConstructor: string) => (
        <div style={{ flex: 1, minWidth: '320px' }}>
            <h3>{label}</h3>
            {driver ? (
                <>
                    <h4>{driver.givenName} {driver.familyName}</h4>
                    <p><strong>Date of birth:</strong> {driver.dateOfBirth ?? 'N/A'}</p>
                    {driver.permanentNumber && <p><strong>Number:</strong> {driver.permanentNumber}</p>}
                    {driver.code && <p><strong>Code:</strong> {driver.code}</p>}
                    {driver.nationality && <p><strong>Nationality:</strong> {driver.nationality}</p>}
                    {isActive !== null && !activeError && <p><strong>Status:</strong> {isActive ? 'Active' : 'Retired'}</p>}
                    {isActive && activeConstructor && <p><strong>Constructor:</strong> {activeConstructor}</p>}
                    {activeError && <p style={{ color: 'red' }}>{activeError}</p>}
                    {statsLoading && <p>Loading career stats…</p>}
                    {statsError && <p style={{ color: 'red' }}>{statsError}</p>}
                    {stats && !statsLoading && !statsError && (
                        <div style={{ marginTop: '0.75rem' }}>
                            <p><strong>Races started:</strong> {stats.racesStarted}</p>
                            <p><strong>Wins:</strong> {stats.wins}</p>
                            <p><strong>Pole positions:</strong> {stats.poles}</p>
                            <p><strong>Seasons raced:</strong> {stats.seasons}</p>
                            <div style={{ marginTop: '0.5rem' }}>
                                <strong>Points by season:</strong>
                                <ul style={{ marginTop: '0.25rem' }}>
                                    {Object.entries(stats.pointsBySeason)
                                        .sort(([a], [b]) => Number(a) - Number(b))
                                        .map(([season, pts]) => (
                                            <li key={season}>{season}: {pts}</li>
                                        ))}
                                </ul>
                            </div>
                            <div style={{ marginTop: '0.75rem' }}>
                                <strong>Performance by constructor:</strong>
                                <ul style={{ marginTop: '0.25rem' }}>
                                    {stats.constructorBreakdown.map((c) => (
                                        <li key={c.constructorId}>
                                            {c.name} — races: {c.races}, points: {c.points}, wins: {c.wins}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <p>Select a driver to view details.</p>
            )}
        </div>
    )

    return (
        <div>
            <h2>Compare Drivers</h2>
            {loading && <p>Loading driver list…</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                <div>
                    <label htmlFor="driver-a-input" style={{ fontWeight: 600 }}>Driver A:</label>
                    <input
                        id="driver-a-input"
                        list="driver-options"
                        value={nameA}
                        onChange={(e) => setNameA(e.target.value)}
                        placeholder="Start typing a driver name"
                        style={{ marginLeft: '0.5rem', minWidth: '240px', padding: '6px' }}
                    />
                </div>
                <div>
                    <label htmlFor="driver-b-input" style={{ fontWeight: 600 }}>Driver B:</label>
                    <input
                        id="driver-b-input"
                        list="driver-options"
                        value={nameB}
                        onChange={(e) => setNameB(e.target.value)}
                        placeholder="Start typing a driver name"
                        style={{ marginLeft: '0.5rem', minWidth: '240px', padding: '6px' }}
                    />
                </div>
                <datalist id="driver-options">
                    {drivers.map((d) => {
                        const fullName = `${d.givenName} ${d.familyName}`
                        return (
                            <option key={d.driverId} value={fullName}>{fullName}</option>
                        )
                    })}
                </datalist>
            </div>

            {ready ? (
                <div style={{ marginTop: '1rem', display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {renderDriverBlock('Driver A', selectedA, statsA, statsLoadingA, statsErrorA, isActiveA, activeConstructorA)}
                    {renderDriverBlock('Driver B', selectedB, statsB, statsLoadingB, statsErrorB, isActiveB, activeConstructorB)}
                </div>
            ) : (
                <p style={{ marginTop: '1rem' }}>Select both drivers to compare.</p>
            )}
        </div>
    )
}

export default CompareDrivers
