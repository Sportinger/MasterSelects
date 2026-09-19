/** Open lifecycle shared by project data and integration-credential storage. */
export function openDatabase(
  name: string,
  version: number,
  upgrade: (database: IDBDatabase, event: IDBVersionChangeEvent, transaction: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    let failed = false;
    const closeResult = () => {
      try { request.result?.close(); } catch { /* No usable connection remains. */ }
    };
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      reject(error);
    };
    const databaseResult = () => {
      const database = request.result;
      if (!database?.objectStoreNames) {
        throw new DOMException(`IndexedDB ${name} returned no database connection`, 'InvalidStateError');
      }
      return database;
    };
    request.onerror = () => {
      fail(request.error ?? new DOMException(`IndexedDB ${name} open failed`, 'UnknownError'));
    };
    request.onupgradeneeded = event => {
      if (failed) return;
      try {
        const database = databaseResult();
        if (!request.transaction) {
          throw new DOMException(`IndexedDB ${name} returned no upgrade transaction`, 'InvalidStateError');
        }
        upgrade(database, event, request.transaction);
      } catch (error) {
        // A throw from an asynchronous event handler does not reject the
        // surrounding promise. Roll back partial migration and settle explicitly.
        fail(error);
        try { request.transaction?.abort(); } catch { /* Already ended/unavailable. */ }
        closeResult();
      }
    };
    request.onsuccess = () => {
      if (failed) {
        closeResult();
        return;
      }
      try { resolve(databaseResult()); }
      catch (error) { fail(error); closeResult(); }
    };
  });
}
