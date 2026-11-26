import GamePage from "./game/GamePage.jsx";
import KitchenScene from "./game/KitchenScene.jsx";
import MeetingRoomScene from "./game/MeetingRoomScene.jsx";
import WorldTransition from "./game/WorldTransition.jsx";
import MainLoaderTest from "./game/MainLoaderTest.jsx";

function routePath() {
  const p = window.location.pathname.replace(/\/$/, "") || "/";
  if (p === "/kitchen") return "kitchen";
  if (p === "/office" || p === "/office-copy") return "office";
  if (p === "/meeting-room") return "meeting-room";
  if (p === "/transition") return "transition";
  if (p === "/loading-test") return "loading-test"; // test: the main loading screen
  return "game";
}

export default function App() {
  switch (routePath()) {
    case "kitchen":
      return <KitchenScene />;
    case "office":
      // The office level: the "Get ready" loader until the scene is ready (GamePage starts straight away here).
      return <GamePage />;
    case "meeting-room":
      return <MeetingRoomScene />;
    case "loading-test":
      return <MainLoaderTest />;
    case "transition":
      return <WorldTransition onComplete={() => {}} />;
    default:
      return <GamePage />;
  }
}
