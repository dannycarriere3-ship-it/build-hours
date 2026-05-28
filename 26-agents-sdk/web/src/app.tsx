import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/app-shell";
import { AgentsPage } from "./pages/agents-page";
import { BoardPage } from "./pages/board-page";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
      </Routes>
    </AppShell>
  );
}
