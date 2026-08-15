import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { TestConfigProvider } from "./context/TestConfigContext";
import { RequireAuth } from "./components/RequireAuth";
import { Landing } from "./pages/Landing";
import { Auth } from "./pages/Auth";
import { NewTest } from "./pages/NewTest";
import { LiveRun } from "./pages/LiveRun";
import { Result } from "./pages/Result";
import { Dashboard } from "./pages/Dashboard";
import { SiteDetail } from "./pages/SiteDetail";
import { Monitoring } from "./pages/Monitoring";
import { Billing } from "./pages/Billing";
import { Settings } from "./pages/Settings";
import { Clients } from "./pages/Clients";

function App() {
  return (
    <AuthProvider>
      <TestConfigProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route
            path="/new-test"
            element={
              <RequireAuth>
                <NewTest />
              </RequireAuth>
            }
          />
          <Route
            path="/live-run"
            element={
              <RequireAuth>
                <LiveRun />
              </RequireAuth>
            }
          />
          <Route
            path="/result"
            element={
              <RequireAuth>
                <Result />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/sites/:id"
            element={
              <RequireAuth>
                <SiteDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/monitoring"
            element={
              <RequireAuth>
                <Monitoring />
              </RequireAuth>
            }
          />
          <Route
            path="/billing"
            element={
              <RequireAuth>
                <Billing />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
          <Route
            path="/clients"
            element={
              <RequireAuth>
                <Clients />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TestConfigProvider>
    </AuthProvider>
  );
}

export default App;
