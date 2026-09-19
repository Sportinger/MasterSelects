interface VirtualDirectoryNode {
  name: string;
  directories: Map<string, VirtualDirectoryNode>;
  files: Map<string, File>;
}

class VirtualFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  private readonly file: File;

  constructor(name: string, file: File) {
    this.name = name;
    this.file = file;
  }

  async getFile(): Promise<File> {
    return this.file;
  }
}

class VirtualDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly node: VirtualDirectoryNode;

  constructor(node: VirtualDirectoryNode) {
    this.node = node;
  }

  get name(): string {
    return this.node.name;
  }

  async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
    const directory = this.node.directories.get(name);
    if (!directory) throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
    return new VirtualDirectoryHandle(directory) as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string): Promise<FileSystemFileHandle> {
    const file = this.node.files.get(name);
    if (!file) throw new DOMException(`File not found: ${name}`, 'NotFoundError');
    return new VirtualFileHandle(name, file) as unknown as FileSystemFileHandle;
  }

  async *entries(): AsyncIterableIterator<[
    string,
    FileSystemDirectoryHandle | FileSystemFileHandle,
  ]> {
    for (const [name, directory] of this.node.directories) {
      yield [name, new VirtualDirectoryHandle(directory) as unknown as FileSystemDirectoryHandle];
    }
    for (const [name, file] of this.node.files) {
      yield [name, new VirtualFileHandle(name, file) as unknown as FileSystemFileHandle];
    }
  }

  async *values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle> {
    for await (const [, handle] of this.entries()) yield handle;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[
    string,
    FileSystemDirectoryHandle | FileSystemFileHandle,
  ]> {
    return this.entries();
  }
}

export function virtualFilePath(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return (path || file.name).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function createVirtualDirectoryHandle(files: File[]): FileSystemDirectoryHandle {
  return createVirtualDirectoryHandleFromEntries(
    files.map((file) => ({ file, path: virtualFilePath(file) })),
  );
}

export function createVirtualDirectoryHandleFromEntries(
  entries: Array<{ file: File; path: string }>,
): FileSystemDirectoryHandle {
  if (entries.length === 0) throw new Error('Choose a dataset folder containing images/ and sparse/.');
  const paths = entries.map(({ path }) => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
  const firstSegments = paths.map((path) => path.split('/')[0]);
  const selectedRoot = firstSegments.every((segment) => segment === firstSegments[0])
    && paths.every((path) => path.includes('/'))
    ? firstSegments[0]
    : 'dataset';
  const root: VirtualDirectoryNode = {
    name: selectedRoot,
    directories: new Map(),
    files: new Map(),
  };

  entries.forEach(({ file }, index) => {
    const parts = paths[index].split('/').filter(Boolean);
    if (parts[0] === selectedRoot && parts.length > 1) parts.shift();
    const fileName = parts.pop();
    if (!fileName) return;
    let directory = root;
    for (const name of parts) {
      let child = directory.directories.get(name);
      if (!child) {
        child = { name, directories: new Map(), files: new Map() };
        directory.directories.set(name, child);
      }
      directory = child;
    }
    directory.files.set(fileName, file);
  });

  return new VirtualDirectoryHandle(root) as unknown as FileSystemDirectoryHandle;
}
