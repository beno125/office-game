/**
 * Kitchen race: track shape, lap / checkpoint tracking, AI drivers and HUD.
 *
 * Pure logic (no three.js / cannon objects): the scene module owns the cars and
 * feeds positions in. The track is a stadium loop on the xz plane around a
 * capsule-shaped island: far straight (z = z0 + radius, driven toward +x),
 * right half-circle, near straight (z = z0 - radius, driven toward -x), left
 * half-circle — counter-clockwise seen from above.
 */

import { brandTone, buttonEl, el, frameEl, markerEl, replayClass } from "../game/ui/dom.js";
import { createCountdown } from "../game/ui/countdown.js";

export const RACE_LAPS = 4;
export const RACE_CHECKPOINTS = 8;
export const RACE_COUNTDOWN_SEC = 3;
/** End of race: the popup opens this long after the player crosses the line. */
export const RACE_RESULTS_DELAY_SEC = 1.2;
/** Longest wait for the player after the winner finishes before the popup opens anyway. */
export const RACE_RESULTS_MAX_WAIT_SEC = 6;
/** Popup fade / scale in and out (ms). */
export const RACE_RESULTS_ANIM_MS = 260;
/**
 * Largest sector jump between two updates still counted as driving (a long
 * frame or a slow-motion catch-up). Bigger jumps (a teleport) don't move the
 * tracker, so a lap only counts when every sector is passed in order.
 */
export const RACE_MAX_SECTOR_STEP = 2;
/** AI stuck check: moved less than this (world units) over the window → back out. */
export const RACE_AI_STUCK_WINDOW = 2;
export const RACE_AI_STUCK_DIST = 1.5;
export const RACE_AI_REVERSE_SEC = 1;
/** AI racing line stays this far inside the lane edge (world units). */
export const RACE_AI_LANE_INSET = 1.1;

