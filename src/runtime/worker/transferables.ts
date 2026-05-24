function isTransferableObject(value: unknown): value is Transferable {
  if (value instanceof ArrayBuffer) {
    return true;
  }

  if (typeof MessagePort !== 'undefined' && value instanceof MessagePort) {
    return true;
  }

  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) {
    return true;
  }

  if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) {
    return true;
  }

  return false;
}

function transferableFromView(value: unknown): Transferable | undefined {
  if (!ArrayBuffer.isView(value)) {
    return undefined;
  }

  return value.buffer instanceof ArrayBuffer ? value.buffer : undefined;
}

export function createRuntimeTransferList(value: unknown): Transferable[] {
  const transferables: Transferable[] = [];
  const seenObjects = new WeakSet<object>();
  const seenTransferables = new WeakSet<object>();

  const visit = (entry: unknown): void => {
    if (entry === null || entry === undefined) {
      return;
    }

    const viewTransferable = transferableFromView(entry);
    if (viewTransferable) {
      if (!seenTransferables.has(viewTransferable)) {
        seenTransferables.add(viewTransferable);
        transferables.push(viewTransferable);
      }
      return;
    }

    if (isTransferableObject(entry)) {
      if (typeof entry === 'object' && !seenTransferables.has(entry)) {
        seenTransferables.add(entry);
        transferables.push(entry);
      }
      return;
    }

    if (typeof entry !== 'object') {
      return;
    }

    if (seenObjects.has(entry)) {
      return;
    }
    seenObjects.add(entry);

    if (Array.isArray(entry)) {
      (entry as unknown[]).forEach(visit);
      return;
    }

    Object.values(entry as Record<string, unknown>).forEach(visit);
  };

  visit(value);
  return transferables;
}
