import ReactDOM from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./i18n";
import "./styles/tokens.css";
import "./styles/app.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
