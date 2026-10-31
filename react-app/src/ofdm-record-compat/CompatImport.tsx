import { useEffect, useState } from 'react'
import { validateOriginal, type Validation } from './v1/reader'
import {
  exportStoredOriginal,
  listOriginals,
  loadOriginal,
  saveOriginal,
} from './v1/store'

export default function CompatImport() {
  const [items, setItems] = useState<
    { fileSha256: string; importedAt: string }[]
  >([])
  const [value, setValue] = useState<Validation | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = async () => setItems(await listOriginals())
  useEffect(() => {
    let mounted = true
    void listOriginals()
      .then((values) => {
        if (mounted) setItems(values)
      })
      .catch((e) => {
        if (mounted) setError(String(e))
      })
    return () => {
      mounted = false
    }
  }, [])
  async function action(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (e) {
      setValue(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  function download(bytes: Uint8Array) {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes).buffer], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'ofdm-compatible-original.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section aria-labelledby="compat-title">
      <h2 id="compat-title">OFDM 兼容记录</h2>
      <p>
        此独立入口验证并保存原始文件，供查看与导出；原 OFDM
        研究界面的导入和计算功能保持原样。
      </p>
      <label>
        选择原始 OFDM JSON{' '}
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file)
              void action(async () => {
                if (file.size > 8 * 1024 * 1024)
                  throw new Error('文件超过 8 MiB。')
                setValue(
                  await validateOriginal(
                    new Uint8Array(await file.arrayBuffer()),
                  ),
                )
                setNotice('记录验证通过；尚未保存。')
              })
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {value && (
        <div>
          <p>文件 SHA-256：{value.fileSha256}</p>
          <p>
            策略：{value.policyVersion}
            ；来源未认证；完整性、协议、帧及汇总校验通过。
          </p>
          <p>
            帧数：{value.record.trials.length}；协议：
            {value.record.protocolHash}
          </p>
          <details>
            <summary>查看实际统计与理论参考</summary>
            <table>
              <thead>
                <tr>
                  <th>布局</th>
                  <th>范围</th>
                  <th>信道</th>
                  <th>Eb/N0</th>
                  <th>方法</th>
                  <th>位数</th>
                  <th>误码</th>
                  <th>擦除</th>
                  <th>BER</th>
                  <th>理论参考</th>
                </tr>
              </thead>
              <tbody>
                {value.record.summary.map((row, i) => (
                  <tr key={i}>
                    <td>{row.layout}</td>
                    <td>{row.scope}</td>
                    <td>{row.channel}</td>
                    <td>{row.ebN0Db}</td>
                    <td>{row.method}</td>
                    <td>{row.bits}</td>
                    <td>{row.errors}</td>
                    <td>{row.erasedBits}</td>
                    <td>{row.ber ?? '含擦除'}</td>
                    <td>{row.idealTheoryBer ?? '不适用'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p>兼容比较：{value.comparisons.length} 项；原始理论值未修改。</p>
          {value.comparisons.length > 0 && (
            <details>
              <summary>查看兼容比较</summary>
              <ul>
                {value.comparisons.map((c) => (
                  <li key={c.path}>
                    {c.path}：{c.original} → 当前重算 {c.recomputed}（
                    {c.ulpDistance} ULP）
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const status = await saveOriginal(value)
                await refresh()
                setNotice(
                  status === 'saved' ? '原件已保存。' : '相同原件已存在。',
                )
              })
            }
          >
            保存原件
          </button>{' '}
          <button disabled={busy} onClick={() => download(value.originalBytes)}>
            导出原件
          </button>
        </div>
      )}
      <h3>已保存原件</h3>
      {items.length === 0 ? (
        <p>暂无记录。</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.fileSha256}>
              <span>
                {item.fileSha256}（{item.importedAt}）
              </span>{' '}
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setValue(await loadOriginal(item.fileSha256))
                    setNotice('已重新验证本地原件。')
                  })
                }
              >
                验证并查看
              </button>{' '}
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    download(await exportStoredOriginal(item.fileSha256)),
                  )
                }
              >
                导出保存的原件
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
