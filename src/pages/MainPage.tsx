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
    points: string;
}

const MainPage = () => {
    const [results, setResults] = useState<RaceResult[]>([])
    const [raceName, setRaceName] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        fetch('https://api.jolpi.ca/ergast/f1/2025/last/results/')
            .then(res => res.json())
            .then(data => {
                const race = data?.MRData?.RaceTable?.Races?.[0]
                setRaceName(race?.raceName || 'Last F1 Race')
                setResults(race?.Results || [])
                setLoading(false)
            })
            .catch(() => {
                setError('Failed to fetch race results.')
                setLoading(false)
            })
    }, [])

    return (
        <div>
            <h2>{raceName}</h2>
            {loading ? (
                <p>Loading...</p>
            ) : error ? (
                <p style={{ color: 'red' }}>{error}</p>
            ) : (
                <table>
                    <thead>
                        <tr>
                            <th>Pos</th>
                            <th>Driver</th>
                            <th>Constructor</th>
                            <th>Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.map((result, idx) => (
                            <tr key={idx}>
                                <td>{result.position}</td>
                                <td>{result.Driver.givenName} {result.Driver.familyName} ({result.Driver.nationality})</td>
                                <td>{result.Constructor.name} ({result.Constructor.nationality})</td>
                                <td>{result.points}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

export default MainPage
