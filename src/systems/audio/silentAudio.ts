import type { AudioApi } from "./audioTypes";

/**
 * Stummes Tonsystem (Stummschaltung): ersetzt das Tonsystem, wenn der Browser keinen AudioContext anlegen kann
 * (kein Ausgabegerät, blockierte Wiedergabe). Das Spiel läuft dann ohne Ton weiter.
 */
export class SilentAudio implements AudioApi {
  public unlockAsync(): Promise<void> {
    return Promise.resolve();
  }

  public setVolumes(): void {}

  public playUi(): void {}

  public playAt(): void {}

  public setListener(): void {}

  public setWingBuzz(): void {}

  public setNearestFly(): void {}

  public setEnvironment(): void {}

  public setNightFactor(): void {}

  public dispose(): void {}
}
