import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// NOTE: StrictMode is intentionally disabled. In React 19 DEV mode it double-
// invokes component functions and effects, and the DevTools profiler tries to
// snapshot state for its timing data. With multi-MB ImageData values in App
// state, that snapshot is pathologically slow (~10s stall on setImage).
createRoot(document.getElementById('root')!).render(<App />);
