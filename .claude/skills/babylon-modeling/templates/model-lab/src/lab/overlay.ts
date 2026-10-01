import type { PixelRect } from "./types";

export interface TileLabel {
  rect: PixelRect;
  text: string;
}

/** Beschriftungsebene (HTML) über dem Canvas: Kopfzeile und Kachelbeschriftungen. */
export class Overlay {
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  render(header: string, tiles: readonly TileLabel[]): void {
    this.host.replaceChildren();
    const headerElement = document.createElement("div");
    headerElement.className = "lab-header";
    headerElement.textContent = header;
    this.host.append(headerElement);
    for (const tile of tiles) {
      const element = document.createElement("div");
      element.className = "lab-tile";
      element.style.left = `${tile.rect.x}px`;
      element.style.top = `${tile.rect.y}px`;
      element.style.width = `${tile.rect.width}px`;
      element.style.height = `${tile.rect.height}px`;
      const caption = document.createElement("span");
      caption.textContent = tile.text;
      element.append(caption);
      this.host.append(element);
    }
  }
}
