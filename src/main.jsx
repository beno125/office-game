import { createRoot } from "react-dom/client";
import App from "./App";
import { getWixClient } from "./wixClient";
import "./index.css";

getWixClient();

const root = document.getElementById("root");
createRoot(root).render(<App />);
