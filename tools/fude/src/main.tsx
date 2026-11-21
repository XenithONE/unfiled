import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/yomogi/400.css";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/style.css";

createRoot(document.getElementById("root")!).render(<App />);
