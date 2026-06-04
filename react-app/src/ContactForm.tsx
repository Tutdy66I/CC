import { useState, type FormEvent } from 'react'
import './ContactForm.css'

interface FormData {
  name: string
  email: string
  topic: string
  message: string
}

interface FormErrors {
  name?: string
  email?: string
  topic?: string
  message?: string
}

function ContactForm() {
  const [form, setForm] = useState<FormData>({
    name: '',
    email: '',
    topic: '',
    message: '',
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [submitted, setSubmitted] = useState(false)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    // 输入时清除对应错误
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
    }
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!form.name.trim()) {
      newErrors.name = '请输入姓名'
    } else if (form.name.trim().length < 2) {
      newErrors.name = '姓名至少 2 个字符'
    }

    if (!form.email.trim()) {
      newErrors.email = '请输入邮箱'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = '邮箱格式不正确'
    }

    if (!form.topic) {
      newErrors.topic = '请选择一个主题'
    }

    if (!form.message.trim()) {
      newErrors.message = '请输入留言内容'
    } else if (form.message.trim().length < 10) {
      newErrors.message = '留言内容至少 10 个字符'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (validate()) {
      console.log('📬 表单提交:', form)
      setSubmitted(true)
    }
  }

  if (submitted) {
    return (
      <section className="form-section">
        <div className="form-success">
          <span className="success-icon">✅</span>
          <h2>提交成功！</h2>
          <p>感谢你，<strong>{form.name}</strong>。我们会尽快回复到 {form.email}</p>
          <button className="btn-reset" onClick={() => { setSubmitted(false); setForm({ name: '', email: '', topic: '', message: '' }) }}>
            再填一次
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="form-section">
      <h2>联系我们</h2>
      <p className="form-subtitle">有问题或建议？请填写下方表单</p>

      <form className="contact-form" onSubmit={handleSubmit} noValidate>
        {/* 姓名 */}
        <div className={`field ${errors.name ? 'field-error' : ''}`}>
          <label htmlFor="name">姓名</label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder="请输入你的姓名"
            value={form.name}
            onChange={handleChange}
          />
          {errors.name && <span className="error-text">{errors.name}</span>}
        </div>

        {/* 邮箱 */}
        <div className={`field ${errors.email ? 'field-error' : ''}`}>
          <label htmlFor="email">邮箱</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="example@mail.com"
            value={form.email}
            onChange={handleChange}
          />
          {errors.email && <span className="error-text">{errors.email}</span>}
        </div>

        {/* 主题 */}
        <div className={`field ${errors.topic ? 'field-error' : ''}`}>
          <label htmlFor="topic">主题</label>
          <select id="topic" name="topic" value={form.topic} onChange={handleChange}>
            <option value="" disabled>请选择主题</option>
            <option value="bug">报告 Bug</option>
            <option value="feature">功能建议</option>
            <option value="question">技术问题</option>
            <option value="other">其他</option>
          </select>
          {errors.topic && <span className="error-text">{errors.topic}</span>}
        </div>

        {/* 留言 */}
        <div className={`field ${errors.message ? 'field-error' : ''}`}>
          <label htmlFor="message">留言内容</label>
          <textarea
            id="message"
            name="message"
            rows={4}
            placeholder="请描述你的问题或建议…"
            value={form.message}
            onChange={handleChange}
          />
          {errors.message && <span className="error-text">{errors.message}</span>}
        </div>

        <button type="submit" className="btn-submit">提交</button>
      </form>
    </section>
  )
}

export default ContactForm
