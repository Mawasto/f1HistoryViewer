import { useEffect, useMemo, useState } from 'react'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Tooltip,
    Legend,
    Title,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { getConstructorTitles } from '../data/constructorTitles'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, Title)

type Constructor = {
    constructorId: string
    name: string
    nationality?: string
    url?: string
}

const CONSTRUCTOR_CACHE_KEY = 'allConstructors_cache_v1'
const CONSTRUCTOR_STATS_CACHE_PREFIX = 'constructor_stats_v2_'

type ConstructorMetrics = {
    seasons: number
    firstSeason: number | null
    wins: number
    driverCount: number
    topDriverName: string | null
    topDriverRaces: number
    driverRaceBreakdown: { driverId: string; name: string; races: number }[]
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

async function fetchJsonWithBackoff(url: string, maxRetries = 6, baseDelay = 600): Promise<any> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await fetch(url)
        if (res.status === 429) {
            await sleep(baseDelay * (attempt + 1))
            continue
        }
        if (!res.ok) throw new Error(`Request failed: ${url}`)
        return res.json()
    }
    throw new Error(`Request repeatedly rate-limited: ${url}`)
}

async function fetchConstructorsRateLimited(): Promise<Constructor[]> {
    const cached = sessionStorage.getItem(CONSTRUCTOR_CACHE_KEY)
    if (cached) {
        try {
            const parsed = JSON.parse(cached)
            if (Array.isArray(parsed)) return parsed
        } catch {
            // ignore broken cache
        }
    }

    const limit = 100
    let offset = 0
    let total = Infinity
    const all: Constructor[] = []

    while (offset === 0 || offset < total) {
        const url = `https://api.jolpi.ca/ergast/f1/constructors/?limit=${limit}&offset=${offset}`
        const data = await fetchJsonWithBackoff(url)
        const mr = data?.MRData
        total = parseInt(mr?.total ?? '0', 10) || 0
        const page: Constructor[] = mr?.ConstructorTable?.Constructors ?? []
        all.push(...page)
        offset += limit
        await sleep(400)
    }

    try { sessionStorage.setItem(CONSTRUCTOR_CACHE_KEY, JSON.stringify(all)) } catch {}
    return all
}

async function fetchConstructorResultsPaginated(constructorId: string): Promise<any[]> {
    const limit = 100
    let offset = 0
    let total = Infinity
    const races: any[] = []

    while (offset === 0 || offset < total) {
        const url = `https://api.jolpi.ca/ergast/f1/constructors/${constructorId}/results.json?limit=${limit}&offset=${offset}`
        const data = await fetchJsonWithBackoff(url)
        const mr = data?.MRData
        total = parseInt(mr?.total ?? '0', 10) || 0
        const page = mr?.RaceTable?.Races ?? []
        races.push(...page)

        offset += limit
        await sleep(400)
    }

    return races
}

async function fetchConstructorMetrics(constructorId: string): Promise<ConstructorMetrics> {
    const cacheKey = `${CONSTRUCTOR_STATS_CACHE_PREFIX}${constructorId}`
    const currentYear = new Date().getFullYear()
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
        try {
            const parsed = JSON.parse(cached)
            if (parsed && parsed.year === currentYear && parsed.metrics) {
                return parsed.metrics as ConstructorMetrics
            }
        } catch {
            // ignore broken cache
        }
    }

    const races = await fetchConstructorResultsPaginated(constructorId)
    const seasonSet = new Set<string>()
    let firstSeason: number | null = null
    let wins = 0
    const driverRaceCounts: Record<string, { count: number; name: string }> = {}

    for (const race of races) {
        const seasonStr = race?.season
        const seasonNum = Number(seasonStr)
        if (seasonStr) seasonSet.add(String(seasonStr))
        if (Number.isFinite(seasonNum)) {
            if (firstSeason === null || seasonNum < firstSeason) firstSeason = seasonNum
        }

        const results: any[] = Array.isArray(race?.Results) ? race.Results : []
        for (const res of results) {
            if (res?.position === '1') wins++
            const driverId = res?.Driver?.driverId
            const driverName = res?.Driver ? `${res.Driver.givenName ?? ''} ${res.Driver.familyName ?? ''}`.trim() : ''
            if (driverId) {
                if (!driverRaceCounts[driverId]) {
                    driverRaceCounts[driverId] = { count: 0, name: driverName || driverId }
                }
                driverRaceCounts[driverId].count += 1
                if (driverName) driverRaceCounts[driverId].name = driverName
            }
        }
    }

    let topDriverId: string | null = null
    let topDriverRaces = 0
    for (const [driverId, info] of Object.entries(driverRaceCounts)) {
        if (info.count > topDriverRaces) {
            topDriverRaces = info.count
            topDriverId = driverId
        }
    }

    const driverRaceBreakdown = Object.entries(driverRaceCounts)
        .map(([driverId, info]) => ({ driverId, name: info.name, races: info.count }))
        .sort((a, b) => b.races - a.races)

    const metrics: ConstructorMetrics = {
        seasons: seasonSet.size,
        firstSeason,
        wins,
        driverCount: Object.keys(driverRaceCounts).length,
        topDriverName: topDriverId ? driverRaceCounts[topDriverId].name : null,
        topDriverRaces,
        driverRaceBreakdown,
    }

    try { sessionStorage.setItem(cacheKey, JSON.stringify({ year: currentYear, metrics })) } catch {}
    return metrics
}

