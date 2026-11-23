import { Button, Label, Marker, Panel, Snap, Title } from "./ui/ui.jsx";
import "./ui/startScreen.css";

/** The start screen's background (key art, canvas grid, glows, rulers); the loader reuses it. */
export function StartBackdrop({ style }) {
  return (
    <div className="wx-start-backdrop" aria-hidden="true" style={style}>
      <div className="wx-start-photo" />
      <div className="wx-start-grid wx-canvas" />
      <div className="wx-start-glow" />
      <div className="wx-ruler wx-ruler-x" />
      <div className="wx-ruler wx-ruler-y" />
    </div>
  );
}

/** Levels shown in the start screen's "Pages" panel (order of LEVEL_ORDER), each with its accent marker. */
const START_LEVELS = [
  { name: "Office", marker: "var(--wx-action)" },
  { name: "Kitchen", marker: "var(--wx-amber)" },
  { name: "Meeting room", marker: "var(--wx-peach)" },
];
/** Entrance sequence (ms): eyebrow, title (snap), then the rest one step apart. */
const START_ENTER = { eyebrow: 0, title: 60, first: 380, step: 70 };

/**
 * Start screen (design system: ./ui).
 */
export default function IntroPage({ onStartPlay }) {
  const at = (i) => START_ENTER.first + i * START_ENTER.step;
  return (
    <main className="wx-start">
      <StartBackdrop />

      <section className="wx-start-menu" aria-labelledby="wx-start-title">
        <Label className="wx-rise" marker="var(--wx-action)" style={{ "--wx-delay": `${START_ENTER.eyebrow}ms` }}>
          A desk-sized driving game
        </Label>
        <Snap delay={START_ENTER.title} tag="Title" className="wx-start-title-wrap">
          <Title id="wx-start-title" size="hero" className="wx-start-title">
            <span>Office</span>
            <span>
              Game<span className="wx-start-dot" aria-hidden="true" />
            </span>
          </Title>
        </Snap>
        <p className="wx-text wx-rise wx-start-sub" style={{ "--wx-delay": `${at(0)}ms` }}>
          Drive a tiny car through the Wix campus. Make a mess on the office desk, race other cars across the kitchen, and smash into rivals in the meeting room.
        </p>
        <div className="wx-rise wx-start-actions" style={{ "--wx-delay": `${at(1)}ms` }}>
          <Button size="lg" iconEnd="arrowRight" frameTag="Button" onClick={() => onStartPlay?.()}>
            Go Drive
          </Button>
        </div>
        <Panel className="wx-rise wx-start-pages" role="group" aria-label="Levels" style={{ "--wx-delay": `${at(2)}ms` }}>
          <Label as="p" className="wx-start-pages-head">Pages</Label>
          <ol>
            {START_LEVELS.map((lv, i) => (
              <li key={lv.name}>
                <Marker color={lv.marker} />
                <span className="wx-start-pages-num">{String(i + 1).padStart(2, "0")}</span>
                <span>{lv.name}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </section>
    </main>
  );
}
