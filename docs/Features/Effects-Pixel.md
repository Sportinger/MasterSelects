# Pixel & Mosaic

Rebuild the picture from cells, tiles and blocks: mosaics, retro low-resolution looks and cells that
drift. Add one in **Properties → Effects → + Add Effect → Pixel & Mosaic**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: pixel -->

## Which one?

| Look | Use |
|---|---|
| plain squares, hiding a face | [Pixelate](./effects/pixelate.md) |
| an old computer game | [Blockify](./effects/blockify.md) |
| a tiled wall with grout | [Block Mosaic](./effects/block-mosaic.md) |
| small blocks on detail, big ones on flat areas | [Quadtree Zoom](./effects/quadtree-zoom.md) |
| blocks with a few poster colours | [Pixel Poster](./effects/pixel-poster.md) |
| tiles that jitter and drift | [Scatter Mosaic](./effects/scatter-mosaic.md) |
| shattered-glass cells | [Voronoi](./effects/voronoi.md) |
| streaks of sorted pixels | [Pixel Sort](#pixel-sort) |

## The shared idea

Pixelate, Blockify and Block Mosaic paint each cell in the average colour of the pixels it covers.
They share one small node graph you can open: select the clip, open the **Nodes** tab and use the ›
on the effect's card, then on each folder ([The node setup](./Effects.md#the-node-setup)).

<figure class="docs-shot docs-shot--graph">

![The Pixelate graph from left to right: Pixel Size feeds Cell Size; Cell Size and Pixel Position feed Centred Cell Grid; Input Frame feeds Premultiplied Source; the grid and the source feed Row Average (cached), then Column Average, then Straight Alpha Output](assets/effects/graphs/pixelate.webp)

<figcaption>Pixelate as it opens in the Node Workspace, with the Constants and Coordinates folders and the Output card left out.</figcaption>
</figure>

- **Cell Size** turns the size control into whole pixels of the rendered frame, and **Centred Cell
  Grid** finds where each pixel's cell starts and ends.
- **Row Average** and **Column Average** average the cell in two short passes.
- [Blockify](./effects/blockify.md#node-setup) adds a **Posterize** folder after the average,
  [Block Mosaic](./effects/block-mosaic.md#node-setup) a **Large Tiles** folder before the grid and a
  **Grout** folder after it; both end with **Mix with Original** for Amount.

## Technical details

Notes for developers on Pixelate, Blockify and Block Mosaic; each effect page adds its own limits.

- **Cell grid.** Pixel Size, Block Size, Tile Size and Grout Width are pixels of a 1080p frame,
  rounded to whole rendered pixels, so preview, export and 4K show the same blocks relative to the
  picture. The grid is anchored at the frame centre: cells grow and shrink about the middle when the
  size is animated, and cells at the frame edges are cut by the frame.
- **Average.** A cached row average and a column average are exact up to 128 rendered pixels per
  cell; larger cells average 64 evenly spread pairs of pixels per row and column.
- **Transparency.** The average reads a premultiplied `rgba16float` copy of the frame and is
  unpremultiplied, so transparent pixels never darken a cell.
- **Software preview and export.** Without WebGPU, Pixelate runs as a hand-written pass that averages
  every cell exactly, within 1/255 of the graph; Blockify, Block Mosaic and edited graphs run
  through the graph interpreter, which is slower.
- **Code.** The recipes live in `src/services/operators/cellGridRecipes.ts`. More:
  [Effect system: editable mirror, split and pixel graphs](./Effect-System.md#editable-mirror-split-and-pixel-graphs),
  [Node Catalog](./Node-Catalog.md) and [Operator Graph Compiler](./Operator-Graph-Compiler.md).
- **Pictures.** The `mirror-pixel.json` manifests in `scripts/effect-lab-shots/`,
  `scripts/effect-editor-shots/` and `scripts/effect-graph-shots/` regenerate the stills and graphs.
