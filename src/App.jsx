import GamePage from "./game/GamePage.jsx";
import OfficeScene from "./OfficeScene.jsx";
import OfficeSceneCopy from "./OfficeSceneCopy.jsx";
import KitchenScene from "./game/KitchenScene.jsx";
import MeetingRoomScene from "./game/MeetingRoomScene.jsx";
import WorldTransition from "./game/WorldTransition.jsx";

function routePath() {
  const p = window.location.pathname.replace(/\/$/, "") || "/";
  if (p === "/kitchen") return "kitchen";
  if (p === "/office" || p === "/office-copy") return "office";
  if (p === "/office-old") return "office-old";
  if (p === "/meeting-room") return "meeting-room";
  if (p === "/transition") return "transition";
  return "game";
}

export default function App() {
  switch (routePath()) {
    case "kitchen":
      return <KitchenScene />;
    case "office":
      return <OfficeSceneCopy />;
    case "office-old":
      return <OfficeScene />;
    case "meeting-room":
      return <MeetingRoomScene />;
    case "transition":
      return <WorldTransition onComplete={() => {}} />;
    default:
      return <GamePage />;
  }
}
