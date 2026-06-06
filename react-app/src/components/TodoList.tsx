import { useState, type FormEvent } from 'react'
import './TodoList.css'

interface Todo {
  id: string
  text: string
  done: boolean
}

let nextId = 0

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [input, setInput] = useState('')

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return
    setTodos((prev) => [
      ...prev,
      { id: String(++nextId), text: trimmed, done: false },
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

  const undone = todos.filter((t) => !t.done).length

  return (
    <section className="todo-list">
      <h2>待办事项</h2>

      <form className="todo-form" onSubmit={handleAdd}>
        <input
          className="todo-input"
          type="text"
          placeholder="添加新的待办…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="todo-add-btn">
          添加
        </button>
      </form>

      {todos.length === 0 ? (
        <p className="todo-empty">还没有待办事项。</p>
      ) : (
        <ul className="todo-items">
          {todos.map((t) => (
            <li key={t.id} className={t.done ? 'todo-item done' : 'todo-item'}>
              <label className="todo-label">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => toggle(t.id)}
                />
                <span className="todo-text">{t.text}</span>
              </label>
              <button className="todo-del" onClick={() => remove(t.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="todo-footer">
        共 {todos.length} 项，{undone} 项未完成
      </footer>
    </section>
  )
}
