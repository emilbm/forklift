import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  IconClipboard,
  IconDumbbell,
  IconHistory,
  IconHome,
  IconList,
} from './components/ui';
import EquipmentPage from './pages/EquipmentPage';
import ExercisesPage from './pages/ExercisesPage';
import HistoryPage from './pages/HistoryPage';
import HomePage from './pages/HomePage';
import RegimenEditPage from './pages/RegimenEditPage';
import RegimensPage from './pages/RegimensPage';
import WorkoutPage from './pages/WorkoutPage';

const TABS = [
  { to: '/', label: 'Home', icon: IconHome },
  { to: '/regimens', label: 'Regimens', icon: IconClipboard },
  { to: '/exercises', label: 'Exercises', icon: IconList },
  { to: '/equipment', label: 'Equipment', icon: IconDumbbell },
  { to: '/history', label: 'History', icon: IconHistory },
];

export default function App() {
  const { pathname } = useLocation();
  // Workout mode is full-screen: no tab bar to fat-finger between sets.
  const inWorkout = pathname.startsWith('/workout');

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/regimens" element={<RegimensPage />} />
        <Route path="/regimens/new" element={<RegimenEditPage />} />
        <Route path="/regimens/:id" element={<RegimenEditPage />} />
        <Route path="/exercises" element={<ExercisesPage />} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/workout/:sessionId" element={<WorkoutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {!inWorkout && (
        <nav className="nav">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
