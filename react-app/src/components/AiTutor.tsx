import { useEffect, useRef, useState } from 'react'
import './AiTutor.css'
import ReportExport from './ReportExport'

export interface ExperimentContext {
  experiment: 'BPSK' | 'QPSK' | 'BER' | '16QAM' | 'COMPARISON'
  data: Record<string, unknown>
}
interface Message {
  role: 'user' | 'assistant'
  content: string
  snapshot?: string
}
const suggestions = [
  '解释本次实验结果',
  '为什么实测 BER 与理论不同？',
  '下一步怎么调参验证？',
]

export default function AiTutor({
  context,
  reportData,
}: {
  context: ExperimentContext | null
  reportData?: Record<string, unknown>
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      pending.current?.abort()
      pending.current = null
    },
    [],
  )

  async function ask(text: string) {
    if (!context || !text.trim() || text.length > 4000 || pending.current)
      return
    if (import.meta.env.VITE_STATIC_HOST === 'true') {
      setError(
        'GitHub Pages 不提供 AI 接口，请使用配置了模型服务的 Node 后端。',
      )
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    // Only completed turns enter history. Each question retains its own snapshot.
    const history = messages.slice(-10)
    const snapshot = JSON.stringify(context, null, 2)
    const user: Message = { role: 'user', content: text.trim(), snapshot }
    setMessages([...history, user])
    try {
      const payload = {
        context,
        messages: [
          ...history.map(({ role, content, snapshot: previous }) => ({
            role,
            content: previous
              ? `${content}\n当时实验快照：${previous}`
              : content,
          })),
          { role: 'user' as const, content: user.content },
        ],
      }
      while (
        new TextEncoder().encode(JSON.stringify(payload)).length > 60000 &&
        payload.messages.length > 1
      ) {
        payload.messages.splice(0, 2)
      }
      const response = await fetch('/api/ai-tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(55000),
        ]),
      })
      const data: { answer?: string; error?: string } = await response.json()
      if (
        !response.ok ||
        typeof data.answer !== 'string' ||
        !data.answer.trim()
      )
        throw new Error(data.error || '助教暂时无法回答，请重试。')
      if (pending.current !== controller) return
      setMessages([
        ...history,
        user,
        { role: 'assistant', content: data.answer },
      ])
      setQuestion('')
    } catch (cause) {
      if (pending.current !== controller) return
      setMessages(history)
      setQuestion(text)
      setError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? '等待回答超时，请重试。'
          : cause instanceof Error
            ? cause.message
            : '请求失败，请重试。',
      )
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setBusy(false)
      }
    }
  }

  function cancel() {
    pending.current?.abort()
    pending.current = null
    setMessages((previous) =>
      previous.at(-1)?.role === 'user' ? previous.slice(0, -1) : previous,
    )
    setBusy(false)
    setNotice('已取消本次提问。')
  }

  return (
    <>
      <details className="ai-tutor">
        <summary>AI 实验助教 · {context?.experiment ?? '等待有效实验'}</summary>
        <p>
          提问时会将本实验的参数、结果摘要及最近对话发送给已配置的模型服务。AI
          解释可能出错，请结合实验验证。
        </p>
        {context ? (
          <details className="ai-tutor-snapshot">
            <summary>查看将发送的实验快照</summary>
            <pre>{JSON.stringify(context, null, 2)}</pre>
          </details>
        ) : (
          <p>请先修正实验参数或运行 BER 扫描。</p>
        )}
        <div className="ai-tutor-actions">
          {suggestions.map((text) => (
            <button
              type="button"
              key={text}
              disabled={busy || !context}
              onClick={() => void ask(text)}
            >
              {text}
            </button>
          ))}
        </div>
        <div
          className="ai-tutor-messages"
          role="log"
          aria-label="助教对话"
          aria-live="polite"
        >
          {messages.map((message, index) => (
            <article key={index} className={`ai-tutor-${message.role}`}>
              <strong>{message.role === 'user' ? '你' : 'AI 助教'}</strong>
              <p>{message.content}</p>
              {message.snapshot && (
                <details>
                  <summary>本次提问的实验快照</summary>
                  <pre>{message.snapshot}</pre>
                </details>
              )}
            </article>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void ask(question)
          }}
        >
          <label>
            向实验助教提问
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              maxLength={4000}
              disabled={busy}
              placeholder="例如：增加比特数后，为什么更接近理论 BER？"
            />
          </label>
          <div className="ai-tutor-actions">
            <button
              type="submit"
              disabled={busy || !context || !question.trim()}
            >
              发送问题
            </button>
            {busy && (
              <button type="button" onClick={cancel}>
                取消回答
              </button>
            )}
            <button
              type="button"
              disabled={busy || messages.length === 0}
              onClick={() => {
                setMessages([])
                setError('')
                setNotice('对话已清空。')
              }}
            >
              清空对话
            </button>
          </div>
        </form>
        <p role="status">{busy ? '助教正在分析本次实验…' : notice}</p>
        {error && (
          <p role="alert" className="signal-error">
            {error}
          </p>
        )}
      </details>
      <ReportExport
        context={
          context
            ? { ...context, data: { ...context.data, ...reportData } }
            : null
        }
        messages={busy ? messages.slice(0, -1) : messages}
      />
    </>
  )
}
