import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import App from "./App.tsx";
import "./index.css";

// Some web3/auth deps still expect Node's Buffer to exist.
globalThis.Buffer ??= Buffer;

createRoot(document.getElementById("root")!).render(<App />);
