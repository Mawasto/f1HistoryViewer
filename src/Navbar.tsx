import { Link } from 'react-router-dom'
import './Navbar.css'

const Navbar = () => (
    <nav className="navbar">
        <ul>
            <li><Link to="/">Main Page</Link></li>
            <li><Link to="/season-results">Results from Season</Link></li>
            <li><Link to="/driver-stats">Driver Stats</Link></li>
            <li><Link to="/constructor-stats">Constructor Stats</Link></li>
            <li><Link to="/track-stats">Track Stats</Link></li>
            <li><Link to="/pitstops">Pitstops</Link></li>
            <li><Link to="/compare-drivers">Compare Drivers</Link></li>
            <li><Link to="/season-calendar">Season Calendar</Link></li>
        </ul>
    </nav>
)

export default Navbar
