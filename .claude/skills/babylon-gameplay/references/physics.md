# Physik mit Havok (Physics V2)

## Einrichten

```ts
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { Scene } from "@babylonjs/core/scene";
// Side-Effect-Imports: scene.enablePhysics(), node.physicsBody, onBefore/AfterPhysicsObservable
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";

/** Bitmasken der Kollisionsebenen (Kollisionsebene). */
export const CollisionLayer = {
  Player: 1 << 0,
  Pickup: 1 << 1,
  World: 1 << 2,
  Hazard: 1 << 3,
} as const;

/** Lädt das Havok-WASM über eine von Vite aufgelöste URL und aktiviert Physics V2. */
export async function enableHavokPhysicsAsync(scene: Scene, gravity = new Vector3(0, -9.81, 0)): Promise<HavokPlugin> {
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  const plugin = new HavokPlugin(true, havok);
  scene.enablePhysics(gravity, plugin);
  return plugin;
}
```

- `vite.config.ts`: `optimizeDeps: { exclude: ["@babylonjs/havok"] }` — sonst 404 auf die WASM
  im Dev-Server. Der Produktions-Build legt eine gehashte `HavokPhysics-*.wasm` ab (~2 MB).
- Die Havok-Instanz immer explizit übergeben; ohne sie greift das Plugin auf ein globales `HK`.
- Havok braucht WASM-SIMD (iOS ab 16.4).
- Plugin-Optionen (3. Parameter): `maxQueryCollectorHits`, `floatingOriginWorldRadius`,
  `disableWorldRegions`.

## Bausteine

