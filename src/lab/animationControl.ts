import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

/** Hält Animationen auf einem festen Zeitpunkt (Standbild für Screenshots). */
export class AnimationControl {
  private readonly groups: readonly AnimationGroup[];

  constructor(groups: readonly AnimationGroup[]) {
    this.groups = groups;
  }

  /**
   * Setzt die Animation `name` (null oder "*" = alle) auf `seconds` und pausiert sie.
   * Schleifenanimationen werden auf die Dauer gefaltet.
   */
  setTime(name: string | null, seconds: number): string[] {
    const affected: string[] = [];
    for (const group of this.groups) {
      if (name !== null && name !== "*" && group.name !== name) continue;
      const framesPerSecond = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
      const span = group.to - group.from;
      const durationSeconds = span / framesPerSecond;
      const wrapped = group.loopAnimation && durationSeconds > 0 ? seconds % durationSeconds : Math.min(seconds, durationSeconds);
      group.start(false);
      group.goToFrame(group.from + wrapped * framesPerSecond);
      group.pause();
      affected.push(group.name);
    }
    return affected;
  }

  /** Beendet alle Animationen und setzt sie auf den Anfang. */
  stopAll(): void {
    for (const group of this.groups) group.stop();
  }
}