/** Furthest an AI car's line may swing outward from the centre line in a turn. */
export function raceAiMaxOutward(laneHalf, turnWiden) {
  return Math.max(0, laneHalf - RACE_AI_LANE_INSET) + turnWiden;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class StadiumTrack {
  /**
   * @param {object} o
   * @param {number} o.xL  left half-circle centre x
   * @param {number} o.xR  right half-circle centre x
   * @param {number} o.z0  centre line z of the island
   * @param {number} o.radius  centre line radius (distance from the island axis)
   * @param {number} o.startX  x of the start / finish line on the far straight
   */
  constructor({ xL, xR, z0, radius, startX, laneHalf = 2.5 }) {
    this.laneHalf = laneHalf;
    this.xL = xL;
    this.xR = xR;
    this.z0 = z0;
    this.r = radius;
    this.straight = xR - xL;
    this.halfTurn = Math.PI * radius;
    this.length = 2 * this.straight + 2 * this.halfTurn;
    this.startS = Math.max(0, Math.min(this.straight, startX - xL));
  }

  /** Raw arc length of the closest centre line point (0 at the far straight's left end). */
  rawS(x, z) {
    const { xL, xR, z0, r, straight, halfTurn } = this;
    if (x >= xL && x <= xR) {
      return z >= z0 ? x - xL : straight + halfTurn + (xR - x);
    }
    if (x > xR) {
      const phi = Math.atan2(x - xR, z - z0); // 0 at the top, PI at the bottom
      return straight + r * Math.max(0, Math.min(Math.PI, phi));
    }
    const phi = Math.atan2(xL - x, z0 - z);
    return 2 * straight + halfTurn + r * Math.max(0, Math.min(Math.PI, phi));
  }

  /** Race progress along the loop, 0 at the start line, in [0, length). */
  progress(x, z) {
    const L = this.length;
    return (((this.rawS(x, z) - this.startS) % L) + L) % L;
  }

  /**
   * Centre line point at race progress p, shifted sideways by `lateral`
   * (positive = toward the outside of the loop). Writes {x, z, heading}.
   * heading follows the car convention: forward = (sin h, cos h).
   */
  pointAt(p, lateral, out) {
    const { xL, xR, z0, r, straight, halfTurn } = this;
    const L = this.length;
    let s = (((p + this.startS) % L) + L) % L;
    const rr = r + lateral;
    if (s < straight) {
      out.x = xL + s;
      out.z = z0 + rr;
      out.heading = Math.PI / 2;
      return out;
    }
    s -= straight;
    if (s < halfTurn) {
      const phi = s / r;
      out.x = xR + rr * Math.sin(phi);
      out.z = z0 + rr * Math.cos(phi);
      out.heading = Math.PI / 2 + phi;
      return out;
    }
    s -= halfTurn;
    if (s < straight) {
      out.x = xR - s;
      out.z = z0 - rr;
      out.heading = -Math.PI / 2;
      return out;
    }
    s -= straight;
    const phi = s / r;
    out.x = xL - rr * Math.sin(phi);
    out.z = z0 - rr * Math.cos(phi);
    out.heading = -Math.PI / 2 + phi;
    return out;
  }

  /** Signed sideways distance from the centre line (positive = outside of the loop). */
  lateralOf(x, z) {
    const { xL, xR, z0, r } = this;
    if (x >= xL && x <= xR) return Math.abs(z - z0) - r;
    const cx = x > xR ? xR : xL;
    return Math.hypot(x - cx, z - z0) - r;
  }

  /** True if race progress p lies on one of the two half-circles. */
  inTurn(p) {
    const L = this.length;
    const s = (((p + this.startS) % L) + L) % L;
    return (
      (s >= this.straight && s < this.straight + this.halfTurn) ||
      s >= 2 * this.straight + this.halfTurn
    );
  }
}

/**
 * Lap counting through checkpoints: the loop is split into RACE_CHECKPOINTS
 * sectors and only stepping into the next sector counts (stepping back undoes
 * it), so crossing the finish line back and forth never adds a lap.
 */
export class LapTracker {
  constructor(track) {
    this.track = track;
    this.reset(0, 0);
  }

  reset(x, z) {
    this.sector = this._sectorOf(x, z);
    // Cars start behind the line: the first crossing makes count 1 (lap 1 under way).
    this.count = 0;
    this.progressValue = 0;
    this.finished = false;
    this.update(x, z);
  }

  _sectorOf(x, z) {
    const p = this.track.progress(x, z);
    return Math.min(
      RACE_CHECKPOINTS - 1,
      Math.floor((p / this.track.length) * RACE_CHECKPOINTS),
    );
  }

  update(x, z) {
    const N = RACE_CHECKPOINTS;
    const p = this.track.progress(x, z);
    const sector = Math.min(N - 1, Math.floor((p / this.track.length) * N));
    const d = (sector - this.sector + N) % N;
    if (d !== 0) {
      if (d <= RACE_MAX_SECTOR_STEP) this.count += d;
      else if (d >= N - RACE_MAX_SECTOR_STEP) this.count -= N - d;
      else return; // a jump across the track: ignored, sector unchanged
    }
    this.sector = sector;
    const sectorLen = this.track.length / N;
    const frac = (p - sector * sectorLen) / sectorLen;
    this.progressValue = this.count + frac;
  }

  /** Laps fully driven (crossing the line at the start does not count). */
  get lapsDone() {
    return Math.max(0, Math.floor((this.count - 1) / RACE_CHECKPOINTS));
  }
}

/**
 * Simple AI driver: aims at a point ahead on its racing line (centre line
 * shifted by `lateral`), steers toward it with the same left / right inputs a
 * player has, lifts off for the half-circles, and backs out when stuck.
 */
export class RaceAIDriver {
  constructor(track, opts) {
    this.track = track;
    this.lateral = opts.lateral ?? 0;
    this.speedFactor = opts.speedFactor ?? 1;
    this.turnSpeedFactor = opts.turnSpeedFactor ?? 0.8;
    this.lookahead = opts.lookahead ?? 4;
    this.turnWiden = opts.turnWiden ?? 1;
    this.wobble = opts.wobble ?? 0;
    this.wobbleRate = opts.wobbleRate ?? 0.5;
    this.phase = opts.phase ?? 0;
    this.time = 0;
    this.reverseTime = 0;
    this.reverseSteer = 0;
    this._pt = { x: 0, z: 0, heading: 0 };
    this.reset();
  }

  reset() {
    this.time = 0;
    this.reverseTime = 0;
    this.checkT = 0;
    this.checkDist = 0;
    this.lastX = null;
    this.lastZ = null;
  }

  /**
   * Fill `input` ({forward, reverse, left, right, brake}) for this step.
   * `others` holds the other cars' positions ({x, z}) to steer around.
   */
  computeInput(pos, state, dt, input, others) {
    input.forward = input.reverse = input.left = input.right = input.brake = false;
    this.time += dt;
    const track = this.track;
    const speed = state.speed;
    const p = track.progress(pos.x, pos.z);

    // Distance actually travelled (pushes by other cars count as not driving on).
    if (this.lastX !== null) this.checkDist += Math.hypot(pos.x - this.lastX, pos.z - this.lastZ);
    this.lastX = pos.x;
    this.lastZ = pos.z;

    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      input.reverse = true;
      // Reversing with this steer swings the nose back toward the track.
      if (this.reverseSteer > 0) input.right = true;
      else input.left = true;
      if (this.reverseTime <= 0) {
        this.checkT = 0;
        this.checkDist = 0;
      }
      return input;
    }

    const ahead = this.lookahead + Math.abs(speed) * 0.12;
    // Aiming at a point ahead cuts the half-circles: run them wider (outward).
    const turnNow = track.inTurn(p + ahead * 0.5);
    let lat = this.lateral + this.wobble * Math.sin(this.time * this.wobbleRate * Math.PI * 2 + this.phase);
    if (turnNow) lat += this.turnWiden;
    // A car close ahead in our path: pass it on the side with more room.
    const fx = Math.sin(state.angle);
    const fz = Math.cos(state.angle);
    const lim = Math.max(0, track.laneHalf - RACE_AI_LANE_INSET);
    if (others) {
      let bestAhead = Infinity;
      let avoidLat = null;
      for (const o of others) {
        const dx = o.x - pos.x;
        const dz = o.z - pos.z;
        const along = dx * fx + dz * fz;
        if (along < -0.5 || along > 8 || along > bestAhead) continue;
        const side = Math.abs(dx * fz - dz * fx);
        if (side > 2.4) continue;
        bestAhead = along;
        const oLat = track.lateralOf(o.x, o.z);
        const roomOut = lim - oLat;
        const roomIn = oLat + lim;
        avoidLat = roomOut >= roomIn ? oLat + 2.4 : oLat - 2.4;
      }
      if (avoidLat !== null) lat = avoidLat;
    }
    lat = Math.max(-lim, Math.min(lim + (turnNow ? this.turnWiden : 0), lat));
    const pt = track.pointAt(p + ahead, lat, this._pt);
    const desired = Math.atan2(pt.x - pos.x, pt.z - pos.z);
    const err = wrapAngle(desired - state.angle);
    // keys.left raises the heading angle, keys.right lowers it.
    if (err > 0.035) input.left = true;
    else if (err < -0.035) input.right = true;

    const turnAhead = track.inTurn(p + ahead * 0.8) || track.inTurn(p);
    let target = state.maxSpeed * (turnAhead ? this.turnSpeedFactor : this.speedFactor);
    if (Math.abs(err) > 1.4) target = Math.min(target, state.maxSpeed * 0.6);
    if (speed < target) input.forward = true;

    // Stuck (against a rail or another car, or shoved around without getting
    // anywhere): if it barely moved over the window, back out and reorient.
    this.checkT += dt;
    if (this.checkT >= RACE_AI_STUCK_WINDOW) {
      if (this.checkDist < RACE_AI_STUCK_DIST) {
        this.reverseTime = RACE_AI_REVERSE_SEC;
        this.reverseSteer = err > 0 ? 1 : -1;
      }
      this.checkT = 0;
      this.checkDist = 0;
    }
    return input;
  }
}

