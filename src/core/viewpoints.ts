import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { WorldLayout } from "../../shared/worldgen";
import { WorldRadius } from "../../shared/world";
import type { SkySystem } from "../rendering/sky/skySystem";
import type { CameraRig } from "../systems/cameraRig";
import type { HiveViews } from "../world/hiveViews";

/** Kamerapunkt `towardSun`: Winkel der Sonne über der Bildmitte (Grad). */
const TowardSunMarginDeg = 10;

/** Hebt einen Punkt über alle Inseln, in deren Umriss er liegt, damit die Kamera frei steht. */
function clearPoint(layout: WorldLayout, x: number, y: number, z: number): Vector3 {
  let height = y;
  for (const island of layout.islands) {
    const reach = island.radius + 25;
    if ((island.x - x) ** 2 + (island.z - z) ** 2 < reach * reach && height > island.bottom - 25 && height < island.canopy + 25) {
      height = island.canopy + 30;
    }
  }
  return new Vector3(x, height, z);
}

/** Sucht um einen Startpunkt die dichteste Wolkenstelle (Spirale über Höhen und Abstände), damit der Punkt in einer Wolke liegt. */
function denseCloudPoint(sky: SkySystem, start: Vector3): Vector3 {
  let best = start.clone();
  let bestDensity = sky.cloudDensityAt(start);
  const probe = new Vector3();
  for (let ring = 1; ring <= 12 && bestDensity < 0.6; ring++) {
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2;
      for (const dy of [-200, 0, 200]) {
        probe.set(start.x + Math.cos(angle) * ring * 150, start.y + dy, start.z + Math.sin(angle) * ring * 150);
        const density = sky.cloudDensityAt(probe);
        if (density > bestDensity) {
          bestDensity = density;
          best = probe.clone();
        }
      }
    }
  }
  return best;
}

/** Ein benannter Kamerapunkt; berechnet Lage und Ziel beim Anwenden (Kamerapunkt). */
type ViewpointFactory = () => { position: Vector3; target: Vector3 } | "chase" | "closeUp";

/**
 * Benannte Kamerapunkte der Spec für Prüf-Agenten (Kamerapunkte): Übersicht, Wolkenmeer, Inselband,
 * Sonne, Wolkeninneres, Stöcke, Nester, Wolkenrand und die Spielkamera.
 */
export class Viewpoints {
  private readonly factories = new Map<string, ViewpointFactory>();
  private readonly rig: CameraRig;

  public constructor(layout: WorldLayout, rig: CameraRig, sky: SkySystem, hives: HiveViews) {
    this.rig = rig;
    const hive = layout.hives[0];
    const nest = layout.nests[1] ?? layout.nests[0];
    const sunward = (): Vector3 => sky.celestial.toSun.clone().multiplyByFloats(1, 0, 1).normalize();
    // Insel im mittleren Band nahe der Weltmitte (3D-Abstand), nicht tief am Wolkenrand der Kugel
    const island = [...layout.islands].filter((candidate) => !candidate.isNest).sort((a, b) => Math.hypot(a.x - 300, a.y - 250, a.z - 400) - Math.hypot(b.x - 300, b.y - 250, b.z - 400))[0];
    this.factories.set("overview", () => ({ position: clearPoint(layout, -520, 180, -1100), target: new Vector3(0, 120, 0) }));
    this.factories.set("chase", () => "chase");
    this.factories.set("closeUp", () => "closeUp");
    this.factories.set("lookDown", () => ({ position: clearPoint(layout, 200, 300, -400), target: new Vector3(900, -900, 300) }));
    this.factories.set("islandBand", () => {
      const centre = island ?? { x: 300, y: 300, z: 400, radius: 30 };
      return { position: new Vector3(centre.x - 90, centre.y + 25, centre.z - 120), target: new Vector3(centre.x, centre.y, centre.z) };
    });
    this.factories.set("towardSun", () => {
      // Blick so geneigt, dass die Sonne im oberen Bilddrittel steht und der Horizont mit dem Wolkenmeer im Bild bleibt
      const direction = sunward();
      const pitch = (Math.min(Math.max(sky.celestial.sunElevationDeg - TowardSunMarginDeg, -10), 40) * Math.PI) / 180;
      const position = clearPoint(layout, 0, 260, 0);
      const ahead = new Vector3(direction.x * Math.cos(pitch), Math.sin(pitch), direction.z * Math.cos(pitch)).scaleInPlace(1000);
      return { position, target: position.add(ahead) };
    });
    this.factories.set("awayFromSun", () => {
      const direction = sunward();
      return { position: clearPoint(layout, 0, 260, 0), target: new Vector3(-direction.x * 1000, 220, -direction.z * 1000) };
    });
    this.factories.set("insideCloud", () => {
      const inside = denseCloudPoint(sky, new Vector3(800, 600, 900));
      return { position: inside, target: inside.add(new Vector3(100, 10, 100)) };
    });
    this.factories.set("belowCloudBase", () => ({ position: new Vector3(-600, 120, 300), target: new Vector3(-500, 700, 500) }));
    this.factories.set("hive", () => {
      const h = hive ?? { x: 0, y: 120, z: 0 };
      return { position: new Vector3(h.x + 35, h.y + 8, h.z + 45), target: new Vector3(h.x, h.y, h.z) };
    });
    this.factories.set("hiveInterior", () => {
      const anchors = hives.anchorsOf(hive?.id ?? 0);
      if (anchors !== undefined) {
        return { position: anchors.hangarCamera.clone(), target: anchors.hangar.clone() };
      }
      const h = hive ?? { x: 0, y: 120, z: 0 };
      return { position: new Vector3(h.x, h.y - 1, h.z + 3), target: new Vector3(h.x, h.y - 1.5, h.z - 3) };
    });
    this.factories.set("nest", () => {
      const n = nest ?? { x: 2000, y: 400, z: 2000 };
      return { position: new Vector3(n.x + 60, n.y + 25, n.z + 70), target: new Vector3(n.x, n.y, n.z) };
    });
    this.factories.set("worldEdge", () => ({ position: new Vector3(0, 400, -(WorldRadius - 1100)), target: new Vector3(0, 450, -WorldRadius) }));
  }

  public get names(): readonly string[] {
    return [...this.factories.keys()];
  }

  public apply(name: string): void {
    const factory = this.factories.get(name);
    if (factory === undefined) {
      throw new Error(`Unbekannter Kamerapunkt: ${name}`);
    }
    const view = factory();
    if (view === "chase") {
      this.rig.resumeOrbit();
      this.rig.setOrbit(1.6, 0.18);
      return;
    }
    if (view === "closeUp") {
      this.rig.resumeOrbit();
      this.rig.setOrbit(0.6, 0.05);
      return;
    }
    this.rig.setFree(view.position, view.target);
  }
}
