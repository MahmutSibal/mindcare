import React from "react";
import ReactDOM from "react-dom/client";
import PatientApp from "./PatientApp";
import GroupApp, { hasGroupInvite } from "./GroupApp";
import { ConnectionTestPage } from "./ConnectionTest";
import IntroGate from "./IntroVideo";
import "../src/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {window.location.hash === "#test" ? <ConnectionTestPage /> : <IntroGate>{hasGroupInvite() ? <GroupApp /> : <PatientApp />}</IntroGate>}
  </React.StrictMode>,
);
