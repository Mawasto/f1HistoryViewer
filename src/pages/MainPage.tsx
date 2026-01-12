import { useEffect, useState } from 'react'
import 'flag-icons/css/flag-icons.min.css'
import { toFlagCode } from '../utils/countryFlag'
import '../styles/MainPage.css'

interface RaceResult {
    position: string;
    Driver: {
        givenName: string;
        familyName: string;
        nationality: string;
    };
    Constructor: {
        constructorId?: string;
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
    const [standings, setStandings] = useState<any[]>([])
    const [standingsSeason, setStandingsSeason] = useState<number | null>(null)
    const [constructorStandings, setConstructorStandings] = useState<any[]>([])
    const [constructorStandingsSeason, setConstructorStandingsSeason] = useState<number | null>(null)

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

                // Fetch driver standings for current season; fall back to previous if empty
                try {
                    let standingsData: any = null
                    let standingsSeasonNum = currentSeasonNum

                    const standingsUrl = 'https://api.jolpi.ca/ergast/f1/current/driverstandings.json'
                    const standingsRes = await fetch(standingsUrl)
                    if (standingsRes.ok) {
                        const data = await standingsRes.json()
                        const lists = data?.MRData?.StandingsTable?.StandingsLists ?? []
                        if (lists && lists.length > 0 && lists[0]?.DriverStandings?.length > 0) {
                            standingsData = data
                        }
                    }

                    if (!standingsData && Number.isFinite(currentSeasonNum)) {
                        const prev = currentSeasonNum - 1
                        try {
                            const prevStandingsUrl = `https://api.jolpi.ca/ergast/f1/${prev}/driverstandings.json`
                            const prevRes = await fetch(prevStandingsUrl)
                            if (prevRes.ok) {
                                const prevData = await prevRes.json()
                                const prevLists = prevData?.MRData?.StandingsTable?.StandingsLists ?? []
                                if (prevLists && prevLists.length > 0 && prevLists[0]?.DriverStandings?.length > 0) {
                                    standingsData = prevData
                                    standingsSeasonNum = prev
                                }
                            }
                        } catch (err) {
                            console.warn('Failed to fetch previous season standings', err)
                        }
                    }

                    const driverStandings = standingsData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
                    setStandings(driverStandings)
                    setStandingsSeason(Number.isFinite(standingsSeasonNum) ? standingsSeasonNum : null)
                } catch (err) {
                    console.warn('Failed to load driver standings', err)
                }

                // Fetch constructor standings for current season; fall back to previous if empty
                try {
                    let conData: any = null
                    let conSeasonNum = currentSeasonNum

                    const conUrl = 'https://api.jolpi.ca/ergast/f1/current/constructorstandings.json'
                    const conRes = await fetch(conUrl)
                    if (conRes.ok) {
                        const data = await conRes.json()
                        const lists = data?.MRData?.StandingsTable?.StandingsLists ?? []
                        if (lists && lists.length > 0 && lists[0]?.ConstructorStandings?.length > 0) {
                            conData = data
                        }
                    }

                    if (!conData && Number.isFinite(currentSeasonNum)) {
                        const prev = currentSeasonNum - 1
                        try {
                            const prevConUrl = `https://api.jolpi.ca/ergast/f1/${prev}/constructorstandings.json`
                            const prevRes = await fetch(prevConUrl)
                            if (prevRes.ok) {
                                const prevData = await prevRes.json()
                                const prevLists = prevData?.MRData?.StandingsTable?.StandingsLists ?? []
                                if (prevLists && prevLists.length > 0 && prevLists[0]?.ConstructorStandings?.length > 0) {
                                    conData = prevData
                                    conSeasonNum = prev
                                }
                            }
                        } catch (err) {
                            console.warn('Failed to fetch previous season constructor standings', err)
                        }
                    }

                    const conStandings = conData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []
                    setConstructorStandings(conStandings)
                    setConstructorStandingsSeason(Number.isFinite(conSeasonNum) ? conSeasonNum : null)
                } catch (err) {
                    console.warn('Failed to load constructor standings', err)
                }

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

    const seasonWinnerPoints = (() => {
        if (!standings || standings.length === 0) return null
        const p = standings[0]?.points
        const n = p ? parseFloat(p) : NaN
        return Number.isFinite(n) ? n : null
    })()

    const constructorResults = (() => {
        const map: Record<string, { constructorId: string; name: string; points: number }> = {}
        results.forEach(r => {
            const id = r.Constructor?.constructorId ?? r.Constructor?.name ?? 'unknown'
            const name = r.Constructor?.name ?? id
            const pts = Number.isFinite(parseFloat(r.points)) ? parseFloat(r.points) : 0
            if (!map[id]) map[id] = { constructorId: id, name, points: 0 }
            map[id].points += pts
        })
        return Object.values(map).sort((a, b) => b.points - a.points)
    })()

    const placeFlagCode = toFlagCode(country)

    return (
        <div className="dashboard-page">
            <div className="page-header">
                <div>
                    <p className="eyebrow">Latest Grand Prix</p>
                    <h2 className="page-title">{raceName}</h2>
                    {lastDate && <p className="muted">Date: {lastDate}</p>}
                    {circuitName && <p className="muted">Track: {circuitName}</p>}
                    {(locality || country) && (
                        <p className="muted place-row">
                            <span>Place: {locality ?? ''}{locality && country ? ', ' : ''}{country ?? ''}</span>
                            {placeFlagCode && <span className={`fi fi-${placeFlagCode}`} aria-label={`${country ?? ''} flag`} />}
                        </p>
                    )}
                </div>
                <div className="badge-stack">
                    {lastRound !== null && totalRaces !== null && (
                        <span className="badge">Round {lastRound} / {totalRaces}</span>
                    )}
                    {standingsSeason && (
                        <span className="badge badge-ghost">Driver standings: {standingsSeason}</span>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="card card-muted" role="status">Loading…</div>
            ) : error ? (
                <div className="card card-error" role="alert">{error}</div>
            ) : (
                <>
                    <div className="summary-grid">
                        <div className="metric-card">
                            <p className="metric-label">Last race</p>
                            <p className="metric-value">{raceName || 'Last F1 Race'}</p>
                            {lastDate && <p className="metric-sub">{lastDate}</p>}
                        </div>
                        <div className="metric-card">
                            <p className="metric-label">Track</p>
                            <p className="metric-value">{circuitName ?? 'TBD'}</p>
                            {(locality || country) && <p className="metric-sub">{[locality, country].filter(Boolean).join(', ')}</p>}
                        </div>
                        <div className="metric-card">
                            <p className="metric-label">Round</p>
                            <p className="metric-value">{lastRound !== null && totalRaces !== null ? `${lastRound} / ${totalRaces}` : '—'}</p>
                            <p className="metric-sub">Season progress</p>
                        </div>
                        <div className="metric-card">
                            <p className="metric-label">Championship leader</p>
                            <p className="metric-value">{standings?.[0]?.Driver ? `${standings[0].Driver.givenName} ${standings[0].Driver.familyName}` : 'TBD'}</p>
                            <p className="metric-sub">{standings?.[0]?.points ? `${standings[0].points} pts` : 'Awaiting results'}</p>
                        </div>
                    </div>

                    <div className="card-grid">
                        <div className="card">
                            <div className="card-header">
                                <div>
                                    <p className="eyebrow">Grand Prix</p>
                                    <h3 className="card-title">Driver results</h3>
                                    <p className="muted">Intervals and points for the most recent race</p>
                                </div>
                            </div>
                            <div className="table-wrap" role="region" aria-label="Last race driver results">
                                <table className="data-table data-table--hover">
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
                                            <tr key={idx} className={result.position === '1' ? 'is-winner' : ''}>
                                                <td>{result.position}</td>
                                                <td>{result.Driver.givenName} {result.Driver.familyName}</td>
                                                <td>{result.Constructor.name}</td>
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
                            </div>
                        </div>

                        <div className="card card-compact">
                            <div className="card-header">
                                <div>
                                    <p className="eyebrow">Grand Prix</p>
                                    <h3 className="card-title">Constructor results</h3>
                                    <p className="muted">Team points for the same race</p>
                                </div>
                            </div>
                            <div className="table-wrap" role="region" aria-label="Last race constructor results">
                                <table className="data-table data-table--hover">
                                    <thead>
                                        <tr>
                                            <th>Constructor</th>
                                            <th>Points</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {constructorResults.map(c => (
                                            <tr key={c.constructorId}>
                                                <td>{c.name}</td>
                                                <td>{c.points}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className="card-grid">
                        <div className="card">
                            <div className="card-header">
                                <div>
                                    <p className="eyebrow">Season</p>
                                    <h3 className="card-title">Driver standings{standingsSeason ? ` (${standingsSeason})` : ''}</h3>
                                    <p className="muted">Championship order with intervals to leader</p>
                                </div>
                            </div>
                            <div className="table-wrap" role="region" aria-label="Season driver standings">
                                <table className="data-table data-table--hover">
                                    <thead>
                                        <tr>
                                            <th>Pos</th>
                                            <th>Driver</th>
                                            <th>Nationality</th>
                                            <th>Constructor</th>
                                            <th>Wins</th>
                                            <th>Points</th>
                                            <th>Interval</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {standings.map((s, i) => {
                                            const pos = s.position
                                            const drv = s.Driver
                                            const constr = s.Constructors?.[0]
                                            const wins = s.wins ?? '0'
                                            const pts = s.points
                                            const interval = pos === '1' ? '—' : (seasonWinnerPoints !== null ? `+${(seasonWinnerPoints - parseFloat(pts)).toFixed(0)} pts` : '')
                                            return (
                                                <tr key={drv?.driverId ?? `${pos}-${i}`} className={pos === '1' ? 'is-winner' : ''}>
                                                    <td>{pos}</td>
                                                    <td>{drv?.givenName} {drv?.familyName}</td>
                                                    <td>{drv?.nationality}</td>
                                                    <td>{constr?.name}</td>
                                                    <td>{wins}</td>
                                                    <td>{pts}</td>
                                                    <td>{interval}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="card card-compact">
                            <div className="card-header">
                                <div>
                                    <p className="eyebrow">Season</p>
                                    <h3 className="card-title">Constructor standings{constructorStandingsSeason ? ` (${constructorStandingsSeason})` : ''}</h3>
                                    <p className="muted">Points for the current title fight</p>
                                </div>
                            </div>
                            <div className="table-wrap" role="region" aria-label="Season constructor standings">
                                <table className="data-table data-table--hover">
                                    <thead>
                                        <tr>
                                            <th>Pos</th>
                                            <th>Constructor</th>
                                            <th>Points</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {constructorStandings.map((c, i) => {
                                            const pos = c.position
                                            const name = c.Constructor?.name ?? c.constructorId
                                            const pts = c.points
                                            return (
                                                <tr key={c.constructorId ?? `${pos}-${i}`} className={pos === '1' ? 'is-winner' : ''}>
                                                    <td>{pos}</td>
                                                    <td>{name}</td>
                                                    <td>{pts}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

export default MainPage
