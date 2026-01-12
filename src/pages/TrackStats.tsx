import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import 'flag-icons/css/flag-icons.min.css'
import { toFlagCode } from '../utils/countryFlag'
import '../styles/MainPage.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, Title)

type Circuit = {
    circuitId: string
    circuitName: string
    Location?: {
        locality?: string
        country?: string
        lat?: string
        long?: string
    }
    url?: string
}

const CIRCUIT_CACHE_KEY = 'allCircuits_cache_v1'
const CIRCUIT_RACE_CACHE_PREFIX = 'circuit_races_cache_v1_'
const CIRCUIT_RESULTS_CACHE_PREFIX = 'circuit_results_cache_v1_'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

async function fetchCircuits(): Promise<Circuit[]> {
    const cached = sessionStorage.getItem(CIRCUIT_CACHE_KEY)
    if (cached) {
        try {
            const parsed = JSON.parse(cached)
            if (Array.isArray(parsed)) return parsed
        } catch {
            // ignore broken cache
        }
    }

    const url = 'https://api.jolpi.ca/ergast/f1/circuits/?limit=100'
    const res = await fetch(url)
    if (res.status === 429) {
        await sleep(600)
        const retry = await fetch(url)
        if (!retry.ok) throw new Error('Rate-limited fetching circuits.')
        const data = await retry.json()
        const circuits: Circuit[] = data?.MRData?.CircuitTable?.Circuits ?? []
        try { sessionStorage.setItem(CIRCUIT_CACHE_KEY, JSON.stringify(circuits)) } catch {}
        return circuits
    }
    if (!res.ok) throw new Error('Failed to fetch circuits.')
    const data = await res.json()
    const circuits: Circuit[] = data?.MRData?.CircuitTable?.Circuits ?? []
    try { sessionStorage.setItem(CIRCUIT_CACHE_KEY, JSON.stringify(circuits)) } catch {}
    return circuits
}

type CircuitRaceStats = {
    count: number
    firstDate: string | null
}

async function fetchCircuitRaceStats(circuitId: string): Promise<CircuitRaceStats> {
    const cacheKey = `${CIRCUIT_RACE_CACHE_PREFIX}${circuitId}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
        try {
            return JSON.parse(cached) as CircuitRaceStats
        } catch {
            // ignore broken cache
        }
    }

    const races: any[] = []
    const limit = 100
    let offset = 0
    let total = Infinity

    while (offset === 0 || offset < total) {
        const url = `https://api.jolpi.ca/ergast/f1/circuits/${circuitId}/races.json?limit=${limit}&offset=${offset}`
        const res = await fetch(url)
        if (res.status === 429) {
            await sleep(600)
            continue
        }
        if (!res.ok) throw new Error('Failed to fetch circuit races.')
        const data = await res.json()
        const mr = data?.MRData
        total = parseInt(mr?.total ?? '0', 10) || 0
        const page = mr?.RaceTable?.Races ?? []
        races.push(...page)
        offset += limit
        await sleep(300)
    }

    let firstDate: string | null = null
    for (const race of races) {
        const dateStr = race?.date
        if (!dateStr) continue
        if (!firstDate || dateStr < firstDate) firstDate = dateStr
    }

    const stats: CircuitRaceStats = { count: races.length, firstDate }
    try { sessionStorage.setItem(cacheKey, JSON.stringify(stats)) } catch {}
    return stats
}

async function fetchCircuitResults(circuitId: string): Promise<any[]> {
    const cacheKey = `${CIRCUIT_RESULTS_CACHE_PREFIX}${circuitId}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
        try {
            return JSON.parse(cached)
        } catch {}
    }

    const races: any[] = []
    const limit = 100
    let offset = 0
    let total = Infinity

    while (offset === 0 || offset < total) {
        const url = `https://api.jolpi.ca/ergast/f1/circuits/${circuitId}/results.json?limit=${limit}&offset=${offset}`
        const res = await fetch(url)
        if (res.status === 429) {
            await sleep(600)
            continue
        }
        if (!res.ok) throw new Error('Failed to fetch circuit results.')
        const data = await res.json()
        const mr = data?.MRData
        total = parseInt(mr?.total ?? '0', 10) || 0
        const page = mr?.RaceTable?.Races ?? []
        races.push(...page)
        offset += limit
        await sleep(300)
    }

    try { sessionStorage.setItem(cacheKey, JSON.stringify(races)) } catch {}
    return races
}

