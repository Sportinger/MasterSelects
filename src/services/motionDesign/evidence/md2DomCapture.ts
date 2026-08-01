const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

interface RasterDimensions {
  width: number;
  height: number;
}

function positiveFinite(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function numericLength(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?(?:px)?$/i.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return positiveFinite(parsed);
}

function viewBoxDimensions(svg: SVGSVGElement): RasterDimensions | null {
  const values = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length !== 4) return null;
  const width = positiveFinite(values[2] ?? Number.NaN);
  const height = positiveFinite(values[3] ?? Number.NaN);
  return width && height ? { width, height } : null;
}

function resolveRasterDimensions(svg: SVGSVGElement): RasterDimensions {
  const rect = svg.getBoundingClientRect();
  const viewBox = viewBoxDimensions(svg);
  const width = positiveFinite(rect.width)
    ?? numericLength(svg.getAttribute('width'))
    ?? viewBox?.width
    ?? null;
  const height = positiveFinite(rect.height)
    ?? numericLength(svg.getAttribute('height'))
    ?? viewBox?.height
    ?? null;
  if (width === null || height === null) {
    throw new Error('Cannot rasterize an SVG with zero or invalid dimensions');
  }
  return { width, height };
}

function isStylableElement(element: Element): element is Element & { style: CSSStyleDeclaration } {
  return 'style' in element;
}

function inlineComputedStyle(source: Element, clone: Element): void {
  const view = source.ownerDocument.defaultView;
  if (!view) throw new Error('Cannot rasterize an SVG without a document window');
  const computed = view.getComputedStyle(source);
  if (isStylableElement(clone)) {
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index);
      if (!property) continue;
      const value = computed.getPropertyValue(property);
      if (!value) continue;
      clone.style.setProperty(property, value, computed.getPropertyPriority(property));
    }
  }

  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  sourceChildren.forEach((sourceChild, index) => {
    const cloneChild = cloneChildren[index];
    if (cloneChild) inlineComputedStyle(sourceChild, cloneChild);
  });
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
        cleanup();
        reject(new Error('Rasterized SVG image has zero or invalid dimensions'));
        return;
      }
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Failed to decode rasterized SVG image'));
    };
    image.src = url;
  });
}

/** Rasterize the actual Graph or Motion Path SVG after freezing its computed CSS. */
export async function rasterizeMd2SvgElement(svg: SVGSVGElement): Promise<string> {
  const dimensions = resolveRasterDimensions(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const isMotionPathOverlay = svg.hasAttribute('data-motion-path-overlay');
  if (isMotionPathOverlay) {
    // MotionPathOverlay owns all visual paint through SVG presentation
    // attributes. Copying its live computed layout styles into a standalone
    // image can retain parent-dependent overlay state and blank the raster.
    clone.removeAttribute('style');
    const background = document.createElementNS(SVG_NAMESPACE, 'rect');
    background.setAttribute('data-md2-capture-background', 'motion-path');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', '#11151b');
    clone.prepend(background);
  } else {
    inlineComputedStyle(svg, clone);
  }

  // Root positioning belongs to the live overlay's parent layout. Preserving
  // it in the standalone SVG would translate an absolutely centered overlay
  // outside its own raster viewport.
  clone.style.setProperty('position', 'static');
  clone.style.setProperty('left', '0px');
  clone.style.setProperty('top', '0px');
  clone.style.setProperty('transform', 'none');

  clone.setAttribute('xmlns', SVG_NAMESPACE);
  clone.setAttribute('width', String(dimensions.width));
  clone.setAttribute('height', String(dimensions.height));
  if (!clone.hasAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${dimensions.width} ${dimensions.height}`);
  }

  const serialized = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadSvgImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(dimensions.width);
    canvas.height = Math.ceil(dimensions.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create a canvas context for MD2 SVG capture');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('MD2 SVG capture did not produce a PNG data URL');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
