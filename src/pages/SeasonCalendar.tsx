import { useEffect, useState } from 'react'
import 'flag-icons/css/flag-icons.min.css'
import { toFlagCode } from '../utils/countryFlag'

type Race = {
    round: string
    raceName?: string
    Circuit?: {
        circuitName?: string
        Location?: { locality?: string; country?: string }
    }
    date?: string
    FirstPractice?: { date?: string }
    SecondPractice?: { date?: string }
    ThirdPractice?: { date?: string }
    Qualifying?: { date?: string }
    Sprint?: { date?: string }
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

    const formatWeekendRange = (race: Race): string => {
        const dateStrings = [
            race.FirstPractice?.date,
            race.SecondPractice?.date,
            race.ThirdPractice?.date,
            race.Sprint?.date,
            race.Qualifying?.date,
            race.date,
        ].filter((d): d is string => Boolean(d))

        if (dateStrings.length === 0) return ''

        const parsed = dateStrings
            .map((d) => ({ raw: d, time: Date.parse(d) }))
            .filter((d) => Number.isFinite(d.time))
            .sort((a, b) => a.time - b.time)

        if (parsed.length === 0) return ''

        const start = new Date(parsed[0].time)
        const end = new Date(parsed[parsed.length - 1].time)

        const startDay = start.getDate()
        const endDay = end.getDate()
        const startMonth = String(start.getMonth() + 1).padStart(2, '0')
        const endMonth = String(end.getMonth() + 1).padStart(2, '0')
        const startYear = start.getFullYear()
        const endYear = end.getFullYear()

        const singleDay = startDay === endDay && startMonth === endMonth && startYear === endYear
        if (singleDay) return `${startDay}/${startMonth}/${startYear}`

        const sameMonthYear = startMonth === endMonth && startYear === endYear
        if (sameMonthYear) return `${startDay}-${endDay}/${endMonth}/${endYear}`

        return `${startDay}/${startMonth}/${startYear} - ${endDay}/${endMonth}/${endYear}`
    }

    return (
        <div>
            <h2>Season Calendar</h2>
            <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <label>
                    Year:
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        style={{ marginLeft: '0.5rem', width: '120px' }}
                    >
                        {Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
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
                                <th>Weekend</th>
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
                                        <td>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {toFlagCode(r.Circuit?.Location?.country ?? null) && (
                                                    <span
                                                        className={`fi fi-${toFlagCode(r.Circuit?.Location?.country ?? null)}`}
                                                        aria-label={`${r.Circuit?.Location?.country ?? ''} flag`}
                                                    />
                                                )}
                                                <span>{[r.Circuit?.Location?.locality, r.Circuit?.Location?.country].filter(Boolean).join(', ')}</span>
                                            </span>
                                        </td>
                                        <td>{formatWeekendRange(r)}</td>
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
