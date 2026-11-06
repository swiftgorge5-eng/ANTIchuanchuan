import { createRoot } from "react-dom/client";
import { App } from "./ui/App.tsx";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("缺少页面根节点");
createRoot(root).render(<App />);
