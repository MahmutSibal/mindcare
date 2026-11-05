import React from "react";
import ReactDOM from "react-dom/client";
import PatientApp from "./PatientApp";
import "../src/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PatientApp />
  </React.StrictMode>,
);