const ORDINALS = ["1st", "2nd", "3rd", "4th"];

/** Each countdown number stays this long (s): its line depletes over it (design only; the race keeps its own timer). */
const COUNTDOWN_STEP_SEC = 1;
/** Chip on the centre messages' frame, by text (others get no chip). */
const STAGE_TAGS = { "FINISH!": "Finish", FINISH: "Finish" };
/** Centre message panel: leave fade (ms, matches its CSS). */
const HUD_MESSAGE_LEAVE_MS = 160;
/** Knock-off counter pop colours. */
const POP_TONE_OUT = "var(--wx-amber)";
const POP_TONE_LEFT = "var(--wx-red)";

/**
 * Centre stage: one big word in a selection frame (FINISH).
 * Replays its entrance only when the text changes. (The countdown is its own
 * component: ../game/ui/countdown.js.)
 */
class HudStage {
  constructor() {
    this.root = el("div", "wx-stage");
    this.root.setAttribute("aria-live", "assertive");
    this.root.style.display = "none";
    this._key = "";
  }

  /** kind: "number" | "word". */
  show(text, { tone, tag, kind = "word" } = {}) {
    if (!text) {
      this.root.style.display = "none";
      this._key = "";
      return;
    }
    this.root.style.display = "";
    const key = kind + "|" + text + "|" + tone;
    if (key === this._key) return;
    this._key = key;
    const item = el("div", "wx-stage-item" + (kind === "word" ? " is-word" : ""));
    item.appendChild(el("span", null, text));
    if (tone) item.style.setProperty("--wx-tone", tone);
    item.appendChild(frameEl(tag));
    this.root.replaceChildren(item);
    replayClass(item, "is-in");
  }
}

