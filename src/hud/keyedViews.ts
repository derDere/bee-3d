// src/hud/keyedViews.ts — ordnet Modellzeilen über Schlüssel wiederverwendeten DOM-Ansichten zu.

/** Ansicht, die eine Schlüsselliste verwaltet (Listenansicht). */
export interface KeyedView {
  readonly element: HTMLElement;
  /** Abgleichsrunde, in der die Ansicht zuletzt gebraucht wurde. */
  seen: number;
}

/**
 * Schlüsselliste (Schlüsselliste): Je Frame `begin()`, dann `claim(key)` für jede Modellzeile und
 * `end()`; Ansichten ohne Zeile gibt `end()` an den Freigabe-Rückruf. `arrange()` bringt die DOM-Reihenfolge
 * in die Reihenfolge der zuletzt beanspruchten Schlüssel und verschiebt nur Elemente, die falsch stehen.
 */
export class KeyedViews<TView extends KeyedView, TKey = number> {
  private readonly views = new Map<TKey, TView>();
  private readonly order: TView[] = [];
  private readonly create: (key: TKey) => TView;
  private readonly release: (view: TView) => void;
  private generation = 0;

  public constructor(create: (key: TKey) => TView, release: (view: TView) => void) {
    this.create = create;
    this.release = release;
  }

  public get size(): number {
    return this.views.size;
  }

  public begin(): void {
    this.generation++;
    this.order.length = 0;
  }

  /** Liefert die Ansicht zum Schlüssel, legt sie bei Bedarf an und merkt ihre Position vor. */
  public claim(key: TKey): TView {
    let view = this.views.get(key);
    if (view === undefined) {
      view = this.create(key);
      this.views.set(key, view);
    }
    view.seen = this.generation;
    this.order.push(view);
    return view;
  }

  public end(): void {
    for (const [key, view] of this.views) {
      if (view.seen !== this.generation) {
        this.views.delete(key);
        this.release(view);
      }
    }
  }

  /** Ordnet die Elemente im Container in der Reihenfolge der Ansprüche an (nach `end()` aufrufen). */
  public arrange(container: HTMLElement): void {
    const children = container.children;
    for (let index = 0; index < this.order.length; index++) {
      const element = this.order[index].element;
      if (children[index] !== element) {
        container.insertBefore(element, children[index] ?? null);
      }
    }
  }

  /** Gibt alle Ansichten frei. */
  public clear(): void {
    for (const view of this.views.values()) {
      this.release(view);
    }
    this.views.clear();
    this.order.length = 0;
  }
}
