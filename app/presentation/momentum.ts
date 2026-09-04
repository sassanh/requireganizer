/**
 * How fast playing items rush when many wait to show. The queue reports
 * how many presentable items still wait; the module also counts how many
 * already played. One continuous run opens normal, rushes through its
 * middle, and settles so its very last item is normal again. Batches that
 * land mid-run stretch the run instead of starting their own curve, and
 * the pace eases toward what the longer run calls for in capped steps —
 * it never dips and never leaps. The run resets only when the queue truly
 * drains.
 */

/** Runs this long or shorter never rush. Decided with the operator. */
const RUSH_START_AFTER = 5;

/** Never faster than this, however long the run. Decided with the operator. */
const RUSH_MAXIMUM = 3;

/** A run this long or longer cruises at the maximum. */
const RUSH_FULL_AT = 15;

/** How many opening items the climb to cruise takes. */
const RUSH_RAMP_ITEMS = 3;

/** How many closing items the settle back to normal takes. */
const RUSH_EASE_ITEMS = 3;

let finishedItems = 0;
let waitingItems = 0;

/**
 * Pace of the tick now showing, eased toward what the backlog calls for.
 * Presenters read this through the animation scalers; anything already
 * running keeps the pace it started with. Defaults to normal.
 */
let tickPace = 1;

/**
 * The cruise for a run of `run` items: normal up to the threshold,
 * then a straight ramp to the maximum.
 */
function cruiseForRun(run: number): number {
  if (run <= RUSH_START_AFTER) return 1;
  const cruise =
    1 +
    ((run - RUSH_START_AFTER) / (RUSH_FULL_AT - RUSH_START_AFTER)) *
      (RUSH_MAXIMUM - 1);
  return Math.min(RUSH_MAXIMUM, cruise);
}

/**
 * The rush factor for `waiting` items still to show (including the one
 * showing now) in a run of `run` items. Pure so tests can pin the curve:
 * the run opens normal, climbs to cruise, settles back, and ends normal.
 */
export function momentumFactorFor(waiting: number, run: number): number {
  if (!Number.isFinite(waiting) || !Number.isFinite(run)) return 1;
  const runSize = Math.max(0, Math.floor(run));
  if (runSize <= 0) return 1;
  const waitingCount = Math.min(Math.max(0, Math.floor(waiting)), runSize);
  if (waitingCount <= 0) return 1;
  const cruise = cruiseForRun(runSize);
  const finished = runSize - waitingCount;
  const rampSteps = RUSH_RAMP_ITEMS - 1;
  const rampFraction =
    finished <= 0 ? 0 : Math.min(finished, rampSteps) / rampSteps;
  const ramped = 1 + (cruise - 1) * rampFraction;
  const easeFraction =
    waitingCount > RUSH_EASE_ITEMS
      ? 1
      : (waitingCount - 1) / RUSH_EASE_ITEMS;
  const eased = 1 + (ramped - 1) * easeFraction;
  return Math.min(RUSH_MAXIMUM, Math.max(1, eased));
}

/**
 * Tell the rush how many presentable items still have to show, including
 * the one about to show now. Zero means the queue truly drained: the run
 * ends, the counters clear, and the pace is normal again. Owned by the
 * presentation queue; every other caller reads through the pace below.
 */
export function setMomentumBacklog(remainingCount: number): void {
  const remaining = Number.isFinite(remainingCount)
    ? Math.max(0, Math.floor(remainingCount))
    : 0;
  if (remaining <= 0) {
    finishedItems = 0;
    waitingItems = 0;
    tickPace = 1;
    return;
  }
  waitingItems = remaining;
}

/** Count one more played item in this run. Called as each value frame starts. */
export function noteMomentumPlayed(): void {
  finishedItems += 1;
}

/** The run length is always played plus waiting — derived, never stored. */
function currentRun(): number {
  return finishedItems + waitingItems;
}

/** The current rush factor: 1 when idle or in a short run. */
export function getMomentumFactor(): number {
  if (waitingItems <= 0 || currentRun() <= 0) return 1;
  return momentumFactorFor(waitingItems, currentRun());
}

/** Record the pace of the tick now showing. Out-of-range values normalize. */
export function setPresentationPace(pace: number): void {
  tickPace = Number.isFinite(pace) && pace > 0 ? pace : 1;
}

/** The pace of the tick now showing: 1 when idle. */
export function getPresentationPace(): number {
  return tickPace;
}

/**
 * Largest single-frame pace move, sized so the closing settle always
 * lands on normal. Upward moves use the same cap, which is what keeps
 * late batches climbing gradually instead of leaping.
 */
export function maxPaceStep(): number {
  return (RUSH_MAXIMUM - 1) / RUSH_EASE_ITEMS;
}

/**
 * Ease the handed-out pace toward what the backlog calls for, capped to
 * one step. Late batches stretch the climb instead of dipping or leaping
 * it; the drain still settles exactly onto normal.
 */
export function settleMomentumPace(): number {
  const desired =
    waitingItems <= 0 || currentRun() <= 0
      ? 1
      : momentumFactorFor(waitingItems, currentRun());
  const step = maxPaceStep();
  const moved =
    desired > tickPace
      ? Math.min(tickPace + step, desired)
      : Math.max(tickPace - step, desired);
  tickPace = Math.min(RUSH_MAXIMUM, Math.max(1, moved));
  return tickPace;
}
