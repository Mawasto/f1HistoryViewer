import { useEffect, useMemo, useState } from 'react'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Tooltip,
    Legend,
    Title,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { getChampionshipTitles } from '../data/championshipTitles'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Title)

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
const DRIVER_STATS_CACHE_PREFIX = 'driver_stats_cache_v4_'
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
        if (!res.ok) {
            throw new Error(`Request failed: ${url}`)
        }
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
    // try cache first
    const cached = sessionStorage.getItem(DRIVER_CACHE_KEY)
    if (cached) {
        try {
            const parsed = JSON.parse(cached)
            if (Array.isArray(parsed)) return parsed
        } catch {
            // ignore broken cache
        }
    }

    // Keep limit at 100 as requested; paginate through all pages.
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
                // back off on throttling and retry
                await sleep(600 * (attempt + 1))
                attempt++
                continue
            }
            if (!res.ok) {
                throw new Error(`Failed to fetch drivers at offset ${offset}`)
            }

            const data = await res.json()
            const mr = data?.MRData
            total = parseInt(mr?.total ?? '0', 10) || 0
            const drivers: Driver[] = mr?.DriverTable?.Drivers ?? []
            all.push(...drivers)
            success = true
        }

        if (!success) {
            throw new Error('Driver list request was repeatedly rate-limited. Please try again soon.')
        }

        offset += limit
        // gentle pacing to stay under burst rate
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
    avgFinish: number | null
    avgQualifying: number | null
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
            } catch {
                // ignore broken cache
            }
        }

        const data = await fetchJsonWithBackoff(`https://api.jolpi.ca/ergast/f1/${season}/last/results.json`)
        const races: any[] = data?.MRData?.RaceTable?.Races ?? []
        if (!Array.isArray(races) || races.length === 0) {
            // No races yet this season; try previous season
            continue
        }

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
        } catch {
            // ignore broken cache
        }
    }

    const resultsRaces = await fetchPaginatedRaces((offset, limit) =>
        `https://api.jolpi.ca/ergast/f1/drivers/${driverId}/results.json?limit=${limit}&offset=${offset}`
    )

    const qualifyingRaces = await fetchPaginatedRaces((offset, limit) =>
        `https://api.jolpi.ca/ergast/f1/drivers/${driverId}/qualifying.json?limit=${limit}&offset=${offset}`
    )

    const pointsBySeason: Record<string, number> = {}
    let wins = 0
    let finishPosSum = 0
    let finishPosCount = 0
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

        const finishPos = Number(result.position)
        if (Number.isFinite(finishPos)) {
            finishPosSum += finishPos
            finishPosCount += 1
        }

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
    let qualiPosSum = 0
    let qualiPosCount = 0
    for (const race of qualifyingRaces) {
        const quali = Array.isArray(race?.QualifyingResults) ? race.QualifyingResults[0] : undefined
        if (!quali) continue
        if (quali.position === '1') poles++
        const qualiPos = Number(quali.position)
        if (Number.isFinite(qualiPos)) {
            qualiPosSum += qualiPos
            qualiPosCount += 1
        }
    }

    const seasons = Object.keys(pointsBySeason).length
    const stats: DriverCareerStats = {
        racesStarted: resultsRaces.length,
        wins,
        poles,
        seasons,
        avgFinish: finishPosCount > 0 ? finishPosSum / finishPosCount : null,
        avgQualifying: qualiPosCount > 0 ? qualiPosSum / qualiPosCount : null,
        pointsBySeason,
        constructorBreakdown: Object.values(constructorMap).sort((a, b) => {
            if (a.firstSeason !== b.firstSeason) return a.firstSeason - b.firstSeason
            return a.firstRound - b.firstRound
        }),
    }

    try { sessionStorage.setItem(cacheKey, JSON.stringify(stats)) } catch {}
    return stats
}

const POLE_WARNING = 'Data might be incorrect as there is no qualifying results stored for years before 1991'

const isBornBefore1975 = (dob?: string) => {
    if (!dob) return false
    const year = Number(dob.split('-')[0])
    return Number.isFinite(year) && year < 1975
}

const formatAverage = (value: number | null) => value === null ? 'N/A' : value.toFixed(2)

