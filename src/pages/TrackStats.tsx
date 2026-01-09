import { useEffect, useMemo, useState } from 'react'

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

const TrackStats = () => {
    const [circuits, setCircuits] = useState<Circuit[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [selectedName, setSelectedName] = useState('')
    const [raceStats, setRaceStats] = useState<CircuitRaceStats | null>(null)
    const [statsLoading, setStatsLoading] = useState(false)
    const [statsError, setStatsError] = useState('')

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

    useEffect(() => {
        if (!selectedCircuit) {
            setRaceStats(null)
            setStatsError('')
            setStatsLoading(false)
            return
        }

        let cancelled = false
        ;(async () => {
            setStatsLoading(true)
            setStatsError('')
            try {
                const stats = await fetchCircuitRaceStats(selectedCircuit.circuitId)
                if (!cancelled) setRaceStats(stats)
            } catch (err) {
                if (!cancelled) setStatsError('Failed to load circuit race stats. Please retry.')
            } finally {
                if (!cancelled) setStatsLoading(false)
            }
        })()

        return () => { cancelled = true }
    }, [selectedCircuit])

    return (
        <div>
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
                        <p>
                            <strong>Location:</strong>{' '}
                            {[selectedCircuit.Location.locality, selectedCircuit.Location.country].filter(Boolean).join(', ') || 'N/A'}
                        </p>
                    )}
                    {selectedCircuit.Location?.lat && selectedCircuit.Location?.long && (
                        <p><strong>Coordinates:</strong> {selectedCircuit.Location.lat}, {selectedCircuit.Location.long}</p>
                    )}
                    {statsLoading && <p>Loading circuit race stats…</p>}
                    {statsError && <p style={{ color: 'red' }}>{statsError}</p>}
                    {raceStats && !statsLoading && !statsError && (
                        <div>
                            <p><strong>Races held:</strong> {raceStats.count}</p>
                            <p><strong>First race date:</strong> {raceStats.firstDate ?? 'N/A'}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default TrackStats
