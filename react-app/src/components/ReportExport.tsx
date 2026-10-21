import { useRef, useState } from 'react'
import {
  renderReport,
  type ReportFormat,
  type ReportMessage,
  type ReportSnapshot,
} from '../lib/reportExport'
import './ReportExport.css'

function captureCharts(
  root: Element,
  experiment: ReportSnapshot['context']['experiment'],
) {
  const selector =
    experiment === 'BPSK'
      ? ':scope > section[aria-label="波形可视化"] figure'
      : ':scope > figure'
  return Array.from(root.querySelectorAll(selector)).map((figure) => {
    const original = figure.querySelector('svg')
    if (!original) throw new Error('图表尚未就绪，请重试。')
    const clone = original.cloneNode(true) as SVGSVGElement
    const sources = [original, ...original.querySelectorAll('*')]
    const targets = [clone, ...clone.querySelectorAll('*')]
    sources.forEach((node, index) => {
      const style = getComputedStyle(node)
      for (const property of [
        'fill',
        'stroke',
        'stroke-width',
        'stroke-dasharray',
        'font-size',
        'font-family',
        'font-weight',
        'opacity',
      ]) {
        targets[index].setAttribute(property, style.getPropertyValue(property))
      }
      if (node.tagName.toLowerCase() === 'text')
        targets[index].setAttribute('fill', '#172033')
    })
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('style', 'background:white')
    const bytes = new TextEncoder().encode(
      new XMLSerializer().serializeToString(clone),
    )
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
      '',
    )
    return {
      title: figure.querySelector('figcaption')?.textContent ?? '实验图表',
      dataUrl: `data:image/svg+xml;base64,${btoa(binary)}`,
    }
  })
}

export default function ReportExport({
  context,
  messages,
}: {
  context: ReportSnapshot['context'] | null
  messages: ReportMessage[]
}) {
  const root = useRef<HTMLDivElement>(null)
  const [includeAi, setIncludeAi] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  function download(format: ReportFormat) {
    if (!context) return
    setError('')
    setStatus('')
    try {
      const scope = root.current?.closest(
        context.experiment === 'BPSK'
          ? '.signal-lab'
          : context.experiment === 'QPSK'
            ? '.qpsk-experiment'
            : context.experiment === '16QAM'
              ? '.qam-experiment'
              : context.experiment === 'COMPARISON'
                ? '.modulation-comparison'
                : '.signal-sweep',
      )
      if (!scope) throw new Error('找不到实验区域。')
      const snapshot: ReportSnapshot = structuredClone({
        generatedAt: new Date().toISOString(),
        context,
        charts: captureCharts(scope, context.experiment),
        messages: includeAi ? messages : [],
      })
      if (!snapshot.charts.length) throw new Error('图表尚未就绪，请重试。')
      const report = renderReport(snapshot, format)
      const url = URL.createObjectURL(
        new Blob([report], {
          type:
            format === 'html'
              ? 'text/html;charset=utf-8'
              : 'text/markdown;charset=utf-8',
        }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `SignalLab-${context.experiment}-${snapshot.generatedAt.replace(/[:.]/g, '-')}.${format}`
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      }
      setStatus(
        '已生成报告并发起下载。HTML 可离线打开，通过浏览器打印保存为 PDF。',
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '报告导出失败，请重试。',
      )
    }
  }
  return (
    <div
      className="report-export"
      ref={root}
      role="group"
      aria-label={`${context?.experiment ?? '实验'}报告导出`}
    >
      <h3>导出实验报告</h3>
      <p>
        保存当前参数、结果及图表；HTML 可打印为 PDF，Markdown 便于编辑。Markdown
        内嵌图片需阅读器支持。
      </p>
      <label>
        <input
          type="checkbox"
          checked={includeAi}
          onChange={(event) => setIncludeAi(event.target.checked)}
        />{' '}
        附带本实验已有 AI 问答及历史快照（仅包含已完成回答）
      </label>
      <div className="report-export-actions">
        <button
          type="button"
          disabled={!context}
          onClick={() => download('html')}
        >
          导出 HTML 报告
        </button>
        <button
          type="button"
          disabled={!context}
          onClick={() => download('md')}
        >
          导出 Markdown 报告
        </button>
      </div>
      {!context && <p>请先修正实验参数或启动扫描。</p>}
      <p role="status">{status}</p>
      {error && (
        <p role="alert" className="signal-error">
          {error}
        </p>
      )}
    </div>
  )
}
