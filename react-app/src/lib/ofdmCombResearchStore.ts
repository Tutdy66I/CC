import {
  parseOfdmCombCheckpoint,
  type OfdmCombCheckpoint,
  type OfdmCombRecord,
} from "./ofdmCombResearchRecord.js";
export interface OfdmCombStoredState {
  revision: number;
  checkpoint: unknown | null;
  records: unknown[];
}
const DATABASE = "signallab-ofdm-comb-v13";
let connection: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () =>
        reject(
          request.error ?? new Error("OFDM 本地存储不可用；请导出 JSON。"),
        );
      request.onblocked = () => {
        blocked = true;
        reject(new Error("请关闭旧 OFDM 页面后重试。"));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
    }).catch((cause) => {
      connection = undefined;
      throw cause;
    });
  return connection;
}
export function validateOfdmCombStoredState(
  value: unknown,
): OfdmCombStoredState {
  if (value === undefined)
    return { revision: 0, checkpoint: null, records: [] };
  const v = value as OfdmCombStoredState;
  if (
    !v ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !Array.isArray(v.records) ||
    v.records.length > 2 ||
    !("checkpoint" in v) ||
    (v.checkpoint !== null &&
      (!v.checkpoint ||
        typeof v.checkpoint !== "object" ||
        Array.isArray(v.checkpoint))) ||
    v.records.some((r) => !r || typeof r !== "object" || Array.isArray(r))
  )
    throw new Error("OFDM 本地数据损坏；已保留原文。");
  return v;
}
export async function readOfdmCombState(): Promise<OfdmCombStoredState> {
  return validateOfdmCombStoredState(await readOfdmCombRawState());
}
export async function readOfdmCombRawState(): Promise<unknown> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly"),
      r = tx.objectStore("state").get("current");
    tx.oncomplete = () => {
      try {
        resolve(r.result);
      } catch (e) {
        reject(e);
      }
    };
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
async function save(
  record: OfdmCombCheckpoint,
  expected: number,
  complete: boolean,
): Promise<number> {
  const parsed = await parseOfdmCombCheckpoint(record);
  if (complete !== (parsed.status === "complete"))
    throw new Error("OFDM 记录状态不匹配。");
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state"),
      r = store.get("current");
    let error: unknown,
      revision = 0;
    r.onsuccess = () => {
      try {
        const v = validateOfdmCombStoredState(r.result);
        if (v.revision !== expected)
          throw new Error(
            "另一页面已修改 OFDM 记录；请导出当前结果后重新加载。",
          );
        revision = expected + 1;
        if (!Number.isSafeInteger(revision))
          throw new Error("OFDM 修订号溢出。");
        store.put(
          {
            revision,
            checkpoint: complete ? null : parsed,
            records: complete
              ? [
                  parsed,
                  ...v.records.filter(
                    (x) =>
                      (x as OfdmCombCheckpoint)?.integrityHash !==
                      parsed.integrityHash,
                  ),
                ].slice(0, 2)
              : v.records,
          },
          "current",
        );
      } catch (cause) {
        error = cause;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(revision);
    tx.onabort = () =>
      reject(error ?? tx.error ?? new Error("OFDM 保存失败；请导出内存结果。"));
    tx.onerror = () => reject(tx.error);
  });
}
export const saveOfdmCombCheckpoint = (
  record: OfdmCombCheckpoint,
  revision: number,
) => save(record, revision, false);
export const saveOfdmCombRecord = (record: OfdmCombRecord, revision: number) =>
  save(record, revision, true);
