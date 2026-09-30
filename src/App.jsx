import GamePage from "./game/GamePage.jsx";
import OfficeScene from "./OfficeScene.jsx";
import KitchenScene from "./game/KitchenScene.jsx";
import WorldTransition from "./game/WorldTransition.jsx";

function routePath() {
  const p = window.location.pathname.replace(/\/$/, "") || "/";
  if (p === "/kitchen") return "kitchen";
  if (p === "/office") return "office";
  if (p === "/transition") return "transition";
  return "game";
}

export default function App() {
  switch (routePath()) {
    case "kitchen":
      return <KitchenScene />;
    case "office":
      return <OfficeScene />;
    case "transition":
      return <WorldTransition onComplete={() => {}} />;
    default:
      return <GamePage />;
  }
}
