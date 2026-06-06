import './TagBar.css'

interface Props {
  tags: { tag: string; count: number }[]
  selected: string | null
  onSelect: (tag: string | null) => void
}

export default function TagBar({ tags, selected, onSelect }: Props) {
  if (tags.length === 0) return null

  return (
    <div className="tag-bar">
      <button
        className={selected === null ? 'tag-pill active' : 'tag-pill'}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          className={selected === tag ? 'tag-pill active' : 'tag-pill'}
          onClick={() => onSelect(selected === tag ? null : tag)}
        >
          {tag}
          <span className="tag-count">{count}</span>
        </button>
      ))}
    </div>
  )
}
