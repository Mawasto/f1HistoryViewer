import { useEffect, useState } from 'react'

const MIN_YEAR = 1950
const CURRENT_YEAR = new Date().getFullYear()
const randYear = () => Math.floor(Math.random() * (CURRENT_YEAR - MIN_YEAR + 1)) + MIN_YEAR

const SeasonResults = () => {
    const [year, setYear] = useState<number>(randYear())
    const [driverStandings, setDriverStandings] = useState<any[]>([])
    const [constructorStandings, setConstructorStandings] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        async function load() {
            setLoading(true)
            setError('')
            setDriverStandings([])
            setConstructorStandings([])

            const driversUrl = `https://api.jolpi.ca/ergast/f1/${year}/driverstandings.json`
            const constructorsUrl = `https://api.jolpi.ca/ergast/f1/${year}/constructorstandings.json`

            try {
                const [drvRes, conRes] = await Promise.all([fetch(driversUrl), fetch(constructorsUrl)])
                if (!drvRes.ok || !conRes.ok) throw new Error('Network response was not ok')

                const drvData = await drvRes.json()
                const conData = await conRes.json()

                const drvList = drvData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
                const conList = conData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []

                setDriverStandings(drvList)
                setConstructorStandings(conList)
            } catch (e) {
                console.error('Failed to load season standings', e)
                setError('Failed to fetch season standings.')
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [year])

    const onYearChange = (v: number) => {
        const clamped = Math.max(MIN_YEAR, Math.min(CURRENT_YEAR, Math.floor(v)))
        setYear(clamped)
    }

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

            {loading ? (
                <p>Loading...</p>
            ) : error ? (
                <p style={{ color: 'red' }}>{error}</p>
            ) : (
                <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', justifyContent: 'center' }}>
                    <div style={{ minWidth: '480px' }}>
                        <h3>Driver standings ({year})</h3>
                        <table>
                            <thead>
                                <tr>
                                    <th>Pos</th>
                                    <th>Driver</th>
                                    <th>Nationality</th>
                                    <th>Constructor</th>
                                    <th>Wins</th>
                                    <th>Points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {driverStandings.map((s, i) => {
                                    const pos = s.position ?? s.positionText
                                    const drv = s.Driver
                                    const constr = s.Constructors?.[0]
                                    return (
                                        <tr key={drv?.driverId ?? `${pos}-${i}`}>
                                            <td>{pos}</td>
                                            <td>{drv?.givenName} {drv?.familyName}</td>
                                            <td>{drv?.nationality}</td>
                                            <td>{constr?.name}</td>
                                            <td>{s.wins ?? '0'}</td>
                                            <td>{s.points}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ minWidth: '320px' }}>
                        <h3>Constructor standings ({year})</h3>
                        <table>
                            <thead>
                                <tr>
                                    <th>Pos</th>
                                    <th>Constructor</th>
                                    <th>Points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {constructorStandings.map((c, i) => {
                                    const pos = c.position ?? c.positionText
                                    const name = c.Constructor?.name ?? c.constructorId
                                    return (
                                        <tr key={c.constructorId ?? `${pos}-${i}`}>
                                            <td>{pos}</td>
                                            <td>{name}</td>
                                            <td>{c.points}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

export default SeasonResults