| Baustein | Wichtig |
|---|---|
| `PhysicsAggregate(node, shapeType \| shape, { mass, friction, restitution, radius, extents, center, mesh, startAsleep, isTriggerShape }, scene)` | Masse 0 → `STATIC`, sonst `DYNAMIC`; Wechsel über `aggregate.body.setMotionType()`. `dispose()` gibt Körper, Form und Material frei. |
| `PhysicsBody(node, motionType, startsAsleep, scene)` | Legt `rotationQuaternion` am Knoten an — ab dann steuert ausschließlich `rotationQuaternion` die Drehung. Methoden: `setLinearVelocity`, `applyForce`, `applyImpulse`, `setGravityFactor`, `setLinearDamping`, `setMassProperties`, `setTargetTransform`, `setPrestepType`. |
| Formen `PhysicsShapeSphere`, `…Capsule`, `…Cylinder`, `…Box`, `…ConvexHull`, `…Mesh`, `…Container`, `…HeightField`, `…GroundMesh` | `isTrigger`, `filterMembershipMask`, `filterCollideMask`, `material = { friction, restitution }`, `density`. Ein Körper-`dispose()` entsorgt seine Form nicht (Formen sind teilbar). |
| `PhysicsMotionType` | `STATIC`, `ANIMATED` (Havok-intern „kinematisch"), `DYNAMIC` |
| `PhysicsPrestepType` | `DISABLED` (Standard: Knotenänderungen erreichen den Körper nicht), `TELEPORT`, `ACTION` (liest `node.absolutePosition`, Weltmatrix muss aktuell sein) |

## Verhalten (Laufzeittest, Havok 1.3.14, 120 Schritte bei 60 Hz)

| Bewegter Körper | Durch statischen Trigger | Gegen statische Wand |
|---|---|---|
| `DYNAMIC` (gravityFactor 0, Geschwindigkeit gesetzt) | ENTERED / EXITED | blockiert; COLLISION_STARTED und CONTINUED |
| `ANIMATED` (Geschwindigkeit oder ACTION-Prestep) | ENTERED / EXITED | **fliegt durch, kein Ereignis** |
| `PhysicsCharacterController` | ENTERED / EXITED (Kollider ist sein interner Körper `"CCTransformNode"`) | blockiert, gleitet entlang |

## Trigger: Sammelobjekte

```ts
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeSphere } from "@babylonjs/core/Physics/v2/physicsShape";
import { PhysicsEventType, PhysicsMotionType, type IBasePhysicsCollisionEvent } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { CollisionLayer } from "./havok";

/** Verwaltet einsammelbare Objekte als statische Trigger-Volumen (Sammelobjekt). */
export class PickupField {
  private readonly scene: Scene;
  private readonly plugin: HavokPlugin;
  private readonly onCollected: (node: TransformNode) => void;
  private readonly shape: PhysicsShapeSphere;
  private readonly bodies = new Map<PhysicsBody, TransformNode>();
  private readonly observer: Observer<IBasePhysicsCollisionEvent>;

  public constructor(scene: Scene, plugin: HavokPlugin, onCollected: (node: TransformNode) => void, radius = 0.75) {
    this.scene = scene;
    this.plugin = plugin;
    this.onCollected = onCollected;
    // Ein gemeinsames Trigger-Shape für alle Sammelobjekte; reagiert nur auf die Spieler-Ebene
    this.shape = new PhysicsShapeSphere(Vector3.Zero(), radius, scene);
    this.shape.isTrigger = true;
    this.shape.filterMembershipMask = CollisionLayer.Pickup;
    this.shape.filterCollideMask = CollisionLayer.Player;
    this.observer = plugin.onTriggerCollisionObservable.add((event) => this.handleTrigger(event));
  }

  public add(node: TransformNode): void {
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = this.shape;
    this.bodies.set(body, node);
  }

  private handleTrigger(event: IBasePhysicsCollisionEvent): void {
    if (event.type !== PhysicsEventType.TRIGGER_ENTERED) {
      return;
    }
    // Reihenfolge von collider und collidedAgainst ist nicht festgelegt
    const body = this.bodies.has(event.collider) ? event.collider : event.collidedAgainst;
    const node = this.bodies.get(body);
    if (!node) {
      return;
    }
    this.bodies.delete(body);
    // Entsorgen erst nach Abschluss des Physik-Schritts
    this.scene.onAfterPhysicsObservable.addOnce(() => body.dispose());
    this.onCollected(node);
  }

  public dispose(): void {
    this.plugin.onTriggerCollisionObservable.remove(this.observer);
    for (const body of this.bodies.keys()) {
      body.dispose();
    }
    this.bodies.clear();
    this.shape.dispose();
  }
}
```

- Trigger melden sich nur über `plugin.onTriggerCollisionObservable`; ein Aktivierungsaufruf ist
  nicht nötig. Filtermasken gelten auch für Trigger.
- Statische Trigger bewegen sich nicht mit dem Knoten (Prestep `DISABLED`). Schwebende
  Sammelobjekte: Optik als Kindknoten animieren, den Trigger-Knoten ruhen lassen.

## Flugfigur

```ts
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsCharacterController } from "@babylonjs/core/Physics/v2/characterController";
import { PhysicsShapeSphere } from "@babylonjs/core/Physics/v2/physicsShape";
import { PhysicsEventType, PhysicsShapeType, type IPhysicsCollisionEvent } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { CollisionLayer } from "../physics/havok";

/** Kinematischer Flugkörper des Spielers auf Basis des Character Controllers (Flugkörper). */
export class FlightBody {
  private readonly controller: PhysicsCharacterController;
  private readonly probeDirection = new Vector3(0, -1, 0);
  private readonly noGravity = Vector3.Zero();

  public constructor(scene: Scene, start: Vector3, radius = 0.25) {
    const shape = new PhysicsShapeSphere(Vector3.Zero(), radius, scene);
    shape.filterMembershipMask = CollisionLayer.Player;
    shape.filterCollideMask = CollisionLayer.World | CollisionLayer.Pickup | CollisionLayer.Hazard;
    this.controller = new PhysicsCharacterController(start, { shape }, scene);
  }

  /** Ein Simulationsschritt; dt in Sekunden, desiredVelocity in Metern pro Sekunde. */
  public step(dt: number, desiredVelocity: Vector3): void {
    const support = this.controller.checkSupport(dt, this.probeDirection);
    this.controller.setVelocity(desiredVelocity);
    this.controller.integrate(dt, support, this.noGravity);
  }

  public get position(): Vector3 {
    return this.controller.getPosition();
  }

  public teleport(position: Vector3): void {
    this.controller.setPosition(position);
  }

  public dispose(): void {
    this.controller.dispose();
  }
}

/** Alternative: dynamischer Körper ohne Schwerkraft mit Kontaktereignissen (Hindernis-Treffer). */
export function createDynamicFlyer(mesh: Mesh, onHit: (event: IPhysicsCollisionEvent) => void): PhysicsAggregate {
  const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.SPHERE, { mass: 1, restitution: 0 });
  aggregate.body.setGravityFactor(0);
  aggregate.body.setMassProperties({ mass: 1, inertia: Vector3.Zero() }); // kein Taumeln
  aggregate.body.setLinearDamping(2);
  aggregate.shape.filterMembershipMask = CollisionLayer.Player;
  aggregate.body.setCollisionCallbackEnabled(true);
  aggregate.body.getCollisionObservable().add((event) => {
    if (event.type === PhysicsEventType.COLLISION_STARTED) {
      onHit(event);
    }
  });
  return aggregate;
}
```

- Der Character Controller ist intern ein `ANIMATED`-Körper mit `TELEPORT`-Prestep; seine
  Shape-Casts ignorieren Trigger, Trigger-Volumen meldet das Plugin.
- Hindernistreffer lösen beim Controller **kein** Kontaktereignis aus. Gefahren als größere
  Trigger auf der Ebene `Hazard` modellieren oder Wunsch- und Ist-Geschwindigkeit vergleichen.
- Sein eigenes `onTriggerCollisionObservable` feuert nur, wenn er einen `DYNAMIC`-Körper schiebt.
- `moveWithCollisions` teilt durch `scene.deltaTime` (nur vom Animationssystem gesetzt) — im
  festen Takt `setVelocity` + `integrate(dt)` verwenden.

## Kollisionsereignisse

- `body.setCollisionCallbackEnabled(true)` → `COLLISION_STARTED`, `COLLISION_CONTINUED` über
  `body.getCollisionObservable()`.
- `body.setCollisionEndedCallbackEnabled(true)` → `COLLISION_FINISHED` über
  `getCollisionEndedObservable()`.
- Weltweit: `plugin.onCollisionObservable`, `plugin.onCollisionEndedObservable`.
- Nutzlast `IPhysicsCollisionEvent`: `collider`, `collidedAgainst`, `type`, `point`, `normal`,
  `distance`, `impulse`.

## Raycasts

```ts
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";

const hit = new PhysicsRaycastResult(); // wiederverwenden, nicht pro Aufruf neu anlegen
plugin.raycast(from, to, hit, { collideWith: CollisionLayer.World, shouldHitTriggers: false });
if (hit.hasHit) {
  // hit.hitPointWorld, hit.hitNormalWorld, hit.hitDistance, hit.body, hit.shape
}
```

Weitere Abfragen am Plugin: `shapeCast`, `pointProximity`, `shapeProximity`; an der Engine:
`raycastToRef`, `raycast`, `raycastMulti`.

## Doku-Abweichungen

- Die Prestep-Doku beschreibt `disablePreStep` vertauscht: Im Quelltext schaltet `false`
  TELEPORT ein.
- Das Ende-Ereignis heißt `COLLISION_FINISHED` (die Doku schreibt „COLLISION_ENDED").
