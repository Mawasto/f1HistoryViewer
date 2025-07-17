import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Navbar from './Navbar'
import MainPage from './pages/MainPage'
import SeasonResults from './pages/SeasonResults'
import DriverStats from './pages/DriverStats'
import ConstructorStats from './pages/ConstructorStats'
import TrackStats from './pages/TrackStats'
import Pitstops from './pages/Pitstops'
import CompareDrivers from './pages/CompareDrivers'
import SeasonCalendar from './pages/SeasonCalendar'
import './App.css'

function App() {
  return (
    <Router>
      <Navbar />
      <div className="app-container">
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/season-results" element={<SeasonResults />} />
          <Route path="/driver-stats" element={<DriverStats />} />
          <Route path="/constructor-stats" element={<ConstructorStats />} />
          <Route path="/track-stats" element={<TrackStats />} />
          <Route path="/pitstops" element={<Pitstops />} />
          <Route path="/compare-drivers" element={<CompareDrivers />} />
          <Route path="/season-calendar" element={<SeasonCalendar />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