/**
 * Centre message on the menus' panel surface (frosted dark panel, Madefor
 * Display, a marker dot in the message's accent), no frame: enters and leaves
 * like the popup. Used for "You’re out!".
 */
class HudMessage {
  constructor() {
    this.root = el("div", "wx-hud-message-slot");
    this.root.setAttribute("aria-live", "assertive");
    this._current = null;
    this._key = "";
  }

  show(text, tone) {
    if (!text) {
      this.clear();
      return;
    }
    const key = text + "|" + tone;
    if (key === this._key) return;
    this.clear();
    this._key = key;
    const panel = el("div", "wx-panel wx-hud-message");
    panel.append(markerEl(tone), el("span", "wx-hud-message-text", text));
    this.root.appendChild(panel);
    this._current = panel;
  }

  clear() {
    const p = this._current;
    this._current = null;
    this._key = "";
    if (!p) return;
    p.classList.add("is-out");
    window.setTimeout(() => p.remove(), HUD_MESSAGE_LEAVE_MS + 40);
  }
}

/** HUD stat: small label over a big value (and an optional "/ total"). */
function hudStat(label) {
  const wrap = el("div", "wx-hud-stat");
  const value = el("div", "wx-hud-value");
  const n = el("span", "wx-hud-num");
  const of = el("span", "wx-hud-of");
  value.append(n, of);
  wrap.append(el("p", "wx-label", label), value);
  return { wrap, n, of };
}

/** Race HUD (position, laps, countdown, result), drawn over the scene mount. */
export class RaceHud {
  constructor() {
    const root = el("div", "kitchen-race-hud wx-hud-root");
    const panel = el("div", "wx-hud");
    this.pos = hudStat("Position");
    this.lap = hudStat("Lap");
    this.lapBars = el("div", "wx-hud-laps");
    this.lapBars.setAttribute("aria-hidden", "true");
    this.lap.wrap.appendChild(this.lapBars);
    panel.append(this.pos.wrap, this.lap.wrap);

    this.stage = new HudStage();
    this.countdown = createCountdown();

    // Result card (kept for the API; the race uses the results popup).
    this.resultEl = el("div", "wx-stage");
    this.resultEl.style.display = "none";
    const card = el("div", "wx-panel");
    card.style.textAlign = "center";
    this.resultTitle = el("div", "wx-title wx-title-h2");
    this.resultSub = el("p", "wx-text");
    this.resultSub.style.marginTop = "8px";
    card.append(this.resultTitle, this.resultSub);
    this.resultEl.appendChild(card);

    root.append(panel, this.countdown.root, this.stage.root, this.resultEl);
    this.root = root;
    this._last = "";
  }

  /** Keep the HUD inside the current mount (the React root can be remounted). */
  attach(mount) {
    if (mount && this.root.parentNode !== mount) mount.appendChild(this.root);
  }

  setVisible(v) {
    this.root.style.display = v ? "" : "none";
  }