const DriverStats = () => {
    const [drivers, setDrivers] = useState<Driver[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [selectedName, setSelectedName] = useState('')
    const [stats, setStats] = useState<DriverCareerStats | null>(null)
    const [statsLoading, setStatsLoading] = useState(false)
    const [statsError, setStatsError] = useState('')
    const [isActive, setIsActive] = useState<boolean | null>(null)
    const [activeError, setActiveError] = useState('')
    const [activeConstructor, setActiveConstructor] = useState('')

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
            } catch (err) {
                if (!cancelled) setError('Failed to load drivers. Please retry in a moment.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [])

    const selectedDriver = useMemo(() => {
        const target = selectedName.trim().toLowerCase()
        if (!target) return undefined
        return drivers.find((d) => `${d.givenName} ${d.familyName}`.toLowerCase() === target)
    }, [drivers, selectedName])

    useEffect(() => {
        const driverId = selectedDriver?.driverId
        if (!driverId) {
            setStats(null)
            setStatsError('')
            setIsActive(null)
            setActiveError('')
            setActiveConstructor('')
            return
        }

        let cancelled = false
        ;(async () => {
            setStatsLoading(true)
            setStatsError('')
            try {
                const career = await fetchDriverCareerStats(driverId)
                if (!cancelled) setStats(career)
            } catch (err) {
                if (!cancelled) setStatsError('Failed to load driver stats. Please retry in a moment.')
            } finally {
                if (!cancelled) setStatsLoading(false)
            }
        })()

        return () => { cancelled = true }
    }, [selectedDriver])

    useEffect(() => {
        const driverId = selectedDriver?.driverId
        if (!driverId) return

        let cancelled = false
        ;(async () => {
            setActiveError('')
            try {
                const activeLookup = await fetchActiveDriverIds()
                if (!cancelled) {
                    setIsActive(activeLookup.ids.has(driverId))
                    setActiveConstructor(activeLookup.constructorByDriver[driverId] ?? '')
                }
            } catch (err) {
                if (!cancelled) setActiveError('Could not determine active status.')
            }
        })()

        return () => { cancelled = true }
    }, [selectedDriver])

    const pointsChart = useMemo(() => {
        if (!stats) return null
        const labels = Object.keys(stats.pointsBySeason).sort((a, b) => Number(a) - Number(b))
        if (labels.length === 0) return null

        return {
            data: {
                labels,
                datasets: [
                    {
                        label: 'Points',
                        data: labels.map((season) => stats.pointsBySeason[season] ?? 0),
                        borderColor: 'rgba(239, 68, 68, 1)',
                        backgroundColor: 'rgba(239, 68, 68, 0.18)',
                        tension: 0.25,
                        fill: true,
                        pointRadius: 3,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Points per season' },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => `${context.formattedValue} pts`,
                        },
                    },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        }
    }, [stats])

    const constructorPointsChart = useMemo(() => {
        if (!stats || stats.constructorBreakdown.length === 0) return null
        const labels = stats.constructorBreakdown.map((c) => c.name)
        const points = stats.constructorBreakdown.map((c) => c.points)

        return {
            data: {
                labels,
                datasets: [
                    {
                        label: 'Points',
                        data: points,
                        backgroundColor: 'rgba(56, 189, 248, 0.7)',
                        borderColor: 'rgba(56, 189, 248, 1)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Points by constructor' },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => `${context.dataset.label}: ${context.formattedValue}`,
                        },
                    },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        }
    }, [stats])

    const constructorWinsChart = useMemo(() => {
        if (!stats || stats.constructorBreakdown.length === 0) return null
        const labels = stats.constructorBreakdown.map((c) => c.name)
        const wins = stats.constructorBreakdown.map((c) => c.wins)

        return {
            data: {
                labels,
                datasets: [
                    {
                        label: 'Wins',
                        data: wins,
                        backgroundColor: 'rgba(34, 197, 94, 0.7)',
                        borderColor: 'rgba(34, 197, 94, 1)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Wins by constructor' },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => `${context.dataset.label}: ${context.formattedValue}`,
                        },
                    },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        }
    }, [stats])

    const constructorRacesChart = useMemo(() => {
        if (!stats || stats.constructorBreakdown.length === 0) return null
        const labels = stats.constructorBreakdown.map((c) => c.name)
        const races = stats.constructorBreakdown.map((c) => c.races)

        return {
            data: {
                labels,
                datasets: [
                    {
                        label: 'Races',
                        data: races,
                        backgroundColor: 'rgba(99, 102, 241, 0.7)',
                        borderColor: 'rgba(99, 102, 241, 1)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Races by constructor' },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => `${context.dataset.label}: ${context.formattedValue}`,
                        },
                    },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        }
    }, [stats])

    return (
        <div>
            <h2>Driver Stats</h2>
            {loading && <p>Loading driver list…</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}

            <div style={{ marginTop: '1rem' }}>
                <label htmlFor="driver-input" style={{ fontWeight: 600 }}>
                    Select a driver:
                </label>
                <input
                    id="driver-input"
                    list="driver-options"
                    value={selectedName}
                    onChange={(e) => setSelectedName(e.target.value)}
                    placeholder="Start typing a driver name"
                    style={{ marginLeft: '0.5rem', minWidth: '260px', padding: '6px' }}
                />
                <datalist id="driver-options">
                    {drivers.map((d) => {
                        const fullName = `${d.givenName} ${d.familyName}`
                        return (
                            <option key={d.driverId} value={fullName}>{fullName}</option>
                        )
                    })}
                </datalist>
            </div>

            {selectedDriver && (
                <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                    <h3>{selectedDriver.givenName} {selectedDriver.familyName}</h3>
                    <p><strong>Date of birth:</strong> {selectedDriver.dateOfBirth ?? 'N/A'}</p>
                    {selectedDriver.permanentNumber && <p><strong>Number:</strong> {selectedDriver.permanentNumber}</p>}
                    {selectedDriver.code && <p><strong>Code:</strong> {selectedDriver.code}</p>}
                    {selectedDriver.nationality && <p><strong>Nationality:</strong> {selectedDriver.nationality}</p>}
                    <p><strong>World Championships:</strong> {getChampionshipTitles(selectedDriver.driverId)}</p>

                    {isActive !== null && !activeError && (
                        <p><strong>Status:</strong> {isActive ? 'Active' : 'Retired'}</p>
                    )}
                    {isActive && activeConstructor && (
                        <p><strong>Constructor:</strong> {activeConstructor}</p>
                    )}
                    {activeError && <p style={{ color: 'red' }}>{activeError}</p>}

                    {statsLoading && <p>Loading career stats…</p>}
                    {statsError && <p style={{ color: 'red' }}>{statsError}</p>}

                    {stats && !statsLoading && !statsError && (
                        <div style={{ marginTop: '0.75rem' }}>
                            <p><strong>Races started:</strong> {stats.racesStarted}</p>
                            <p><strong>Wins:</strong> {stats.wins}</p>
                            <p><strong>Average race finishing position:</strong> {formatAverage(stats.avgFinish)}</p>
                            <p>
                                <strong>Pole positions:</strong> {stats.poles}
                                {isBornBefore1975(selectedDriver?.dateOfBirth) && (
                                    <span
                                        title={POLE_WARNING}
                                        aria-label={POLE_WARNING}
                                        style={{ marginLeft: '6px', cursor: 'help' }}
                                    >
                                        ⓘ
                                    </span>
                                )}
                            </p>
                            <p><strong>Average qualifying position:</strong> {formatAverage(stats.avgQualifying)}</p>
                            <p><strong>Seasons raced:</strong> {stats.seasons}</p>
                            {(constructorPointsChart || constructorWinsChart || constructorRacesChart) && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                                    {constructorWinsChart && (
                                        <div style={{ minHeight: '280px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                            <Bar data={constructorWinsChart.data} options={constructorWinsChart.options} />
                                        </div>
                                    )}
                                    {constructorPointsChart && (
                                        <div style={{ minHeight: '280px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                            <Bar data={constructorPointsChart.data} options={constructorPointsChart.options} />
                                        </div>
                                    )}
                                    {constructorRacesChart && (
                                        <div style={{ minHeight: '280px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                            <Bar data={constructorRacesChart.data} options={constructorRacesChart.options} />
                                        </div>
                                    )}
                                </div>
                            )}
                            {pointsChart && (
                                <div style={{ marginTop: '1rem', minHeight: '320px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                    <Line data={pointsChart.data} options={pointsChart.options} />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default DriverStats
