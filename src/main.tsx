import { render } from "solid-js/web";
import { App } from "./App";
import "./styles/app.css";
import "./store/settings";

if (import.meta.env.DEV) void import("./dev/debug");

const root = document.getElementById("root")!;
// Remplace le splash statique d'index.html (même rendu : aucun saut visible).
root.textContent = "";
render(() => <App />, root);