  setStatus(lap, laps, place, cars) {
    const key = lap + "/" + laps + "/" + place + "/" + cars;
    if (key === this._last) return;
    this._last = key;
    this.pos.n.textContent = ORDINALS[place - 1] || String(place);
    this.pos.of.textContent = `/ ${cars}`;
    this.lap.n.textContent = String(lap);
    this.lap.of.textContent = `/ ${laps}`;
    if (this.lapBars.childElementCount !== laps) this.lapBars.replaceChildren(...Array.from({ length: laps }, () => el("span")));
    [...this.lapBars.children].forEach((s, i) => {
      s.className = i < lap - 1 ? "is-done" : i === lap - 1 ? "is-now" : "";
    });
  }

  /** Countdown number (3, 2, 1): the shared countdown (no frame), its line depleting over the second. */
  setCountdown(n) {
    this.stage.show("");
    this.countdown.show(n, COUNTDOWN_STEP_SEC);
  }

  /** GO: bigger, Wix Blue, a short glow pulse (cleared by setBig("")). */
  setGo() {
    this.countdown.go();
  }

  setBig(text, color) {
    this.countdown.clear();
    this.stage.show(text, { tone: brandTone(color), tag: STAGE_TAGS[text] });
  }

  showResult(title, sub, color) {
    this.resultEl.style.display = "";
    this.resultTitle.textContent = title;
    this.resultTitle.style.color = brandTone(color);
    this.resultSub.textContent = sub;
  }

  hideResult() {
    this.resultEl.style.display = "none";
  }
}

/**
 * Knock-off counter for the meeting room arena, in the race HUD's style:
 * "Knocked off N | Remaining M", the changed number pops when a car falls,
 * plus a centre message on a panel (e.g. "You’re out!").
 */
export class KnockoutHud {
  constructor() {
    const root = el("div", "arena-knockout-hud wx-hud-root");
    root.style.display = "none";
    const panel = el("div", "wx-hud");
    this.out = hudStat("Knocked off");
    this.left = hudStat("Remaining");
    panel.append(this.out.wrap, this.left.wrap);
    this.message = new HudMessage();
    root.append(panel, this.message.root);
    this.root = root;
    this._vals = [null, null];
  }

  attach(mount) {
    if (mount && this.root.parentNode !== mount) mount.appendChild(this.root);
  }

  setVisible(v) {
    this.root.style.display = v ? "" : "none";
  }

  _pop(n, tone) {
    n.style.setProperty("--wx-tone", tone);
    replayClass(n, "is-pop");
  }

  /** Counts; the number that changed pops (unless `quiet`, e.g. on a reset). */
  setCounts(knockedOff, remaining, quiet = false) {
    const [o, r] = this._vals;
    if (knockedOff === o && remaining === r) return;
    this.out.n.textContent = String(knockedOff);
    this.left.n.textContent = String(remaining);
    if (!quiet && o !== null && knockedOff !== o) this._pop(this.out.n, POP_TONE_OUT);
    if (!quiet && r !== null && remaining !== r) this._pop(this.left.n, POP_TONE_LEFT);
    this._vals = [knockedOff, remaining];
  }

  setBig(text, color) {
    this.message.show(text, brandTone(color));
  }
}

