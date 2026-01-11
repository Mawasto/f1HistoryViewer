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

const DRIVER_A_COLOR = 'rgba(239, 68, 68, 0.85)'
const DRIVER_A_FILL = 'rgba(239, 68, 68, 0.18)'
const DRIVER_B_COLOR = 'rgba(59, 130, 246, 0.85)'
const DRIVER_B_FILL = 'rgba(59, 130, 246, 0.18)'
const BAR_BORDER = 1

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
    totalPoints: number
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
    const totalPoints = Object.values(pointsBySeason).reduce((sum, pts) => sum + pts, 0)
    const stats: DriverCareerStats = {
        racesStarted: resultsRaces.length,
        wins,
        poles,
        seasons,
        totalPoints,
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

    const headToHeadMetricsChart = useMemo(() => {
        if (!statsA || !statsB || !selectedA || !selectedB) return null

        const metrics = [
            { label: 'World championships', a: getChampionshipTitles(selectedA.driverId), b: getChampionshipTitles(selectedB.driverId) },
            { label: 'Wins', a: statsA.wins, b: statsB.wins },
            { label: 'Pole positions', a: statsA.poles, b: statsB.poles },
            { label: 'Seasons raced', a: statsA.seasons, b: statsB.seasons },
            { label: 'Average race position', a: statsA.avgFinish, b: statsB.avgFinish, format: (v: number) => v.toFixed(2) },
            { label: 'Average qualifying position', a: statsA.avgQualifying, b: statsB.avgQualifying, format: (v: number) => v.toFixed(2) },
        ]

        const formatValue = (index: number, value: number | null) => {
            if (value === null || Number.isNaN(value)) return 'N/A'
            const formatter = metrics[index]?.format
            return formatter ? formatter(value) : value.toString()
        }

        return {
            data: {
                labels: metrics.map((m) => m.label),
                datasets: [
                    {
                        label: `${selectedA.givenName} ${selectedA.familyName}`,
                        data: metrics.map((m) => m.a ?? null),
                        backgroundColor: DRIVER_A_COLOR,
                        borderColor: DRIVER_A_COLOR.replace('0.85', '1'),
                        borderWidth: BAR_BORDER,
                    },
                    {
                        label: `${selectedB.givenName} ${selectedB.familyName}`,
                        data: metrics.map((m) => m.b ?? null),
                        backgroundColor: DRIVER_B_COLOR,
                        borderColor: DRIVER_B_COLOR.replace('0.85', '1'),
                        borderWidth: BAR_BORDER,
                    },
                ],
            },
            options: {
                indexAxis: 'y' as const,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Head-to-head summary' },
                    tooltip: {
                        callbacks: {
                            label: (ctx: any) => {
                                const value = ctx.raw as number | null
                                return `${ctx.dataset.label}: ${formatValue(ctx.dataIndex, value)}`
                            },
                        },
                    },
                },
                scales: {
                    x: { beginAtZero: true },
                    y: { grid: { display: false } },
                },
            },
        }
    }, [statsA, statsB, selectedA, selectedB])

    const racesStartedChart = useMemo(() => {
        if (!statsA || !statsB || !selectedA || !selectedB) return null

        return {
            data: {
                labels: ['Races started'],
                datasets: [
                    {
                        label: `${selectedA.givenName} ${selectedA.familyName}`,
                        data: [statsA.racesStarted],
                        backgroundColor: DRIVER_A_COLOR,
                        borderColor: DRIVER_A_COLOR.replace('0.85', '1'),
                        borderWidth: BAR_BORDER,
                    },
                    {
                        label: `${selectedB.givenName} ${selectedB.familyName}`,
                        data: [statsB.racesStarted],
                        backgroundColor: DRIVER_B_COLOR,
                        borderColor: DRIVER_B_COLOR.replace('0.85', '1'),
                        borderWidth: BAR_BORDER,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Races started' },
                    tooltip: {
                        callbacks: {
                            label: (ctx: any) => `${ctx.dataset.label}: ${ctx.formattedValue}`,
                        },
                    },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        }
    }, [statsA, statsB, selectedA, selectedB])

    const pointsEarnedChart = useMemo(() => {
        if (!statsA || !statsB || !selectedA || !selectedB) return null

        return {
            data: {
                labels: ['Total points earned'],
                datasets: [
                    {
                        label: `${selectedA.givenName} ${selectedA.familyName}`,
                        data: [statsA.totalPoints],
                        backgroundColor: DRIVER_A_COLOR,
                        borderColor: DRIVER_A_COLOR.replace('0.85', '1'),
                        borderWidth: BAR_BORDER,
                    },
                    {
                        label: `${selectedB.givenName} ${selectedB.familyName}`,
                        data: [statsB.totalPoints],
                        backgroundColor: DRIVER_B_COLOR,
                        borderColor: DRIVER_B_COLOR.replace('0.85', '1'),
                        borderWidth: BAR_BORDER,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Total points earned' },
                    tooltip: {
                        callbacks: {
                            label: (ctx: any) => `${ctx.dataset.label}: ${ctx.formattedValue}`,
                        },
                    },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        }
    }, [statsA, statsB, selectedA, selectedB])

    const pointsChart = useMemo(() => {
        if (!statsA && !statsB) return null
        const seasons = new Set<string>([
            ...Object.keys(statsA?.pointsBySeason ?? {}),
            ...Object.keys(statsB?.pointsBySeason ?? {}),
        ])
        const labels = Array.from(seasons).sort((a, b) => Number(a) - Number(b))
        if (labels.length === 0) return null

        const datasetA = statsA ? labels.map((s) => statsA.pointsBySeason[s] ?? 0) : []
        const datasetB = statsB ? labels.map((s) => statsB.pointsBySeason[s] ?? 0) : []

        return {
            data: {
                labels,
                datasets: [
                    statsA && {
                        label: selectedA ? `${selectedA.givenName} ${selectedA.familyName}` : '',
                        data: datasetA,
                        borderColor: DRIVER_A_COLOR,
                        backgroundColor: DRIVER_A_FILL,
                        tension: 0.25,
                        fill: true,
                        pointRadius: 3,
                    },
                    statsB && {
                        label: selectedB ? `${selectedB.givenName} ${selectedB.familyName}` : '',
                        data: datasetB,
                        borderColor: DRIVER_B_COLOR,
                        backgroundColor: DRIVER_B_FILL,
                        tension: 0.25,
                        fill: true,
                        pointRadius: 3,
                    },
                ].filter(Boolean) as any[],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Points per season' },
                    tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${c.formattedValue} pts` } },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        }
    }, [statsA, statsB, selectedA, selectedB])

    const buildConstructorCharts = useMemo(() => {
        if (!statsA && !statsB) return { points: null, wins: null, races: null }

        const mergeKey = (c: ConstructorBreakdown) => c.name
        const constructorNames = new Set<string>()
        ;(statsA?.constructorBreakdown ?? []).forEach((c) => constructorNames.add(mergeKey(c)))
        ;(statsB?.constructorBreakdown ?? []).forEach((c) => constructorNames.add(mergeKey(c)))
        const labels = Array.from(constructorNames)

        const toLookup = (list?: ConstructorBreakdown[]) =>
            Object.fromEntries((list ?? []).map((c) => [mergeKey(c), c]))

        const lookupA = toLookup(statsA?.constructorBreakdown)
        const lookupB = toLookup(statsB?.constructorBreakdown)

        const dataset = (field: keyof ConstructorBreakdown, color: string, label: string, lookup: Record<string, ConstructorBreakdown>) => ({
            label,
            data: labels.map((name) => lookup[name]?.[field] ?? 0),
            backgroundColor: color,
            borderColor: color.replace('0.85', '1'),
            borderWidth: BAR_BORDER,
        })

        const makeChart = (title: string, field: keyof ConstructorBreakdown) => ({
            data: {
                labels,
                datasets: [
                    statsA && dataset(field, 'rgba(239, 68, 68, 0.75)', selectedA ? `${selectedA.givenName} ${selectedA.familyName}` : 'Driver A', lookupA),
                    statsB && dataset(field, 'rgba(59, 130, 246, 0.75)', selectedB ? `${selectedB.givenName} ${selectedB.familyName}` : 'Driver B', lookupB),
                ].filter(Boolean) as any[],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: title },
                    tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${c.formattedValue}` } },
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                },
            },
        })

        return {
            points: labels.length ? makeChart('Points by constructor', 'points') : null,
            wins: labels.length ? makeChart('Wins by constructor', 'wins') : null,
            races: labels.length ? makeChart('Races by constructor', 'races') : null,
        }
    }, [statsA, statsB, selectedA, selectedB])

    const renderDriverBlock = (
        driver: Driver | undefined,
        statsLoading: boolean,
        statsError: string,
        isActive: boolean | null,
        activeConstructor: string
    ) => (
        <div style={{ flex: 1, minWidth: '320px' }}>
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
                <>
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        {renderDriverBlock(selectedA, statsLoadingA, statsErrorA, isActiveA, activeConstructorA)}
                        {renderDriverBlock(selectedB, statsLoadingB, statsErrorB, isActiveB, activeConstructorB)}
                    </div>

                    {statsA && statsB && (
                        <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
                            {headToHeadMetricsChart && (
                                <div style={{ gridColumn: '1 / -1', minHeight: '320px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                    <Bar data={headToHeadMetricsChart.data} options={headToHeadMetricsChart.options} />
                                </div>
                            )}

                            {pointsChart && (
                                <div style={{ gridColumn: '1 / -1', minHeight: '320px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                    <Line data={pointsChart.data} options={pointsChart.options} />
                                </div>
                            )}

                            {racesStartedChart && (
                                <div style={{ minHeight: '260px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                    <Bar data={racesStartedChart.data} options={racesStartedChart.options} />
                                </div>
                            )}
                            {pointsEarnedChart && (
                                <div style={{ minHeight: '260px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                    <Bar data={pointsEarnedChart.data} options={pointsEarnedChart.options} />
                                </div>
                            )}

                            {(buildConstructorCharts.wins || buildConstructorCharts.points || buildConstructorCharts.races) && (
                                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
                                    {buildConstructorCharts.wins && (
                                        <div style={{ minHeight: '260px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                            <Bar data={buildConstructorCharts.wins.data} options={buildConstructorCharts.wins.options} />
                                        </div>
                                    )}
                                    {buildConstructorCharts.points && (
                                        <div style={{ minHeight: '260px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                            <Bar data={buildConstructorCharts.points.data} options={buildConstructorCharts.points.options} />
                                        </div>
                                    )}
                                    {buildConstructorCharts.races && (
                                        <div style={{ minHeight: '260px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                            <Bar data={buildConstructorCharts.races.data} options={buildConstructorCharts.races.options} />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <p style={{ marginTop: '1rem' }}>Select both drivers to compare.</p>
            )}
        </div>
    )
}

export default CompareDrivers
