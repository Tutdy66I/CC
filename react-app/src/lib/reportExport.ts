import { theoreticalBpskBer, type BerPoint } from './berSweep.js'
import { theoreticalQam16Ber } from './qam16.js'
import type { ComparisonPoint } from './modulationComparison.js'

export interface ReportMessage {
  role: 'user' | 'assistant'
  content: string
  snapshot?: string
}
export interface ReportSnapshot {
  generatedAt: string
  context: {
    experiment: 'BPSK' | 'QPSK' | 'BER' | '16QAM' | 'COMPARISON'
    data: Record<string, unknown>
  }
  charts: { title: string; dataUrl: string }[]
  messages: ReportMessage[]
}
export type ReportFormat = 'html' | 'md'
const labels: Record<string, string> = {
  bits: '比特数',
  seed: '随机种子',
  ebN0Db: 'Eb/N0 (dB)',
  noiseEnabled: '启用 AWGN',
  errors: '误码数',
  ber: '实测 BER',
  theoretical: '理论 BER',
  symbols: '符号数',
  modulation: '调制方式',
  evmPercent: '参考辅助 RMS EVM (%)',
  evmDb: 'RMS EVM (dB，零误差为负无穷)',
}
const statusLabels: Record<string, string> = {
  idle: '未运行',
  running: '运行中（未完成）',
  done: '已完成',
  cancelled: '已取消（未完成）',
  error: '失败（未完成）',
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  )
const valueText = (value: unknown) =>
  typeof value === 'boolean'
    ? value
      ? '是'
      : '否'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)