const ConstructorStats = () => {
    const [constructors, setConstructors] = useState<Constructor[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [selectedName, setSelectedName] = useState('')
    const [metrics, setMetrics] = useState<ConstructorMetrics | null>(null)
    const [metricsLoading, setMetricsLoading] = useState(false)
    const [metricsError, setMetricsError] = useState('')

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            setError('')
            try {
                const list = await fetchConstructorsRateLimited()
                const sorted = list.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                if (!cancelled) setConstructors(sorted)
            } catch (err) {
                if (!cancelled) setError('Failed to load constructors. Please retry in a moment.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [])

    const selectedConstructor = useMemo(() => {
        const target = selectedName.trim().toLowerCase()
        if (!target) return undefined
        return constructors.find((c) => c.name.toLowerCase() === target)
    }, [constructors, selectedName])

    useEffect(() => {
        if (!selectedConstructor) {
            setMetrics(null)
            setMetricsError('')
            setMetricsLoading(false)
            return
        }

        let cancelled = false
        ;(async () => {
            setMetricsLoading(true)
            setMetricsError('')
            try {
                const m = await fetchConstructorMetrics(selectedConstructor.constructorId)
                if (!cancelled) setMetrics(m)
            } catch (err) {
                if (!cancelled) setMetricsError('Failed to load constructor stats. Please retry in a moment.')
            } finally {
                if (!cancelled) setMetricsLoading(false)
            }
        })()

        return () => { cancelled = true }
    }, [selectedConstructor])

    const driverRaceChart = useMemo(() => {
        if (!metrics || metrics.driverRaceBreakdown.length === 0) return null
        const topDrivers = metrics.driverRaceBreakdown.slice(0, 20)
        const labels = topDrivers.map((d) => d.name)
        const dataPoints = topDrivers.map((d) => d.races)

        return {
            data: {
                labels,
                datasets: [
                    {
                        label: 'Races',
                        data: dataPoints,
                        backgroundColor: 'rgba(56, 189, 248, 0.75)',
                        borderColor: 'rgba(56, 189, 248, 1)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y' as const,
                plugins: {
                    legend: { position: 'bottom' as const },
                    title: { display: true, text: 'Drivers by races for this constructor (top 20)' },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => `${context.dataset.label}: ${context.formattedValue}`,
                        },
                    },
                },
                scales: {
                    x: { beginAtZero: true, ticks: { precision: 0 } },
                    y: {
                        grid: { display: false },
                        ticks: {
                            autoSkip: false,
                            font: { size: 11 },
                        },
                    },
                },
            },
        }
    }, [metrics])

    return (
        <div>
            <h2>Constructor Stats</h2>
            {loading && <p>Loading constructor list…</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}

            <div style={{ marginTop: '1rem' }}>
                <label htmlFor="constructor-input" style={{ fontWeight: 600 }}>
                    Select a constructor:
                </label>
                <input
                    id="constructor-input"
                    list="constructor-options"
                    value={selectedName}
                    onChange={(e) => setSelectedName(e.target.value)}
                    placeholder="Start typing a constructor name"
                    style={{ marginLeft: '0.5rem', minWidth: '260px', padding: '6px' }}
                />
                <datalist id="constructor-options">
                    {constructors.map((c) => (
                        <option key={c.constructorId} value={c.name}>{c.name}</option>
                    ))}
                </datalist>
            </div>

            {selectedConstructor && (
                <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                    <h3>{selectedConstructor.name}</h3>
                    <p><strong>Nationality:</strong> {selectedConstructor.nationality ?? 'N/A'}</p>
                    <p><strong>World Championships:</strong> {getConstructorTitles(selectedConstructor.constructorId)}</p>
                    {metricsLoading && <p>Loading constructor stats…</p>}
                    {metricsError && <p style={{ color: 'red' }}>{metricsError}</p>}
                    {metrics && !metricsLoading && !metricsError && (
                        <div>
                            <p><strong>Seasons raced:</strong> {metrics.seasons}</p>
                            <p><strong>First season:</strong> {metrics.firstSeason ?? 'N/A'}</p>
                            <p><strong>Total wins:</strong> {metrics.wins}</p>
                            {metrics.topDriverName && metrics.topDriverRaces > 0 && (
                                <p><strong>Driver with most races for this team:</strong> {metrics.topDriverName} ({metrics.topDriverRaces} races)</p>
                            )}
                            <p><strong>Total number of drivers that had raced for this team:</strong> {metrics.driverCount}</p>
                            {driverRaceChart && (
                                <div style={{ marginTop: '1rem', minHeight: '360px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                    <Bar data={driverRaceChart.data} options={driverRaceChart.options} />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default ConstructorStats