/** Race time as m:ss.t */
export function formatRaceTime(sec) {
  if (!(sec >= 0)) return "—";
  const m = Math.floor(sec / 60);
  const r = sec - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

/** Popup eyebrow, and the editor-style name chip on the player's row. */
const POPUP_EYEBROW = "Results";
const POPUP_PLAYER_TAG = "You";

/**
 * End-of-race / round popup (design system: frosted panel, Madefor title,
 * standings with the player's row selected, pill buttons without frames). Real <button>s, so
 * mouse, Tab and Enter / Space all work.
 */
export class RaceResultsPopup {
  constructor({ onRetry, onNext, retryLabel = "Race again", nextLabel = "Next level" }) {
    this.onRetry = onRetry;
    this.onNext = onNext;
    this.open = false;
    this._hideTimer = 0;

    const root = el("div", "kitchen-race-results wx-popup");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");

    const card = el("div", "wx-panel wx-popup-card");
    const head = el("div", "wx-popup-head");
    this.eyebrow = el("p", "wx-label");
    this.marker = markerEl();
    this.eyebrow.append(this.marker, document.createTextNode(POPUP_EYEBROW));
    this.titleEl = el("h2", "wx-title wx-popup-title");
    this.titleEl.id = "kitchen-race-results-title";
    root.setAttribute("aria-labelledby", this.titleEl.id);
    this.subEl = el("p", "wx-text");
    head.append(this.eyebrow, this.titleEl, this.subEl);

    this.listEl = el("ol", "wx-standings");

    const btnRow = el("div", "wx-popup-actions");
    // No selection frames: the buttons' own hover / focus state (ui.css) shows they react.
    const retry = buttonEl(retryLabel, { variant: "secondary", size: "lg", frame: false });
    const next = buttonEl(nextLabel, { variant: "primary", size: "lg", frame: false });
    this.retryBtn = retry.button;
    this.nextBtn = next.button;
    this.nextWrap = next.wrap;
    this.retryBtn.addEventListener("click", () => this.open && this.onRetry && this.onRetry());
    this.nextBtn.addEventListener("click", () => this.open && !this.nextBtn.disabled && this.onNext && this.onNext());
    btnRow.append(retry.wrap, next.wrap);

    card.append(head, this.listEl, btnRow, frameEl());
    root.append(card);
    // Keys used here stay here (the game's own key handlers on window don't see them).
    root.addEventListener("keydown", (e) => {
      if (e.code === "Tab") {
        const f = [this.retryBtn, this.nextBtn].filter((b) => !b.disabled);
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length]?.focus();
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        const f = [this.retryBtn, this.nextBtn].filter((b) => !b.disabled);
        const i = f.indexOf(document.activeElement);
        f[(i + 1 + f.length) % f.length]?.focus();
      }
      e.stopPropagation();
    });
    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.root = root;
    this.card = card;
  }

  attach(mount) {
    if (mount && this.root.parentNode !== mount) mount.appendChild(this.root);
  }

  /**
   * @param {object} r
   * @param {string} r.title       e.g. "You win!" / "2nd place"
   * @param {string} r.color       result colour (the eyebrow marker)
   * @param {string} r.sub         one line under the title (e.g. your time)
   * @param {{place:number,name:string,color:string,time:string,isPlayer:boolean}[]} r.rows
   * @param {boolean} r.nextEnabled  false when there's no next level
   */
  show(r) {
    window.clearTimeout(this._hideTimer);
    this.titleEl.textContent = r.title;
    this.marker.style.setProperty("--wx-marker", brandTone(r.color));
    this.subEl.textContent = r.sub || "";
    this.subEl.style.display = r.sub ? "" : "none";
    this.listEl.replaceChildren(
      ...r.rows.map((row) => {
        const li = el("li", row.isPlayer ? "is-player" : "");
        const name = el("span", null, row.name);
        if (row.isPlayer) name.appendChild(el("span", "wx-standings-you", " (you)"));
        li.append(
          el("span", "wx-standings-place", ORDINALS[row.place - 1] || String(row.place)),
          markerEl(row.color),
          name,
          el("span", "wx-standings-time", row.time),
        );
        if (row.isPlayer) li.appendChild(frameEl(POPUP_PLAYER_TAG));
        return li;
      }),
    );
    this.nextBtn.disabled = !r.nextEnabled;
    this.nextWrap.style.display = r.nextEnabled ? "" : "none";
    // The only button left is the main action.
    this.retryBtn.classList.toggle("wx-btn-primary", !r.nextEnabled);
    this.retryBtn.classList.toggle("wx-btn-secondary", !!r.nextEnabled);
    this.root.style.display = "flex";
    this.open = true;
    // Next frame: animate in, focus the first button.
    requestAnimationFrame(() => {
      this.root.classList.add("is-open");
      this.retryBtn.focus({ preventScroll: true });
    });
  }

  hide(immediate = false) {
    if (!this.open && this.root.style.display === "none") return;
    this.open = false;
    if (document.activeElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.root.classList.remove("is-open");
    window.clearTimeout(this._hideTimer);
    if (immediate) {
      this.root.style.display = "none";
      return;
    }
    this._hideTimer = window.setTimeout(() => {
      if (!this.open) this.root.style.display = "none";
    }, RACE_RESULTS_ANIM_MS);
  }
}
