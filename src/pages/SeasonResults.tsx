import { useEffect, useState } from 'react'

const MIN_YEAR = 1950
const CURRENT_YEAR = new Date().getFullYear()
const randYear = () => Math.floor(Math.random() * (CURRENT_YEAR - MIN_YEAR + 1)) + MIN_YEAR

const SeasonResults = () => {
    const [year, setYear] = useState<number>(randYear())
    const [driverStandings, setDriverStandings] = useState<any[]>([])
    const [constructorStandings, setConstructorStandings] = useState<any[]>([])
    const [seasonRaces, setSeasonRaces] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [racesFetchedCount, setRacesFetchedCount] = useState(0)
    const [racesTotal, setRacesTotal] = useState(0)
    const [missingRounds, setMissingRounds] = useState<string[]>([])

    useEffect(() => {
        async function load() {
            setLoading(true)
            setError('')
            setDriverStandings([])
            setConstructorStandings([])
            setSeasonRaces([])
            setRacesFetchedCount(0)
            setRacesTotal(0)
            setMissingRounds([])

            try {
                // fetch standings
                const [drvRes, conRes] = await Promise.all([
                    fetch(`https://api.jolpi.ca/ergast/f1/${year}/driverstandings/`),
                    fetch(`https://api.jolpi.ca/ergast/f1/${year}/constructorstandings/`),
                ])
                if (!drvRes.ok || !conRes.ok) throw new Error('Network response was not ok for standings')

                const drvData = await drvRes.json()
                const conData = await conRes.json()

                const drvList = drvData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
                const conList = conData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []
                setDriverStandings(drvList)
                setConstructorStandings(conList)

                // fetch races list (metadata: round, circuit, country)
                const racesUrl = `https://api.jolpi.ca/ergast/f1/${year}/races/`
                const racesRes = await fetch(racesUrl)
                if (!racesRes.ok) throw new Error('Failed to fetch season races')
                const racesData = await racesRes.json()
                const racesList = racesData?.MRData?.RaceTable?.Races ?? []
                const sortedByRound = racesList.slice().sort((a: any, b: any) => {
                    const ra = parseInt(a.round ?? '0', 10)
                    const rb = parseInt(b.round ?? '0', 10)
                    return ra - rb
                })
                setRacesTotal(sortedByRound.length)

                // try cache first
                const cacheKey = `seasonResults_${year}`
                const cached = sessionStorage.getItem(cacheKey)
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached)
                        setSeasonRaces(parsed)
                        const fetchedCount = parsed.filter((r: any) => Array.isArray(r.Results) && r.Results.length > 0).length
                        setRacesFetchedCount(fetchedCount)
                        setMissingRounds(parsed.filter((r: any) => !Array.isArray(r.Results) || r.Results.length === 0).map((r: any) => r.round ?? r.raceName ?? String(r)))
                        setLoading(false)
                        return
                    } catch {
                        // fallthrough to fresh fetch
                    }
                }

                // fetch all results for season via paginated /results/ (offset)
                const pageLimit = 100
                let offset = 0
                let totalResults = Infinity
                const raceResultsMap = new Map<string, any[]>()
                let pagesFetched = 0

                while (offset === 0 || offset < totalResults) {
                    const url = `https://api.jolpi.ca/ergast/f1/${year}/results/?limit=${pageLimit}&offset=${offset}`
                    const res = await fetch(url)
                    if (!res.ok) throw new Error(`Failed to fetch results page at offset ${offset}`)
                    const data = await res.json()
                    pagesFetched++
                    const mr = data?.MRData
                    totalResults = parseInt(mr?.total ?? String(0), 10)
                    const racesFromPage = mr?.RaceTable?.Races ?? []

                    for (const r of racesFromPage) {
                        const key = String(r.round ?? r.raceName ?? '')
                        const existing = raceResultsMap.get(key) ?? []
                        // merge Results arrays (some pages may split races if limit small)
                        raceResultsMap.set(key, existing.concat(r.Results ?? []))
                    }

                    offset += pageLimit
                }

                // build seasonRaces from races metadata and merged results
                const mergedRaces = sortedByRound.map((r: any) => {
                    const key = String(r.round ?? r.raceName ?? '')
                    const results = (raceResultsMap.get(key) ?? []).slice()
                    return { ...r, Results: results }
                })

                // check for missing rounds
                const missing: string[] = []
                mergedRaces.forEach((r: any) => {
                    const hasResults = Array.isArray(r?.Results) && r.Results.length > 0
                    if (!hasResults) missing.push(r?.round ?? r?.raceName ?? String(r))
                })

                setSeasonRaces(mergedRaces)
                setRacesFetchedCount(mergedRaces.filter((r: any) => Array.isArray(r?.Results) && r.Results.length > 0).length)
                setMissingRounds(missing)

                // if rounds are missing, start background retry loop to fetch missing rounds until complete
                if (missing.length > 0) {
                    (async () => {
                        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
                        let current = mergedRaces.map((r: any) => ({ ...r, Results: (r.Results ?? []).slice() }))
                        while (true) {
                            for (let idx = 0; idx < current.length; idx++) {
                                const r = current[idx]
                                const has = Array.isArray(r.Results) && r.Results.length > 0
                                if (has) continue
                                const round = r.round

                                // try simple per-round fetch with retries
                                for (let attempt = 0; attempt < 4; attempt++) {
                                    try {
                                        const res = await fetch(`https://api.jolpi.ca/ergast/f1/${year}/${round}/results.json`)
                                        if (res.ok) {
                                            const data = await res.json()
                                            const full = data?.MRData?.RaceTable?.Races?.[0]
                                            if (full && Array.isArray(full.Results) && full.Results.length > 0) {
                                                current[idx] = full
                                                break
                                            }
                                        }
                                    } catch {}
                                    await sleep(500 * (attempt + 1))
                                }

                                if (Array.isArray(current[idx].Results) && current[idx].Results.length > 0) continue

                                // paginated merge fallback
                                try {
                                    const pageLimit = 200
                                    const first = await fetch(`https://api.jolpi.ca/ergast/f1/${year}/${round}/results.json?limit=${pageLimit}&offset=0`)
                                    if (first.ok) {
                                        const firstData = await first.json()
                                        const firstRace = firstData?.MRData?.RaceTable?.Races?.[0]
                                        let results = (firstRace?.Results) ? firstRace.Results.slice() : []
                                        const total = parseInt(firstData?.MRData?.total ?? '0', 10)
                                        const limit = parseInt(firstData?.MRData?.limit ?? String(pageLimit), 10)
                                        if (total > results.length) {
                                            for (let off = limit; off < total; off += limit) {
                                                try {
                                                    const p = await fetch(`https://api.jolpi.ca/ergast/f1/${year}/${round}/results.json?limit=${limit}&offset=${off}`)
                                                    if (!p.ok) continue
                                                    const pd = await p.json()
                                                    const pr = pd?.MRData?.RaceTable?.Races?.[0]
                                                    if (pr?.Results) results = results.concat(pr.Results)
                                                } catch {}
                                            }
                                        }
                                        if (results.length > 0) {
                                            current[idx] = { ...(firstRace ?? r), Results: results }
                                        }
                                    }
                                } catch {}
                            }

                            const newMissing = current.filter((race: any) => !(Array.isArray(race?.Results) && race.Results.length > 0)).map((race: any) => race?.round ?? race?.raceName ?? String(race))
                            setSeasonRaces(current)
                            setRacesFetchedCount(current.filter((race: any) => Array.isArray(race?.Results) && race.Results.length > 0).length)
                            setMissingRounds(newMissing)

                            if (newMissing.length === 0) {
                                try { sessionStorage.setItem(cacheKey, JSON.stringify(current)) } catch {}
                                break
                            }

                            // wait before next retry cycle
                            await sleep(5000)
                        }
                    })()
                } else {
                    try { sessionStorage.setItem(cacheKey, JSON.stringify(mergedRaces)) } catch {}
                }
            } catch (e) {
                console.error('Failed to load season standings or results', e)
                setError('Failed to fetch season standings/results.')
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [year])

    // Build combined driver list (standings order first, then any drivers present in race results but not in standings)
    const driverRows = (() => {
        const standingsMap = Object.fromEntries(driverStandings.map((s: any) => [s.Driver.driverId, s]))
        const driverIdsInStandings = driverStandings.map((s: any) => s.Driver.driverId)

        const driversFromResults = new Map<string, any>()
        seasonRaces.forEach(r => {
            (r.Results ?? []).forEach((res: any) => {
                const id = res.Driver?.driverId
                if (id && !driversFromResults.has(id)) {
                    driversFromResults.set(id, res.Driver)
                }
            })
        })

        // build final ordered ids: standings first, then others found in results
        const orderedIds = [...driverIdsInStandings]
        for (const id of driversFromResults.keys()) {
            if (!orderedIds.includes(id)) orderedIds.push(id)
        }

        // for each driver id build row with per-race positions and final points
        return orderedIds.map((id) => {
            const standing = standingsMap[id]
            const driverInfo = standing?.Driver ?? driversFromResults.get(id) ?? { driverId: id, givenName: id, familyName: '' }
            const seasonPos = standing?.position ?? ''
            const seasonPoints = standing?.points ?? '0'
            const perRace = seasonRaces.map(r => {
                const res = (r.Results ?? []).find((x: any) => x.Driver?.driverId === id)
                return res ? (res.position ?? res.positionText ?? res.status ?? '-') : '-'
            })
            return {
                driverId: id,
                driverInfo,
                seasonPos,
                seasonPoints,
                perRace,
            }
        })
    })()

    const constructorRows = (() => {
        const standingsMap = Object.fromEntries(constructorStandings.map((s: any) => [(s.Constructor?.constructorId ?? s.constructorId), s]))
        const consIdsInStandings = constructorStandings.map((s: any) => (s.Constructor?.constructorId ?? s.constructorId))

        const consFromResults = new Map<string, any>()
        seasonRaces.forEach(r => {
            (r.Results ?? []).forEach((res: any) => {
                const id = res?.Constructor?.constructorId
                if (id && !consFromResults.has(id)) consFromResults.set(id, res.Constructor)
            })
        })

        const orderedIds = [...consIdsInStandings]
        for (const id of consFromResults.keys()) {
            if (!orderedIds.includes(id)) orderedIds.push(id)
        }

        return orderedIds.map((id) => {
            const standing = standingsMap[id]
            const constructorInfo = standing?.Constructor ?? consFromResults.get(id) ?? { constructorId: id, name: id }
            const seasonPos = standing?.position ?? ''
            const seasonPoints = standing?.points ?? '0'
            const perRace = seasonRaces.map(r => {
                const results = (r.Results ?? []).filter((x: any) => x?.Constructor?.constructorId === id)
                const roundPoints = results.reduce((sum: number, res: any) => sum + (parseInt(res?.points ?? '0', 10) || 0), 0)
                return roundPoints > 0 ? String(roundPoints) : '-'
            })
            return {
                constructorId: id,
                constructorInfo,
                seasonPos,
                seasonPoints,
                perRace,
            }
        })
    })()

    // Compute champion summaries and wins
    const championSummary = (() => {
        const driverChampion = driverStandings?.[0]?.Driver
        const constructorChampion = constructorStandings?.[0]?.Constructor

        const winners = seasonRaces.map((r: any) => {
            const winner = (r?.Results ?? []).find((res: any) => String(res?.position ?? '') === '1')
            return winner ?? null
        }).filter(Boolean) as any[]

        const driverChampionWins = driverChampion ? winners.filter(w => w.Driver?.driverId === driverChampion.driverId).length : 0
        const constructorChampionWins = constructorChampion ? winners.filter(w => w.Constructor?.constructorId === constructorChampion.constructorId).length : 0

        return { driverChampion, driverChampionWins, constructorChampion, constructorChampionWins }
    })()

    return (
        <div>
            <h2>Results from Season</h2>

            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'center' }}>
                <label>
                    Year:
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        style={{ marginLeft: '0.5rem', width: '120px' }}
                    >
                        {Array.from({ length: CURRENT_YEAR - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </label>
                <button onClick={() => setYear(randYear())}>Random year</button>
            </div>

            {(loading || missingRounds.length > 0) ? (
                <p>Results are loading, please wait{racesTotal ? ` — fetched ${racesFetchedCount}/${racesTotal} rounds` : ''}...</p>
            ) : error ? (
                <p style={{ color: 'red' }}>{error}</p>
            ) : (
                <>
                    {/* Top summary boxes: driver champion + constructor champion */}
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', alignItems: 'stretch', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <div style={{ minWidth: '260px', padding: '12px 16px', borderRadius: '8px', border: '1px solid #000000ff', background: '#fafafa' }}>
                            <div style={{ fontSize: '0.9rem', color: '#555', marginBottom: '4px' }}>Driver World Champion</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#000' }}>
                                {championSummary.driverChampion ? (
                                    <>
                                        {championSummary.driverChampion.givenName} {championSummary.driverChampion.familyName}
                                    </>
                                ) : (
                                    'N/A'
                                )}
                            </div>
                            <div style={{ marginTop: '6px', color: '#333' }}>1st place finishes: <span style={{ fontWeight: 600 }}>{championSummary.driverChampionWins}</span></div>
                        </div>

                        <div style={{ minWidth: '260px', padding: '12px 16px', borderRadius: '8px', border: '1px solid #000000ff', background: '#fafafa' }}>
                            <div style={{ fontSize: '0.9rem', color: '#555', marginBottom: '4px' }}>Constructor Champions</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#000' }}>
                                {championSummary.constructorChampion ? (
                                    championSummary.constructorChampion.name
                                ) : (
                                    'N/A'
                                )}
                            </div>
                            <div style={{ marginTop: '6px', color: '#333' }}>Combined wins: <span style={{ fontWeight: 600 }}>{championSummary.constructorChampionWins}</span></div>
                        </div>
                    </div>

                    <div style={{ overflowX: 'auto', display: 'block', maxWidth: '100vw' }}>
                        <h3>Driver results by round ({year})</h3>
                        <table style={{ width: 'max-content', whiteSpace: 'nowrap', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th>Position</th>
                                    <th>Driver</th>
                                    {seasonRaces.map(r => {
                                        const country = r?.Circuit?.Location?.country ?? ''
                                        const code = country ? country.trim().slice(0, 3).toUpperCase() : ''
                                        return (
                                            <th key={r.round}>{r.round}{code ? ` • ${code}` : ''}</th>
                                        )
                                    })}
                                    <th>Points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {driverRows.map((row) => (
                                    <tr key={row.driverId}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{row.seasonPos}</td>
                                        <td style={{ textAlign: 'left' }}>{row.driverInfo.givenName} {row.driverInfo.familyName}</td>
                                        {row.perRace.map((p: string, i: number) => (
                                            <td key={i} style={{ whiteSpace: 'nowrap' }}>{p}</td>
                                        ))}
                                        <td style={{ whiteSpace: 'nowrap' }}>{row.seasonPoints}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* constructors results by round */}
                    <div style={{ marginTop: '1rem', overflowX: 'auto', display: 'block', maxWidth: '100vw' }}>
                        <h3>Constructor results by round ({year})</h3>
                        <table style={{ width: 'max-content', whiteSpace: 'nowrap', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th>Pos</th>
                                    <th>Constructor</th>
                                    {seasonRaces.map(r => {
                                        const country = r?.Circuit?.Location?.country ?? ''
                                        const code = country ? country.trim().slice(0, 3).toUpperCase() : ''
                                        return (
                                            <th key={r.round}>{r.round}{code ? ` • ${code}` : ''}</th>
                                        )
                                    })}
                                    <th>Points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {constructorRows.map((row: any) => (
                                    <tr key={row.constructorId}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{row.seasonPos}</td>
                                        <td style={{ textAlign: 'left' }}>{row.constructorInfo.name ?? row.constructorInfo.constructorId}</td>
                                        {row.perRace.map((p: string, i: number) => (
                                            <td key={i} style={{ whiteSpace: 'nowrap' }}>{p}</td>
                                        ))}
                                        <td style={{ whiteSpace: 'nowrap' }}>{row.seasonPoints}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    )
}

export default SeasonResults