export function renderReport(
  snapshot: ReportSnapshot,
  format: ReportFormat,
): string {
  const html = format === 'html'
  const text = (value: string) =>
    html
      ? escapeHtml(value)
      : escapeHtml(value)
          .replace(/[\\`*_[\]{}|#!]/g, '\\$&')
          .replace(/\r?\n/g, '<br>')
  const heading = (title: string) =>
    html ? `<h2>${text(title)}</h2>` : `\n## ${text(title)}\n`
  const paragraph = (content: string) =>
    html ? `<p>${text(content)}</p>` : `\n${text(content)}\n`
  const pre = (content: string) =>
    html ? `<pre>${escapeHtml(content)}</pre>` : paragraph(content)
  const table = (headers: string[], rows: string[][]) =>
    html
      ? `<table><thead><tr>${headers.map((cell) => `<th scope="col">${text(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${text(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : `\n| ${headers.map(text).join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.map(text).join(' | ')} |`).join('\n')}\n`
  const { experiment, data } = snapshot.context
  const title = `SignalLab ${experiment} 实验报告`
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(new Date(snapshot.generatedAt))
  let body = html ? `<h1>${title}</h1>` : `# ${title}\n`
  body += paragraph(
    `SignalLab v1.1 · 生成时间：${time}（Asia/Hong_Kong，UTC+08:00）`,
  )
  body += heading('实验参数与结果')
  const rows = Object.entries(data)
    .filter(
      ([key, value]) =>
        ![
          'points',
          'run',
          'status',
          'inputBits',
          'decodedBits',
          'samples',
        ].includes(key) &&
        value !== null &&
        value !== undefined,
    )
    .map(([key, value]) => [labels[key] ?? key, valueText(value)])
  if (experiment === 'BER' || experiment === 'COMPARISON') {
    const run = data.run as { bits: number; seed: number }
    rows.push(['每点比特数', String(run.bits)], ['基础种子', String(run.seed)])
  } else if (
    data.noiseEnabled === true &&
    typeof data.ebN0Db === 'number' &&
    data.theoretical === undefined
  ) {
    rows.push([
      '理论 BER',
      String(
        experiment === '16QAM'
          ? theoreticalQam16Ber(data.ebN0Db)
          : theoreticalBpskBer(data.ebN0Db),
      ),
    ])
  }
  body += table(['项目', '数值'], rows)
  if (typeof data.inputBits === 'string')
    body += heading('输入比特（完整）') + pre(data.inputBits)
  if (typeof data.decodedBits === 'string')
    body += heading('恢复比特（完整）') + pre(data.decodedBits)
  if (Array.isArray(data.samples) && data.samples.length) {
    const samples = data.samples as Record<string, unknown>[]
    const columns = Object.keys(samples[0])
    const sampleLabels: Record<string, string> = {
      index: '序号',
      sent: '发送比特',
      received: '接收采样',
      decoded: '恢复比特',
      i: '接收 I',
      q: '接收 Q',
    }
    body += heading(
      `采样明细（前 ${samples.length} ${experiment === 'QPSK' || experiment === '16QAM' ? '个符号' : '比特'}）`,
    )
    body += table(
      columns.map((key) => sampleLabels[key] ?? key),
      samples.map((sample) => columns.map((key) => valueText(sample[key]))),
    )
  }
  if (experiment === 'BER') {
    const points = data.points as BerPoint[]
    body += paragraph(
      `扫描状态：${statusLabels[String(data.status)] ?? String(data.status)}；已完成 ${points.length}/8 点。仅导出已完成点；未计算的点不推断。`,
    )
    body += paragraph(
      '扫描 −4 至 10 dB、步长 2 dB，交替01比特；第 i 点种子=(基础种子+i) mod 2^32，i从0开始。',
    )
    body += heading('BER 逐点数据')
    body += table(
      [
        'Eb/N0 (dB)',
        '种子',
        '比特数',
        '误码数',
        '实测 BER',
        '理论 BER',
        '区间类型',
        '下界',
        '上界',
      ],
      points.map((point) =>
        [
          point.ebN0Db,
          point.seed,
          point.bits,
          point.errors,
          point.ber,
          point.theoretical,
          point.interval.kind === 'zero-upper'
            ? '单侧95%上限'
            : '双侧95% Wilson',
          point.interval.lower,
          point.interval.upper,
        ].map(String),
      ),
    )
  }
  body += heading('图表快照')
  if (experiment === 'COMPARISON') {
    const points = data.points as ComparisonPoint[]
    body += paragraph(
      `比较状态：${statusLabels[String(data.status)] ?? String(data.status)}；已完成 ${points.length}/30 点，仅包含实际完成点。`,
    )
    body += table(
      [
        '调制',
        'Eb/N0 (dB)',
        '种子',
        '比特数',
        '误码数',
        '实测 BER',
        '理论 BER',
        '参考辅助 RMS EVM (%)',
      ],
      points.map((point) =>
        [
          point.modulation,
          point.ebN0Db,
          point.seed,
          point.bits,
          point.errors,
          point.ber,
          point.theoretical,
          point.evm.percent,
        ].map(String),
      ),
    )
    body += paragraph(
      '64比特循环依次发送0000至1111。三种调制相同比特数与Eb/N0；第i个SNR种子=(基础种子+i) mod 2^32。BPSK/QPSK共用逐位噪声，因此实测BER完全重合。此比较不提供置信带，零误码不等于真实BER为零。',
    )
  }
  if (!snapshot.charts.length)
    body += paragraph('未捕获图表，请返回实验页面重试导出。')
  for (const chart of snapshot.charts) {
    if (!/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(chart.dataUrl))
      throw new Error('图表格式无效。')
    body += html
      ? `<figure><img src="${chart.dataUrl}" alt="${text(chart.title)}"><figcaption>${text(chart.title)}</figcaption></figure>`
      : `\n![${text(chart.title)}](${chart.dataUrl})\n`
  }
  body += heading('模型与统计说明')
  body += paragraph(
    'EVM RMS=√(Σ|r−s|²/Σ|s|²)，按全部输入、实际发送信号归一化，不采用判决后重建参考，不作增益/相位/频偏补偿。零EVM的dB为−∞。BPSK仅测实轴，不等同于二维RF EVM。',
  )
  if (experiment === '16QAM' || experiment === 'COMPARISON')
    body += paragraph(
      'Gray 16QAM：每四位前两位控制I、后两位控制Q，各轴00/01/11/10→−3a/−a/+a/+3a，a=√(2/5)；均匀星座平均Es=4、Eb=1。短输入不重新缩放。精确理论BER=3/4 Q(d)+1/2 Q(3d)−1/4 Q(5d)，d=√(0.8×10^(Eb/N0[dB]/10))。',
    )
  body += paragraph(
    '单位比特能量 Eb=1；BPSK：0→+1，1→−1。Gray QPSK：第一位控制I、第二位控制Q，Es=2；每轴以0为判决阈值。AWGN每轴方差=1/(2×10^(Eb/N0[dB]/10))。',
  )
  body += paragraph(
    data.noiseEnabled === false
      ? '已关闭噪声：当前 Eb/N0 不参与计算，不应用有噪声理论 BER 数值。'
      : '相干检测、理想同步与 AWGN 条件下，BPSK 与 Gray QPSK 的理论 BER=½·erfc(√(10^(Eb/N0[dB]/10)))。',
  )
  body += paragraph(
    '实测 BER=误码数/比特数。有限样本会波动；零误码不代表真实 BER 为零。原BPSK扫描中零误码使用单侧95%上限 1−0.05^(1/N)，其他点使用双侧95% Wilson区间；它们是逐点区间，不是整条曲线的同时置信带。三调制比较不提供这些区间。',
  )
  body += paragraph(
    experiment === 'QPSK' || experiment === '16QAM'
      ? '星座图仅显示前500个符号，等比例I/Q轴；蓝点为正确接收，红叉为误判，空心圆为理想点；BER按全部比特计算。'
      : experiment === 'BPSK'
        ? '波形仅显示前32比特；BER按全部比特计算。载波为无噪声示意，接收图为匹配滤波采样，不是射频时域噪声波形。'
        : experiment === 'COMPARISON'
          ? '曲线为对数纵轴，零误码在底部以叉号标记，不赋予对数BER值，也不代表置信上限。'
          : '曲线为对数纵轴；零误码三角形表示上限，不接入实测折线。',
  )
  body += heading('AI 解释与历史快照')
  body += paragraph(
    'AI 解释为模型生成，可能有误，不属于实测数据。每个问题保留当时快照，可能与本报告当前参数不同。导出不会调用模型。',
  )
  body += snapshot.messages.length
    ? snapshot.messages
        .map(
          (message) =>
            paragraph(message.role === 'user' ? '提问' : 'AI 助教') +
            pre(message.content) +
            (message.snapshot
              ? paragraph('提问时实验快照') + pre(message.snapshot)
              : ''),
        )
        .join('')
    : paragraph('本报告未包含 AI 问答。')
  if (!html) return body
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${title}</title><style>body{max-width:960px;margin:32px auto;padding:0 20px;font:15px/1.7 system-ui,sans-serif;color:#172033;background:white}h1{font-size:28px}h2{margin-top:32px}table{width:100%;border-collapse:collapse;font-size:12px;overflow-wrap:anywhere}td,th{border:1px solid #ccd2dc;padding:7px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:12px}figure{margin:24px 0;break-inside:avoid}img{display:block;width:100%;max-height:560px;object-fit:contain}figcaption{font-size:13px;color:#475569}p{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none;padding:0;font-size:11px}h2{break-after:avoid}thead{display:table-header-group}tr{break-inside:avoid}img{max-height:135mm}@page{size:A4;margin:16mm}}</style></head><body>${body}</body></html>`
}
