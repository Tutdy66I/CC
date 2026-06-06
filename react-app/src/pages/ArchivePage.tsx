import { posts } from '../lib/markdown'

interface Props {
  onSelect: (slug: string) => void
}

interface YearGroup {
  year: string
  months: MonthGroup[]
}

interface MonthGroup {
  month: string
  items: typeof posts
}

function groupByYear(): YearGroup[] {
  const map = new Map<string, MonthGroup[]>()
  for (const p of posts) {
    if (!p.date) continue
    const [year, month] = p.date.split('-')
    if (!year) continue
    const y = map.get(year) ?? []
    let m = y.find((g) => g.month === month)
    if (!m) {
      m = { month: month ?? '??', items: [] }
      y.push(m)
    }
    m.items.push(p)
    map.set(year, y)
  }
  return [...map.entries()]
    .map(([year, months]) => ({
      year,
      months: months.sort((a, b) => b.month.localeCompare(a.month)),
    }))
    .sort((a, b) => b.year.localeCompare(a.year))
}

export default function ArchivePage({ onSelect }: Props) {
  const groups = groupByYear()

  if (groups.length === 0) {
    return (
      <div className="archive-page">
        <h1 className="archive-heading">Archive</h1>
        <p className="blog-empty">No posts yet.</p>
      </div>
    )
  }

  return (
    <div className="archive-page">
      <h1 className="archive-heading">Archive</h1>
      {groups.map(({ year, months }) => (
        <section key={year} className="archive-year">
          <h2 className="archive-year-heading">{year}</h2>
          {months.map(({ month, items }) => (
            <div key={month} className="archive-month">
              <h3 className="archive-month-heading">
                {new Date(Number(year), Number(month) - 1).toLocaleString(
                  'default',
                  { month: 'long' },
                )}
              </h3>
              <ul className="archive-posts">
                {items.map((p) => (
                  <li key={p.slug}>
                    <button
                      className="archive-post-link"
                      onClick={() => onSelect(p.slug)}
                    >
                      <span className="archive-post-date">
                        {month}-{p.date.split('-')[2] ?? '??'}
                      </span>
                      <span className="archive-post-title">{p.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