const TrackStats = () => {
    const [circuits, setCircuits] = useState<Circuit[]>([])
    const [searchParams] = useSearchParams()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [selectedName, setSelectedName] = useState('')
    const [raceStats, setRaceStats] = useState<CircuitRaceStats | null>(null)
    const [statsLoading, setStatsLoading] = useState(false)
    const [statsError, setStatsError] = useState('')
    const [topDrivers, setTopDrivers] = useState<{ driverId: string; name: string; wins: number }[]>([])
    const [lastRaceResults, setLastRaceResults] = useState<{ raceName: string; date?: string; season?: string; results: any[] } | null>(null)
    const [resultsLoading, setResultsLoading] = useState(false)
    const [resultsError, setResultsError] = useState('')

    const topWinsChart = useMemo(() => {
        if (!topDrivers || topDrivers.length === 0) return null
        const labels = topDrivers.map(d => d.name)
        const dataPoints = topDrivers.map(d => d.wins)
        return {
            data: {
                labels,
                datasets: [
                    {
                        label: 'Wins',
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
                    legend: { display: false },
                    title: { display: true, text: 'Top 3 drivers by wins at this circuit' },
                    tooltip: {
                        callbacks: {
                            label: (ctx: any) => `${ctx.formattedValue} wins`,
                        },
                    },
                },
                scales: {
                    x: { beginAtZero: true, ticks: { precision: 0 }, grid: { display: true } },
                    y: { grid: { display: false } },
                },
            },
        }
    }, [topDrivers])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            setError('')
            try {
                const list = await fetchCircuits()
                const sorted = list.slice().sort((a, b) => a.circuitName.toLowerCase().localeCompare(b.circuitName.toLowerCase()))
                if (!cancelled) setCircuits(sorted)
            } catch {
                if (!cancelled) setError('Failed to load circuits. Please retry.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [])

    const selectedCircuit = useMemo(() => {
        const target = selectedName.trim().toLowerCase()
        if (!target) return undefined
        return circuits.find((c) => c.circuitName.toLowerCase() === target)
    }, [circuits, selectedName])

    const locationFlag = useMemo(
        () => toFlagCode(selectedCircuit?.Location?.country ?? null),
        [selectedCircuit?.Location?.country]
    )

    useEffect(() => {
        const circuitParam = searchParams.get('circuit')
        if (circuitParam) {
            setSelectedName(circuitParam)
        }
    }, [searchParams])

    const mapSrc = useMemo(() => {
        const loc = selectedCircuit?.Location
        if (!loc) return null
        const { lat, long, locality, country } = loc
        if (lat && long) {
            return `https://www.google.com/maps?q=${lat},${long}&hl=en&z=12&output=embed`
        }
        const query = [locality, country].filter(Boolean).join(', ')
        if (query) {
            return `https://www.google.com/maps?q=${encodeURIComponent(query)}&hl=en&z=6&output=embed`
        }
        return null
    }, [selectedCircuit?.Location])

    useEffect(() => {
        if (!selectedCircuit) {
            setRaceStats(null)
            setStatsError('')
            setStatsLoading(false)
            setTopDrivers([])
            setLastRaceResults(null)
            setResultsError('')
            setResultsLoading(false)
            return
        }

        let cancelled = false
        ;(async () => {
            setStatsLoading(true)
            setStatsError('')
            setResultsLoading(true)
            setResultsError('')
            try {
                const stats = await fetchCircuitRaceStats(selectedCircuit.circuitId)
                const races = await fetchCircuitResults(selectedCircuit.circuitId)

                if (!cancelled) setRaceStats(stats)

                const winMap: Record<string, { driverId: string; name: string; wins: number }> = {}
                let latestRace: any = null
                let latestKey = ''

                for (const race of races) {
                    const winner = Array.isArray(race?.Results) ? race.Results.find((r: any) => r.position === '1') : null
                    if (winner?.Driver?.driverId) {
                        const id = winner.Driver.driverId
                        const name = `${winner.Driver.givenName ?? ''} ${winner.Driver.familyName ?? ''}`.trim() || id
                        if (!winMap[id]) winMap[id] = { driverId: id, name, wins: 0 }
                        winMap[id].wins += 1
                    }

                    const key = `${race?.date ?? ''}_${race?.season ?? ''}_${race?.round ?? ''}`
                    if (!latestRace || key > latestKey) {
                        latestRace = race
                        latestKey = key
                    }
                }

                const sortedTop = Object.values(winMap).sort((a, b) => b.wins - a.wins).slice(0, 3)
                if (!cancelled) setTopDrivers(sortedTop)

                if (!cancelled && latestRace) {
                    const resultsArr = (latestRace.Results ?? []).slice().sort((a: any, b: any) => {
                        const pa = parseInt(a.position ?? '999', 10)
                        const pb = parseInt(b.position ?? '999', 10)
                        return pa - pb
                    })
                    setLastRaceResults({
                        raceName: latestRace.raceName ?? 'Latest race',
                        date: latestRace.date,
                        season: latestRace.season,
                        results: resultsArr,
                    })
                }
            } catch {
                if (!cancelled) {
                    setStatsError('Failed to load circuit race stats. Please retry.')
                    setResultsError('Failed to load circuit results. Please retry.')
                }
            } finally {
                if (!cancelled) {
                    setStatsLoading(false)
                    setResultsLoading(false)
                }
            }
        })()

        return () => { cancelled = true }
    }, [selectedCircuit])

    return (
        <div className="dashboard-page">
            <h2>Track Stats</h2>
            {loading && <p>Loading circuit list…</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}

            <div style={{ marginTop: '1rem' }}>
                <label htmlFor="circuit-input" style={{ fontWeight: 600 }}>
                    Select a circuit:
                </label>
                <input
                    id="circuit-input"
                    list="circuit-options"
                    value={selectedName}
                    onChange={(e) => setSelectedName(e.target.value)}
                    placeholder="Start typing a circuit name"
                    style={{ marginLeft: '0.5rem', minWidth: '280px', padding: '6px' }}
                />
                <datalist id="circuit-options">
                    {circuits.map((c) => (
                        <option key={c.circuitId} value={c.circuitName}>{c.circuitName}</option>
                    ))}
                </datalist>
            </div>

            {selectedCircuit && (
                <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                    <h3>{selectedCircuit.circuitName}</h3>
                    {selectedCircuit.Location && (
                        <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong style={{ marginRight: '2px' }}>Location:</strong>
                            <span>{[selectedCircuit.Location.locality, selectedCircuit.Location.country].filter(Boolean).join(', ') || 'N/A'}</span>
                            {locationFlag && <span className={`fi fi-${locationFlag}`} aria-label={`${selectedCircuit.Location.country} flag`} />}
                        </p>
                    )}
                    {selectedCircuit.Location?.lat && selectedCircuit.Location?.long && (
                        <p><strong>Coordinates:</strong> {selectedCircuit.Location.lat}, {selectedCircuit.Location.long}</p>
                    )}
                    {mapSrc && (
                        <div style={{ marginTop: '0.5rem', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 8px 22px rgba(0,0,0,0.18)', maxWidth: '640px' }}>
                            <iframe
                                title="Circuit location map"
                                src={mapSrc}
                                width="100%"
                                height="320"
                                style={{ border: 0, display: 'block' }}
                                loading="lazy"
                                allowFullScreen
                                referrerPolicy="no-referrer-when-downgrade"
                            />
                        </div>
                    )}
                    {statsLoading && <p>Loading circuit race stats…</p>}
                    {statsError && <p style={{ color: 'red' }}>{statsError}</p>}
                    {raceStats && !statsLoading && !statsError && (
                        <div>
                            <p><strong>Races held:</strong> {raceStats.count}</p>
                            <p><strong>First race date:</strong> {raceStats.firstDate ?? 'N/A'}</p>
                        </div>
                    )}
                    <div style={{ marginTop: '1rem' }}>
                        <h4>Top drivers by wins at this circuit</h4>
                        {resultsLoading && <p>Loading circuit results…</p>}
                        {resultsError && <p style={{ color: 'red' }}>{resultsError}</p>}
                        {!resultsLoading && !resultsError && (
                            <>
                                {topWinsChart && (
                                    <div style={{ marginTop: '1rem', minHeight: '260px', background: '#0b0f1a', color: '#f8fafc', padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(0,0,0,0.18)' }}>
                                        <Bar data={topWinsChart.data} options={topWinsChart.options} />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    {lastRaceResults && !resultsLoading && !resultsError && (
                        <div style={{ marginTop: '1rem' }}>
                            <h4>Last race held here ({lastRaceResults.season ?? ''}{lastRaceResults.date ? ` – ${lastRaceResults.date}` : ''})</h4>
                            <p style={{ marginTop: '-0.25rem' }}>{lastRaceResults.raceName}</p>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Pos</th>
                                        <th>Driver</th>
                                        <th>Constructor</th>
                                        <th>Time / Status</th>
                                        <th>Points</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lastRaceResults.results.map((res: any, idx: number) => (
                                        <tr key={idx}>
                                            <td>{res.position}</td>
                                            <td>{`${res.Driver?.givenName ?? ''} ${res.Driver?.familyName ?? ''}`.trim()}</td>
                                            <td>{res.Constructor?.name ?? res.Constructor?.constructorId ?? ''}</td>
                                            <td>{res.Time?.time ?? res.status ?? ''}</td>
                                            <td>{res.points}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default TrackStats
