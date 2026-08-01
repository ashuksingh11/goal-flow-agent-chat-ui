import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
// v5.2 panel design (Pencil goal-flow2.pen). Loaded second: it defines new class
// names only, so styles.css keeps serving GoalBar and the working column.
import "./panel.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
