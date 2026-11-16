/**
 * Kitchen race: track shape, lap / checkpoint tracking, AI drivers and HUD.
 *
 * Pure logic (no three.js / cannon objects): the scene module owns the cars and
 * feeds positions in. The track is a stadium loop on the xz plane around a
 * capsule-shaped island: far straight (z = z0 + radius, driven toward +x),
 * right half-circle, near straight (z = z0 - radius, driven toward -x), left
 * half-circle — counter-clockwise seen from above.
 */

export const RACE_LAPS = 4;
export const RACE_CHECKPOINTS = 8;
export const RACE_COUNTDOWN_SEC = 3;
/** AI stuck check: moved less than this (world units) over the window → back out. */
export const RACE_AI_STUCK_WINDOW = 2;
export const RACE_AI_STUCK_DIST = 1.5;
export const RACE_AI_REVERSE_SEC = 1;

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
    if (d === 1) this.count++;
    else if (d === N - 1) this.count--;
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
    const lim = Math.max(0, track.laneHalf - 1.1);
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

/** Race HUD (lap, position, countdown, result), drawn over the scene mount. */
export class RaceHud {
  constructor() {
    const root = document.createElement("div");
    root.className = "kitchen-race-hud";
    Object.assign(root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "5",
      font: "800 16px/1.2 system-ui, sans-serif",
      color: "#fff",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "absolute",
      top: "16px",
      left: "16px",
      padding: "10px 14px",
      borderRadius: "10px",
      background: "rgba(9, 9, 20, 0.62)",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      minWidth: "120px",
    });
    this.lapEl = document.createElement("div");
    this.posEl = document.createElement("div");
    this.posEl.style.fontSize = "26px";
    panel.append(this.posEl, this.lapEl);

    this.bigEl = document.createElement("div");
    Object.assign(this.bigEl.style, {
      position: "absolute",
      left: "50%",
      top: "38%",
      transform: "translate(-50%, -50%)",
      fontSize: "min(22vw, 140px)",
      fontWeight: "900",
      textShadow: "0 4px 24px rgba(0,0,0,0.6)",
      display: "none",
    });

    this.resultEl = document.createElement("div");
    Object.assign(this.resultEl.style, {
      position: "absolute",
      left: "50%",
      top: "40%",
      transform: "translate(-50%, -50%)",
      padding: "22px 30px",
      borderRadius: "14px",
      background: "rgba(9, 9, 20, 0.78)",
      textAlign: "center",
      display: "none",
      maxWidth: "calc(100vw - 32px)",
      boxSizing: "border-box",
    });
    this.resultTitle = document.createElement("div");
    this.resultTitle.style.fontSize = "34px";
    this.resultSub = document.createElement("div");
    Object.assign(this.resultSub.style, {
      marginTop: "10px",
      fontSize: "13px",
      fontWeight: "600",
      opacity: "0.8",
    });
    this.resultEl.append(this.resultTitle, this.resultSub);

    root.append(panel, this.bigEl, this.resultEl);
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
    this.lapEl.textContent = `Lap ${lap}/${laps}`;
    this.posEl.textContent = `${ORDINALS[place - 1] || place} / ${cars}`;
  }

  setBig(text, color) {
    if (!text) {
      this.bigEl.style.display = "none";
      return;
    }
    this.bigEl.style.display = "";
    this.bigEl.textContent = text;
    this.bigEl.style.color = color || "#fff";
  }

  showResult(title, sub, color) {
    this.resultEl.style.display = "";
    this.resultTitle.textContent = title;
    this.resultTitle.style.color = color || "#fff";
    this.resultSub.textContent = sub;
  }

  hideResult() {
    this.resultEl.style.display = "none";
  }
}
