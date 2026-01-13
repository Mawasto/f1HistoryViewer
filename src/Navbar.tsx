import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AuthModal from './components/AuthModal'
import './styles/Navbar.css'

const Navbar = () => {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
    const { user, setUser, loading } = useAuth()

    const handleLogout = () => {
        setUser(null)
    }

    return (
        <>
            <nav className="navbar">
                <div className="nav-inner">
                    <div className="nav-brand">f1HistoryViewer</div>
                    <ul className="nav-links">
                        <li><Link to="/">Main Page</Link></li>
                        <li><Link to="/season-results">Results from Season</Link></li>
                        <li><Link to="/driver-stats">Driver Stats</Link></li>
                        <li><Link to="/constructor-stats">Constructor Stats</Link></li>
                        <li><Link to="/track-stats">Track Stats</Link></li>
                        <li><Link to="/pitstops">Pitstops</Link></li>
                        <li><Link to="/compare-drivers">Compare Drivers</Link></li>
                        <li><Link to="/season-calendar">Season Calendar</Link></li>
                    </ul>
                    <div className="nav-auth">
                        {loading ? (
                            <span className="nav-auth-loading">Loading...</span>
                        ) : user ? (
                            <div className="nav-user-info">
                                <span className="nav-user-email">{user.email}</span>
                                <button className="nav-auth-btn nav-logout-btn" onClick={handleLogout}>
                                    Logout
                                </button>
                            </div>
                        ) : (
                            <button
                                className="nav-auth-btn nav-login-btn"
                                onClick={() => setIsAuthModalOpen(true)}
                            >
                                Login
                            </button>
                        )}
                    </div>
                </div>
            </nav>
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
        </>
    )
}

export default Navbar
