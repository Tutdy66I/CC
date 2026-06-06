import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react'
import './TodoList.css'

type Priority = 'low' | 'medium' | 'high'

interface Todo {
  id: string
  text: string
  done: boolean
  priority: Priority | null
}

const STORAGE_KEY = 'todo-list-v1'
const PRIORITIES: { value: Priority | null; label: string }[] = [
  { value: null, label: '--' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

function isTodo(t: unknown): t is Todo {
  return (
    typeof t === 'object' &&
    t !== null &&
    'id' in t &&
    'text' in t &&
    'done' in t
  )
}

function loadTodos(): { todos: Todo[]; nextId: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { todos: [], nextId: 0 }
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return { todos: [], nextId: 0 }
    const todos: Todo[] = arr.filter(isTodo)
    const maxId = todos.reduce(
      (max, t) => Math.max(max, Number(t.id) || 0),
      0,
    )
    return { todos, nextId: maxId }
  } catch {
    return { todos: [], nextId: 0 }
  }
}

export default function TodoList() {
  const [{ todos: initialTodos, nextId: initialId }] = useState(loadTodos)
  const nextId = useRef(initialId)
  const [todos, setTodos] = useState<Todo[]>(initialTodos)
  const [input, setInput] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return
    setTodos((prev) => [
      ...prev,
      {
        id: String(++nextId.current),
        text: trimmed,
        done: false,
        priority: null,
      },
    ])
    setInput('')
  }

  function toggle(id: string) {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    )
  }

  function remove(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  function setPriority(id: string, priority: Priority | null) {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, priority } : t)),
    )
  }

  const undone = todos.filter((t) => !t.done).length

  return (
    <section className="todo-list">
      <h2>Todo</h2>

      <form className="todo-form" onSubmit={handleAdd}>
        <input
          className="todo-input"
          type="text"
          placeholder="Add a new todo..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="todo-add-btn">
          Add
        </button>
      </form>

      {todos.length === 0 ? (
        <p className="todo-empty">No todos yet.</p>
      ) : (
        <ul className="todo-items">
          {todos.map((t) => (
            <li
              key={t.id}
              className={'todo-item' + (t.done ? ' done' : '')}
            >
              <label className="todo-label">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => toggle(t.id)}
                />
                <span className="todo-text">{t.text}</span>
              </label>
              <div className="todo-actions">
                {t.priority && (
                  <span className={`todo-priority prio-${t.priority}`}>
                    {t.priority}
                  </span>
                )}
                <select
                  className="todo-prio-select"
                  value={t.priority ?? ''}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setPriority(
                      t.id,
                      (e.target.value as Priority) || null,
                    )
                  }
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value ?? '_'} value={p.value ?? ''}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  className="todo-del"
                  onClick={() => remove(t.id)}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="todo-footer">
        {todos.length} item{todos.length !== 1 ? 's' : ''} · {undone} remaining
      </footer>
    </section>
  )
}
