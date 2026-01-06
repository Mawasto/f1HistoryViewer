import { useEffect, useState } from 'react'

interface RaceResult {
    position: string;
    Driver: {
        givenName: string;
        familyName: string;
        nationality: string;
    };
    Constructor: {
        name: string;
        nationality: string;
    };
    Time?: {
        time?: string;
    };
    // status can be e.g. 'Finished', 'Lapped', 'Accident', etc.
    status?: string;
    // laps is provided as a string in the API
    laps?: string;
    points: string;
}

const MainPage = () => {
    const [results, setResults] = useState<RaceResult[]>([])
    const [raceName, setRaceName] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [lastRound, setLastRound] = useState<number | null>(null)
    const [totalRaces, setTotalRaces] = useState<number | null>(null)
    const [lastDate, setLastDate] = useState<string | null>(null)
    const [circuitName, setCircuitName] = useState<string | null>(null)
    const [locality, setLocality] = useState<string | null>(null)
    const [country, setCountry] = useState<string | null>(null)

    useEffect(() => {
        async function load() {
            setLoading(true)
            setError('')
            setLastDate(null)
            setCircuitName(null)
            setLocality(null)
            setCountry(null)
            try {
                // Use "current" endpoints and explicit .json
                const lastUrl = 'https://api.jolpi.ca/ergast/f1/current/last/results.json'
                const seasonUrl = 'https://api.jolpi.ca/ergast/f1/current.json'

                const [lastRes, seasonRes] = await Promise.all([
                    fetch(lastUrl),
                    fetch(seasonUrl),
                ])

                if (!lastRes.ok || !seasonRes.ok) {
                    throw new Error('Network response was not ok')
                }

                const lastData = await lastRes.json()
                const seasonData = await seasonRes.json()

                // Try to get race from current season
                let race = lastData?.MRData?.RaceTable?.Races?.[0]

                // Get total races for current season (MRData.total or races length)
                let totalStr = seasonData?.MRData?.total ?? String(seasonData?.MRData?.RaceTable?.Races?.length ?? '')
                let totalNum = totalStr ? parseInt(totalStr, 10) : NaN

                // If there are no races for the current season (empty Races[] or total === 0),
                // fall back to previous season's last race and totals.
                const currentSeasonStr = seasonData?.MRData?.RaceTable?.season
                const currentSeasonNum = currentSeasonStr ? parseInt(currentSeasonStr, 10) : NaN
                const hasNoRaces = !race || (seasonData?.MRData?.RaceTable?.Races && seasonData.MRData.RaceTable.Races.length === 0) || totalNum === 0

                if (hasNoRaces && Number.isFinite(currentSeasonNum)) {
                    const prevSeason = currentSeasonNum - 1
                    try {
                        const prevLastUrl = `https://api.jolpi.ca/ergast/f1/${prevSeason}/last/results.json`
                        const prevSeasonUrl = `https://api.jolpi.ca/ergast/f1/${prevSeason}.json`
                        const [prevLastRes, prevSeasonRes] = await Promise.all([
                            fetch(prevLastUrl),
                            fetch(prevSeasonUrl),
                        ])

                        if (prevLastRes.ok && prevSeasonRes.ok) {
                            const prevLastData = await prevLastRes.json()
                            const prevSeasonData = await prevSeasonRes.json()
                            const prevRace = prevLastData?.MRData?.RaceTable?.Races?.[0]

                            if (prevRace) {
                                race = prevRace
                            }

                            const prevTotalStr = prevSeasonData?.MRData?.total ?? String(prevSeasonData?.MRData?.RaceTable?.Races?.length ?? '')
                            totalNum = prevTotalStr ? parseInt(prevTotalStr, 10) : NaN
                        }
                    } catch (err) {
                        // ignore fallback errors and proceed with what we have
                        console.warn('Failed to fetch previous season data', err)
                    }
                }

                setRaceName(race?.raceName || 'Last F1 Race')
                setResults(race?.Results || [])

                const dateStr = race?.date
                setLastDate(dateStr ?? null)

                const circuit = race?.Circuit
                setCircuitName(circuit?.circuitName ?? null)
                setLocality(circuit?.Location?.locality ?? null)
                setCountry(circuit?.Location?.country ?? null)

                const roundStr = race?.round
                const roundNum = roundStr ? parseInt(roundStr, 10) : NaN
                setLastRound(Number.isFinite(roundNum) ? roundNum : null)

                setTotalRaces(Number.isFinite(totalNum) ? totalNum : null)

                setLoading(false)
            } catch (e) {
                console.error('Failed to load race data', e)
                setError('Failed to fetch race/season data.')
                setLoading(false)
            }
        }

        load()
    }, [])

    const winnerLaps = (() => {
        const winnerLapsStr = results.find(r => r.position === '1')?.laps
        const n = winnerLapsStr ? parseInt(winnerLapsStr, 10) : NaN
        return Number.isFinite(n) ? n : null
    })()

    return (
        <div>
            <h2>{raceName}</h2>
            {lastDate && <p>Date: {lastDate}</p>}
            {circuitName && <p>Track: {circuitName}</p>}
            {(locality || country) && <p>Place: {locality ?? ''}{locality && country ? ', ' : ''}{country ?? ''}</p>}
            {loading ? (
                <p>Loading...</p>
            ) : error ? (
                <p style={{ color: 'red' }}>{error}</p>
            ) : (
                <>
                    {lastRound !== null && totalRaces !== null && (
                        <p style={{ fontWeight: 600 }}>Round {lastRound} / {totalRaces}</p>
                    )}
                    <table>
                        <thead>
                            <tr>
                                <th>Pos</th>
                                <th>Driver</th>
                                <th>Constructor</th>
                                <th>Points</th>
                                <th>Interval</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((result, idx) => (
                                <tr key={idx}>
                                    <td>{result.position}</td>
                                    <td>{result.Driver.givenName} {result.Driver.familyName} ({result.Driver.nationality})</td>
                                    <td>{result.Constructor.name} ({result.Constructor.nationality})</td>
                                    <td>{result.points}</td>
                                    <td>{
                                        result.position === '1'
                                            ? '—'
                                            : result.status === 'Lapped' && winnerLaps !== null && result.laps
                                            ? (() => {
                                                const diff = winnerLaps - parseInt(result.laps || '0', 10)
                                                if (!Number.isFinite(diff) || diff <= 0) return result.Time?.time ?? result.status ?? ''
                                                return `+${diff} ${Math.abs(diff) === 1 ? 'lap' : 'laps'}`
                                            })()
                                            : (result.Time?.time ?? result.status ?? '')
                                    }</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    )
}

export default MainPage
