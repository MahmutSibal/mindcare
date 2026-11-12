import React from "react";
import ReactDOM from "react-dom/client";
import PatientApp from "./PatientApp";
import GroupApp, { hasGroupInvite } from "./GroupApp";
import "../src/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {hasGroupInvite() ? <GroupApp /> : <PatientApp />}
  </React.StrictMode>,
);
