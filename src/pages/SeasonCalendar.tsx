import { useEffect, useState } from 'react'

type Race = {
    round: string
    raceName?: string
    Circuit?: {
        circuitName?: string
        Location?: { locality?: string; country?: string }
    }
    date?: string
}

const MIN_YEAR = 1950
const MAX_YEAR = 2025

const SeasonCalendar = () => {
    const [year, setYear] = useState<number>(MAX_YEAR)
    const [races, setRaces] = useState<Race[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            setError('')
            setRaces([])
            try {
                const res = await fetch(`https://api.jolpi.ca/ergast/f1/${year}/races/`)
                if (!res.ok) throw new Error('Failed to fetch season calendar')
                const data = await res.json()
                const list: Race[] = data?.MRData?.RaceTable?.Races ?? []
                const sorted = list.slice().sort((a, b) => parseInt(a.round ?? '0', 10) - parseInt(b.round ?? '0', 10))
                if (!cancelled) setRaces(sorted)
            } catch {
                if (!cancelled) setError('Could not load season calendar. Please retry.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [year])

    return (
        <div>
            <h2>Season Calendar</h2>
            <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <label>
                    Year:
                    <input
                        type="number"
                        min={MIN_YEAR}
                        max={MAX_YEAR}
                        value={year}
                        onChange={(e) => setYear(Math.min(MAX_YEAR, Math.max(MIN_YEAR, Number(e.target.value) || MIN_YEAR)))}
                        style={{ marginLeft: '0.5rem', width: '120px' }}
                    />
                </label>
            </div>

            <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                {loading && <p>Loading calendar…</p>}
                {error && <p style={{ color: 'red' }}>{error}</p>}
                {!loading && !error && (
                    <table>
                        <thead>
                            <tr>
                                <th>Round</th>
                                <th>Race</th>
                                <th>Circuit</th>
                                <th>Location</th>
                                <th>Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {races.length === 0 ? (
                                <tr><td colSpan={5}>No races found for {year}.</td></tr>
                            ) : (
                                races.map((r) => (
                                    <tr key={r.round}>
                                        <td>{r.round}</td>
                                        <td>{r.raceName ?? 'Race'}</td>
                                        <td>{r.Circuit?.circuitName ?? 'Unknown'}</td>
                                        <td>{[r.Circuit?.Location?.locality, r.Circuit?.Location?.country].filter(Boolean).join(', ')}</td>
                                        <td>{r.date ?? ''}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}

export default SeasonCalendar
